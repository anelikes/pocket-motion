/**
 * Colour glyphs and the fallback chain (`patches/0063`, `fonts.fallback`), and
 * text drawn as tofu, refused or reported rather than shipped.
 *
 * The colour face is the one the repository pins, Noto Color Emoji (COLRv1,
 * `assets/fonts/Noto-COLRv1.ttf`). Three compositions are staged in one tree:
 *
 *   clean       a 64 px title with a trophy (solid layers) and a flame (radial
 *               gradients of 9 stops), the fallback declared: every glyph
 *               found, the colours drawn
 *   refused     the same title with a laptop (a src-in composite) and a
 *               flag (two regional indicators): the build leaves all three out
 *               and says why, and `check` names each and the node
 *   no-fallback the flame with no fallback declared: the face has no emoji, so
 *               it is tofu — `check` fails, `trace` says so, and a render that
 *               refuses tofu writes nothing
 *
 * Red, each watched (`baselines/vector-glyphs/redcheck.ts`):
 *   - `bakeSlot` not routing a colour face's glyph to the supplement (its
 *     base outline baked into the cell): "draws its colours" fails;
 *   - `sequenceOnly` returning null: "left out by name" fails on U+1F1E8;
 *   - colr.ts reading a composite (format 32) as a transform: "left out by
 *     name" fails on U+1F4BB;
 *   - PAINT_MAX_STOPS back at 6: the flame is refused and "draws its colours"
 *     fails at `check`;
 *   - `check` not reading `missingGlyphs`: "tofu fails check" fails;
 *   - `render` not checking on its first frame: "a render that refuses tofu"
 *     fails on the file it wrote.
 *   - `trace` leaving `missingGlyphs` out of its JSON: "trace and render say
 *     so" fails.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { runFromArgv as renderFromArgv } from "../src/cli/commands/render.ts";
import { dispatch } from "../src/cli/main.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { MissingGlyphError, render } from "../src/render/render.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";
import { parseVectorFaces } from "../src/text/atlas.ts";
import { mountedMissingGlyphs } from "../src/text/missing.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const TMP = scratchDir("colour-glyphs");
const TREE = join(TMP, "tree");

const TROPHY = "\u{1F3C6}";
const FLAME = "\u{1F525}";
// A laptop: Noto Color Emoji draws it with a src-in composite. (A warning
// sign is drawn that way too, but Noto Sans SC maps U+26A0 itself, and the
// slot's own face wins over its fallback, as in CSS.)
const LAPTOP = "\u{1F4BB}";
const FLAG_CN = "\u{1F1E8}\u{1F1F3}";

async function stage(name: string, text: string, fallback: boolean): Promise<{ c: ResolvedComposition; notes: string[] }> {
  const dir = join(TREE, "compositions", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "main.tsx"),
    [
      'import { mount } from "@pocketjs/framework";',
      'import { Text, View } from "@pocketjs/framework/components";',
      "",
      "mount(() => (",
      '  <View class="w-full h-full bg-black">',
      `    <Text debugName="title" class="absolute left-[20px] top-[20px] text-[64px] font-bold text-white">{${JSON.stringify(text)}}</Text>`,
      "  </View>",
      "));",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pocket-motion.json"),
    JSON.stringify({
      motion: 1,
      durationFrames: 2,
      fps: 30,
      supersample: 1,
      fonts: {
        regular: "assets/fonts/NotoSansSC-Regular.otf",
        bold: "assets/fonts/NotoSansSC-Bold.otf",
        ...(fallback ? { fallback: ["assets/fonts/Noto-COLRv1.ttf"] } : {}),
      },
    }),
  );
  writeFileSync(
    join(dir, "pocket.json"),
    JSON.stringify({
      pocket: 2,
      id: `dev.pocket-stack.motion-${name}`,
      name: `pocketjs-motion-${name}`,
      title: name,
      version: "0.0.0",
      engine: { capabilities: { requires: [] } },
      app: {
        entry: `compositions/${name}/main.tsx`,
        output: "main",
        framework: "solid",
        viewport: { fixed: { logical: [960, 120], presentation: "native" } },
      },
    }),
  );
  const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error(`${name}: ${resolved.message}`);
  const notes: string[] = [];
  await runBuild(resolved.value, { fontNotes: notes });
  return { c: resolved.value, notes };
}

async function cli(...argv: string[]): Promise<{ code: number; json: Record<string, unknown>; out: string }> {
  const r = await dispatch([...argv, "--json"]);
  if (r === "help") throw new Error(`${argv.join(" ")}: printed help`);
  return { code: r.exitCode, json: (r.json ?? {}) as Record<string, unknown>, out: (r.stdoutLines ?? []).join("\n") };
}

let clean: { c: ResolvedComposition; notes: string[] };
let refused: { c: ResolvedComposition; notes: string[] };
let bare: { c: ResolvedComposition; notes: string[] };

beforeAll(async () => {
  mkdirSync(join(TREE, "dist"), { recursive: true });
  for (const entry of readdirSync(ROOT)) {
    if (entry === "dist" || entry === ".git" || entry === "compositions") continue;
    symlinkSync(join(ROOT, entry), join(TREE, entry));
  }
  clean = await stage("clean", `${TROPHY} 进击 ${FLAME}`, true);
  refused = await stage("refused", `${TROPHY} 进击 ${FLAME}${LAPTOP}${FLAG_CN}`, true);
  bare = await stage("no-fallback", `进击 ${FLAME}`, false);
}, 180_000);

describe("colour glyphs from a declared fallback", () => {
  test("an atlas slot carries the colour glyphs as a supplement of layers", () => {
    const faces = parseVectorFaces(new Uint8Array(readFileSync(clean.c.pakPath)));
    const supplement = faces.find((f) => f.supplement && f.codepoints.has(0x1f525));
    expect(supplement).toBeDefined();
    // The trophy is 13 solid layers, the flame two gradient ones.
    expect(supplement!.layers.get(0x1f3c6)).toBe(13);
    expect(supplement!.layers.get(0x1f525)).toBe(2);
    expect(clean.notes.some((n) => /carries 2 colour glyph\(s\)/.test(n))).toBe(true);
  });

  test("it draws its colours: every glyph found, the flame's gradient orange", async () => {
    const check = await cli("check", clean.c.dir);
    expect(check.code).toBe(0);
    expect(check.json.missingGlyphs).toEqual([]);
    const source = await WasmFrameSource.create({
      compositionId: clean.c.compositionId,
      bundlePath: clean.c.bundlePath,
      pakPath: clean.c.pakPath,
      width: clean.c.width,
      height: clean.c.height,
      hz: clean.c.fps,
      durationFrames: 1,
      renderScale: 1,
      shutter: null,
    });
    await source.seekFrame(0);
    const rgba = source.read().slice();
    await source.dispose();
    // The run is white text: a saturated warm pixel is a colour layer's, and
    // a saturated yellow-orange in the flame's half is its gradient's.
    let warm = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
      if (r > 200 && g > 60 && g < 200 && b < 90) warm++;
    }
    expect(warm).toBeGreaterThan(200);
  }, 60_000);

  test("what the core cannot draw is left out by name, and check names it", async () => {
    const left = refused.notes.filter((n) => n.includes("left out"));
    expect(left.some((n) => n.includes("composite") && n.includes("U+1F4BB"))).toBe(true);
    expect(left.some((n) => n.includes("regional indicator") && n.includes("U+1F1E8") && n.includes("U+1F1F3"))).toBe(true);
    const check = await cli("check", refused.c.dir);
    expect(check.code).toBe(1);
    expect(check.json.missingGlyphs).toEqual(["U+1F1E8", "U+1F1F3", "U+1F4BB"]);
    const nodes = check.json.missingGlyphNodes as { name: string | null; text: string; codepoints: string[] }[];
    expect(nodes).toEqual([{ name: "title", text: `${TROPHY} 进击 ${FLAME}${LAPTOP}${FLAG_CN}`, codepoints: ["U+1F1E8", "U+1F1F3", "U+1F4BB"] }]);
  }, 60_000);
});

describe("tofu is refused or reported, never shipped quietly", () => {
  test("tofu fails check, naming the codepoint and the node", async () => {
    const check = await cli("check", bare.c.dir);
    expect(check.code).toBe(1);
    expect(check.out).toContain('"title": "进击 🔥" (U+1F525)');
    expect(check.json.missingGlyphs).toEqual(["U+1F525"]);
  }, 60_000);

  test("trace and render say so", async () => {
    const trace = await cli("trace", bare.c.dir);
    expect(trace.code).toBe(0);
    expect(trace.json.missingGlyphs).toEqual(["U+1F525"]);
    expect(trace.out).toContain("1 codepoint(s) drawn as the tofu box — U+1F525");
    const clean_ = await cli("trace", clean.c.dir);
    expect("missingGlyphs" in clean_.json).toBe(false);
  }, 60_000);

  test("a spec job's mounted text is read for tofu before anything renders", async () => {
    // What `render --spec` refuses a job on, in this process or `--workers`'.
    expect(await mountedMissingGlyphs(bare.c)).toEqual([0x1f525]);
    expect(await mountedMissingGlyphs(clean.c)).toEqual([]);
  }, 60_000);

  test("a render that refuses tofu throws before the first frame reaches the file", async () => {
    const out = join(TMP, "tofu.mp4");
    const c = bare.c;
    let thrown: unknown;
    try {
      await render({
        compositionId: c.compositionId,
        bundlePath: c.bundlePath,
        pakPath: c.pakPath,
        width: c.width,
        height: c.height,
        hz: c.fps,
        durationFrames: c.durationFrames,
        renderScale: 1,
        shutter: null,
        outputPath: out,
        format: "png-seq",
        encodePNG: () => new Uint8Array([1]),
        refuseMissingGlyphs: true,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MissingGlyphError);
    expect((thrown as MissingGlyphError).codepoints).toEqual([0x1f525]);
    expect(existsSync(join(out, "frame-00000.png")) || (existsSync(out) && readdirSync(out).length > 0)).toBe(false);
  }, 60_000);
});

/**
 * A `render --spec` job is where platform data arrives, so the fallback chain
 * has to reach it: `fonts.fallback` in the job spec, measured with by the
 * template's generator and written into the staged sidecar.
 *
 * Red, each watched (`baselines/vector-glyphs/redcheck.ts`):
 *   - `parseSpec` not accepting the key: the job with it is refused as an
 *     invalid spec;
 *   - lower-third's generator not writing it into the staged sidecar: the
 *     flame misses and the job is refused at mount;
 *   - the text-fit pre-check ignoring `fonts.fallback` (src/text/coverage.ts):
 *     the job with it is refused before staging;
 *   - the pre-check counting whatever a fallback maps, the build's left-out
 *     rule not asked: the flag job passes the pre-check and is refused only at
 *     mount, with no reason attached.
 */
describe("a spec job's emoji", () => {
  const DIR = join(ROOT, "compositions/lower-third");
  const sample = JSON.parse(readFileSync(join(DIR, "spec.default.json"), "utf8")) as Record<string, unknown> & {
    fonts: Record<string, unknown>;
  };
  const jobWith = (fallback: boolean) => ({
    ...sample,
    copy: { name: "林知远", title: `城南市图书馆 · 讲解员 ${FLAME}` },
    fonts: { ...sample.fonts, ...(fallback ? { fallback: ["assets/fonts/Noto-COLRv1.ttf"] } : {}) },
  });

  test("renders through the fallback face the job declares", async () => {
    const dir = scratchDir("spec-emoji");
    const path = join(dir, "job.json");
    writeFileSync(path, JSON.stringify(jobWith(true)));
    const out = join(dir, "job.mp4");
    const r = await renderFromArgv([DIR, "--spec", path, "--out", out, "--json"]);
    const json = r.json as { ok: boolean; missingGlyphs?: string[]; identity?: { components: Record<string, string> } };
    expect(r.exitCode, JSON.stringify(json).slice(0, 400)).toBe(0);
    expect(json.missingGlyphs).toBeUndefined();
    // The face that drew the flame is an input of this render, by name.
    expect(Object.keys(json.identity!.components)).toContain("font:fallback/0/Noto-COLRv1.ttf");
    expect(existsSync(out)).toBe(true);
  }, 240_000);

  test("without it, the job is refused before anything is staged, naming the field", async () => {
    // The text-fit pre-check (src/text/coverage.ts) reads the job's faces'
    // cmaps; the mount check behind it (`mountedMissingGlyphs`, above) is what
    // names a node for text no job field carries.
    const dir = scratchDir("spec-tofu");
    const path = join(dir, "job.json");
    writeFileSync(path, JSON.stringify(jobWith(false)));
    const out = join(dir, "job.mp4");
    const r = await renderFromArgv([DIR, "--spec", path, "--out", out, "--json"]);
    const json = r.json as { missingGlyphs?: { field: string; codePoint: string; face: string; leftOut?: unknown }[] };
    expect(r.exitCode).toBe(1);
    expect(json.missingGlyphs!.map((m) => [m.field, m.codePoint, m.face, m.leftOut])).toEqual([
      ["/copy/title", "U+1F525", "regular", undefined],
      ["/copy/title", "U+1F525", "bold", undefined],
    ]);
    expect(existsSync(out)).toBe(false);
  }, 240_000);

  test("a flag the fallback maps and the build leaves out is refused with the build's reason", async () => {
    const dir = scratchDir("spec-flag");
    const path = join(dir, "job.json");
    writeFileSync(path, JSON.stringify({ ...jobWith(true), copy: { name: "林知远", title: `城南市图书馆 ${FLAG_CN}` } }));
    const r = await renderFromArgv([DIR, "--spec", path, "--out", join(dir, "job.mp4"), "--json"]);
    const json = r.json as { missingGlyphs?: { codePoint: string; leftOut?: { file: string; reason: string } }[] };
    expect(r.exitCode).toBe(1);
    const flags = json.missingGlyphs!.filter((m) => m.codePoint === "U+1F1E8" || m.codePoint === "U+1F1F3");
    expect(flags).toHaveLength(4);
    for (const m of flags) {
      expect(m.leftOut?.file).toBe("assets/fonts/Noto-COLRv1.ttf");
      expect(m.leftOut?.reason).toContain("regional indicator");
    }
  }, 240_000);
});
