#!/usr/bin/env bun
/**
 * The host-side guards of patches/0042-0043, each watched red: introduce the
 * defect, run the test that names it, restore.
 *
 *   bun baselines/vector-paths/redcheck-ts.ts [mutation name ...]
 *
 * A defect in the vendored compiler or framework is written into the PATCH
 * file — one `+` line replaced by another, so every hunk keeps its line
 * counts and still applies — and `bun scripts/vendor.ts --no-wasm` rebuilds
 * the tree from it. `vendor/` is never edited by hand, here as anywhere; the
 * wasm is not rebuilt because no defect here is in Rust (the core's guards
 * are `redcheck.py`'s). A defect in this repository's own sources is written
 * into the file and restored. Every patch and file is restored and the tree
 * re-vendored at the end, whatever happened.
 *
 * Prints one line per defect: RED (its test failed), GREEN (it did not), or
 * SKIP (its anchor is not found exactly once, so it did not run).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

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
    name: "collector does not fold a `+` of literals",
    file: "patches/0043-path-component.patch",
    old: '+    case "BinaryExpression": {',
    new: '+    case "BinaryExpressionX": {',
    test: ["tests/catalog.test.ts", "G9"],
  },
  {
    name: "collector does not follow a const",
    file: "patches/0043-path-component.patch",
    old: '+      if (b.kind !== "const" || b.path.node.type !== "VariableDeclarator") return null;',
    new: "+      return null;",
    test: ["tests/catalog.test.ts", "G9"],
  },
  {
    name: "collector does not read a .map callback's parameter",
    file: "patches/0043-path-component.patch",
    old: '+      if (b.kind === "param") return mapParamValues(b.path, depth);',
    new: '+      if (b.kind === "param") return null;',
    test: ["tests/catalog.test.ts", "G9"],
  },
  {
    name: "collector reads `d` only on an element named Path",
    file: "patches/0043-path-component.patch",
    old: '+              if (name.type === "JSXIdentifier" && name.name === "d" && path.node.value) {',
    new: '+              if (name.type === "JSXIdentifier" && name.name === "d" && path.node.value && (path.parentPath.node as { name?: { name?: string } }).name?.name === "Path") {',
    test: ["tests/vector-paths.test.ts", "the same d written as a literal"],
  },
  {
    name: "arc pieces of a quarter turn instead of an eighth",
    file: "patches/0043-path-component.patch",
    old: "+const EIGHTH_COS = Math.SQRT1_2 - 1e-9;",
    new: "+const EIGHTH_COS = -1e-9;",
    test: ["tests/vector-paths.test.ts", "M10 50 A40 25 30 1 0 90 50"],
  },
  {
    // Expected GREEN, kept as the record of it: this host's Math.tan gives
    // the same bits, so only another host could show the difference.
    name: "tan(alpha/4) through Math.tan (expected green on one host)",
    file: "patches/0043-path-component.patch",
    old: "+    const t4 = t2 / (1 + Math.sqrt(1 + t2 * t2)); // tan(alpha/4)",
    new: "+    const t4 = Math.tan(Math.atan(t2) / 2); // tan(alpha/4)",
    test: ["tests/vector-paths.test.ts", "M10 50 A40 25 30 1 0 90 50"],
  },
  {
    name: "a quarter turn's -0 kept",
    file: "patches/0043-path-component.patch",
    old: "+  return [c + 0, s + 0];",
    new: "+  return [c, s];",
    test: ["tests/vector-paths.test.ts", "degrees are exact"],
  },
  {
    name: "a later key's line against key 0's cubic not promoted",
    file: "patches/0043-path-component.patch",
    old: "+      if (a === PATH_VERB.cubic && b === PATH_VERB.line) {",
    new: "+      if (a === PATH_VERB.cubic && b === PATH_VERB.line && false) {",
    test: ["tests/catalog.test.ts", "G9"],
  },
  {
    name: "key 0's line against a later key's cubic not promoted",
    file: "patches/0043-path-component.patch",
    old: "+      if (a === PATH_VERB.line && b === PATH_VERB.cubic) {",
    new: "+      if (a === PATH_VERB.line && b === PATH_VERB.cubic && false) {",
    test: ["tests/catalog.test.ts", "G9"],
  },
  {
    name: "path tokens not parsed",
    file: "patches/0043-path-component.patch",
    old: "+  if (parsePathUtility(tok, D)) return true;",
    new: "+  if (false && parsePathUtility(tok, D)) return true;",
    test: ["tests/catalog.test.ts", "G6 —"],
  },
  {
    name: "trimEnd is not a keyframe name",
    file: "patches/0043-path-component.patch",
    old: "+  trimEnd: [[PROP.trimEnd], scalarBits],",
    new: "+  trimEndX: [[PROP.trimEnd], scalarBits],",
    test: ["tests/catalog.test.ts", "G6 —"],
  },
  {
    name: "build lets a PathDataError escape unlocated",
    file: "patches/0043-path-component.patch",
    old: "+      if (!(e instanceof PathDataError)) throw e;",
    new: "+      throw e;",
    test: ["tests/vector-paths.test.ts", "morph keys that part"],
  },
  {
    name: "mount counts an unbaked outline instead of refusing it",
    file: "patches/0043-path-component.patch",
    old: "+    if (getHost().strict) {\n+      throw new Error(\n+        `PocketJS: <Path> outline",
    new: "+    if (false) {\n+      throw new Error(\n+        `PocketJS: <Path> outline",
    test: ["tests/vector-paths.test.ts", "a d computed at run time"],
  },
  {
    name: "mount never registers the path table",
    file: "patches/0043-path-component.patch",
    old: "+  for (const key of Object.keys(table)) paths.set(key, table[key]!);",
    new: "+  for (const key of Object.keys(table)) void key;",
    test: ["tests/vector-paths.test.ts", "the same d written as a literal"],
  },
  {
    name: "the component never hands the key to the host",
    file: "patches/0043-path-component.patch",
    old: "+    get path() {",
    new: "+    get pathX() {",
    test: ["tests/vector-paths.test.ts", "the same d written as a literal"],
  },
  {
    name: "the op is not in this repository's range list",
    file: "src/vendor/draw-ops.ts",
    old: '"paintPop", "path"];',
    new: '"paintPop"];',
    test: ["tests/patches.test.ts", "reserved draw-list op range"],
  },
];

function sh(cmd: string[], quiet = true): { code: number; out: string } {
  // POCKETJS_ROOT is vendor.ts's clone source and boot's core: a test must
  // boot THIS tree's core, so it reaches only the vendoring.
  const env = { ...Bun.env };
  if (cmd[1] !== "scripts/vendor.ts") delete env.POCKETJS_ROOT;
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env });
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
// its test is green without the defect (a test that times out on a loaded
// machine is red either way).
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
