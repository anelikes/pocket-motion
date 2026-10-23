#!/usr/bin/env bash
# Stage the HyperFrames port into a scratch project.
#
#   stage-hf.sh <repo checkout> <scratch dir> <gsap.min.js, GSAP 3.15.0>
#
# The project is index.html from this directory plus the repository's two
# HarmonyOS Sans faces and a local GSAP, so the render fetches nothing.
set -euo pipefail
W=$(cd "$1" && pwd); S=$2; GSAP=$3
D=$S/hf/bench-title
rm -rf "$D"; mkdir -p "$D/assets/fonts"
cp "$W/baselines/render-cost/hyperframes/bench-title/index.html" "$D/"
cp "$W/assets/fonts/HarmonyOS_Sans_Regular.ttf" "$W/assets/fonts/HarmonyOS_Sans_Bold.ttf" "$D/assets/fonts/"
cp "$GSAP" "$D/gsap.min.js"
grep -q "GSAP 3.15.0" "$D/gsap.min.js" || { echo "stage-hf: $GSAP is not GSAP 3.15.0" >&2; exit 2; }
echo "staged $D"
