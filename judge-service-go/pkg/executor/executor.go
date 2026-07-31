package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
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

// UpdateContainerResources updates the resource limits of a running container.
func (e *Executor) UpdateContainerResources(ctx context.Context, containerID string, memoryMb int64) error {
	if memoryMb <= 0 {
		return nil
	}

	memoryBytes := memoryMb * 1024 * 1024
	slog.Info("Updating container resource limits", "containerId", containerID, "memoryMb", memoryMb)

	opts := docker.UpdateContainerOptions{
		Context:    ctx,
		Memory:     int(memoryBytes),
		MemorySwap: int(memoryBytes),
	}
	if err := e.cli.UpdateContainer(containerID, opts); err != nil {
		return fmt.Errorf("failed to update container memory limit: %w", err)
	}
	return nil
}

func (s *ExecStream) Wait() (int, error) {
	s.waitOnce.Do(func() {
		s.result = <-s.waitCh
	})
	return s.result.exitCode, s.result.err
}

// runExecWithTimeout handles the full lifecycle of creating, running, and waiting for an exec instance.
func (e *Executor) runExecWithTimeout(ctx context.Context, containerID string, user string, workDir string, cmd []string, timeout time.Duration) (string, string, int, error) {
	var stdoutBuf, stderrBuf bytes.Buffer

	execOpts := docker.CreateExecOptions{
		Container:    containerID,
		User:         user,
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
			if errors.Is(err, context.DeadlineExceeded) || childCtx.Err() == context.DeadlineExceeded || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") {
				return stdoutBuf.String(), stderrBuf.String(), -1, NewExecutionError(ErrTimeLimitExceeded, fmt.Sprintf("execution timed out after %v", timeout), -1)
			}
			return stdoutBuf.String(), stderrBuf.String(), -1, err
		}
	case <-childCtx.Done():
		// timed out or cancelled
		closeExec()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			slog.Warn("exec waiter did not exit promptly after cancellation", "containerId", containerID, "cmd", cmd)
		}
		if childCtx.Err() == context.DeadlineExceeded {
			slog.Warn("exec timed out", "containerId", containerID, "timeout", timeout, "cmd", cmd)
			return stdoutBuf.String(), stderrBuf.String(), -1, NewExecutionError(ErrTimeLimitExceeded, fmt.Sprintf("execution timed out after %v", timeout), -1)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, childCtx.Err()
	case <-ctx.Done():
		// caller cancelled
		closeExec()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			slog.Warn("exec waiter did not exit promptly after caller cancellation", "containerId", containerID, "cmd", cmd)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, ctx.Err()
	}

	// Inspect exec to get exit code
	inspect, err := e.cli.InspectExec(execObj.ID)
	if err != nil {
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("failed to inspect exec: %w", err)
	}

	if inspect.ExitCode != 0 {
		if inspect.ExitCode == 137 {
			return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, NewExecutionError(ErrMemoryLimitExceeded, "process killed (possibly OOM)", inspect.ExitCode)
		}
		return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, NewExecutionError(ErrRuntimeError, fmt.Sprintf("exit code %d", inspect.ExitCode), inspect.ExitCode)
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

func (e *Executor) runExecStreamWithTimeout(ctx context.Context, containerID string, user string, workDir string, cmd []string, timeout time.Duration) (*ExecStream, error) {
	execOpts := docker.CreateExecOptions{
		Container:    containerID,
		User:         user,
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
				if errors.Is(err, context.DeadlineExceeded) || childCtx.Err() == context.DeadlineExceeded || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") {
					waitResult.err = NewExecutionError(ErrTimeLimitExceeded, fmt.Sprintf("execution timed out after %v", timeout), -1)
				} else {
					waitResult.err = err
				}
				stream.waitCh <- waitResult
				return
			}
		case <-childCtx.Done():
			closeExec()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				slog.Warn("exec waiter did not exit promptly after cancellation", "containerId", containerID, "cmd", cmd)
			}
			if childCtx.Err() == context.DeadlineExceeded {
				slog.Warn("exec timed out", "containerId", containerID, "timeout", timeout, "cmd", cmd)
				waitResult.err = NewExecutionError(ErrTimeLimitExceeded, fmt.Sprintf("execution timed out after %v", timeout), -1)
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
				slog.Warn("exec waiter did not exit promptly after caller cancellation", "containerId", containerID, "cmd", cmd)
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
		if inspect.ExitCode != 0 {
			if inspect.ExitCode == 137 {
				waitResult.err = NewExecutionError(ErrMemoryLimitExceeded, "process killed (possibly OOM)", inspect.ExitCode)
			} else {
				waitResult.err = NewExecutionError(ErrRuntimeError, fmt.Sprintf("exit code %d", inspect.ExitCode), inspect.ExitCode)
			}
		}
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
func (e *Executor) RunInContainer(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, runCmd []string, timeout time.Duration, memoryLimitMb int64) (string, string, error) {
	// Overall submission timeout derived from provided timeout (multiply by factor) or environment.
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	stream, err := e.RunInContainerStream(subCtx, containerID, files, hostWorkDir, containerWorkDir, compileCmd, runCmd, timeout, memoryLimitMb)
	if err != nil {
		return "", "", err
	}
	runStdout, runStderr, _, err := e.collectStream(stream)
	return runStdout, runStderr, err
}

func (e *Executor) CompileInContainer(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, timeout time.Duration, memoryLimitMb int64) (string, string, error) {
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	if err := e.copyFilesToContainer(containerID, hostWorkDir, containerWorkDir, files); err != nil {
		return "", "", err
	}

	// Apply memory limit before compilation
	if memoryLimitMb > 0 {
		if err := e.UpdateContainerResources(subCtx, containerID, memoryLimitMb); err != nil {
			slog.Warn("failed to apply memory limit for compilation", "containerId", containerID, "error", err)
		}
		defer func() {
			// Reset limit after compilation if needed, but usually we just keep it for run
			// However, CompileInContainer is sometimes used standalone.
			// For safety, let's NOT reset it here if it's going to be used by Run immediately.
			// Actually, the caller should handle reset if they know it's the end.
		}()
	}

	compileStdout, compileStderr, _, err := e.runExecWithTimeout(subCtx, containerID, getJudgeUser(), containerWorkDir, rewriteCommandForWorkspace(compileCmd, containerWorkDir), timeout)
	if err != nil {
		return compileStdout, compileStderr, NewExecutionError(ErrCompilationFailed, err.Error(), -1)
	}

	return compileStdout, compileStderr, nil
}

func getJudgeUser() string {
	if u := os.Getenv("JUDGE_USER"); u != "" {
		return u
	}
	return "judge"
}

func (e *Executor) RunInContainerStream(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, runCmd []string, timeout time.Duration, memoryLimitMb int64) (*ExecStream, error) {
	submissionTimeout := timeout * 3
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)

	if len(files) > 0 {
		if err := e.copyFilesToContainer(containerID, hostWorkDir, containerWorkDir, files); err != nil {
			cancel()
			return nil, err
		}
	}

	// Apply a reasonable limit during compilation if a strict limit is requested for run
	if memoryLimitMb > 0 {
		compilationLimit := memoryLimitMb
		if compilationLimit < 1024 {
			compilationLimit = 1024
		}
		if err := e.UpdateContainerResources(subCtx, containerID, compilationLimit); err != nil {
			slog.Warn("failed to apply compilation memory limit", "containerId", containerID, "error", err)
		}
	}

	if len(compileCmd) > 0 {
		slog.Info("Compiling in container", "containerId", containerID, "cmd", compileCmd)
		compileStdout, compileStderr, _, err := e.runExecWithTimeout(subCtx, containerID, getJudgeUser(), containerWorkDir, rewriteCommandForWorkspace(compileCmd, containerWorkDir), timeout)
		if err != nil {
			cancel()
			return nil, NewExecutionError(ErrCompilationFailed, fmt.Sprintf("%v | stdout=%s stderr=%s", err, compileStdout, compileStderr), -1)
		}
	}

	// Apply strict memory limit BEFORE execution
	if memoryLimitMb > 0 {
		if err := e.UpdateContainerResources(subCtx, containerID, memoryLimitMb); err != nil {
			slog.Warn("failed to apply execution memory limit", "containerId", containerID, "error", err)
		}
	}

	stream, err := e.runExecStreamWithTimeout(subCtx, containerID, getJudgeUser(), containerWorkDir, rewriteCommandForWorkspace(runCmd, containerWorkDir), timeout)
	if err != nil {
		cancel()
		return nil, err
	}

	wrapped := &ExecStream{
		Stdout: stream.Stdout,
		Stderr: stream.Stderr,
		waitCh: make(chan execWaitResult, 1),
	}
	go func() {
		exitCode, waitErr := stream.Wait()
		cancel()

		// Reset limit AFTER execution completes. Bounded on its own timeout — this must
		// never be context.Background() unbounded: a stalled Docker daemon call here would
		// otherwise hang forever, and since the container is only released back to the
		// pool once this goroutine returns, one hang permanently strands a pooled container.
		if memoryLimitMb > 0 {
			resetCtx, resetCancel := context.WithTimeout(context.Background(), 10*time.Second)
			resetErr := e.UpdateContainerResources(resetCtx, containerID, 1024)
			resetCancel()
			if resetErr != nil {
				slog.Error("failed to reset memory limit", "containerId", containerID, "error", resetErr)
				if waitErr == nil {
					waitErr = NewExecutionError(ErrContainerUnhealthy, fmt.Sprintf("failed to reset memory limit: %v", resetErr), -1)
				}
			}
		}

		// Clear /tmp and kill leftover processes to prevent contamination between reused containers
		// Since the container's PID 1 now runs as root, we can safely kill all processes
		// owned by the 'judge' user without stopping the container.
		cStdout, cStderr, cExit, cErr := e.runExecWithTimeout(context.Background(), containerID, "root", "/", []string{"sh", "-c", "rm -rf /tmp/* && (pkill -9 -u judge || true)"}, 5*time.Second)
		if cErr != nil && cExit != 137 {
			slog.Error("failed to cleanup container", "containerId", containerID, "error", cErr, "stdout", cStdout, "stderr", cStderr, "exitCode", cExit)
		}

		wrapped.waitCh <- execWaitResult{exitCode: exitCode, err: waitErr}
	}()

	return wrapped, nil
}

// runExecWithStdin is like runExecWithTimeout but attaches stdin and feeds stdinData
// to the process, then signals EOF so blocking readers (input()/scanf/Scanner...)
// unblock once all bytes have been consumed.
func (e *Executor) runExecWithStdin(ctx context.Context, containerID string, user string, workDir string, cmd []string, timeout time.Duration, stdinData []byte) (string, string, int, error) {
	var stdoutBuf, stderrBuf bytes.Buffer

	execOpts := docker.CreateExecOptions{
		Container:    containerID,
		User:         user,
		Cmd:          cmd,
		WorkingDir:   workDir,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Context:      ctx,
	}
	execObj, err := e.cli.CreateExec(execOpts)
	if err != nil {
		return "", "", -1, fmt.Errorf("failed to create exec: %w", err)
	}

	childCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	startExecOptions := docker.StartExecOptions{
		InputStream:  bytes.NewReader(stdinData),
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
			if errors.Is(err, context.DeadlineExceeded) || childCtx.Err() == context.DeadlineExceeded || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") {
				return stdoutBuf.String(), stderrBuf.String(), -1, NewExecutionError(ErrTimeLimitExceeded, fmt.Sprintf("execution timed out after %v", timeout), -1)
			}
			return stdoutBuf.String(), stderrBuf.String(), -1, err
		}
	case <-childCtx.Done():
		closeExec()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			slog.Warn("exec waiter did not exit promptly after cancellation", "containerId", containerID, "cmd", cmd)
		}
		if childCtx.Err() == context.DeadlineExceeded {
			slog.Warn("exec timed out", "containerId", containerID, "timeout", timeout, "cmd", cmd)
			return stdoutBuf.String(), stderrBuf.String(), -1, NewExecutionError(ErrTimeLimitExceeded, fmt.Sprintf("execution timed out after %v", timeout), -1)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, childCtx.Err()
	case <-ctx.Done():
		closeExec()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			slog.Warn("exec waiter did not exit promptly after caller cancellation", "containerId", containerID, "cmd", cmd)
		}
		return stdoutBuf.String(), stderrBuf.String(), -1, ctx.Err()
	}

	inspect, err := e.cli.InspectExec(execObj.ID)
	if err != nil {
		return stdoutBuf.String(), stderrBuf.String(), -1, fmt.Errorf("failed to inspect exec: %w", err)
	}

	if inspect.ExitCode != 0 {
		if inspect.ExitCode == 137 {
			return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, NewExecutionError(ErrMemoryLimitExceeded, "process killed (possibly OOM)", inspect.ExitCode)
		}
		return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, NewExecutionError(ErrRuntimeError, fmt.Sprintf("exit code %d", inspect.ExitCode), inspect.ExitCode)
	}

	return stdoutBuf.String(), stderrBuf.String(), inspect.ExitCode, nil
}

// RunRawWithStdin compiles (if needed) and runs raw, unwrapped source code against a
// single stdin payload, returning stdout/stderr/exit code directly — no wrapper
// generation, no test-case harness, no structural comparison. This is the primitive
// behind the Judge0-compatible /raw-run endpoint: the caller (assessment-api) decides
// AC/WA itself by comparing stdout against an expected value it never sends here.
func (e *Executor) RunRawWithStdin(ctx context.Context, containerID string, files []string, hostWorkDir string, containerWorkDir string, compileCmd []string, runCmd []string, timeout time.Duration, memoryLimitMb int64, stdinData []byte) (stdout string, stderr string, compileOutput string, exitCode int, execErr error) {
	// Compilation gets its own generous, FIXED budget — matching central_runner.go's
	// compileCentralSubmission (120s), which real production submissions rely on.
	// It must NOT share the caller's short per-run `timeout`: Go builds in particular
	// (cold GOCACHE) routinely take longer than any reasonable algorithm time limit,
	// and that's expected/fine — only the student's own run should be bounded tightly.
	const rawCompileTimeout = 120 * time.Second

	submissionTimeout := rawCompileTimeout + timeout*2
	subCtx, cancel := context.WithTimeout(ctx, submissionTimeout)
	defer cancel()

	if len(files) > 0 {
		if err := e.copyFilesToContainer(containerID, hostWorkDir, containerWorkDir, files); err != nil {
			return "", "", "", -1, err
		}
	}

	if memoryLimitMb > 0 {
		compilationLimit := memoryLimitMb
		if compilationLimit < 1024 {
			compilationLimit = 1024
		}
		if err := e.UpdateContainerResources(subCtx, containerID, compilationLimit); err != nil {
			slog.Warn("failed to apply compilation memory limit", "containerId", containerID, "error", err)
		}
	}

	if len(compileCmd) > 0 {
		slog.Info("Compiling raw submission in container", "containerId", containerID, "cmd", compileCmd)
		compileStdout, compileStderr, _, err := e.runExecWithTimeout(subCtx, containerID, getJudgeUser(), containerWorkDir, rewriteCommandForWorkspace(compileCmd, containerWorkDir), rawCompileTimeout)
		if err != nil {
			combined := compileStdout
			if compileStderr != "" {
				if combined != "" {
					combined += "\n"
				}
				combined += compileStderr
			}
			return "", "", combined, -1, NewExecutionError(ErrCompilationFailed, fmt.Sprintf("%v | stdout=%s stderr=%s", err, compileStdout, compileStderr), -1)
		}
	}

	if memoryLimitMb > 0 {
		if err := e.UpdateContainerResources(subCtx, containerID, memoryLimitMb); err != nil {
			slog.Warn("failed to apply execution memory limit", "containerId", containerID, "error", err)
		}
	}

	runStdout, runStderr, runExit, runErr := e.runExecWithStdin(subCtx, containerID, getJudgeUser(), containerWorkDir, rewriteCommandForWorkspace(runCmd, containerWorkDir), timeout, stdinData)

	// Reset limit AFTER execution completes. Bounded on its own timeout for the same
	// reason as RunInContainerStream's equivalent reset — see comment there.
	if memoryLimitMb > 0 {
		resetCtx, resetCancel := context.WithTimeout(context.Background(), 10*time.Second)
		resetErr := e.UpdateContainerResources(resetCtx, containerID, 1024)
		resetCancel()
		if resetErr != nil {
			slog.Error("failed to reset memory limit", "containerId", containerID, "error", resetErr)
		}
	}

	// Clear /tmp and kill leftover processes to prevent contamination between reused containers.
	cStdout, cStderr, cExit, cErr := e.runExecWithTimeout(context.Background(), containerID, "root", "/", []string{"sh", "-c", "rm -rf /tmp/* && (pkill -9 -u judge || true)"}, 5*time.Second)
	if cErr != nil && cExit != 137 {
		slog.Error("failed to cleanup raw-run container", "containerId", containerID, "error", cErr, "stdout", cStdout, "stderr", cStderr, "exitCode", cExit)
	}

	return runStdout, runStderr, "", runExit, runErr
}
