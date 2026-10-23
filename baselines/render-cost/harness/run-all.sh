#!/usr/bin/env bash
# The measurement matrix.
#
#   run-all.sh <repo> <scratch> <reps> <hyperframes bin> <workerd bin> [--no-extras]
#
# Two parts. The CORE set is what the verdict rests on, run <reps> times with
# the renderers interleaved inside each repetition so that load drift on a
# shared machine falls on all of them: each renderer's first frame and its
# full render at its defaults, HyperFrames also on the software path a server
# without a GPU runs, pocket-motion with no shutter and with 4 and 12 samples,
# and the core in workerd. It is the set
# to re-run when the machine is quiet. The EXTRAS run once afterwards:
# builds, the GPU and parallel configurations, the Worker Loader variant, the
# 4-sample workerd render and the per-frame breakdown.
#
# Expects stage-pm.sh, stage-rm.sh, stage-hf.sh and workers/build.ts to have
# run into <scratch> (docs/render-cost-benchmark.md, "Reproduce"). Appends one
# JSON line per run to <scratch>/results/runs.jsonl (measure.ts), one per
# workerd request to <scratch>/results/workerd.jsonl (workerd.sh), and one per
# breakdown to <scratch>/results/core-bench.jsonl.
set -uo pipefail
W=$(cd "$1" && pwd); S=$2; REPS=$3; HFB=$4; WD=$5; EXTRAS=${6:-}
OUT=$S/results/runs.jsonl
mkdir -p "$S/results" "$S/out"
M=(bun "$W/baselines/render-cost/harness/measure.ts")
PM=(bun "$W/src/cli/main.ts")
P=$S/proto/compositions
RMB=$S/rm/node_modules/.bin/remotion
WKS=$W/baselines/render-cost/harness/workerd.sh

export REMOTION_DISABLE_TELEMETRY=1
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1
export HYPERFRAMES_NO_OPTIONAL_INSTALL=1 HYPERFRAMES_SKIP_SKILLS=1
unset GEMINI_API_KEY

m() { local label=$1 cwd=$2; shift 2; "${M[@]}" --label "$label" --out "$OUT" --cwd "$cwd" -- "$@"; }

# Readiness timeouts, raised: at a load average in the hundreds Remotion's
# 30 s default for a delayRender() (the font load) expired. They change how
# long each renderer waits for its page, not what it renders.
RMT=(--timeout=180000)
HFT=(--player-ready-timeout=180000 --browser-timeout=180)

# Remotion renders from a bundle; build it once, untimed here (timed below).
[ -d "$S/rm/build-r" ] || (cd "$S/rm" && "$RMB" bundle src/index.ts --out-dir "$S/rm/build-r" --bundle-cache=false >/dev/null)

for r in $(seq 1 "$REPS"); do
  echo "== rep $r $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)"
  m pm.first-frame "$W" "${PM[@]}" frame "$P/bench-title" --at 0 --out "$S/out/pm-first.png"
  m rm.first-frame "$S/rm" "$RMB" still "$S/rm/build-r" BenchTitle "$S/out/rm-first.png" --frame=0 --overwrite "${RMT[@]}"
  m hf.first-frame "$S/hf" "$HFB" snapshot "$S/hf/bench-title" --at 0 --no-end -o "$S/out/hf-first" --timeout=180000
  m pm.render.none "$W" "${PM[@]}" render "$P/bench-title" --out "$S/out/pm-none.mp4"
  m rm.render.c1 "$S/rm" "$RMB" render "$S/rm/build-r" BenchTitle "$S/out/rm-c1.mp4" --crf=16 --concurrency=1 --overwrite "${RMT[@]}"
  m hf.render.w1 "$S/hf" "$HFB" render "$S/hf/bench-title" -o "$S/out/hf-w1.mp4" --workers 1 "${HFT[@]}"
  m hf.render.w1.sw "$S/hf" "$HFB" render "$S/hf/bench-title" -o "$S/out/hf-w1-sw.mp4" --workers 1 --no-browser-gpu "${HFT[@]}"
  m pm.render.s4 "$W" "${PM[@]}" render "$P/bench-title-s4" --out "$S/out/pm-s4.mp4"
  m pm.render.s12 "$W" "${PM[@]}" render "$P/bench-title-s12" --out "$S/out/pm-s12.mp4"
  # The same core in workerd: a fresh process per repetition.
  "$WKS" "$WD" "$S/wk" "$S/results/workerd.jsonl" \
    'at=0' 'from=0&to=300' 'from=0&to=300&deflate=1' 'from=0&to=300&samples=12'
done

[ "$EXTRAS" = "--no-extras" ] && { echo "== done $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)"; exit 0; }

echo "== extras $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)"
# A cold build first empties the content-addressed transform cache (safe to
# delete: a missing entry reads as a miss).
rm -rf "$W/vendor/pocketjs/.cache/transforms"
m pm.build.cold "$W" "${PM[@]}" build "$P/bench-title"
m pm.build.warm "$W" "${PM[@]}" build "$P/bench-title"
rm -rf "$S/rm/build-x"
m rm.bundle "$S/rm" "$RMB" bundle src/index.ts --out-dir "$S/rm/build-x" --bundle-cache=false
# Remotion's Lambda default, software GL: on this Mac about 4 s a frame, so
# 30 frames rather than 300 (its 300-frame render overran a 180 s timeout).
m rm.render.c1.swangle.30f "$S/rm" "$RMB" render "$S/rm/build-r" BenchTitle "$S/out/rm-c1-swangle-30f.mp4" --crf=16 --concurrency=1 --gl=swangle --frames=0-29 --overwrite "${RMT[@]}"
m rm.render.c5 "$S/rm" "$RMB" render "$S/rm/build-r" BenchTitle "$S/out/rm-c5.mp4" --crf=16 --overwrite "${RMT[@]}"
m hf.render.auto "$S/hf" "$HFB" render "$S/hf/bench-title" -o "$S/out/hf-auto.mp4" --workers auto "${HFT[@]}"
"$WKS" "$WD" "$S/wk" "$S/results/workerd.jsonl" 'from=0&to=300&samples=4'
BODY="$S/wk/loader/request.bin" "$WKS" "$WD" "$S/wk/loader" "$S/results/workerd.jsonl" 'at=0' 'at=0'
for v in "" -s4 -s12; do
  n=${v#-s}; bun "$W/baselines/render-cost/harness/core-bench.ts" --dist "$S/proto/dist/compositions/bench-title$v" \
    --samples "${n:-0}" >> "$S/results/core-bench.jsonl"
done
echo "== done $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)"
