/**
 * Fit, wrap and clamp in layout (patches/0059) where the core's own tests
 * cannot reach, and the glyph pre-check for jobs.
 *
 * The core holds the fit itself: which rung holds, where a line breaks, what
 * a clamp keeps and counts, that a fitted block measures as its laid-out
 * text, and that paint draws the rung layout chose
 * (`engine/core/src/text_fit_tests.rs`, each red under the edit
 * `baselines/text-fit/redcheck.py` makes). The compiler's tokens are the
 * catalogue's (G6) and the finding code's predicate is G8. What is left is
 * the host side: `layout` reading the core's record against a built
 * fixture, `assert`'s `untruncated` against the same sweep, and the
 * characters a job's faces cannot draw found before anything is staged.
 *
 * Each test names the edit that turns it red.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { assertComposition, sweepNamedNodes } from "../src/cli/commands/assert.ts";
import { run as runLayout, type LayoutNode } from "../src/cli/commands/layout.ts";
import { runFromArgv as renderFromArgv } from "../src/cli/commands/render.ts";
import { sampleFrames } from "../src/cli/commands/visibility.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { EXIT_FAIL } from "../src/cli/types.ts";
import { evaluateAssertions } from "../src/render/assertions.ts";
import { parseSpec, type JobSpec } from "../src/manifest/spec.ts";
import { checkCoverage, jobCoverage, readCmap } from "../src/text/coverage.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const FIXTURE = join(ROOT, "compositions", "text-fit");

let fixture: ResolvedComposition;
let nodes: Map<string, LayoutNode>;

beforeAll(async () => {
  const resolved = await resolveComposition({ dir: FIXTURE, flags: { json: true }, requireBundle: false });
  if (!resolved.ok) throw new Error(`text-fit did not resolve: ${resolved.message}`);
  fixture = resolved.value;
  await runBuild(fixture);
  const result = await runLayout({ dir: FIXTURE, at: 0, all: false, flags: { json: true } });
  const json = result.json as { nodes: LayoutNode[] };
  nodes = new Map(json.nodes.filter((n) => n.name).map((n) => [n.name!, n]));
}, 300_000);

const node = (name: string): LayoutNode => {
  const n = nodes.get(name);
  if (n === undefined) throw new Error(`layout reported no node ${name}`);
  return n;
};
const codes = (name: string): string[] => (node(name).findings ?? []).map((f) => f.code);

describe("compositions/text-fit, read back by layout", () => {
  // Red with `readTextFit` left out of `inspectLayout`: no node carries `fit`.
  test("a run that holds its box takes the largest rung", () => {
    expect(node("short").fit).toMatchObject({ px: 88, rung: 0, rungs: 8, fitted: true, linesTotal: 1 });
    expect(node("short").fit!.ladder).toEqual([88, 80, 72, 65, 59, 54, 49, 48]);
    expect(node("price-short").fit).toMatchObject({ px: 96, rung: 0, wraps: false });
    expect(codes("short")).toEqual([]);
  });

  test("a longer run takes a smaller rung, and that is not a finding", () => {
    const long = node("long").fit!;
    expect(long.fitted).toBe(true);
    expect(long.rung).toBeGreaterThan(0);
    expect(long.px).toBeLessThan(88);
    expect(long.linesTotal).toBe(2);
    expect(codes("long")).toEqual([]);
    expect(node("price").fit).toMatchObject({ px: 56, rung: 2, rungs: 3, fitted: true, linesTotal: 1 });
  });

  test("a box flex sizes is the box the run is fitted to", () => {
    expect(node("flex-short").w).toBe(400);
    expect(node("flex-long").w).toBe(400);
    expect(node("flex-short").fit).toMatchObject({ px: 72, fitted: true });
    expect(node("flex-long").fit!.px).toBeLessThan(72);
    expect(node("flex-long").fit!.fitted).toBe(true);
  });

  test("U+200B breaks a CJK run and cuts nothing", () => {
    expect(node("cjk").fit).toMatchObject({ fitted: true, wraps: true, split: 0, dropped: 0 });
    expect(node("cjk").fit!.linesTotal).toBeGreaterThan(1);
  });

  // Red with the `text_truncated` branch removed from `findingsFor`: the
  // records still say what was dropped and no code carries it.
  test("a ladder that bottoms out and a clamp that drops are text_truncated", () => {
    const over = node("overlong").fit!;
    expect(over).toMatchObject({ px: 48, rung: 7, fitted: false, clamp: 2, linesKept: 2 });
    expect(over.linesTotal).toBeGreaterThan(2);
    expect(over.dropped).toBeGreaterThan(0);
    expect(codes("overlong")).toEqual(["text_truncated"]);
    const legal = node("legal").fit!;
    expect(legal).toMatchObject({ px: 24, declaredLadder: false, clamp: 3, linesKept: 3 });
    expect(legal.dropped).toBeGreaterThan(0);
    expect(codes("legal")).toEqual(["text_truncated"]);
    // Three lines' worth fits, so nothing is left out.
    expect(node("legal-short").fit).toMatchObject({ clamp: 3, linesKept: 1, dropped: 0 });
    expect(codes("legal-short")).toEqual([]);
  });

  test("an empty run takes no box and holds no record, whatever it declares", () => {
    expect(node("empty")).toMatchObject({ w: 0, h: 0, inPicture: false });
    expect(node("empty").fit).toBeUndefined();
  });

  // Red with emit_text drawing the style's slot rather than the record's:
  // the fitted twin draws at 88 px and its ink is not the fixed twin's.
  test("a fitted run draws the pixels a run declared at its rung draws", async () => {
    const fit = node("twin-fit");
    const fixed = node("twin-fixed");
    expect(fit.fit!.px).toBe(Number(/text-\[(\d+)px\]/.exec(fixed.class ?? "")![1]));
    const png = join(scratchDir("text-fit-twins"), "frame.png");
    const { run: frame } = await import("../src/cli/commands/frame.ts");
    await frame({ dir: FIXTURE, at: 0, out: png, flags: { json: true } });
    const gray = await grayOf(png);
    const crop = (x: number, y: number, w: number, h: number): number[] => {
      const out: number[] = [];
      for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) out.push(gray[r * 1920 + c]!);
      return out;
    };
    const a = crop(fit.x, fit.y, 500, 80);
    const b = crop(fixed.x, fixed.y, 500, 80);
    expect(a.some((v) => v > 0)).toBe(true);
    expect(a).toEqual(b);
  });
});

async function grayOf(png: string): Promise<Uint8Array> {
  const p = Bun.spawn(["ffmpeg", "-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { stdout: "pipe" });
  const bytes = new Uint8Array(await new Response(p.stdout).arrayBuffer());
  await p.exited;
  return bytes;
}

describe("assert: untruncated", () => {
  test("the fixture's own assertions hold", async () => {
    const verdict = await assertComposition(fixture);
    const failed = (verdict.json as { assertions: Array<{ ok: boolean; node: string; detail: string }> }).assertions.filter(
      (a) => !a.ok,
    );
    expect(failed).toEqual([]);
  }, 300_000);

  // Red with the sweep no longer recording `text_truncated` frames: every
  // `untruncated` holds, `overlong`'s included.
  test("untruncated FAILS on the run the clamp cut, at every sampled frame", async () => {
    const frames = sampleFrames(fixture.durationFrames, 6);
    const { nodes: swept } = await sweepNamedNodes(fixture, frames, { names: new Set(["overlong", "long"]) });
    const [over, long] = evaluateAssertions({
      assertions: [
        { node: "overlong", untruncated: true },
        { node: "long", untruncated: true },
      ],
      nodes: swept,
      frames,
    });
    expect(over!.ok).toBe(false);
    expect(over!.detail).toContain("text_truncated at");
    expect(long!.ok).toBe(true);
  }, 300_000);
});

describe("the glyph pre-check", () => {
  const faces = { regular: "assets/fonts/NotoSansSC-Regular.otf", bold: "assets/fonts/NotoSansSC-Bold.otf" };

  // Red with the format-12 branch removed from `readCmap`: the 445 code
  // points above U+FFFF that only format 12 maps go missing.
  test("readCmap reads what opentype.js reads, above the Basic Multilingual Plane too", async () => {
    const opentype = (await import(`${ROOT}/vendor/pocketjs/node_modules/opentype.js/dist/opentype.js`)) as {
      parse(buffer: ArrayBuffer): { tables: { cmap: { glyphIndexMap: Record<string, number> } } };
    };
    for (const file of [faces.bold, "assets/fonts/HarmonyOS_Sans_Regular.ttf"]) {
      const bytes = new Uint8Array(readFileSync(join(ROOT, file)));
      const mine = readCmap(bytes);
      const map = opentype.parse(bytes.slice().buffer).tables.cmap.glyphIndexMap;
      const theirs = Object.keys(map).map(Number).filter((c) => map[c] !== 0).sort((a, b) => a - b);
      expect([...mine].sort((a, b) => a - b)).toEqual(theirs);
    }
    expect([...readCmap(new Uint8Array(readFileSync(join(ROOT, faces.bold))))].some((c) => c > 0xffff)).toBe(true);
  });

  test("a missing character is named by field, character and weight", () => {
    const report = checkCoverage(
      [
        { field: "/copy/name", text: "Mumbai ₹ 1,299\n" },
        { field: "/copy/title", text: "🔥 new" },
      ],
      faces,
      ROOT,
    );
    expect(report.missing.map((m) => `${m.field} ${m.codePoint} ${m.face}`)).toEqual([
      "/copy/name U+20B9 regular",
      "/copy/name U+20B9 bold",
      "/copy/title U+1F525 regular",
      "/copy/title U+1F525 bold",
    ]);
  });

  // Red with `displayText` left out of `jobStrings`: "ÿ" is mapped and "Ÿ",
  // which the upper-case style draws, is not.
  test("captions are checked in the case the style draws", () => {
    const job = (casing: string): JobSpec => {
      const r = parseSpec(
        {
          spec: 1,
          template: "captions",
          viewport: [640, 360],
          fps: 30,
          fonts: faces,
          transcript: { language: "fr", words: [{ text: "ÿ", start: 0, end: 0.5 }] },
          style: { name: "highlight", case: casing },
        },
        { root: ROOT },
      );
      if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.path}: ${d.message}`).join("\n"));
      return r.value;
    };
    expect(jobCoverage(job("none"), ROOT).missing).toEqual([]);
    expect(jobCoverage(job("upper"), ROOT).missing.map((m) => m.codePoint)).toEqual(["U+0178", "U+0178"]);
  });

  // Red with the per-job coverage removed from the directory loop: the clean
  // job renders before the bad one is refused.
  test("a directory of jobs is refused before any renders, every job's characters named", async () => {
    const dir = scratchDir("text-fit-jobs");
    const base = JSON.parse(readFileSync(join(ROOT, "compositions/lower-third/spec.default.json"), "utf8")) as {
      copy: { name: string; title: string };
    };
    writeFileSync(join(dir, "a-clean.json"), JSON.stringify(base));
    writeFileSync(join(dir, "b-rupee.json"), JSON.stringify({ ...base, copy: { ...base.copy, title: "₹ 1,299" } }));
    const out = scratchDir("text-fit-out");
    const result = await renderFromArgv([join(ROOT, "compositions/lower-third"), "--spec", dir, "--out-dir", out, "--json"]);
    expect(result.exitCode).toBe(EXIT_FAIL);
    const json = result.json as { done: unknown[]; failed: Array<{ spec: string; missingGlyphs?: Array<{ char: string }> }> };
    expect(json.done).toEqual([]);
    expect(json.failed.map((f) => f.spec)).toEqual(["b-rupee.json"]);
    expect([...new Set(json.failed[0]!.missingGlyphs!.map((m) => m.char))]).toEqual(["₹"]);
  }, 120_000);
});
