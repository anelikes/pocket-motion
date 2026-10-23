#!/usr/bin/env bash
# Stage the pocket-motion benchmark scene into a scratch tree and build it.
#
#   stage-pm.sh <repo checkout> <scratch dir>
#
# Three compositions come out, identical but for the sidecar's shutter:
#   compositions/bench-title       no shutter
#   compositions/bench-title-s4    shutter 180° x 4
#   compositions/bench-title-s12   shutter 180° x 12
#   compositions/bench-title-ss2, -ss2-s12, -ss4   supersample 2 without and
#                                  with the 12-sample shutter, and
#                                  supersample 4: built only to read the wasm
#                                  memory and pak size those densities cost
# The scratch tree borrows vendor/, assets/ and node_modules/ from the checkout
# by symlink, which is how baselines/shutter.md stages its scenes.
set -euo pipefail
W=$(cd "$1" && pwd); S=$2; P=$S/proto
SRC=$W/baselines/render-cost/pocket-motion/bench-title
mkdir -p "$P/compositions"
for l in vendor assets node_modules; do ln -sfn "$W/$l" "$P/$l"; done
stage() { # name shutter-json-or-empty [supersample]
  local d=$P/compositions/$1
  rm -rf "$d"; cp -R "$SRC" "$d"
  sed -i '' "s#compositions/bench-title/main.tsx#compositions/$1/main.tsx#; s#\"output\": \"bench-title\"#\"output\": \"$1\"#" "$d/pocket.json"
  if [ -n "${3:-}" ]; then
    sed -i '' "s#\"supersample\": 1,#\"supersample\": $3,#" "$d/pocket-motion.json"
  fi
  if [ -n "$2" ]; then
    sed -i '' "s#\"supersample\": \([124]\),#\"supersample\": \1,\n  \"shutter\": $2,#" "$d/pocket-motion.json"
  fi
}
stage bench-title ""
stage bench-title-s4 '{ "angle": 180, "samples": 4 }'
stage bench-title-s12 '{ "angle": 180, "samples": 12 }'
stage bench-title-ss2 "" 2
stage bench-title-ss2-s12 '{ "angle": 180, "samples": 12 }' 2
stage bench-title-ss4 "" 4
for c in bench-title bench-title-s4 bench-title-s12 bench-title-ss2 bench-title-ss2-s12 bench-title-ss4; do
  bun "$W/src/cli/main.ts" build "$P/compositions/$c"
done
