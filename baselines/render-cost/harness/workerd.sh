#!/usr/bin/env bash
# Time requests against the workerd prototype and record what the workerd
# process spent on each.
#
#   workerd.sh <workerd binary> <project dir from workers/build.ts> <out.jsonl> <query>...
#
# With BODY=<file> in the environment, each request is a POST of that file to
# /render (the Worker Loader variant, <project>/loader), not a GET of /.
# Each query is the part after `?` (e.g. `from=0&to=300&samples=4`). Per
# request this records wall time from curl, the workerd process's CPU time
# before and after (ps, centisecond resolution), its RSS after, and the
# response's own fields (frame hashes, digest, wasm memory). workerd is
# started once per call; the time from spawn until /health answers is recorded
# as the first line, `startup`. Every render request boots its own wasm
# instance and guest, so each one pays the scene's boot, not the Worker's.
set -euo pipefail
WD=$1; P=$2; OUT=$3; shift 3
PORT=$(grep -o '127.0.0.1:[0-9]*' "$P/config.capnp" | cut -d: -f2)
cd "$P"
t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
"$WD" serve config.capnp --experimental > "$P/workerd.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 500); do curl -s -o /dev/null "http://127.0.0.1:$PORT/health" && break; sleep 0.02; done
t1=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
dt=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.3f", b - a }')
echo "{\"query\":\"startup\",\"wallSeconds\":$dt,\"workerdRssBytes\":$(( $(ps -o rss= -p "$PID") * 1024 ))}" >> "$OUT"
cpu() { ps -o time= -p "$PID" | awk -F'[:.]' '{ if (NF==3) print $1*60+$2+$3/100; else print $1*3600+$2*60+$3+$4/100 }'; }
for q in "$@"; do
  c0=$(cpu); l0=$(sysctl -n vm.loadavg | awk '{print $2}')
  if [ -n "${BODY:-}" ]; then
    wall=$(curl -s -o "$P/last.json" -w '%{time_total}' --data-binary "@$BODY" "http://127.0.0.1:$PORT/render?$q")
  else
    wall=$(curl -s -o "$P/last.json" -w '%{time_total}' "http://127.0.0.1:$PORT/?$q")
  fi
  c1=$(cpu); rss=$(ps -o rss= -p "$PID")
  bun -e "
    const r = JSON.parse(await Bun.file('$P/last.json').text());
    const rec = { variant: '${BODY:+loader}' || 'static', query: '$q', wallSeconds: $wall, workerdCpuSeconds: +($c1 - $c0).toFixed(2),
      workerdRssBytes: $rss * 1024, load: $l0, digest: r.digest, frames: r.frames.length,
      wasmMemoryAfterBootBytes: r.wasmMemoryAfterBootBytes, wasmMemoryBytes: r.wasmMemoryBytes,
      pakBytes: r.pakBytes, deflatedBytes: r.deflatedBytes ?? null, rawBytes: r.rawBytes ?? null, hashes: r.frames };
    require('node:fs').appendFileSync('$OUT', JSON.stringify(rec) + '\n');
    console.log(rec.query, 'wall', rec.wallSeconds, 's cpu', rec.workerdCpuSeconds, 's rss', (rec.workerdRssBytes/2**20).toFixed(0), 'MiB wasm', (rec.wasmMemoryBytes/2**20).toFixed(1), 'MiB digest', rec.digest.slice(0,8));
  "
done
