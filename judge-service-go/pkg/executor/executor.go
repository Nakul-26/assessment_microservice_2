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
	"strings"
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
	execObj, err := e.cli.CreateExec(execOpts)
	if err != nil {
		return "", "", -1, fmt.Errorf("failed to create exec: %w", err)
	}

	// Use a child context with timeout so it cancels the StartExec if needed.
	childCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		startExecOptions := docker.StartExecOptions{
			OutputStream: &stdoutBuf,
			ErrorStream:  &stderrBuf,
			Context:      childCtx,
		}
		// StartExec will return when the attached streams close or context canceled.
		if err := e.cli.StartExec(execObj.ID, startExecOptions); err != nil {
			done <- fmt.Errorf("failed to start exec: %w", err)
			return
		}
		done <- nil
	}()

	select {
	case err := <-done:
		if err != nil {
			return stdoutBuf.String(), stderrBuf.String(), -1, err
		}
	case <-childCtx.Done():
		// timed out or cancelled
		if childCtx.Err() == context.DeadlineExceeded {
			log.Printf("[container=%s] exec timed out after %v: %v", containerID, timeout, cmd)
			return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("execution timed out after %v", timeout)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, childCtx.Err()
	case <-ctx.Done():
		// caller cancelled
		return stdoutBuf.String(), stderrBuf.String(), -1, ctx.Err()
	}

	// Inspect exec to get exit code
	inspect, err := e.cli.InspectExec(execObj.ID)
	if err != nil {
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("failed to inspect exec: %w", err)
	}

	return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, nil
}

// RunSubmission executes user code in a Docker container
func (e *Executor) RunSubmission(ctx context.Context, languageImage string, files []string, tempDir string, compileCmd []string, runCmd []string, timeout time.Duration) (string, string, error) {
	// Pull image
	if err := e.pullImage(ctx, languageImage); err != nil {
		return "", "", fmt.Errorf("failed to pull image %s: %w", languageImage, err)
	}

	// Overall submission timeout derived from provided timeout (multiply by factor) or environment.
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	// Decide user. Prefer numeric UID if set, else do not force "judge" name to avoid missing passwd entry.
	user := os.Getenv("JUDGE_USER")   // e.g., "judge"
	uid := os.Getenv("JUDGE_UID")     // e.g., "1000"
	var containerUser string
	if uid != "" {
		containerUser = uid
	} else if user != "" {
		containerUser = user
	} else {
		containerUser = "" // let image default to its default user
	}

	pidsLimit := int64(1024)

	hostCfg := &docker.HostConfig{
		AutoRemove:     true,
		NetworkMode:    "none",
		ReadonlyRootfs: false, // Set to false to allow writing files
		Memory:         256 * 1024 * 1024,
		CPUQuota:       50000,
		PidsLimit:      &pidsLimit,
	}

	containerOptions := docker.CreateContainerOptions{
		Config: &docker.Config{
			Image:      languageImage,
			Cmd:        []string{"tail", "-f", "/dev/null"},
			WorkingDir: "/app",
			Tty:        false,
		},
		HostConfig: hostCfg,
	}

	// If containerUser configured, set it
	if containerUser != "" {
		containerOptions.Config.User = containerUser
	}

	container, err := e.cli.CreateContainer(containerOptions)
	if err != nil {
		return "", "", fmt.Errorf("failed to create container: %w", err)
	}
	containerID := container.ID

	// Ensure container is stopped on exit
	defer func() {
		log.Printf("[container=%s] stopping container", containerID)
		_ = e.cli.StopContainer(containerID, 1)
	}()

	// Start container
	if err := e.cli.StartContainer(containerID, nil); err != nil {
		return "", "", fmt.Errorf("failed to start container: %w", err)
	}

	// Copy files into container
	for _, file := range files {
		content, err := os.ReadFile(filepath.Join(tempDir, file))
		if err != nil {
			return "", "", fmt.Errorf("failed to read file %s: %w", file, err)
		}
		if err := e.copyToContainer(subCtx, containerID, "/app", file, string(content)); err != nil {
			return "", "", fmt.Errorf("failed to copy file %s to container: %w", file, err)
		}
	}

	// Compile step (if present)
	if len(compileCmd) > 0 {
		compileStdout, compileStderr, exitCode, err := e.runExecWithTimeout(subCtx, containerID, compileCmd, timeout)
		if err != nil {
			return compileStdout, compileStderr, fmt.Errorf("compilation command failed: %w", err)
		}
		if exitCode != 0 {
			return compileStdout, compileStderr, fmt.Errorf("compilation failed with exit code %d", exitCode)
		}
	}

	// Run step
	runStdout, runStderr, exitCode, err := e.runExecWithTimeout(subCtx, containerID, runCmd, timeout)
	if err != nil {
		return runStdout, runStderr, fmt.Errorf("execution command failed: %w", err)
	}
	if exitCode != 0 {
		return runStdout, runStderr, fmt.Errorf("execution failed with exit code %d", exitCode)
	}

	return runStdout, runStderr, nil
}

// pullImage pulls a Docker image if it's not available locally
func (e *Executor) pullImage(ctx context.Context, image string) error {
	// If image exists locally, skip
	if _, err := e.cli.InspectImage(image); err == nil {
		return nil
	} else if err != docker.ErrNoSuchImage {
		return fmt.Errorf("failed to inspect image %s: %w", image, err)
	}

	// Parse image into repository and tag
	repo, tag := image, "latest"
	if strings.Contains(image, ":") {
		parts := strings.SplitN(image, ":", 2)
		repo, tag = parts[0], parts[1]
	}

	log.Printf("Pulling image: %s:%s", repo, tag)
	pullOptions := docker.PullImageOptions{
		Repository:   repo,
		Tag:          tag,
		Context:      ctx,
		OutputStream: io.Discard,
	}
	auth := docker.AuthConfiguration{}
	if err := e.cli.PullImage(pullOptions, auth); err != nil {
		return fmt.Errorf("failed to pull image %s: %w", image, err)
	}
	return nil
}

// copyToContainer copies content to a file inside the container
func (e *Executor) copyToContainer(ctx context.Context, containerID, destPath, fileName, content string) error {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	header := &tar.Header{
		Name: fileName,
		Size: int64(len(content)),
		Mode: 0644,
	}
	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("error writing tar header: %w", err)
	}
	if _, err := tw.Write([]byte(content)); err != nil {
		return fmt.Errorf("error writing tar content: %w", err)
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("error closing tar writer: %w", err)
	}

	opts := docker.UploadToContainerOptions{
		Context:     ctx,
		Path:        destPath,
		InputStream: &buf,
	}
	if err := e.cli.UploadToContainer(containerID, opts); err != nil {
		return fmt.Errorf("UploadToContainer failed: %w", err)
	}
	return nil
}
