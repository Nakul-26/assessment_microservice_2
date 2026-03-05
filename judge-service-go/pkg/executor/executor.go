package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
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

// Client returns the underlying Docker client.
func (e *Executor) Client() *docker.Client {
	return e.cli
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

func (e *Executor) copyFilesToContainer(containerID string, workDir string, files []string) error {
	if len(files) == 0 {
		return nil
	}

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for _, name := range files {
		path := filepath.Join(workDir, name)
		info, err := os.Stat(path)
		if err != nil {
			_ = tw.Close()
			return fmt.Errorf("failed to stat %s: %w", path, err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			_ = tw.Close()
			return fmt.Errorf("failed to read %s: %w", path, err)
		}
		hdr := &tar.Header{
			Name:    name,
			Mode:    int64(info.Mode().Perm()),
			Size:    int64(len(data)),
			ModTime: info.ModTime(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			_ = tw.Close()
			return fmt.Errorf("failed to write tar header for %s: %w", name, err)
		}
		if _, err := tw.Write(data); err != nil {
			_ = tw.Close()
			return fmt.Errorf("failed to write tar data for %s: %w", name, err)
		}
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("failed to close tar writer: %w", err)
	}

	opts := docker.UploadToContainerOptions{
		InputStream: &buf,
		Path:        "/app",
	}
	if err := e.cli.UploadToContainer(containerID, opts); err != nil {
		return fmt.Errorf("failed to upload files to container: %w", err)
	}
	return nil
}

// RunInContainer executes user code in a given Docker container
func (e *Executor) RunInContainer(ctx context.Context, containerID string, files []string, workDir string, compileCmd []string, runCmd []string, timeout time.Duration) (string, string, error) {
	// Overall submission timeout derived from provided timeout (multiply by factor) or environment.
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	// Upload current submission files into the container.
	if err := e.copyFilesToContainer(containerID, workDir, files); err != nil {
		return "", "", err
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
