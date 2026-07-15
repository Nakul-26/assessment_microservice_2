#!/usr/bin/env bash
# benchmark/run_benchmark.sh
# Convenience wrapper to run the judge load benchmark
#
# Usage:
#   ./run_benchmark.sh [phase] [options]
#
# Phases:
#   small   - 100 subs @ 5/s
#   medium  - 200 subs @ 10/s
#   heavy   - 300 subs @ 20/s
#   stress  - 400 subs @ 40/s
#   full    - All phases in sequence (default)
#   custom  - Use -rate and -total flags
#
# Examples:
#   ./run_benchmark.sh small
#   ./run_benchmark.sh full
#   ./run_benchmark.sh custom -rate 15 -total 150 -lang python

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$SCRIPT_DIR/judge-bench"

# Rebuild if binary is missing or source is newer
if [ ! -f "$BINARY" ] || [ "$SCRIPT_DIR/main.go" -nt "$BINARY" ]; then
  echo "🔨 Building benchmark tool..."
  cd "$SCRIPT_DIR"
  go build -o ./judge-bench .
  echo "✅ Build complete"
fi

PHASE="${1:-full}"
shift || true

# Auto-detect judge service IP
JUDGE_IP=$(docker inspect codespace_judge_service_go \
  --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "172.18.0.3")
JUDGE_URL="http://${JUDGE_IP}:8081"

echo "════════════════════════════════════════════════════"
echo "  Judge Service Load Benchmark"
echo "  Target: $JUDGE_URL"
echo "  Phase:  $PHASE"
echo "════════════════════════════════════════════════════"

# Live resource monitoring in background
MONITOR_PID=""
if command -v docker &>/dev/null; then
  (
    while true; do
      echo "--- $(date '+%H:%M:%S') Judge Container Stats ---"
      docker stats codespace_judge_service_go --no-stream \
        --format "CPU: {{.CPUPerc}}  MEM: {{.MemUsage}}  NET: {{.NetIO}}  BLOCK: {{.BlockIO}}" 2>/dev/null || true
      sleep 5
    done
  ) >> "$SCRIPT_DIR/resource_monitor.log" 2>&1 &
  MONITOR_PID=$!
  echo "📊 Resource monitor started (PID $MONITOR_PID) → resource_monitor.log"
fi

cleanup() {
  if [ -n "$MONITOR_PID" ]; then
    kill "$MONITOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

"$BINARY" -phase "$PHASE" -judge "$JUDGE_URL" -out "$SCRIPT_DIR/benchmark_results.csv" "$@"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Done! Results: $SCRIPT_DIR/benchmark_results.csv"
echo "  Logs:          $SCRIPT_DIR/resource_monitor.log"
echo "════════════════════════════════════════════════════"
