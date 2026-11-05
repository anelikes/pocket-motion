#!/usr/bin/env bun
/**
 * The guards of patches/0063 (vector glyphs, colour glyphs, tofu reported),
 * each watched red: introduce the defect, run the test that names it, restore.
 *
 *   bun baselines/vector-glyphs/redcheck.ts [mutation name ...]
 *
 * The harness `baselines/svg-import/redcheck.ts` uses. A defect in the
 * vendored tree is written into the PATCH file — one `+` line replaced by
 * another, so every hunk keeps its line counts and still applies — and
 * `bun scripts/vendor.ts` rebuilds the tree from it (`--no-wasm` unless the
 * defect is in what the wasm runs); `vendor/` is never edited by hand. A
 * defect in this repository's own sources is written into the file and
 * restored. A core defect is tested by the core's own suite (`cargo test` in
 * `vendor/pocketjs/engine/core`, which needs no wasm). Every file is restored
 * and the tree re-vendored with the wasm at the end, whatever happened.
 *
 * Prints one line per defect: RED (its test failed), GREEN (it did not), or
 * SKIP (an anchor is not found exactly once, so it did not run).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const CORE = join(ROOT, "vendor/pocketjs/engine/core");
const P = "patches/0063-vector-and-colour-glyphs.patch";

interface Mutation {
  name: string;
  /** A patch under patches/ (its `+` lines are searched), or a repo file. */
  file: string;
  edits: Array<[string, string]>;
  /** `bun test` file and -t filter, or `cargo` and a test-name filter. */
  test: ["cargo", string] | [string, string];
  /** The defect is in what the wasm runs: re-vendor with it. */
  wasm?: boolean;
}

const MUTATIONS: Mutation[] = [
  // ---- the core (cargo) ----
  {
    name: "measurement reads only atlases",
    file: P,
    edits: [["+        let Some(face) = self.metrics(slot) else {\n             return (0.0, 0.0);", "+        let Some(face) = self.atlas(slot).map(Metrics::Atlas) else {\n             return (0.0, 0.0);"]],
    test: ["cargo", "a_vector_slot_measures_with_wide_advances_and_kerning"],
  },
  {
    name: "a vector face's kern pairs not applied",
    file: P,
    edits: [["+            Metrics::Vector(v) => v.kern(left, right),", "+            Metrics::Vector(_v) => 0,"]],
    test: ["cargo", "a_vector_slot_measures_with_wide_advances_and_kerning"],
  },
  {
    name: "a miss's codepoint not kept",
    file: P,
    edits: [["+            if missed.len() < MISSED_MAX {", "+            if missed.len() < 0 {"]],
    test: ["cargo", "a_vector_slot_measures_with_wide_advances_and_kerning"],
  },
  {
    name: "a vector slot taken down the atlas branch",
    file: P,
    edits: [["+        if self.fonts.is_vector_slot(slot) {", "+        if false {"]],
    test: ["cargo", "a_vector_slot_draws_paths_and_no_cells"],
  },
  {
    name: "a glyph's origin without its baseline",
    file: P,
    edits: [["+                Affine::translate(roundf(sx) + xoff, roundf(sy) + baseline)", "+                Affine::translate(roundf(sx) + xoff, roundf(sy))"]],
    test: ["cargo", "a_vector_slot_draws_paths_and_no_cells"],
  },
  {
    name: "a glyph placed by its anchor alone, upright",
    file: P,
    edits: [["+                world.then(&Affine::translate(g.x + xoff, g.y + baseline))", "+                Affine::translate(world.apply(g.x, g.y).0 + xoff, world.apply(g.x, g.y).1 + baseline)"]],
    test: ["cargo", "a_vector_glyph_turns_with_its_node"],
  },
  {
    name: "an atlas slot's supplement ignored",
    file: P,
    edits: [["+        let colour = fonts.vector(slot).filter(|v| v.is_supplement());", "+        let colour: Option<&crate::text::VectorFace> = None;"]],
    test: ["cargo", "an_atlas_slot_draws_its_colour_glyphs_as_layers"],
  },
  {
    name: "a colour layer drawn without the subtree opacity",
    file: P,
    edits: [["+                            LayerPaint::Solid(colour) => (scale_alpha(colour, op), None),", "+                            LayerPaint::Solid(colour) => (colour, None),"]],
    test: ["cargo", "an_atlas_slot_draws_its_colour_glyphs_as_layers"],
  },
  {
    name: "a supplement evicting its slot's atlas",
    file: P,
    edits: [["+                    if !v.is_supplement() {\n+                        self.slots[slot] = None;", "+                    if true {\n+                        self.slots[slot] = None;"]],
    test: ["cargo", "loading_order_keeps_one_owner_of_a_slots_metrics"],
  },
  {
    name: "a gradient's coefficients not mapped to the screen",
    file: P,
    edits: [["+    let coef = [a[0], a[1], a[2], b[0], b[1], b[2]];", "+    let coef = g.coef;"]],
    test: ["cargo", "a_gradient_layer_is_a_paint_around_a_white_fill"],
  },
  {
    name: "trailing bytes after the outlines accepted",
    file: P,
    edits: [["+        if o != bytes.len() {", "+        if false {"]],
    test: ["cargo", "vector_face_parse_refuses_malformed_blobs"],
  },
  // ---- the compiler and the switch-over ----
  {
    name: "a vector advance rounded down",
    file: P,
    edits: [["+    const advance = Math.max(0, Math.min(0xffff, Math.round((glyph.advanceWidth ?? 0) * sourceScale)));", "+    const advance = Math.max(0, Math.min(0xffff, Math.floor((glyph.advanceWidth ?? 0) * sourceScale)));"]],
    test: ["tests/vector-glyphs.test.ts", "carries the atlas's metrics"],
  },
  {
    name: "a vector slot's kern pairs dropped",
    file: P,
    edits: [["+  const pairs = atlasKernPairs(font, glyphs, scale, 0x7fff);", "+  const pairs: { left: number; right: number; delta: number }[] = [];"]],
    test: ["tests/vector-glyphs.test.ts", "carries the atlas's metrics"],
  },
  {
    name: "a vector baseline rounded up",
    file: P,
    edits: [["+  const baseline = Math.round(ascent);\n+  const cellH = Math.max(1, baseline + Math.ceil(descent));", "+  const baseline = Math.ceil(ascent);\n+  const cellH = Math.max(1, baseline + Math.ceil(descent));"]],
    test: ["tests/vector-glyphs.test.ts", "carries the atlas's metrics"],
  },
  {
    name: "the ceiling no longer switches to a vector slot",
    file: P,
    edits: [["+    const ceiling = atlasCellHeight(font, px) > 255;", "+    const ceiling = false;"]],
    test: ["tests/vector-glyphs.test.ts", "past the ceiling"],
  },
  {
    name: "a vector glyph's anchor not rounded where GLYPH_RUN rounds",
    file: P,
    edits: [["+        let snap = world.is_axis_aligned() && world.a == 1.0 && world.d == 1.0;", "+        let snap = false;"]],
    test: ["tests/vector-glyphs.test.ts", "land where the atlas"],
    wasm: true,
  },
  // ---- colour glyphs ----
  {
    name: "a colour face's glyph baked into an atlas cell",
    file: P,
    edits: [["+    if (colourTables.has(source)) {\n+      const sequence = sequenceOnly(cp);", "+    if (false) {\n+      const sequence = sequenceOnly(cp);"]],
    test: ["tests/colour-glyphs.test.ts", "draws its colours"],
  },
  {
    name: "regional indicators drawn on their own",
    file: P,
    edits: [['+  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return "a regional indicator', '+  if (false) return "a regional indicator']],
    test: ["tests/colour-glyphs.test.ts", "left out by name"],
  },
  {
    name: "a composite drawn as its source alone",
    file: P,
    edits: [["+      case 32:\n+        throw new Refused(composite(u8(at + 4)));\n+      case 2:", "+      case 32:\n+        return walk(at + u24(at + 1), m, depth + 1, out);\n+      case 2:"]],
    test: ["tests/colour-glyphs.test.ts", "left out by name"],
  },
  {
    name: "the paint's stop bound back at six",
    file: P,
    edits: [["+export const PAINT_MAX_STOPS = 16;", "+export const PAINT_MAX_STOPS = 6;"]],
    test: ["tests/colour-glyphs.test.ts", "draws its colours"],
  },
  // ---- this repository ----
  {
    name: "the measurer reading atlases only",
    file: "src/text/atlas.ts",
    edits: [["    if (v.supplement) continue;\n    out.set(v.slot, {", "    continue;\n    out.set(v.slot, {"]],
    test: ["tests/vector-glyphs.test.ts", "measures a size past the ceiling"],
  },
  {
    name: "a job spec refusing fonts.fallback",
    file: "src/manifest/spec.ts",
    edits: [['export const SPEC_FONT_ALLOWED = new Set<string>([...FONT_WEIGHT_KEYS, "fallback"]);', "export const SPEC_FONT_ALLOWED = new Set<string>([...FONT_WEIGHT_KEYS]);"]],
    test: ["tests/colour-glyphs.test.ts", "renders through the fallback face the job declares"],
  },
  {
    name: "lower-third not writing the fallback into the staged sidecar",
    file: "compositions/lower-third/gen.ts",
    edits: [["          ...(spec.fonts.fallback !== undefined ? { fallback: spec.fonts.fallback } : {}),\n        },\n        ...(footage ? { footage } : {}),", "        },\n        ...(footage ? { footage } : {}),"]],
    test: ["tests/colour-glyphs.test.ts", "renders through the fallback face the job declares"],
  },
  {
    name: "check not reading the missed codepoints",
    file: "src/cli/commands/check.ts",
    edits: [["    const missing = world.missingGlyphs();", "    const missing: number[] = [];"]],
    test: ["tests/colour-glyphs.test.ts", "tofu fails check"],
  },
  {
    name: "a refusing render not checking its first frame",
    file: "src/render/render.ts",
    edits: [["      if (options.refuseMissingGlyphs && f === start) {", "      if (false) {"]],
    test: ["tests/colour-glyphs.test.ts", "refuses tofu"],
  },
  {
    name: "trace not saying so",
    file: "src/cli/commands/trace.ts",
    edits: [["      ...(result.missingGlyphs.length > 0 ? { missingGlyphs: result.missingGlyphs.map(codepointLabel) } : {}),", ""]],
    test: ["tests/colour-glyphs.test.ts", "trace and render say so"],
  },
];

function sh(cmd: string[], cwd = ROOT): { code: number; out: string } {
  // POCKETJS_ROOT is vendor.ts's clone source and boot's core: a test must
  // boot THIS tree's core, so it reaches only the vendoring.
  const env = { ...Bun.env };
  if (cmd[1] !== "scripts/vendor.ts") delete env.POCKETJS_ROOT;
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

function vendor(wasm: boolean): void {
  const r = sh(["bun", "scripts/vendor.ts", ...(wasm ? [] : ["--no-wasm"])]);
  if (r.code !== 0) throw new Error(`vendor failed:\n${r.out}`);
}

function runTest(test: Mutation["test"]): { code: number; out: string } {
  if (test[0] === "cargo") {
    const cargo = sh(["rustup", "which", "cargo"]).out.trim();
    return sh([cargo, "test", "--release", "--lib", test[1]], CORE);
  }
  return sh(["bun", "test", test[0], "-t", test[1]]);
}

const only = new Set(process.argv.slice(2));
const chosen = MUTATIONS.filter((m) => only.size === 0 || only.has(m.name));
const originals = new Map<string, string>();
// Each test once on the tree as it is: a RED below only means something if
// its test is green without the defect.
vendor(true);
for (const t of new Set(chosen.map((m) => m.test.join("\0")))) {
  const test = t.split("\0") as Mutation["test"];
  const r = runTest(test);
  console.log(`${r.code === 0 ? "base GREEN" : "base RED  "} [${test.join(" ")}]`);
  if (r.code !== 0) throw new Error(`baseline red: ${test.join(" ")}\n${r.out.slice(-2000)}`);
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
      if (m.file.startsWith("patches/")) {
        vendor(m.wasm === true);
      }
      const r = runTest(m.test);
      verdict = /\b0 pass\b/.test(r.out) && !/\bfail\b/.test(r.out) ? "NO-TEST" : /running 0 tests/.test(r.out) ? "NO-TEST" : r.code === 0 ? "GREEN" : "RED";
    } catch (e) {
      verdict = `ERROR ${(e as Error).message.split("\n")[0]}`;
    } finally {
      writeFileSync(path, src);
    }
    console.log(`${verdict.padEnd(5)} ${m.name}  [${m.test.join(" ")}]`);
  }
} finally {
  for (const [path, src] of originals) writeFileSync(path, src);
  vendor(true);
}
