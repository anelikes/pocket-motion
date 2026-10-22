#!/usr/bin/env bash
# Exposure digests for three subjects, to compare across platforms.
#
#   determinism.sh <repo> <scratch> <tag>
#
# <repo> holds src/, vendor/pocketjs/tools/png.ts and dist/compositions/reel
# (the worktree, or a staged copy of those three for a container that cannot
# see it). <scratch> holds pj/ (the prototype tree: POCKETJS_ROOT), proto/dist
# (the two scenes, built) and harness/. Writes <scratch>/out/det/<subject>-<tag>.json.
#
# The linux/x86-64 run in baselines/shutter.md was:
#   docker run --rm --platform linux/amd64 -v "$S:$S" -w "$S" oven/bun@sha256:38919894db4e... \
#     bash "$S/harness/determinism.sh" "$S/repo" "$S" linux-amd64
set -euo pipefail
R=$1; S=$2; TAG=$3; P=$S/proto
mkdir -p "$S/out/det"
export POCKETJS_ROOT=$S/pj
bun "$S/harness/shutter.ts" --repo "$R" --bundle "$P/dist/compositions/blur/main.js" --pak "$P/dist/compositions/blur/main.pak" \
  --w 1920 --h 1080 --fps 30 --frames 90 --angle 180 --n 1,4,8,16 --exempt label-crisp --json "$S/out/det/blur-$TAG.json" > /dev/null
bun "$S/harness/shutter.ts" --repo "$R" --bundle "$P/dist/compositions/heavy/main.js" --pak "$P/dist/compositions/heavy/main.pak" \
  --w 1920 --h 1080 --fps 30 --frames 30 --angle 180 --n 1,4,8 --json "$S/out/det/heavy-$TAG.json" > /dev/null
bun "$S/harness/shutter.ts" --repo "$R" --bundle "$R/dist/compositions/reel/main.js" --pak "$R/dist/compositions/reel/main.pak" \
  --w 1920 --h 1080 --fps 30 --from 380 --frames 60 --angle 180 --n 1,8 --json "$S/out/det/reel-$TAG.json" > /dev/null
for f in blur heavy reel; do
  bun -e "const d=require('$S/out/det/$f-$TAG.json');console.log('$f', d.platform, d.wasm.slice(0,12), d.perN.map(r=>'N'+r.n+'='+r.digest.slice(0,16)).join(' '))"
done
