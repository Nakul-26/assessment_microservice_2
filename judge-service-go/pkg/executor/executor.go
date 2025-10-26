package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"log"
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

// RunSubmission executes user code in a Docker container
func (e *Executor) RunSubmission(ctx context.Context, languageImage string, userCode, fileName string, runCmd []string, timeout time.Duration) (string, string, error) {
	// Ensure the image exists, pull if not
	if err := e.pullImage(ctx, languageImage); err != nil {
		return "", "", fmt.Errorf("failed to pull image %s: %w", languageImage, err)
	}

	pidsLimit := int64(1024)
	// Create container
	containerOptions := docker.CreateContainerOptions{
		Config: &docker.Config{
			Image:        languageImage,
			Cmd:          runCmd,
			WorkingDir:   "/app",
			Tty:          false,
			AttachStdout: true,
			AttachStderr: true,
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

	// Copy user code into container
	if err := e.copyToContainer(ctx, containerID, "/app", fileName, userCode); err != nil {
		return "", "", fmt.Errorf("failed to copy code to container: %w", err)
	}

	// Start container
	if err := e.cli.StartContainer(containerID, nil); err != nil {
		return "", "", fmt.Errorf("failed to start container: %w", err)
	}

	// Set up a timeout for the container execution
	resultChan := make(chan error, 1)
	var stdoutBuf, stderrBuf bytes.Buffer

	go func() {
		// Attach to container logs
		logOptions := docker.LogsOptions{
			Context:      ctx,
			Container:    containerID,
			Stdout:       true,
			Stderr:       true,
			Follow:       true,
			Timestamps:   false,
			OutputStream: &stdoutBuf,
			ErrorStream:  &stderrBuf,
		}
		err := e.cli.Logs(logOptions)
		if err != nil {
			resultChan <- fmt.Errorf("failed to get container logs: %w", err)
			return
		}

		// Wait for container to finish
		statusCode, err := e.cli.WaitContainerWithContext(containerID, ctx)
		if err != nil {
			resultChan <- fmt.Errorf("error waiting for container: %w", err)
			return
		}
		if statusCode != 0 {
			resultChan <- fmt.Errorf("container exited with non-zero status: %d", statusCode)
			return
		}
		resultChan <- nil
	}()

	select {
	case err := <-resultChan:
		if err != nil {
			return stdoutBuf.String(), stderrBuf.String(), err
		}
		return stdoutBuf.String(), stderrBuf.String(), nil
	case <-time.After(timeout):
		// Timeout occurred, kill the container
		log.Printf("Container %s timed out, killing...", containerID)
		if err := e.cli.KillContainer(docker.KillContainerOptions{ID: containerID, Context: ctx}); err != nil {
			log.Printf("Failed to kill container %s: %v", containerID, err)
		}
		return stdoutBuf.String(), stderrBuf.String(), fmt.Errorf("execution timed out after %s", timeout)
	}
}

// pullImage pulls a Docker image if it's not available locally
func (e *Executor) pullImage(ctx context.Context, image string) error {
	// Check if image exists locally
	_, err := e.cli.InspectImage(image)
	if err != nil && err != docker.ErrNoSuchImage {
		return fmt.Errorf("failed to inspect image %s: %w", image, err)
	}

	if err == docker.ErrNoSuchImage {
		log.Printf("Pulling image: %s", image)
		pullOptions := docker.PullImageOptions{
			Repository: image,
			Context:    ctx,
		}
		// The go-dockerclient PullImage method writes progress to os.Stdout by default
		err = e.cli.PullImage(pullOptions, docker.AuthConfiguration{})
		if err != nil {
			return fmt.Errorf("failed to pull image %s: %w", image, err)
		}
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

// logWriter is a simple io.Writer to capture logs (no longer needed with bytes.Buffer)
type logWriter struct {
	buf []byte
}

func (lw *logWriter) Write(p []byte) (n int, err error) {
	lw.buf = append(lw.buf, p...)
	return len(p), nil
}

func (lw *logWriter) Bytes() []byte {
	return lw.buf
}
