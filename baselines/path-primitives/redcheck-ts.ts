#!/usr/bin/env bun
/**
 * The host-side guards of patches/0045-0046 and `src/anim/path-motion.ts`,
 * each watched red: introduce the defect, run the test that names it,
 * restore.
 *
 *   bun baselines/path-primitives/redcheck-ts.ts [mutation name ...]
 *
 * As `baselines/vector-paths/redcheck-ts.ts` does: a defect in the vendored
 * compiler is written into the PATCH file — one `+` line replaced by another,
 * so every hunk keeps its line counts and still applies — and
 * `bun scripts/vendor.ts --no-wasm` rebuilds the tree from it; a defect in
 * this repository's own sources is written into the file and restored. The
 * core's guards are `redcheck.py`'s. Every patch and file is restored and the
 * tree re-vendored at the end, whatever happened.
 *
 * Prints one line per defect: RED (its test failed), GREEN (it did not), or
 * SKIP (its anchor is not found exactly once, so it did not run).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const T = "tests/path-primitives.test.ts";
const DASH = "patches/0045-path-dashes.patch";
const MORPH = "patches/0046-morph-equalisation.patch";
const KIT = "src/anim/path-motion.ts";

interface Mutation {
  name: string;
  /** A patch under patches/ (its `+` lines are searched), or a repo file. */
  file: string;
  old: string;
  new: string;
  /** `bun test` arguments: a file and a -t filter. */
  test: [string, string];
}

const MUTATIONS: Mutation[] = [
  {
    name: "dash tokens not parsed",
    file: DASH,
    old: '+  if (tok.startsWith("stroke-dash-")) {',
    new: '+  if (tok.startsWith("stroke-dashX-")) {',
    test: [T, "sets the count and the lengths"],
  },
  {
    name: "a pattern of zeros parses",
    file: DASH,
    old: "+    if (!lens.some((v) => v > 0)) return false;",
    new: "+    if (lens.length < 0) return false;",
    test: [T, "a pattern the core would draw solid does not parse"],
  },
  {
    name: "strokeDashoffset is not a keyframe name",
    file: DASH,
    old: "+  strokeDashoffset: [[PROP.dashOffset], pxBits],",
    new: "+  strokeDashoffsetX: [[PROP.dashOffset], pxBits],",
    test: [T, "are keyframe names for the offset"],
  },
  {
    name: "dash tokens not parsed (catalogue)",
    file: DASH,
    old: '+  if (tok.startsWith("stroke-dash-")) {',
    new: '+  if (tok.startsWith("stroke-dashX-")) {',
    test: ["tests/catalog.test.ts", "G6"],
  },
  {
    name: "keys that line up are equalised too",
    file: MORPH,
    old: "+  const aligned = alignByCommands(parse()) ?? equalizeKeys(parse());",
    new: "+  const aligned = equalizeKeys(parse());",
    test: [T, "keys that already line up bake the bytes 0043 baked"],
  },
  {
    name: "a split's second half from the wrong control point",
    file: MORPH,
    old: "+    [ex, ey, cx, cy, g[4], g[5]],",
    new: "+    [bx, by, cx, cy, g[4], g[5]],",
    test: [T, "every key keeps its outline"],
  },
  {
    name: "no start search",
    file: MORPH,
    old: "+      mine[i] = rotated(b, mb, bestShift);",
    new: "+      mine[i] = b;",
    test: [T, "one outline written another way morphs to itself"],
  },
  {
    name: "no winding rule",
    file: MORPH,
    old: "+    if (flip) mine = mine.map(reversed);",
    new: "+    if (flip && false) mine = mine.map(reversed);",
    test: [T, "one outline written another way morphs to itself"],
  },
  {
    name: "subpaths paired in written order, not by size",
    file: MORPH,
    old: "+        xs.map((x) => [x, size(x[1])] as const).sort((a, b) => b[1] - a[1] || a[0][0] - b[0][0]).map(([x]) => x);",
    new: "+        xs.map((x) => [x, size(x[1])] as const).sort((a, b) => a[0][0] - b[0][0]).map(([x]) => x);",
    test: [T, "one outline written another way morphs to itself"],
  },
  {
    name: "a cut inside a cubic becomes a nowhere-cubic at its end",
    file: MORPH,
    old: "+    else inside[i]!.push({ t, extra: need[g]! - 1 });",
    new: "+    else after[i]! += need[g]!;",
    test: [T, "one outline written another way morphs to itself"],
  },
  {
    name: "an unpartnered subpath shrinks to the origin",
    file: MORPH,
    old: "+        else if (r < sa.length) placed[sa[r]![0]] = pointSub(closed, centre(sa[r]![1]));",
    new: "+        else if (r < sa.length) placed[sa[r]![0]] = pointSub(closed, [0, 0]);",
    test: [T, "a subpath with no partner is a point"],
  },
  {
    name: "arc length through Math.hypot",
    file: MORPH,
    old: "+      acc += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));",
    new: "+      acc += Math.hypot(x - px, y - py);",
    test: [T, "nothing reaches the host's trigonometry"],
  },
  {
    name: "the kit keys even ticks",
    file: KIT,
    old: "const keys = keyTicks(ticks, every, 1);",
    new: "const keys = keyTicks(ticks, every, 2);",
    test: [T, "keys: tick 0, the odd ticks"],
  },
  {
    name: "the kit does not unwrap its angles",
    file: KIT,
    old: "const angles = turn === null ? [] : unwrapDegrees(pts.map((p) => p.angle + back + turn));",
    new: "const angles = turn === null ? [] : pts.map((p) => p.angle + back + turn);",
    test: [T, "keys: tick 0, the odd ticks"],
  },
  {
    name: "atan2Deg mirrors the left half wrongly",
    file: KIT,
    old: "  if (x < 0) deg = 180 - deg;",
    new: "  if (x < 0) deg = deg - 180;",
    test: [T, "atan2Deg"],
  },
  {
    name: "the viewBox is not centred in its box",
    file: KIT,
    old: "      tx += (w - vw * s) * 0.5 - vx * s;",
    new: "      tx += -vx * s;",
    test: [T, "a follower walks the outline"],
  },
  {
    name: "the node's corner rides the path, not its centre",
    file: KIT,
    old: "  const origin = o.node ? { x: o.node.x + o.node.w / 2, y: o.node.y + o.node.h / 2 } : { x: 0, y: 0 };",
    new: "  const origin = o.node ? { x: o.node.x, y: o.node.y } : { x: 0, y: 0 };",
    test: [T, "the dart and the dot sit on the route"],
  },
];

function sh(cmd: string[], quiet = true): { code: number | null; out: string } {
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString() + p.stderr.toString();
  if (!quiet) process.stdout.write(out);
  return { code: p.exitCode, out };
}

function vendor(): void {
  const r = sh(["bun", "scripts/vendor.ts", "--no-wasm"]);
  if (r.code !== 0) throw new Error(`vendor failed:\n${r.out}`);
}

const only = new Set(process.argv.slice(2));
const originals = new Map<string, string>();
// Each test once on the tree as it is: a RED below only means something if
// its test is green without the defect.
vendor();
for (const t of new Set(MUTATIONS.filter((m) => only.size === 0 || only.has(m.name)).map((m) => m.test.join("\0")))) {
  const [file, filter] = t.split("\0") as [string, string];
  const r = sh(["bun", "test", file, "-t", filter]);
  console.log(`${r.code === 0 ? "base GREEN" : "base RED  "} [${file} -t ${filter}]`);
  if (r.code !== 0) throw new Error(`baseline red: ${file} -t ${filter}\n${r.out.slice(-2000)}`);
}
try {
  for (const m of MUTATIONS) {
    if (only.size > 0 && !only.has(m.name)) continue;
    const path = join(ROOT, m.file);
    const src = originals.get(path) ?? readFileSync(path, "utf8");
    originals.set(path, src);
    const count = src.split(m.old).length - 1;
    if (count !== 1) {
      console.log(`SKIP  ${m.name}: anchor found ${count} times`);
      continue;
    }
    writeFileSync(path, src.replace(m.old, m.new));
    let verdict: string;
    try {
      if (m.file.startsWith("patches/")) vendor();
      const r = sh(["bun", "test", m.test[0], "-t", m.test[1]]);
      verdict = /\b0 pass\b/.test(r.out) && !/\bfail\b/.test(r.out) ? "NO-TEST" : r.code === 0 ? "GREEN" : "RED";
    } catch (e) {
      verdict = `ERROR ${(e as Error).message.split("\n")[0]}`;
    } finally {
      writeFileSync(path, src);
    }
    console.log(`${verdict.padEnd(5)} ${m.name}  [${m.test.join(" -t ")}]`);
  }
} finally {
  for (const [path, src] of originals) writeFileSync(path, src);
  vendor();
}
