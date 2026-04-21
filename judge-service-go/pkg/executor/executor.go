package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"

	docker "github.com/fsouza/go-dockerclient"

	"judge-service-go/pkg/workspace"
)

// Executor holds the Docker client
type Executor struct {
	cli *docker.Client
}

type ExecStream struct {
	Stdout io.ReadCloser
	Stderr io.ReadCloser

	waitOnce sync.Once
	waitCh   chan execWaitResult
	result   execWaitResult
}

type execWaitResult struct {
	exitCode int
	err      error
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

func (s *ExecStream) Wait() (int, error) {
	s.waitOnce.Do(func() {
		s.result = <-s.waitCh
	})
	return s.result.exitCode, s.result.err
}

// runExecWithTimeout handles the full lifecycle of creating, running, and waiting for an exec instance.
func (e *Executor) runExecWithTimeout(ctx context.Context, containerID string, workDir string, cmd []string, timeout time.Duration) (string, string, int, error) {
	var stdoutBuf, stderrBuf bytes.Buffer

	execOpts := docker.CreateExecOptions{
		Container:    containerID,
		Cmd:          cmd,
		WorkingDir:   workDir,
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

	startExecOptions := docker.StartExecOptions{
		OutputStream: &stdoutBuf,
		ErrorStream:  &stderrBuf,
		Context:      childCtx,
	}
	closeWaiter, err := e.cli.StartExecNonBlocking(execObj.ID, startExecOptions)
	if err != nil {
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("failed to start exec: %w", err)
	}
	var closeOnce sync.Once
	closeExec := func() {
		closeOnce.Do(func() {
			_ = closeWaiter.Close()
		})
	}
	defer closeExec()

	done := make(chan error, 1)
	go func() {
		done <- closeWaiter.Wait()
	}()

	select {
	case err := <-done:
		if err != nil {
			return stdoutBuf.String(), stderrBuf.String(), -1, err
		}
	case <-childCtx.Done():
		// timed out or cancelled
		closeExec()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			log.Printf("[container=%s] exec waiter did not exit promptly after cancellation: %v", containerID, cmd)
		}
		if childCtx.Err() == context.DeadlineExceeded {
			log.Printf("[container=%s] exec timed out after %v: %v", containerID, timeout, cmd)
			return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("execution timed out after %v", timeout)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, childCtx.Err()
	case <-ctx.Done():
		// caller cancelled
		closeExec()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			log.Printf("[container=%s] exec waiter did not exit promptly after caller cancellation: %v", containerID, cmd)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, ctx.Err()
	}

	// Inspect exec to get exit code
	inspect, err := e.cli.InspectExec(execObj.ID)
	if err != nil {
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("failed to inspect exec: %w", err)
	}

	return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, nil
}

func (e *Executor) copyFilesToContainer(containerID string, hostWorkDir string, containerWorkDir string, files []string) error {
	if len(files) == 0 {
		return nil
	}

	if err := workspace.ValidateNoExternalSymlinks(hostWorkDir); err != nil {
		return err
	}

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for _, name := range files {
		path, err := workspace.SafeJoin(hostWorkDir, name)
		if err != nil {
			_ = tw.Close()
			return fmt.Errorf("invalid workspace path %s: %w", name, err)
		}
		data, info, err := workspace.ReadRegularFile(hostWorkDir, name)
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
		Path:        containerWorkDir,
	}
	if err := e.cli.UploadToContainer(containerID, opts); err != nil {
		return fmt.Errorf("failed to upload files to container: %w", err)
	}
	return nil
}

func rewriteCommandForWorkspace(cmd []string, containerWorkDir string) []string {
	rewritten := make([]string, len(cmd))
	for i, part := range cmd {
		switch {
		case part == "/app":
			rewritten[i] = containerWorkDir
		case strings.HasPrefix(part, "/app/"):
			rewritten[i] = containerWorkDir + strings.TrimPrefix(part, "/app")
		default:
			rewritten[i] = part
		}
	}
	return rewritten
}

func (e *Executor) runExecStreamWithTimeout(ctx context.Context, containerID string, workDir string, cmd []string, timeout time.Duration) (*ExecStream, error) {
	execOpts := docker.CreateExecOptions{
		Container:    containerID,
		Cmd:          cmd,
		WorkingDir:   workDir,
		AttachStdout: true,
		AttachStderr: true,
		Context:      ctx,
	}
	execObj, err := e.cli.CreateExec(execOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to create exec: %w", err)
	}

	childCtx, cancel := context.WithTimeout(ctx, timeout)
	stdoutReader, stdoutWriter := io.Pipe()
	stderrReader, stderrWriter := io.Pipe()

	startExecOptions := docker.StartExecOptions{
		OutputStream: stdoutWriter,
		ErrorStream:  stderrWriter,
		Context:      childCtx,
	}
	closeWaiter, err := e.cli.StartExecNonBlocking(execObj.ID, startExecOptions)
	if err != nil {
		cancel()
		_ = stdoutWriter.Close()
		_ = stderrWriter.Close()
		_ = stdoutReader.Close()
		_ = stderrReader.Close()
		return nil, fmt.Errorf("failed to start exec: %w", err)
	}

	stream := &ExecStream{
		Stdout: stdoutReader,
		Stderr: stderrReader,
		waitCh: make(chan execWaitResult, 1),
	}

	go func() {
		defer cancel()
		defer func() {
			_ = stdoutWriter.Close()
			_ = stderrWriter.Close()
		}()

		var closeOnce sync.Once
		closeExec := func() {
			closeOnce.Do(func() {
				_ = closeWaiter.Close()
			})
		}
		defer closeExec()

		done := make(chan error, 1)
		go func() {
			done <- closeWaiter.Wait()
		}()

		var waitResult execWaitResult
		select {
		case err := <-done:
			if err != nil {
				waitResult.err = err
				stream.waitCh <- waitResult
				return
			}
		case <-childCtx.Done():
			closeExec()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				log.Printf("[container=%s] exec waiter did not exit promptly after cancellation: %v", containerID, cmd)
			}
			if childCtx.Err() == context.DeadlineExceeded {
				log.Printf("[container=%s] exec timed out after %v: %v", containerID, timeout, cmd)
				waitResult.err = fmt.Errorf("execution timed out after %v", timeout)
			} else {
				waitResult.err = childCtx.Err()
			}
			stream.waitCh <- waitResult
			return
		case <-ctx.Done():
			closeExec()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				log.Printf("[container=%s] exec waiter did not exit promptly after caller cancellation: %v", containerID, cmd)
			}
			waitResult.err = ctx.Err()
			stream.waitCh <- waitResult
			return
		}

		inspect, err := e.cli.InspectExec(execObj.ID)
		if err != nil {
			waitResult.err = fmt.Errorf("failed to inspect exec: %w", err)
			stream.waitCh <- waitResult
			return
		}

		waitResult.exitCode = inspect.ExitCode
		stream.waitCh <- waitResult
	}()

	return stream, nil
}

func (e *Executor) collectStream(stream *ExecStream) (string, string, int, error) {
	var stdoutBuf, stderrBuf bytes.Buffer

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(&stdoutBuf, stream.Stdout)
		_ = stream.Stdout.Close()
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(&stderrBuf, stream.Stderr)
		_ = stream.Stderr.Close()
	}()

	exitCode, waitErr := stream.Wait()
	wg.Wait()
	return stdoutBuf.String(), stderrBuf.String(), exitCode, waitErr
}

// RunInContainer executes user code in a given Docker container
func (e *Executor) RunInContainer(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, runCmd []string, timeout time.Duration) (string, string, error) {
	// Overall submission timeout derived from provided timeout (multiply by factor) or environment.
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	// Upload current submission files into the container.
	if err := e.copyFilesToContainer(containerID, hostWorkDir, containerWorkDir, files); err != nil {
		return "", "", err
	}

	// Compile step (if present)
	if len(compileCmd) > 0 {
		compileStdout, compileStderr, exitCode, err := e.runExecWithTimeout(subCtx, containerID, containerWorkDir, rewriteCommandForWorkspace(compileCmd, containerWorkDir), timeout)
		if err != nil {
			return compileStdout, compileStderr, fmt.Errorf("compilation command failed: %w", err)
		}
		if exitCode != 0 {
			return compileStdout, compileStderr, fmt.Errorf("compilation failed with exit code %d", exitCode)
		}
	}

	stream, err := e.RunInContainerStream(subCtx, containerID, nil, "", containerWorkDir, nil, runCmd, timeout)
	if err != nil {
		return "", "", err
	}
	runStdout, runStderr, exitCode, err := e.collectStream(stream)
	if err != nil {
		return runStdout, runStderr, fmt.Errorf("execution command failed: %w", err)
	}
	if exitCode != 0 {
		return runStdout, runStderr, fmt.Errorf("execution failed with exit code %d", exitCode)
	}

	return runStdout, runStderr, nil
}

func (e *Executor) CompileInContainer(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, timeout time.Duration) (string, string, error) {
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	if err := e.copyFilesToContainer(containerID, hostWorkDir, containerWorkDir, files); err != nil {
		return "", "", err
	}

	compileStdout, compileStderr, exitCode, err := e.runExecWithTimeout(subCtx, containerID, containerWorkDir, rewriteCommandForWorkspace(compileCmd, containerWorkDir), timeout)
	if err != nil {
		return compileStdout, compileStderr, fmt.Errorf("compilation command failed: %w", err)
	}
	if exitCode != 0 {
		return compileStdout, compileStderr, fmt.Errorf("compilation failed with exit code %d", exitCode)
	}

	return compileStdout, compileStderr, nil
}

func (e *Executor) RunInContainerStream(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, runCmd []string, timeout time.Duration) (*ExecStream, error) {
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)

	if len(files) > 0 {
		if err := e.copyFilesToContainer(containerID, hostWorkDir, containerWorkDir, files); err != nil {
			cancel()
			return nil, err
		}
	}

	if len(compileCmd) > 0 {
		compileStdout, compileStderr, exitCode, err := e.runExecWithTimeout(subCtx, containerID, containerWorkDir, rewriteCommandForWorkspace(compileCmd, containerWorkDir), timeout)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("compilation command failed: %w | stdout=%s stderr=%s", err, compileStdout, compileStderr)
		}
		if exitCode != 0 {
			cancel()
			return nil, fmt.Errorf("compilation failed with exit code %d | stdout=%s stderr=%s", exitCode, compileStdout, compileStderr)
		}
	}

	stream, err := e.runExecStreamWithTimeout(subCtx, containerID, containerWorkDir, rewriteCommandForWorkspace(runCmd, containerWorkDir), timeout)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("execution command failed: %w", err)
	}

	wrapped := &ExecStream{
		Stdout: stream.Stdout,
		Stderr: stream.Stderr,
		waitCh: make(chan execWaitResult, 1),
	}
	go func() {
		exitCode, waitErr := stream.Wait()
		cancel()
		wrapped.waitCh <- execWaitResult{exitCode: exitCode, err: waitErr}
	}()

	return wrapped, nil
}
