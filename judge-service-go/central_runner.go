package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"judge-service-go/pkg/central/adapters"
	"judge-service-go/pkg/comparator"
	"judge-service-go/pkg/executor"
	"judge-service-go/pkg/models"
	"judge-service-go/pkg/pool"
	"judge-service-go/pkg/workspace"
)

const (
	defaultPythonBatchThreshold     = 20
	defaultJavaScriptBatchThreshold = 20
)

type batchedTestExecOutput struct {
	Test      int         `json:"test"`
	Output    interface{} `json:"output"`
	Error     string      `json:"error,omitempty"`
	Traceback string      `json:"traceback,omitempty"`
	Fatal     string      `json:"fatal,omitempty"`
}

var errBatchedOutputLimitExceeded = fmt.Errorf("batched wrapper output exceeded limit")

func runSubmissionCentral(ctx context.Context, exec *executor.Executor, pooledContainer *pool.PooledContainer, submissionMsg models.SubmissionMessage, problem models.Problem, adapter adapters.LanguageAdapter) (*models.SubmissionResult, error) {
	submissionWorkspace, err := workspace.NewSubmissionWorkspace(pooledContainer.WorkDir, submissionMsg.SubmissionID)
	if err != nil {
		return nil, err
	}
	defer func() {
		if cleanupErr := workspace.CleanupSubmissionWorkspace(submissionWorkspace.HostPath); cleanupErr != nil {
			log.Printf("[submission=%s] failed to cleanup workspace %s: %v", submissionMsg.SubmissionID, submissionWorkspace.HostPath, cleanupErr)
		}
	}()

	if batchAdapter, ok := adapter.(adapters.BatchLanguageAdapter); ok && shouldUseBatchedExecution(submissionMsg.Language, len(problem.TestCases)) {
		return runSubmissionCentralBatched(ctx, exec, pooledContainer, submissionMsg, problem, batchAdapter, submissionWorkspace, startedResult(problem))
	}

	result := startedResult(problem)
	return runSubmissionCentralPerTest(ctx, exec, pooledContainer, submissionMsg, problem, adapter, submissionWorkspace, result)
}

func startedResult(problem models.Problem) *models.SubmissionResult {
	started := time.Now().UTC()
	result := models.NewSubmissionResult()
	result.StartedAt = &started
	return result
}

func runSubmissionCentralPerTest(ctx context.Context, exec *executor.Executor, pooledContainer *pool.PooledContainer, submissionMsg models.SubmissionMessage, problem models.Problem, adapter adapters.LanguageAdapter, submissionWorkspace *workspace.SubmissionWorkspace, result *models.SubmissionResult) (*models.SubmissionResult, error) {
	testTimeout := perTestTimeout(problem)
	baseFiles, err := adapter.PrepareFiles(submissionWorkspace.HostPath, submissionMsg)
	if err != nil {
		return nil, err
	}

	for i, tc := range problem.TestCases {
		testStart := time.Now()
		tr := models.TestResult{
			Test:     i + 1,
			Expected: tc.Expected,
		}

		payload := map[string]interface{}{"inputs": tc.Input}
		inputJSON, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			tr.Ok = false
			tr.Error = fmt.Sprintf("failed to marshal test input: %v", marshalErr)
			tr.TimeMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		filesToCopy := append([]string{}, baseFiles...)
		inputB64 := base64.StdEncoding.EncodeToString(inputJSON)
		testCtx, cancel := context.WithTimeout(ctx, testTimeout)
		stdout, stderr, runErr := exec.RunInContainer(
			testCtx,
			pooledContainer.ID,
			filesToCopy,
			submissionWorkspace.HostPath,
			submissionWorkspace.ContainerPath,
			nil,
			adapter.RunCommand(inputB64),
			testTimeout,
		)
		cancel()

		stdoutTrimmed := strings.TrimSpace(stdout)
		stderrTrimmed := strings.TrimSpace(stderr)
		stdoutForResult, stdoutTruncated := truncateString(stdoutTrimmed, maxTestOutputBytes)
		stderrForLog, stderrTruncated := truncateString(stderrTrimmed, maxLogOutputBytes)
		tr.Stdout = stdoutForResult

		if runErr != nil {
			tr.Ok = false
			runErrText := strings.ToLower(runErr.Error())
			if strings.Contains(runErrText, "timed out") || strings.Contains(runErrText, "deadline exceeded") {
				tr.Error = "Time Limit Exceeded"
			} else {
				tr.Error = "Runtime Error"
			}
			log.Printf("[submission=%s test=%d] runtime error: %v", submissionMsg.SubmissionID, i+1, runErr)
			if stderrForLog != "" {
				log.Printf("[submission=%s test=%d] runtime stderr%s: %s", submissionMsg.SubmissionID, i+1, map[bool]string{true: " (truncated)", false: ""}[stderrTruncated], stderrForLog)
			}
			tr.TimeMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		if stdoutTruncated {
			tr.Ok = false
			tr.Error = "Output Limit Exceeded"
			tr.TimeMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		out, parseErr := parseSingleTestOutput(stdoutTrimmed)
		if parseErr != nil {
			tr.Ok = false
			tr.Error = "Runtime Error"
			tr.TimeMs = time.Since(testStart).Milliseconds()
			log.Printf("[submission=%s test=%d] invalid wrapper output: %v | stdout=%q", submissionMsg.SubmissionID, i+1, parseErr, stdoutForResult)
			result.AddTestResult(tr)
			continue
		}

		if out.Error != "" {
			tr.Ok = false
			tr.Error = "Runtime Error"
			if out.Traceback != "" {
				tracebackForLog, tbTruncated := truncateString(out.Traceback, maxLogOutputBytes)
				log.Printf("[submission=%s test=%d] wrapper traceback%s: %s", submissionMsg.SubmissionID, i+1, map[bool]string{true: " (truncated)", false: ""}[tbTruncated], tracebackForLog)
			}
			tr.TimeMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		tr.Output = out.Output
		tr.Ok = comparator.Compare(tc.Expected, out.Output, problem.CompareConfig)
		tr.TimeMs = time.Since(testStart).Milliseconds()
		result.AddTestResult(tr)
	}

	finished := time.Now().UTC()
	result.FinishedAt = &finished
	result.ElapsedMs = finished.Sub(*result.StartedAt).Milliseconds()
	result.UpdateStatus()

	return result, nil
}

func runSubmissionCentralBatched(ctx context.Context, exec *executor.Executor, pooledContainer *pool.PooledContainer, submissionMsg models.SubmissionMessage, problem models.Problem, adapter adapters.BatchLanguageAdapter, submissionWorkspace *workspace.SubmissionWorkspace, result *models.SubmissionResult) (*models.SubmissionResult, error) {
	baseFiles, err := adapter.PrepareBatchFiles(submissionWorkspace.HostPath, submissionMsg)
	if err != nil {
		return nil, err
	}

	testsPayload := make([]map[string]interface{}, 0, len(problem.TestCases))
	for _, tc := range problem.TestCases {
		testsPayload = append(testsPayload, map[string]interface{}{"inputs": tc.Input})
	}
	testsJSON, err := json.Marshal(testsPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal batched tests: %w", err)
	}
	if len(testsJSON) > maxTestsBytes {
		return nil, fmt.Errorf("batched tests JSON too large: %d bytes", len(testsJSON))
	}

	testTimeout := perTestTimeout(problem)
	runTimeout := time.Duration(len(problem.TestCases)+1) * testTimeout
	runCtx, cancel := context.WithTimeout(ctx, runTimeout)
	defer cancel()

	stream, err := exec.RunInContainerStream(
		runCtx,
		pooledContainer.ID,
		append([]string{}, baseFiles...),
		submissionWorkspace.HostPath,
		submissionWorkspace.ContainerPath,
		nil,
		adapter.BatchRunCommand(base64.StdEncoding.EncodeToString(testsJSON)),
		runTimeout,
	)
	if err != nil {
		return nil, err
	}

	var stderrBuf bytes.Buffer
	stderrDone := make(chan struct{})
	go func() {
		defer close(stderrDone)
		_, _ = io.Copy(&stderrBuf, stream.Stderr)
		_ = stream.Stderr.Close()
	}()

	processed, parseErr := appendBatchedResults(result, stream.Stdout, problem)
	_ = stream.Stdout.Close()

	exitCode, waitErr := stream.Wait()
	<-stderrDone

	var runErr error
	switch {
	case waitErr != nil:
		runErr = fmt.Errorf("execution command failed: %w", waitErr)
	case exitCode != 0:
		runErr = fmt.Errorf("execution failed with exit code %d", exitCode)
	}

	stderrTrimmed := strings.TrimSpace(stderrBuf.String())
	if stderrTrimmed != "" {
		stderrForLog, stderrTruncated := truncateString(stderrTrimmed, maxLogOutputBytes)
		log.Printf("[submission=%s] batched stderr%s: %s", submissionMsg.SubmissionID, map[bool]string{true: " (truncated)", false: ""}[stderrTruncated], stderrForLog)
	}

	remainingReason := ""
	switch {
	case errors.Is(parseErr, errBatchedOutputLimitExceeded):
		remainingReason = "Output Limit Exceeded"
	case runErr != nil:
		runErrText := strings.ToLower(runErr.Error())
		if strings.Contains(runErrText, "timed out") || strings.Contains(runErrText, "deadline exceeded") {
			remainingReason = "Time Limit Exceeded"
		} else {
			remainingReason = "Runtime Error"
		}
	case parseErr != nil:
		remainingReason = "Runtime Error"
	case processed < len(problem.TestCases):
		remainingReason = "Runtime Error"
	}
	if parseErr != nil {
		log.Printf("[submission=%s] batched output parse error after %d tests: %v", submissionMsg.SubmissionID, processed, parseErr)
	}
	if runErr != nil {
		log.Printf("[submission=%s] batched execution error after %d tests: %v", submissionMsg.SubmissionID, processed, runErr)
	}
	if remainingReason != "" {
		appendMissingBatchedResults(result, problem, processed, remainingReason)
	}

	finished := time.Now().UTC()
	result.FinishedAt = &finished
	result.ElapsedMs = finished.Sub(*result.StartedAt).Milliseconds()
	result.UpdateStatus()

	return result, nil
}

func appendBatchedResults(result *models.SubmissionResult, stdout io.Reader, problem models.Problem) (int, error) {
	reader := bufio.NewReader(stdout)
	processed := 0

	for {
		line, err := readBoundedLine(reader, maxTestOutputBytes)
		if err == io.EOF {
			return processed, nil
		}
		if err != nil {
			return processed, err
		}

		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}

		var out batchedTestExecOutput
		if err := json.Unmarshal(line, &out); err != nil {
			return processed, fmt.Errorf("invalid batched wrapper output: %w", err)
		}
		if out.Fatal != "" {
			return processed, fmt.Errorf("wrapper fatal error: %s", out.Fatal)
		}
		if out.Test <= 0 || out.Test > len(problem.TestCases) {
			return processed, fmt.Errorf("batched wrapper returned invalid test index %d", out.Test)
		}
		tc := problem.TestCases[out.Test-1]
		testStart := time.Now()
		tr := models.TestResult{
			Test:     out.Test,
			Expected: tc.Expected,
			Output:   out.Output,
		}
		if out.Error != "" {
			tr.Ok = false
			tr.Error = "Runtime Error"
		} else {
			tr.Ok = comparator.Compare(tc.Expected, out.Output, problem.CompareConfig)
		}
		tr.TimeMs = time.Since(testStart).Milliseconds()
		result.AddTestResult(tr)
		processed++
	}
}

func appendMissingBatchedResults(result *models.SubmissionResult, problem models.Problem, processed int, reason string) {
	for i := processed; i < len(problem.TestCases); i++ {
		result.AddTestResult(models.TestResult{
			Test:     i + 1,
			Expected: problem.TestCases[i].Expected,
			Ok:       false,
			Error:    reason,
		})
	}
}

func readBoundedLine(reader *bufio.Reader, maxBytes int) ([]byte, error) {
	var line []byte
	for {
		chunk, err := reader.ReadSlice('\n')
		line = append(line, chunk...)
		if maxBytes > 0 && len(line) > maxBytes {
			return nil, errBatchedOutputLimitExceeded
		}
		if err == nil {
			return line, nil
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if err == io.EOF {
			if len(line) == 0 {
				return nil, io.EOF
			}
			return line, nil
		}
		return nil, err
	}
}

func shouldUseBatchedExecution(language string, testCount int) bool {
	threshold := 0
	switch language {
	case "python":
		threshold = defaultPythonBatchThreshold
		if raw := strings.TrimSpace(os.Getenv("JUDGE_BATCH_THRESHOLD_PY")); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
				threshold = parsed
			}
		}
	case "javascript":
		threshold = defaultJavaScriptBatchThreshold
		if raw := strings.TrimSpace(os.Getenv("JUDGE_BATCH_THRESHOLD_JS")); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
				threshold = parsed
			}
		}
	default:
		return false
	}
	return testCount >= threshold
}
