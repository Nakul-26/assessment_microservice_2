package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	docker "github.com/fsouza/go-dockerclient"
)

// Executor holds the Docker client
type Executor struct {
	cli *docker.Client
}

// NewExecutor creates a new Executor instance
func NewExecutor() (*Executor, error) {
	// Try to connect to Docker daemon via environment variables
	cli, err := docker.NewClientFromEnv()
	if err != nil {
		// Fallback to default Unix socket if environment variables are not set
		cli, err = docker.NewClient("unix:///var/run/docker.sock")
		if err != nil {
			return nil, fmt.Errorf("failed to create docker client: %w", err)
		}
	}
	return &Executor{cli: cli}, nil
}

// runExecWithTimeout handles the full lifecycle of creating, running, and waiting for an exec instance.
func (e *Executor) runExecWithTimeout(ctx context.Context, containerID string, cmd []string, timeout time.Duration) (string, string, int, error) {
	var stdoutBuf, stderrBuf bytes.Buffer

	execOpts := docker.CreateExecOptions{
		Container:    containerID,
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
		Context:      ctx,
	}
	exec, err := e.cli.CreateExec(execOpts)
	if err != nil {
		return "", "", -1, fmt.Errorf("failed to create exec: %w", err)
	}

	// Channel to signal completion
	done := make(chan error, 1)
	go func() {
		startExecOptions := docker.StartExecOptions{
			OutputStream: &stdoutBuf,
			ErrorStream:  &stderrBuf,
			Context:      ctx,
		}
		err := e.cli.StartExec(exec.ID, startExecOptions)
		// Wait for the exec to finish. StartExec is non-blocking, but the underlying stream operations will block.
		// Inspecting after it's done gives us the exit code.
		if err != nil {
			done <- fmt.Errorf("failed to start exec: %w", err)
			return
		}
		done <- nil
	}()

	// Wait for completion or timeout
	select {
	case err := <-done:
		if err != nil {
			return stdoutBuf.String(), stderrBuf.String(), -1, err
		}
	case <-time.After(timeout):
		// The execution timed out. The container will be stopped by the deferred function in RunSubmission.
		log.Printf("Execution timed out after %v for command: %v", timeout, cmd)
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("execution timed out after %v", timeout)
	case <-ctx.Done():
		return stdoutBuf.String(), stderrBuf.String(), -1, ctx.Err()
	}

	// Inspect the exec to get the exit code
	inspect, err := e.cli.InspectExec(exec.ID)
	if err != nil {
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("failed to inspect exec: %w", err)
	}

	return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, nil
}

// RunSubmission executes user code in a Docker container
func (e *Executor) RunSubmission(ctx context.Context, languageImage string, files []string, tempDir string, compileCmd []string, runCmd []string, timeout time.Duration) (string, string, error) {
	// Ensure the image exists, pull if not
	if err := e.pullImage(ctx, languageImage); err != nil {
		return "", "", fmt.Errorf("failed to pull image %s: %w", languageImage, err)
	}

	pidsLimit := int64(1024)
	// Create container with a long-running command to keep it alive
	containerOptions := docker.CreateContainerOptions{
		Config: &docker.Config{
			Image:      languageImage,
			Cmd:        []string{"tail", "-f", "/dev/null"}, // Keep container alive
			WorkingDir: "/app",
			Tty:        false,
		},
		HostConfig: &docker.HostConfig{
			AutoRemove:  true,
			NetworkMode: "none",
			Memory:      256 * 1024 * 1024, // 256 MB
			CPUQuota:    50000,             // 50% of one CPU core
			PidsLimit:   &pidsLimit,
		},
	}
	container, err := e.cli.CreateContainer(containerOptions)
	if err != nil {
		return "", "", fmt.Errorf("failed to create container: %w", err)
	}

	containerID := container.ID
	// Use a context with cancel to ensure cleanup happens
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Defer stopping the container. The timeout '1' is a grace period.
	defer func() {
		log.Printf("Stopping container %s", containerID)
		stopErr := e.cli.StopContainer(containerID, 1)
		if stopErr != nil {
			// Log if the container couldn't be stopped, but don't mask the original error.
			log.Printf("Failed to stop container %s: %v", containerID, stopErr)
		}
	}()

	// Start the container
	if err := e.cli.StartContainer(containerID, nil); err != nil {
		return "", "", fmt.Errorf("failed to start container: %w", err)
	}

	        // Copy files into container
	        for _, file := range files {
	            content, err := os.ReadFile(filepath.Join(tempDir, file))
	            if err != nil {
	                return "", "", fmt.Errorf("failed to read file %s: %w", file, err)
	            }
	            containerFileName := file
	            if file == "submission.py" {
	                containerFileName = "solution.py"
	            } else if file == "submission.java" {
	                containerFileName = "Main.java"
	            }
	            if err := e.copyToContainer(ctx, containerID, "/app", containerFileName, string(content)); err != nil {
	                return "", "", fmt.Errorf("failed to copy file %s to container: %w", file, err)
	            }
	        }
	// Run compile command if it exists
	if len(compileCmd) > 0 {
		compileStdout, compileStderr, exitCode, err := e.runExecWithTimeout(ctx, containerID, compileCmd, timeout)
		if err != nil {
			return compileStdout, compileStderr, fmt.Errorf("compilation command failed: %w", err)
		}
		if exitCode != 0 {
			return compileStdout, compileStderr, fmt.Errorf("compilation failed with exit code %d", exitCode)
		}
	}

	// Run the actual command
	runStdout, runStderr, exitCode, err := e.runExecWithTimeout(ctx, containerID, runCmd, timeout)
	if err != nil {
		// If there's a timeout or context error, we still want to return any output captured
		return runStdout, runStderr, fmt.Errorf("execution command failed: %w", err)
	}
	if exitCode != 0 {
		// For non-zero exits, we still return the output, but also the error
		return runStdout, runStderr, fmt.Errorf("execution failed with exit code %d", exitCode)
	}

	return runStdout, runStderr, nil
}

// pullImage pulls a Docker image if it's not available locally
func (e *Executor) pullImage(ctx context.Context, image string) error {
	// Check if image exists locally
	_, err := e.cli.InspectImage(image)
	if err == nil {
		return nil // Image exists
	}
	if err != docker.ErrNoSuchImage {
		return fmt.Errorf("failed to inspect image %s: %w", image, err)
		// bigdecimal
	}

	log.Printf("Pulling image: %s", image)
	pullOptions := docker.PullImageOptions{
		Repository:   image,
		Context:      ctx,
		OutputStream: io.Discard, // Suppress verbose pull output
	}
	auth := docker.AuthConfiguration{} // Assuming public images
	err = e.cli.PullImage(pullOptions, auth)
	if err != nil {
		return fmt.Errorf("failed to pull image %s: %w", image, err)
	}

	return nil
}

// copyToContainer copies content to a file inside the container
func (e *Executor) copyToContainer(ctx context.Context, containerID, destPath, fileName, content string) error {
	// Create a tar archive in memory
	var buf bytes.Buffer
	tarWriter := tar.NewWriter(&buf)

	header := &tar.Header{
		Name: fileName,
		Size: int64(len(content)),
		Mode: 0755,
	}
	if err := tarWriter.WriteHeader(header); err != nil {
		return fmt.Errorf("error writing tar header: %w", err)
	}
	if _, err := tarWriter.Write([]byte(content)); err != nil {
		return fmt.Errorf("error writing tar content: %w", err)
	}
	tarWriter.Close()

	// Upload the tar archive to the container
	return e.cli.UploadToContainer(containerID, docker.UploadToContainerOptions{
		Context:     ctx,
		Path:        destPath,
		InputStream: &buf,
	})
}
