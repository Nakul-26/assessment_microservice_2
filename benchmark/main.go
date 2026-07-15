// benchmark/main.go
// Judge Service Load Benchmark Tool
//
// Usage:
//   go run ./benchmark [flags]
//
// Flags:
//   -judge   Judge service /run endpoint (default: http://172.18.0.3:8081)
//   -stats   Judge service /stats endpoint (default: http://172.18.0.3:8081/stats)
//   -rate    Submissions per second (default: 5)
//   -total   Total submissions to send (default: 100)
//   -lang    Language filter: all|python|javascript|java|cpp|go (default: all)
//   -phase   Run a named phase: small|medium|heavy|stress|full (default: full)
//   -out     Output CSV path (default: benchmark_results.csv)

package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ─── Request / Response models ────────────────────────────────────────────────

type TestCase struct {
	Inputs   interface{} `json:"inputs"` // judge expects "inputs" (plural)
	Expected interface{} `json:"expected"`
	IsSample bool        `json:"isSample"`
}

type CompareConfig struct {
	Mode string `json:"mode"`
}

type Parameter struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type SubmissionRequest struct {
	SchemaVersion string        `json:"schemaVersion"`
	SubmissionID  string        `json:"submissionId"`
	ProblemID     string        `json:"problemId"`
	Language      string        `json:"language"`
	FunctionName  string        `json:"functionName"`
	Code          string        `json:"code"`
	ReturnType    string        `json:"returnType"`
	Parameters    []Parameter   `json:"parameters,omitempty"`
	CompareConfig CompareConfig `json:"compareConfig"`
	Tests         []TestCase    `json:"tests"`
}

type JudgeResult struct {
	Status  string `json:"status"`
	Passed  int    `json:"passed"`
	Total   int    `json:"total"`
	Message string `json:"message,omitempty"`
}

type PoolStats struct {
	Available map[string]int `json:"available"`
	InUse     map[string]int `json:"in_use"`
}

type StatsResponse struct {
	Pool    PoolStats              `json:"pool"`
	Metrics map[string]interface{} `json:"metrics"`
}

// ─── Problem definitions ──────────────────────────────────────────────────────

type Problem struct {
	ID           string
	FunctionName string
	ReturnType   string
	Parameters   []Parameter
	Tests        []TestCase
	CompareMode  string
}

type Submission struct {
	Lang         string
	FunctionName string
	Code         string
	ReturnType   string
	Parameters   []Parameter
	CompareMode  string
	Tests        []TestCase
}

var problems = []Problem{
	{
		ID:           "two-sum",
		FunctionName: "twoSum",
		ReturnType:   "array<number>",
		Parameters:   []Parameter{{Name: "nums", Type: "array<number>"}, {Name: "target", Type: "number"}},
		CompareMode:  "EXACT",
		Tests: []TestCase{
			{Inputs: []interface{}{[]interface{}{2, 7, 11, 15}, 9}, Expected: []interface{}{0, 1}, IsSample: true},
			{Inputs: []interface{}{[]interface{}{3, 2, 4}, 6}, Expected: []interface{}{1, 2}},
			{Inputs: []interface{}{[]interface{}{3, 3}, 6}, Expected: []interface{}{0, 1}},
		},
	},
	{
		ID:           "max-subarray",
		FunctionName: "maxSubArray",
		ReturnType:   "number",
		Parameters:   []Parameter{{Name: "nums", Type: "array<number>"}},
		CompareMode:  "EXACT",
		Tests: []TestCase{
			{Inputs: []interface{}{[]interface{}{-2, 1, -3, 4, -1, 2, 1, -5, 4}}, Expected: 6, IsSample: true},
			{Inputs: []interface{}{[]interface{}{1}}, Expected: 1},
			{Inputs: []interface{}{[]interface{}{5, 4, -1, 7, 8}}, Expected: 23},
		},
	},
	{
		ID:           "palindrome",
		FunctionName: "isPalindrome",
		ReturnType:   "boolean",
		Parameters:   []Parameter{{Name: "x", Type: "number"}},
		CompareMode:  "EXACT",
		Tests: []TestCase{
			{Inputs: []interface{}{121}, Expected: true, IsSample: true},
			{Inputs: []interface{}{-121}, Expected: false},
			{Inputs: []interface{}{10}, Expected: false},
		},
	},
}

// Language-specific code snippets per problem
type LangCode struct {
	Lang         string
	FunctionName string
	Code         string
}

var submissionMatrix = map[string]map[string]LangCode{
	"two-sum": {
		"python": {
			Lang:         "python",
			FunctionName: "twoSum",
			Code: `def twoSum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        complement = target - n
        if complement in seen:
            return [seen[complement], i]
        seen[n] = i
    return []`,
		},
		"javascript": {
			Lang:         "javascript",
			FunctionName: "twoSum",
			Code: `function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) return [map.get(complement), i];
    map.set(nums[i], i);
  }
  return [];
}`,
		},
		"java": {
			Lang:         "java",
			FunctionName: "twoSum",
			Code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.Map<Integer, Integer> map = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) return new int[]{map.get(comp), i};
            map.put(nums[i], i);
        }
        return new int[]{};
    }
}`,
		},
		"cpp": {
			Lang:         "cpp",
			FunctionName: "twoSum",
			Code: `#include <vector>
#include <unordered_map>
class Solution {
public:
    std::vector<int> twoSum(std::vector<int>& nums, int target) {
        std::unordered_map<int,int> m;
        for(int i=0;i<(int)nums.size();i++){
            int comp=target-nums[i];
            if(m.count(comp)) return {m[comp],i};
            m[nums[i]]=i;
        }
        return {};
    }
};`,
		},
		"go": {
			Lang:         "go",
			FunctionName: "twoSum",
			Code: `package main
func twoSum(nums []int, target int) []int {
    seen := make(map[int]int)
    for i, n := range nums {
        comp := target - n
        if j, ok := seen[comp]; ok {
            return []int{j, i}
        }
        seen[n] = i
    }
    return nil
}`,
		},
	},
	"max-subarray": {
		"python": {
			Lang:         "python",
			FunctionName: "maxSubArray",
			Code: `def maxSubArray(nums):
    best = cur = nums[0]
    for n in nums[1:]:
        cur = max(n, cur+n)
        best = max(best, cur)
    return best`,
		},
		"javascript": {
			Lang:         "javascript",
			FunctionName: "maxSubArray",
			Code: `function maxSubArray(nums) {
  let best = nums[0], cur = nums[0];
  for (let i = 1; i < nums.length; i++) {
    cur = Math.max(nums[i], cur + nums[i]);
    best = Math.max(best, cur);
  }
  return best;
}`,
		},
		"java": {
			Lang:         "java",
			FunctionName: "maxSubArray",
			Code: `class Solution {
    public int maxSubArray(int[] nums) {
        int best = nums[0], cur = nums[0];
        for (int i = 1; i < nums.length; i++) {
            cur = Math.max(nums[i], cur + nums[i]);
            best = Math.max(best, cur);
        }
        return best;
    }
}`,
		},
		"cpp": {
			Lang:         "cpp",
			FunctionName: "maxSubArray",
			Code: `#include <vector>
#include <algorithm>
class Solution {
public:
    int maxSubArray(std::vector<int>& nums) {
        int best = nums[0], cur = nums[0];
        for(int i=1;i<(int)nums.size();i++){
            cur = std::max(nums[i], cur+nums[i]);
            best = std::max(best, cur);
        }
        return best;
    }
};`,
		},
		"go": {
			Lang:         "go",
			FunctionName: "maxSubArray",
			Code: `package main
func maxSubArray(nums []int) int {
    best, cur := nums[0], nums[0]
    for _, n := range nums[1:] {
        if cur+n > n { cur = cur+n } else { cur = n }
        if cur > best { best = cur }
    }
    return best
}`,
		},
	},
	"palindrome": {
		"python": {
			Lang:         "python",
			FunctionName: "isPalindrome",
			Code: `def isPalindrome(x):
    if x < 0: return False
    s = str(x)
    return s == s[::-1]`,
		},
		"javascript": {
			Lang:         "javascript",
			FunctionName: "isPalindrome",
			Code: `function isPalindrome(x) {
  if (x < 0) return false;
  const s = String(x);
  return s === s.split('').reverse().join('');
}`,
		},
		"java": {
			Lang:         "java",
			FunctionName: "isPalindrome",
			Code: `class Solution {
    public boolean isPalindrome(int x) {
        if (x < 0) return false;
        String s = Integer.toString(x);
        return s.equals(new StringBuilder(s).reverse().toString());
    }
}`,
		},
		"cpp": {
			Lang:         "cpp",
			FunctionName: "isPalindrome",
			Code: `#include <string>
#include <algorithm>
class Solution {
public:
    bool isPalindrome(int x) {
        if(x < 0) return false;
        std::string s = std::to_string(x);
        std::string r = s;
        std::reverse(r.begin(), r.end());
        return s == r;
    }
};`,
		},
		"go": {
			Lang:         "go",
			FunctionName: "isPalindrome",
			Code: `package main
import "strconv"
func isPalindrome(x int) bool {
    if x < 0 { return false }
    s := strconv.Itoa(x)
    for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
        if s[i] != s[j] { return false }
    }
    return true
}`,
		},
	},
}

// Build a flat list of all submissions (problem x language combos)
func buildSubmissionPool(langFilter string) []Submission {
	langs := []string{"python", "javascript", "java", "cpp", "go"}
	if langFilter != "all" {
		langs = []string{langFilter}
	}

	var pool []Submission
	for _, p := range problems {
		for _, l := range langs {
			codes, ok := submissionMatrix[p.ID]
			if !ok {
				continue
			}
			lc, ok := codes[l]
			if !ok {
				continue
			}
			pool = append(pool, Submission{
				Lang:         lc.Lang,
				FunctionName: lc.FunctionName,
				Code:         lc.Code,
				ReturnType:   p.ReturnType,
				Parameters:   p.Parameters,
				CompareMode:  p.CompareMode,
				Tests:        p.Tests,
			})
		}
	}
	return pool
}

// ─── Metrics collection ───────────────────────────────────────────────────────

type Result struct {
	ID           int
	Lang         string
	Status       string // "accepted", "wrong_answer", "error", "timeout", "http_error"
	LatencyMs    float64
	Accepted     bool
	ErrorMessage string
}

type PhaseReport struct {
	PhaseName     string
	TargetRate    float64 // submissions/sec requested
	ActualRate    float64 // submissions/sec achieved
	TotalSent     int
	Accepted      int
	Failed        int
	Errors        int
	AvgLatencyMs  float64
	P50LatencyMs  float64
	P95LatencyMs  float64
	P99LatencyMs  float64
	MaxLatencyMs  float64
	MinLatencyMs  float64
	DurationSec   float64
	SuccessRate   float64
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func sendSubmission(judgeURL string, sub Submission, id int, client *http.Client, timeout time.Duration) Result {
	req := SubmissionRequest{
		SchemaVersion: "1",
		SubmissionID:  fmt.Sprintf("bench-%06d", id),
		ProblemID:     "temp",
		Language:      sub.Lang,
		FunctionName:  sub.FunctionName,
		Code:          sub.Code,
		ReturnType:    sub.ReturnType,
		Parameters:    sub.Parameters,
		CompareConfig: CompareConfig{Mode: sub.CompareMode},
		Tests:         sub.Tests,
	}

	body, _ := json.Marshal(req)
	start := time.Now()

	httpReq, err := http.NewRequest("POST", judgeURL+"/run", bytes.NewReader(body))
	if err != nil {
		return Result{ID: id, Lang: sub.Lang, Status: "error", LatencyMs: 0, ErrorMessage: err.Error()}
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	latency := float64(time.Since(start).Milliseconds())

	if err != nil {
		status := "error"
		msg := err.Error()
		if isTimeout(err) {
			status = "timeout"
			msg = "request timed out"
		}
		return Result{ID: id, Lang: sub.Lang, Status: status, LatencyMs: latency, ErrorMessage: msg}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		return Result{
			ID:           id,
			Lang:         sub.Lang,
			Status:       "http_error",
			LatencyMs:    latency,
			ErrorMessage: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody)),
		}
	}

	var result JudgeResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return Result{ID: id, Lang: sub.Lang, Status: "parse_error", LatencyMs: latency, ErrorMessage: err.Error()}
	}

	// Judge returns "Accepted" (capital A) - normalise to lowercase for comparison
	normalStatus := strings.ToLower(result.Status)
	accepted := normalStatus == "accepted"
	status := normalStatus
	if status == "" {
		status = "unknown"
	}
	return Result{ID: id, Lang: sub.Lang, Status: status, LatencyMs: latency, Accepted: accepted}
}

func isTimeout(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return len(msg) > 0 && (contains(msg, "timeout") || contains(msg, "deadline exceeded") || contains(msg, "context deadline"))
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && stringContains(s, sub))
}

func stringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ─── Stats polling ────────────────────────────────────────────────────────────

type PoolSnapshot struct {
	Time      time.Time
	Available map[string]int
	InUse     map[string]int
}

func pollStats(statsURL string, client *http.Client) (*StatsResponse, error) {
	resp, err := client.Get(statsURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var s StatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, err
	}
	return &s, nil
}

// ─── Rate-limited load generator ─────────────────────────────────────────────

func runPhase(phaseName string, judgeURL string, statsURL string, rate float64, totalSubs int, pool []Submission, timeout time.Duration) PhaseReport {
	client := &http.Client{Timeout: timeout}
	statsClient := &http.Client{Timeout: 5 * time.Second}

	results := make([]Result, 0, totalSubs)
	var mu sync.Mutex
	var wg sync.WaitGroup
	var sent int64

	interval := time.Duration(float64(time.Second) / rate)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	fmt.Printf("\n┌─────────────────────────────────────────────────────┐\n")
	fmt.Printf("│ Phase: %-20s  Rate: %5.0f/s  Total: %4d │\n", phaseName, rate, totalSubs)
	fmt.Printf("└─────────────────────────────────────────────────────┘\n")

	// Poll stats in background
	var poolSnapshots []PoolSnapshot
	var snapMu sync.Mutex
	stopPoll := make(chan struct{})
	go func() {
		tick := time.NewTicker(2 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-stopPoll:
				return
			case <-tick.C:
				if s, err := pollStats(statsURL, statsClient); err == nil {
					snapMu.Lock()
					poolSnapshots = append(poolSnapshots, PoolSnapshot{
						Time:      time.Now(),
						Available: s.Pool.Available,
						InUse:     s.Pool.InUse,
					})
					snapMu.Unlock()
				}
			}
		}
	}()

	progressTicker := time.NewTicker(5 * time.Second)
	go func() {
		for range progressTicker.C {
			n := atomic.LoadInt64(&sent)
			if n >= int64(totalSubs) {
				return
			}
			fmt.Printf("  → Progress: %d/%d sent\n", n, totalSubs)
		}
	}()

	start := time.Now()
	for i := 0; i < totalSubs; i++ {
		<-ticker.C
		sub := pool[i%len(pool)]
		idx := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := sendSubmission(judgeURL, sub, idx, client, timeout)
			atomic.AddInt64(&sent, 1)
			mu.Lock()
			results = append(results, r)
			mu.Unlock()
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)
	progressTicker.Stop()
	close(stopPoll)

	// Analyze results
	report := analyze(phaseName, rate, results, elapsed)

	// Print pool utilization summary
	snapMu.Lock()
	if len(poolSnapshots) > 0 {
		fmt.Printf("\n  Pool utilization during phase:\n")
		maxInUse := make(map[string]int)
		for _, s := range poolSnapshots {
			for lang, cnt := range s.InUse {
				if cnt > maxInUse[lang] {
					maxInUse[lang] = cnt
				}
			}
		}
		if len(maxInUse) == 0 {
			fmt.Printf("    (all containers idle / no in-use recorded)\n")
		} else {
			for lang, mx := range maxInUse {
				fmt.Printf("    %-12s max_in_use=%d\n", lang, mx)
			}
		}
	}
	snapMu.Unlock()

	printReport(report)
	return report
}

func analyze(name string, targetRate float64, results []Result, elapsed time.Duration) PhaseReport {
	total := len(results)
	accepted := 0
	failed := 0
	errors := 0
	latencies := make([]float64, 0, total)

	for _, r := range results {
		latencies = append(latencies, r.LatencyMs)
		switch {
		case r.Accepted:
			accepted++
		case r.Status == "accepted":
			accepted++
		case r.Status == "wrong_answer":
			failed++
		default:
			errors++
		}
	}

	sort.Float64s(latencies)

	pct := func(p float64) float64 {
		if len(latencies) == 0 {
			return 0
		}
		idx := int(math.Ceil(p/100.0*float64(len(latencies)))) - 1
		if idx < 0 {
			idx = 0
		}
		if idx >= len(latencies) {
			idx = len(latencies) - 1
		}
		return latencies[idx]
	}

	avg := func() float64 {
		if len(latencies) == 0 {
			return 0
		}
		sum := 0.0
		for _, l := range latencies {
			sum += l
		}
		return sum / float64(len(latencies))
	}()

	actualRate := 0.0
	if elapsed.Seconds() > 0 {
		actualRate = float64(total) / elapsed.Seconds()
	}

	successRate := 0.0
	if total > 0 {
		successRate = float64(accepted) / float64(total) * 100
	}

	return PhaseReport{
		PhaseName:    name,
		TargetRate:   targetRate,
		ActualRate:   actualRate,
		TotalSent:    total,
		Accepted:     accepted,
		Failed:       failed,
		Errors:       errors,
		AvgLatencyMs: avg,
		P50LatencyMs: pct(50),
		P95LatencyMs: pct(95),
		P99LatencyMs: pct(99),
		MaxLatencyMs: pct(100),
		MinLatencyMs: func() float64 {
			if len(latencies) == 0 {
				return 0
			}
			return latencies[0]
		}(),
		DurationSec: elapsed.Seconds(),
		SuccessRate: successRate,
	}
}

func printReport(r PhaseReport) {
	status := "✅"
	if r.SuccessRate < 80 || r.Errors > r.TotalSent/5 {
		status = "❌"
	} else if r.SuccessRate < 95 {
		status = "⚠️ "
	}

	fmt.Printf("\n  %s Results for [%s]\n", status, r.PhaseName)
	fmt.Printf("  ─────────────────────────────────────────────\n")
	fmt.Printf("  Submissions  : %d sent in %.1fs\n", r.TotalSent, r.DurationSec)
	fmt.Printf("  Target rate  : %.0f/s    Actual rate: %.1f/s\n", r.TargetRate, r.ActualRate)
	fmt.Printf("  Accepted     : %d (%.1f%%)\n", r.Accepted, r.SuccessRate)
	fmt.Printf("  Failed/WA    : %d\n", r.Failed)
	fmt.Printf("  Errors       : %d\n", r.Errors)
	fmt.Printf("  Latency avg  : %.0f ms\n", r.AvgLatencyMs)
	fmt.Printf("  Latency P50  : %.0f ms\n", r.P50LatencyMs)
	fmt.Printf("  Latency P95  : %.0f ms\n", r.P95LatencyMs)
	fmt.Printf("  Latency P99  : %.0f ms\n", r.P99LatencyMs)
	fmt.Printf("  Latency max  : %.0f ms\n", r.MaxLatencyMs)
	fmt.Printf("  ─────────────────────────────────────────────\n")
}

// ─── CSV export ───────────────────────────────────────────────────────────────

func exportCSV(reports []PhaseReport, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	defer w.Flush()

	headers := []string{
		"phase", "target_rate", "actual_rate", "total", "accepted", "failed", "errors",
		"success_rate_%", "avg_ms", "p50_ms", "p95_ms", "p99_ms", "max_ms", "min_ms", "duration_s",
	}
	w.Write(headers)

	for _, r := range reports {
		w.Write([]string{
			r.PhaseName,
			fmt.Sprintf("%.0f", r.TargetRate),
			fmt.Sprintf("%.2f", r.ActualRate),
			fmt.Sprintf("%d", r.TotalSent),
			fmt.Sprintf("%d", r.Accepted),
			fmt.Sprintf("%d", r.Failed),
			fmt.Sprintf("%d", r.Errors),
			fmt.Sprintf("%.1f", r.SuccessRate),
			fmt.Sprintf("%.0f", r.AvgLatencyMs),
			fmt.Sprintf("%.0f", r.P50LatencyMs),
			fmt.Sprintf("%.0f", r.P95LatencyMs),
			fmt.Sprintf("%.0f", r.P99LatencyMs),
			fmt.Sprintf("%.0f", r.MaxLatencyMs),
			fmt.Sprintf("%.0f", r.MinLatencyMs),
			fmt.Sprintf("%.1f", r.DurationSec),
		})
	}
	return nil
}

// ─── Summarize all phases ─────────────────────────────────────────────────────

func printFinalSummary(reports []PhaseReport) {
	fmt.Printf("\n╔══════════════════════════════════════════════════════════════════════╗\n")
	fmt.Printf("║                    FINAL BENCHMARK SUMMARY                          ║\n")
	fmt.Printf("╠══════════════════════════════════════════════════════════════════════╣\n")
	fmt.Printf("║ %-18s %8s %8s %8s %8s %8s   ║\n", "Phase", "Rate/s", "Accept%", "P95ms", "P99ms", "Errors")
	fmt.Printf("╠══════════════════════════════════════════════════════════════════════╣\n")

	var maxSustainableRate float64
	for _, r := range reports {
		marker := "  "
		if r.SuccessRate >= 95 && r.Errors == 0 {
			marker = "✅"
			if r.ActualRate > maxSustainableRate {
				maxSustainableRate = r.ActualRate
			}
		} else if r.SuccessRate < 80 || r.Errors > r.TotalSent/10 {
			marker = "❌"
		} else {
			marker = "⚠️"
		}
		fmt.Printf("║ %s %-16s %8.1f %8.1f %8.0f %8.0f %8d   ║\n",
			marker, r.PhaseName, r.ActualRate, r.SuccessRate, r.P95LatencyMs, r.P99LatencyMs, r.Errors)
	}

	fmt.Printf("╠══════════════════════════════════════════════════════════════════════╣\n")
	fmt.Printf("║  Max sustainable rate (0 errors, ≥95%% success): %.1f subs/sec        ║\n", maxSustainableRate)
	fmt.Printf("║                                                                      ║\n")
	fmt.Printf("║  Scale-out projections:                                              ║\n")
	if maxSustainableRate > 0 {
		for _, n := range []int{1, 2, 3, 5} {
			fmt.Printf("║    %d judge server(s): ~%.0f submissions/sec                          ║\n",
				n, maxSustainableRate*float64(n))
		}
	} else {
		fmt.Printf("║    (Could not determine sustainable rate — check errors above)       ║\n")
	}
	fmt.Printf("║                                                                      ║\n")
	fmt.Printf("║  Codespace has 2 vCPUs / ~8GB RAM.                                  ║\n")
	fmt.Printf("║  Pool size: 2 containers per language (8 languages = 16 total).      ║\n")
	fmt.Printf("╚══════════════════════════════════════════════════════════════════════╝\n")
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	judgeURL := flag.String("judge", "http://172.18.0.3:8081", "Judge service base URL")
	statsURL := flag.String("stats", "", "Judge /stats URL (auto-derived from -judge if empty)")
	rate := flag.Float64("rate", 5, "Submissions per second")
	total := flag.Int("total", 100, "Total submissions")
	langFilter := flag.String("lang", "all", "Language filter: all|python|javascript|java|cpp|go")
	phase := flag.String("phase", "full", "Phase: small|medium|heavy|stress|full|custom")
	outCSV := flag.String("out", "benchmark_results.csv", "Output CSV file")
	timeoutSec := flag.Int("timeout", 90, "Per-submission HTTP timeout in seconds")
	flag.Parse()

	if *statsURL == "" {
		*statsURL = *judgeURL + "/stats"
	}

	// Check judge is reachable
	checkClient := &http.Client{Timeout: 5 * time.Second}
	if resp, err := checkClient.Get(*judgeURL + "/health"); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Judge service unreachable at %s: %v\n", *judgeURL, err)
		os.Exit(1)
	} else {
		resp.Body.Close()
		fmt.Printf("✅ Judge service is up at %s\n", *judgeURL)
	}

	subPool := buildSubmissionPool(*langFilter)
	if len(subPool) == 0 {
		fmt.Fprintf(os.Stderr, "❌ No submissions built for lang=%s\n", *langFilter)
		os.Exit(1)
	}
	fmt.Printf("📦 Submission pool: %d unique problem×language combinations\n", len(subPool))

	timeout := time.Duration(*timeoutSec) * time.Second
	var reports []PhaseReport

	switch *phase {
	case "small":
		reports = append(reports, runPhase("small-5/s", *judgeURL, *statsURL, 5, 100, subPool, timeout))

	case "medium":
		reports = append(reports, runPhase("medium-10/s", *judgeURL, *statsURL, 10, 200, subPool, timeout))

	case "heavy":
		reports = append(reports, runPhase("heavy-20/s", *judgeURL, *statsURL, 20, 300, subPool, timeout))

	case "stress":
		reports = append(reports, runPhase("stress-40/s", *judgeURL, *statsURL, 40, 400, subPool, timeout))

	case "custom":
		reports = append(reports, runPhase(fmt.Sprintf("custom-%.0f/s", *rate), *judgeURL, *statsURL, *rate, *total, subPool, timeout))

	default: // full
		// Phase 1: Warm-up baseline
		fmt.Printf("\n🔥 Phase 1: Warm-up (100 submissions @ 5/s)\n")
		reports = append(reports, runPhase("warmup-5/s", *judgeURL, *statsURL, 5, 100, subPool, timeout))

		// Cool-down between phases
		fmt.Printf("\n⏳ Cooling down 10s...\n")
		time.Sleep(10 * time.Second)

		// Phase 2: Medium
		fmt.Printf("\n🔥 Phase 2: Medium (200 submissions @ 10/s)\n")
		reports = append(reports, runPhase("medium-10/s", *judgeURL, *statsURL, 10, 200, subPool, timeout))

		fmt.Printf("\n⏳ Cooling down 10s...\n")
		time.Sleep(10 * time.Second)

		// Phase 3: Heavy
		fmt.Printf("\n🔥 Phase 3: Heavy (300 submissions @ 20/s)\n")
		reports = append(reports, runPhase("heavy-20/s", *judgeURL, *statsURL, 20, 300, subPool, timeout))

		fmt.Printf("\n⏳ Cooling down 15s...\n")
		time.Sleep(15 * time.Second)

		// Phase 4: Stress
		fmt.Printf("\n🔥 Phase 4: Stress (400 submissions @ 40/s)\n")
		reports = append(reports, runPhase("stress-40/s", *judgeURL, *statsURL, 40, 400, subPool, timeout))

		fmt.Printf("\n⏳ Cooling down 15s...\n")
		time.Sleep(15 * time.Second)

		// Phase 5: Breaking point attempt
		fmt.Printf("\n🔥 Phase 5: Breaking point (500 submissions @ 60/s)\n")
		reports = append(reports, runPhase("break-60/s", *judgeURL, *statsURL, 60, 500, subPool, timeout))
	}

	printFinalSummary(reports)

	if err := exportCSV(reports, *outCSV); err != nil {
		fmt.Fprintf(os.Stderr, "⚠️  Could not write CSV: %v\n", err)
	} else {
		fmt.Printf("\n📊 Results exported to: %s\n", *outCSV)
	}
}
