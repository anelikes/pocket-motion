#!/usr/bin/env bun
/**
 * The guards of patches/0053 (`<Svg>`) and 0054 (outlines read at mount),
 * each watched red: introduce the defect, run the test that names it, restore.
 *
 *   bun baselines/svg-import/redcheck.ts [mutation name ...]
 *
 * The same harness as `baselines/vector-paths/redcheck-ts.ts`. A defect in the
 * vendored compiler or framework is written into the PATCH file — one `+`
 * line replaced by another, so every hunk keeps its line counts and still
 * applies — and `bun scripts/vendor.ts --no-wasm` rebuilds the tree from it;
 * `vendor/` is never edited by hand. A defect in this repository's own
 * sources is written into the file and restored. Every patch and file is
 * restored and the tree re-vendored at the end, whatever happened.
 *
 * Prints one line per defect: RED (its test failed), GREEN (it did not), or
 * SKIP (an anchor is not found exactly once, so it did not run).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

interface Mutation {
  name: string;
  /** A patch under patches/ (its `+` lines are searched), or a repo file. */
  file: string;
  /** Replacements, each anchor found exactly once. */
  edits: Array<[string, string]>;
  /** `bun test` arguments: a file and a -t filter. */
  test: [string, string];
}

const P53 = "patches/0053-svg-import.patch";
const P54 = "patches/0054-paths-read-at-mount.patch";

const MUTATIONS: Mutation[] = [
  // ---- 0053: the document ----
  {
    name: "a circle swept counter-clockwise",
    file: P53,
    edits: [[
      "+      const arc = (ex: number, ey: number): string => `A${rx} ${ry} 0 0 1 ${ex} ${ey}`;\n+      return `M${cx + rx} ${cy}${arc(cx, cy + ry)}${arc(cx - rx, cy)}${arc(cx, cy - ry)}${arc(cx + rx, cy)}Z`;",
      "+      const arc = (ex: number, ey: number): string => `A${rx} ${ry} 0 0 0 ${ex} ${ey}`;\n+      return `M${cx + rx} ${cy}${arc(cx, cy - ry)}${arc(cx - rx, cy)}${arc(cx, cy + ry)}${arc(cx + rx, cy)}Z`;",
    ]],
    test: ["tests/svg-import.test.ts", "a circle starts at"],
  },
  {
    name: "a transform list composed leftmost-first",
    file: P53,
    edits: [["+    out = mul(out, t);", "+    out = mul(t, out);"]],
    test: ["tests/svg-import.test.ts", "a transform list applies its rightmost function first"],
  },
  {
    name: "rotate() through Math.cos and Math.sin",
    file: P53,
    edits: [["+      want(1, 3);\n+      const [c, s] = cosSinDeg(a[0]!);", "+      want(1, 3);\n+      const c = Math.cos((a[0]! * Math.PI) / 180), s = Math.sin((a[0]! * Math.PI) / 180);"]],
    test: ["tests/svg-import.test.ts", "a quarter turn is exact"],
  },
  {
    name: "meet and slice swapped",
    file: P53,
    edits: [['+      const s = m[4] === "slice" ? Math.max(width / vw, height / vh) : Math.min(width / vw, height / vh);', '+      const s = m[4] === "slice" ? Math.min(width / vw, height / vh) : Math.max(width / vw, height / vh);']],
    test: ["tests/svg-import.test.ts", "preserveAspectRatio"],
  },
  {
    name: "a stroke under a non-uniform map accepted",
    file: P53,
    edits: [["+      if (Math.abs(sx2 - sy2) > tol || Math.abs(dot) > tol) {", "+      if (false) {"]],
    test: ["tests/svg-import.test.ts", "non-uniform map is refused"],
  },
  {
    name: "a gradient not refused by name",
    file: P53,
    edits: [['+  lineargradient: "gradients are not imported', '+  linearGradientX: "gradients are not imported']],
    test: ["tests/svg-import.test.ts", "refused: <defs><linearGradient"],
  },
  {
    name: "ids listed in the order the walk finished them",
    file: P53,
    edits: [["+  return { width, height, clip: overflow !== \"visible\", parts, ids: [...seenIds.keys()].filter((id) => emitted.has(id)), skipped };", "+  return { width, height, clip: overflow !== \"visible\", parts, ids, skipped };"]],
    test: ["tests/svg-import.test.ts", "an unnamed group is folded"],
  },
  // ---- 0053: the expansion ----
  {
    name: "an editor's unit on the root's size refused without saying what to give",
    file: P53,
    edits: [["+      throw new SvgImportError(`${(e as Error).message} - give the <Svg> width and height in px`);", "+      throw e;"]],
    test: ["tests/svg-import.test.ts", "an editor's unit on the root's size"],
  },
  {
    name: "an id inside <defs> not recorded",
    file: P53,
    edits: [["+      if (c.attrs.id !== undefined && !skipped.has(c.attrs.id)) skipped.set(c.attrs.id, \"it is inside <defs>, which is not drawn\");", "+      void 0;"]],
    test: ["tests/svg-import.test.ts", "an id inside <defs> is known"],
  },
  {
    name: "the added import names forgotten between elements",
    file: P53,
    edits: [["+  let locals = added.get(decl);", "+  let locals = (added.clear(), added.get(decl));"]],
    test: ["tests/svg-import.test.ts", "two <Svg> elements in one module"],
  },
  {
    name: "the expander not among transformFile's plugins",
    file: P53,
    edits: [['+    ...(framework === "solid" ? [makeSvgExpander(path, svgDeps)] : []),', "+    ...([] as PluginObj[]),"]],
    test: ["tests/svg-import.test.ts", "every shape is an outline the collector bakes"],
  },
  {
    name: "a parts key naming no id accepted",
    file: P53,
    edits: [["+    if (!tree.ids.includes(id)) {", "+    if (false) {"]],
    test: ["tests/svg-import.test.ts", "a parts key naming no id"],
  },
  {
    name: "a parts entry joined as a `+` expression, not a literal",
    file: P53,
    edits: [["+        const out = t.stringLiteral(`${base} ${textOf(lit)}`.trim());\n+        out.loc = v.loc;\n+        return out;", "+        const out = t.binaryExpression(\"+\", t.stringLiteral(`${base} `), t.stringLiteral(textOf(lit)));\n+        out.loc = v.loc;\n+        return out;"]],
    test: ["tests/svg-import.test.ts", "a token in a parts value that does not parse"],
  },
  {
    name: "a parts entry dropped from the join",
    file: P53,
    edits: [['+    attrs.push(attr("class", extra ? combine(part.cls, extra, part.id!) : literal(part.cls)));', '+    attrs.push(attr("class", literal(part.cls)));']],
    test: ["tests/svg-import.test.ts", "sidecar's assertions hold"],
  },
  {
    name: "a cached transform kept when its file changed",
    file: P53,
    edits: [["+    if (!existsSync(dep.path) || sha256Of(readFileSync(dep.path)) !== dep.sha256) return false;", "+    if (dep === null) return false;"]],
    test: ["tests/svg-import.test.ts", "a cached transform is dropped"],
  },
  {
    name: "the canvas not named svg:<src>",
    file: P53,
    edits: [["+      attr(\"debugName\", t.stringLiteral(`svg:${s.text}`)),", "+      attr(\"debugName\", t.stringLiteral(\"canvas\")),"]],
    test: ["tests/svg-import.test.ts", "every shape is an outline the collector bakes"],
  },
  {
    name: "the catalogue's svg probe expecting the wrong refusal",
    file: "src/catalog/surface.ts",
    edits: [["'<filter id=\"f\"> (line 1): filters are not imported'", "'<filter id=\"f\"> (line 1): filters are imported'"]],
    test: ["tests/catalog.test.ts", "G10"],
  },
  // ---- 0053: this repository ----
  {
    name: "lint does not check the file exists",
    file: "src/lint/svg-trees.ts",
    edits: [["      if (!existsSync(path)) {", "      if (false) {"]],
    test: ["tests/svg-import.test.ts", "a missing file is svg.missingFile"],
  },
  {
    name: "the image lint reads an <Svg>'s src as a picture name",
    file: "src/lint/images.ts",
    edits: [["      if (svgSrc.has(`${literal.line}:${literal.column}`)) continue;\n", ""]],
    test: ["tests/svg-import.test.ts", "a missing file is svg.missingFile"],
  },
  {
    name: "layout reads one picture's parts as collisions",
    file: "src/render/findings.ts",
    edits: [["      if (onePicture(a, b)) continue;\n", ""]],
    test: ["tests/svg-import.test.ts", "two parts in one svg"],
  },
  // ---- 0054 ----
  {
    name: "the collector does not report a d it cannot read",
    file: P54,
    edits: [["+                if (ds === null) {\n+                  out.unreadPaths.push(at);", "+                if (ds === null) {\n+                  void at;"]],
    test: ["tests/path-inventory.test.ts", "a computed d and a forwarded prop are unread"],
  },
  {
    name: "the build ignores --path-inventory",
    file: P54,
    edits: [['+  else if (a.startsWith("--path-inventory=")) pathInventory = resolvePath(a.slice("--path-inventory=".length));', '+  else if (a.startsWith("--path-inventory=")) void 0;']],
    test: ["tests/path-inventory.test.ts", "a d computed at mount is baked from an inventory and draws"],
  },
  {
    name: "an inventory outline that does not parse is not located",
    file: P54,
    edits: [["+        errors.push(`${shown}: outline ${i}, computed at mount: <Path> d does not bake: ${e.message}`);", "+        errors.push(`<Path> d does not bake: ${e.message}`);"]],
    test: ["tests/path-inventory.test.ts", "does not parse is refused naming the inventory"],
  },
  {
    name: "mount refuses an unbaked outline even with an inventory host",
    file: P54,
    edits: [['+    if (typeof inventory === "function") {', "+    if (false) {"]],
    test: ["tests/path-inventory.test.ts", "a d computed at mount is baked from an inventory and draws"],
  },
  {
    name: "runBuild never reads the paths-at-mount line",
    file: "src/cli/build.ts",
    edits: [["  const unread = PATHS_AT_MOUNT.exec(stdout);", "  const unread = PATHS_AT_MOUNT.exec(\"\");"]],
    test: ["tests/path-inventory.test.ts", "a d computed at mount is baked from an inventory and draws"],
  },
  {
    name: "runBuild does not mount the rebuilt bundle",
    file: "src/cli/build.ts",
    edits: [["      const again = await read();", "      const again: unknown[] = [];"]],
    test: ["tests/path-inventory.test.ts", "a mount that computes different outlines"],
  },
  {
    name: "runBuild mounts and writes an inventory for every build",
    file: "src/cli/build.ts",
    edits: [
      ["  if (unread) {", "  if (unread || true) {"],
      ["    if (outlines.length > 0) {", "    if (outlines.length >= 0) {"],
      ["`${unread[1]} <Path>", "`${unread?.[1]} <Path>"],
    ],
    test: ["tests/path-inventory.test.ts", "every d is a literal is built once"],
  },
];

function sh(cmd: string[]): { code: number; out: string } {
  // POCKETJS_ROOT is vendor.ts's clone source and boot's core: a test must
  // boot THIS tree's core, so it reaches only the vendoring.
  const env = { ...Bun.env };
  if (cmd[1] !== "scripts/vendor.ts") delete env.POCKETJS_ROOT;
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

function vendor(): void {
  const r = sh(["bun", "scripts/vendor.ts", "--no-wasm"]);
  if (r.code !== 0) throw new Error(`vendor failed:\n${r.out}`);
}

const only = new Set(process.argv.slice(2));
const chosen = MUTATIONS.filter((m) => only.size === 0 || only.has(m.name));
const originals = new Map<string, string>();
// Each test once on the tree as it is: a RED below only means something if
// its test is green without the defect.
vendor();
for (const t of new Set(chosen.map((m) => m.test.join("\0")))) {
  const [file, filter] = t.split("\0") as [string, string];
  const r = sh(["bun", "test", file, "-t", filter]);
  console.log(`${r.code === 0 ? "base GREEN" : "base RED  "} [${file} -t ${filter}]`);
  if (r.code !== 0) throw new Error(`baseline red: ${file} -t ${filter}\n${r.out.slice(-2000)}`);
}
try {
  for (const m of chosen) {
    const path = join(ROOT, m.file);
    const src = originals.get(path) ?? readFileSync(path, "utf8");
    originals.set(path, src);
    let edited = src;
    const missing = m.edits.find(([old]) => edited.split(old).length - 1 !== 1);
    if (missing) {
      console.log(`SKIP  ${m.name}: anchor found ${edited.split(missing[0]).length - 1} times`);
      continue;
    }
    for (const [old, now] of m.edits) edited = edited.replace(old, now);
    writeFileSync(path, edited);
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
