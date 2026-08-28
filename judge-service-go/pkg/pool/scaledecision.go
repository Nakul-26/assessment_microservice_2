package pool

// scaleDecision is the pure, Docker-free core of the pool autoscaler: given one language's
// current bounds/target and a load signal for the most recent interval, it decides whether to
// grow, shrink, or hold. Kept separate from ContainerPool so it can be unit-tested without a
// Docker daemon — everything else in this package needs one (see the //go:build integration
// tests at the repo root), which is why this is the only pool-package logic with dedicated
// non-integration test coverage.
type scaleDecision struct {
	NewTarget int
	Action    string // "up", "down", or "hold" — for logging/metrics, not branched on by callers
}

const (
	scaleActionUp   = "up"
	scaleActionDown = "down"
	scaleActionHold = "hold"
)

// decideScale computes the next target for one language.
//
//   - min/max: configured bounds for this language (min <= max is assumed; callers clamp
//     upstream — see main.go's startup validation).
//   - target: the current scaling target (min <= target <= max going in).
//   - avgWaitMs: average Acquire() wait time in milliseconds over the most recent interval.
//     0 with hadTraffic=false means "no Acquire calls this interval" (no signal — hold).
//   - hadTraffic: whether any Acquire calls happened this interval at all. Distinguishes a
//     genuinely idle language (hold, don't scale down just because nobody asked) from one
//     that's fast enough to have zero wait (also hold-or-scale-down, but for a real reason).
//   - timeouts: count of Acquire calls that hit their context deadline (30s, see main.go)
//     this interval. Even one timeout is treated as a stronger signal than the wait-time
//     average alone — a caller that timed out already failed a submission, so this forces a
//     scale-up regardless of avgWaitMs, as long as there's room to grow.
//   - upThresholdMs/downThresholdMs: the dead-band. Above up -> grow. Below down -> shrink.
//     Between them -> hold. Requires upThresholdMs > downThresholdMs (asymmetric by design,
//     same shape as the asymmetric up/down cooldowns applied by the caller).
//   - upCooldownElapsed/downCooldownElapsed: whether enough time has passed since this
//     language's last scale-up/scale-down for another one to be allowed. The caller tracks
//     the actual timestamps; this function only receives the already-evaluated booleans so it
//     stays a pure function of its inputs (no clock, fully unit-testable).
//   - globalHeadroomAvailable: whether the cross-language container budget has room for one
//     more container right now. Only consulted for scale-up decisions — scale-down never
//     needs headroom.
//
// Scales by at most 1 container per call (see main.go/StartAutoscaler's per-tick cadence) —
// deliberately gradual so a single burst can't overshoot straight to max; sustained load keeps
// climbing on every subsequent tick until satisfied or capped.
func decideScale(
	min, max, target int,
	avgWaitMs float64,
	hadTraffic bool,
	timeouts int64,
	upThresholdMs, downThresholdMs float64,
	upCooldownElapsed, downCooldownElapsed bool,
	globalHeadroomAvailable bool,
) scaleDecision {
	// Defensive clamp: never trust an out-of-range target, even transiently.
	if target < min {
		target = min
	}
	if target > max {
		target = max
	}

	if !hadTraffic {
		return scaleDecision{NewTarget: target, Action: scaleActionHold}
	}

	wantsScaleUp := timeouts > 0 || avgWaitMs > upThresholdMs
	if wantsScaleUp {
		if target < max && upCooldownElapsed && globalHeadroomAvailable {
			return scaleDecision{NewTarget: target + 1, Action: scaleActionUp}
		}
		// Wants to grow but can't right now (at max, cooldown, or no global headroom) —
		// hold rather than fall through to a scale-down check: a language under load
		// should never shrink just because it also can't grow this tick.
		return scaleDecision{NewTarget: target, Action: scaleActionHold}
	}

	if avgWaitMs < downThresholdMs {
		if target > min && downCooldownElapsed {
			return scaleDecision{NewTarget: target - 1, Action: scaleActionDown}
		}
		return scaleDecision{NewTarget: target, Action: scaleActionHold}
	}

	// In the dead-band between the two thresholds.
	return scaleDecision{NewTarget: target, Action: scaleActionHold}
}
