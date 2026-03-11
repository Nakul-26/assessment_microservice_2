//go:build integration

package main

import (
	"testing"

	"judge-service-go/pkg/testutil"
)

func TestPythonCentralIntegration_FDLeakRegression(t *testing.T) {
	startFDs, err := testutil.CountOpenFDs()
	if err != nil {
		t.Skipf("fd counting unavailable: %v", err)
	}

	exec, p, pc, lang := setupPythonIntegration(t)
	defer p.Release(pc)

	problem := twoSumProblem()
	code := `
def twoSum(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
`

	prevFDs := startFDs
	const cycles = 3
	const runsPerCycle = 12
	const tolerance = 5

	for cycle := 0; cycle < cycles; cycle++ {
		for i := 0; i < runsPerCycle; i++ {
			result := runCentralOnce(t, exec, pc, lang, problem, code)
			if result == nil || result.Passed != result.Total {
				t.Fatalf("unexpected result during fd cycle %d run %d: %+v", cycle, i, result)
			}
		}

		testutil.StabilizeRuntime()

		currentFDs, err := testutil.CountOpenFDs()
		if err != nil {
			t.Fatalf("CountOpenFDs failed: %v", err)
		}
		t.Logf("cycle=%d start_fds=%d current_fds=%d", cycle, startFDs, currentFDs)

		if cycle > 0 && currentFDs > prevFDs+tolerance {
			t.Fatalf("possible fd leak across cycles: previous=%d current=%d tolerance=%d", prevFDs, currentFDs, tolerance)
		}
		prevFDs = currentFDs
	}

	testutil.StabilizeRuntime()

	endFDs, err := testutil.CountOpenFDs()
	if err != nil {
		t.Fatalf("CountOpenFDs failed: %v", err)
	}
	t.Logf("fds before=%d after=%d", startFDs, endFDs)
	if endFDs > startFDs+tolerance {
		t.Fatalf("possible fd leak: start=%d end=%d tolerance=%d", startFDs, endFDs, tolerance)
	}
}
