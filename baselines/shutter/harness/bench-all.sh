#!/usr/bin/env bash
# Cost of one exposure per frame at 1080p, N = 1, 4, 8, 16, on four scenes.
W=$1; S=$2; P=$S/proto; OUT=${3:-$S/out}
cd "$S"
run() { POCKETJS_ROOT=$S/pj bun harness/bench.ts --repo "$W" --bundle "$1/main.js" --pak "$1/main.pak" --w 1920 --h 1080 --fps 30 --from "$2" --frames 12 --reps 3 --label "$3" --json "$OUT/bench-$3.json"; }
run "$P/dist/compositions/blur" 10 blur
run "$P/dist/compositions/heavy" 10 heavy
run "$W/dist/compositions/reel" 400 reel
run "$W/dist/compositions/transitions" 100 transitions
