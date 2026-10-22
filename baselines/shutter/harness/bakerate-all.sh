#!/usr/bin/env bash
# Same-instant comparison of 60 Hz and 240 Hz bakes over five compositions.
W=$1; S=$2
cd "$S"
for spec in "transitions 1920 1080 756" "shutter 3840 2160 150" "rename-card 1920 1080 180" "reel 1920 1080 1071" "curves 1920 1080 420"; do
  set -- $spec
  echo "== $1"
  bun harness/bakerate.ts --repo "$W" --a "$W/dist/compositions/$1/main.js" --b "$S/dist240/$1/main.js" \
    --w "$2" --h "$3" --fps 30 --frames "$4" --n 1 --json "$S/out/bakerate-$1-n1.json" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['framesDiffering'], 'of', d['frames'], 'differ; first', d['differ'][:12], 'digestA', d['digestA'][:16])"
done
