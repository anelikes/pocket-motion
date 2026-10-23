#!/usr/bin/env bash
# Stage the Remotion port into a scratch project.
#
#   stage-rm.sh <repo checkout> <scratch dir> <node_modules holding remotion 4.0.482>
#
# node_modules is a symlink to an existing install (with its downloaded
# chrome-headless-shell under .remotion/), so staging downloads nothing; the
# fonts are the repository's two HarmonyOS Sans faces, served as public/.
set -euo pipefail
W=$(cd "$1" && pwd); S=$2; NM=$3
D=$S/rm
rm -rf "$D"; mkdir -p "$D/public/fonts"
cp -R "$W/baselines/render-cost/remotion/src" "$W/baselines/render-cost/remotion/package.json" "$D/"
cp "$W/assets/fonts/HarmonyOS_Sans_Regular.ttf" "$W/assets/fonts/HarmonyOS_Sans_Bold.ttf" "$D/public/fonts/"
ln -sfn "$NM" "$D/node_modules"
grep -q '"version": "4.0.482"' "$NM/remotion/package.json" || { echo "stage-rm: $NM has no remotion 4.0.482" >&2; exit 2; }
echo "staged $D"
