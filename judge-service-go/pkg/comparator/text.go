package comparator

import "strings"

// CompareText is the stdin-mode MVP comparator: exact match after trimming
// trailing whitespace from both sides. Trailing-newline differences are
// treated as noise rather than a wrong answer — println/print always adds
// one, so refusing to trim it would fail nearly every otherwise-correct
// submission on that alone. This is distinct from the normalization flags
// (internal whitespace, case, blank lines) planned for Phase 2 — see
// docs/arventiq-integration/PLAN.md §5.
func CompareText(actual, expected string) bool {
	return strings.TrimRight(actual, " \t\r\n") == strings.TrimRight(expected, " \t\r\n")
}
