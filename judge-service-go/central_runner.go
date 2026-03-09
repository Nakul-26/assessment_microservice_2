package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"judge-service-go/pkg/central/adapters"
	"judge-service-go/pkg/comparator"
	"judge-service-go/pkg/executor"
	"judge-service-go/pkg/models"
	"judge-service-go/pkg/pool"
)

func runSubmissionCentral(ctx context.Context, exec *executor.Executor, pooledContainer *pool.PooledContainer, submissionMsg models.SubmissionMessage, problem models.Problem, adapter adapters.LanguageAdapter) (*models.SubmissionResult, error) {
	baseFiles, err := adapter.PrepareFiles(pooledContainer.WorkDir, submissionMsg)
	if err != nil {
		return nil, err
	}

	started := time.Now().UTC()
	result := models.NewSubmissionResult()
	result.StartedAt = &started
	testTimeout := perTestTimeout(problem)

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
			tr.DurationMs = time.Since(testStart).Milliseconds()
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
			pooledContainer.WorkDir,
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
			tr.DurationMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		if stdoutTruncated {
			tr.Ok = false
			tr.Error = "Output Limit Exceeded"
			tr.DurationMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		out, parseErr := parseSingleTestOutput(stdoutTrimmed)
		if parseErr != nil {
			tr.Ok = false
			tr.Error = "Runtime Error"
			tr.DurationMs = time.Since(testStart).Milliseconds()
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
			tr.DurationMs = time.Since(testStart).Milliseconds()
			result.AddTestResult(tr)
			continue
		}

		tr.Output = out.Output
		tr.Ok = comparator.Compare(tc.Expected, out.Output, problem.CompareConfig)
		tr.DurationMs = time.Since(testStart).Milliseconds()
		result.AddTestResult(tr)
	}

	finished := time.Now().UTC()
	result.FinishedAt = &finished
	result.ElapsedMs = finished.Sub(started).Milliseconds()
	result.Status = models.StatusFinished

	return result, nil
}
