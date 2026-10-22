/**
 * The `captions` job template: the spec, the generated composition, and the
 * one claim the product makes — every word is in the picture at every frame
 * of its window — checked against the picture for all five styles.
 *
 * Only two styles have a sample in the ledgers (`compositions/captions/alpha-en`
 * is `highlight`, `burn-zh` is `clip-wipe`), so the other three would
 * otherwise have the claim made about them and checked nowhere. The sweep
 * below builds each one over the same short transcript and evaluates the
 * sidecar's own `assertions[]` at EVERY frame, the exact case of `assert`,
 * at 30 fps and at 60, where frame 0 samples clock 0 and nothing can start
 * before it.
 *
 * The red case was run before this was trusted: with `gateInTick` returning
 * the word's own clock instead of the tick before it, all five styles fail
 * here at 30 fps, and `assert --samples 101` on `burn-zh` fails all 9 words,
 * each at exactly the first frame of its window.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sweepNamedNodes } from "../src/cli/commands/assert.ts";
import { runFromArgv as renderFromArgv } from "../src/cli/commands/render.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import { STYLE_NAMES, textLiteral, type StyleName } from "../src/captions/styles.ts";
import { generateCaptions } from "../src/captions/template.ts";
import { evaluateAssertions } from "../src/render/assertions.ts";
import { parseSidecar, type Diagnostic } from "../src/manifest/sidecar.ts";
import { SPEC_CAPTIONS_ROOT_KEYS, parseSpec, type CaptionsSpec } from "../src/manifest/spec.ts";

const ROOT = resolve(import.meta.dir, "..");
process.env.POCKETJS_ROOT = join(ROOT, "vendor", "pocketjs");

const FONTS = {
  regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
  bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
};

/** Seven words over two sentences, two seconds: short enough to sweep every frame. */
const WORDS = [
  { text: "Every", start: 0.0, end: 0.3 },
  { text: "frame", start: 0.3, end: 0.55 },
  { text: "is", start: 0.55, end: 0.7 },
  { text: "a", start: 0.7, end: 0.8 },
  { text: "hash.", start: 0.8, end: 1.15 },
  { text: "Nothing", start: 1.3, end: 1.6 },
  { text: "moves.", start: 1.6, end: 2.0 },
];

function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spec: 1,
    template: "captions",
    viewport: [640, 360],
    fps: 30,
    fonts: FONTS,
    transcript: { words: WORDS, language: "en" },
    style: { name: "highlight" },
    ...overrides,
  };
}

function parsed(input: unknown): CaptionsSpec {
  const r = parseSpec(input, { root: ROOT });
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.path}: ${d.code}: ${d.message}`).join("\n"));
  if (r.value.template !== "captions") throw new Error("not a captions spec");
  return r.value;
}

function refused(input: unknown): Diagnostic[] {
  const r = parseSpec(input, { root: ROOT });
  if (r.ok) throw new Error("accepted");
  return [...r.diagnostics];
}

async function withJobDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  // Two levels under the repository, where a staged job lives, so the
  // repository root and the dist directory derive the way they do for a job.
  await mkdir(join(ROOT, "dist"), { recursive: true });
  const dir = await mkdtemp(join(ROOT, "dist", "captions-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("parseSpec — template captions", () => {
  test("both samples parse, and what they leave out is materialised", async () => {
    const en = parsed(await Bun.file(join(ROOT, "compositions/captions/alpha-en/spec.default.json")).json());
    expect([en.durationFrames, en.style.size, en.style.minSize, en.layout.lineWidth, en.layout.margin]).toEqual([
      180, 80, 56, 1536, 108,
    ]);
    expect(en.style.colours).toEqual({ ink: "#ffffff", box: "#ff1745" });
    const zh = parsed(await Bun.file(join(ROOT, "compositions/captions/burn-zh/spec.default.json")).json());
    // 88 px at a 1080 short side is 59 at 720; 78% of 720 and 22% of 1280.
    expect([zh.durationFrames, zh.style.size, zh.layout.lineWidth, zh.layout.margin]).toEqual([101, 59, 562, 282]);
    expect(zh.footage).toEqual({ src: "assets/synthetic/bars-9x16-30fps.mp4" });
  });

  test("a declared durationFrames is kept, and one the transcript runs past is refused", () => {
    expect(parsed(spec({ durationFrames: 90 })).durationFrames).toBe(90);
    const d = refused(spec({ durationFrames: 30 }));
    expect(d.map((x) => x.code)).toEqual(["spec.transcript.pastEnd"]);
    expect(d[0]!.message).toContain('word 6 "moves." ends at frame 60');
  });

  test("three aspects at any even size with a sane short side; nothing else", () => {
    for (const v of [[1920, 1080], [1080, 1920], [1080, 1080], [1280, 720], [720, 1280], [360, 360]]) {
      expect(parsed(spec({ viewport: v })).viewport).toEqual(v as [number, number]);
    }
    for (const v of [[854, 480], [1001, 1001], [300, 300], [1000, 600]]) {
      expect(refused(spec({ viewport: v })).map((x) => x.code)).toEqual(["spec.viewport.aspect"]);
    }
  });

  test("an unknown root key lists the captions template's keys", () => {
    const d = refused(spec({ palette: {} }));
    expect(d[0]!.code).toBe("spec.unknownKey");
    expect(d[0]!.message).toContain(`allowed keys are ${[...SPEC_CAPTIONS_ROOT_KEYS].join(", ")}`);
  });

  test("a style's keys are its own: keywords on highlight is refused, on clip-wipe accepted", () => {
    const d = refused(spec({ style: { name: "highlight", keywords: ["hash"] } }));
    expect(d.map((x) => x.code)).toEqual(["spec.style.unknownKey"]);
    expect(d[0]!.message).toContain("allowed keys are name, size, minSize, case, ink, box");
    expect(parsed(spec({ style: { name: "clip-wipe", keywords: ["hash"] } })).style.keywords).toEqual(["hash"]);
  });

  test("a transcript names its words one way, and inline words take no other format", () => {
    expect(refused(spec({ transcript: { words: WORDS, src: "x.json", format: "words", language: "en" } })).map((x) => x.code)).toEqual([
      "spec.transcript.source",
    ]);
    expect(refused(spec({ transcript: { words: WORDS, format: "openai", language: "en" } })).map((x) => x.code)).toEqual([
      "spec.transcript.format",
    ]);
  });

  test("the alpha-en sample without untimed: attach is refused at its untimed numeral", async () => {
    const raw = (await Bun.file(join(ROOT, "compositions/captions/alpha-en/spec.default.json")).json()) as {
      transcript: Record<string, unknown>;
    };
    delete raw.transcript.untimed;
    const d = refused(raw);
    expect(d.map((x) => x.code)).toEqual(["spec.transcript.untimed"]);
    expect(d[0]!.message).toContain('"2026"');
  });

  test("an unknown template still names all three", () => {
    expect(refused({ ...spec(), template: "subtitles" }).find((x) => x.code === "spec.template.mismatch")!.message).toContain(
      '"captions"',
    );
  });
});

describe("the generated composition", () => {
  test("a word that looks like a picture name is written as two literals, so no build looks for the file", () => {
    expect(textLiteral("logo.png")).toBe('{"logo" + ".png"}');
    expect(textLiteral("LOGO.PNG")).toBe('{"LOGO.PNG"}');
    expect(textLiteral("hash.")).toBe('{"hash."}');
  });

  test("every word is a named node with one inPicture assertion, and the sidecar parses", async () => {
    await withJobDir(async (dir) => {
      for (const name of STYLE_NAMES) {
        const g = await generateCaptions(parsed(spec({ style: { name } })), join(dir, name), "test");
        const sidecar = parseSidecar(JSON.parse(readFileSync(join(dir, name, "pocket-motion.json"), "utf8")));
        if (!sidecar.ok) throw new Error(`${name}: ${JSON.stringify(sidecar.diagnostics)}`);
        expect(sidecar.value.assertions.map((a) => a.node)).toEqual(WORDS.map((_, i) => `w${i}`));
        expect(g.rendered.named.map((n) => n.node)).toEqual(WORDS.map((_, i) => `w${i}`));
        const app = readFileSync(join(dir, name, "app.tsx"), "utf8");
        for (let i = 0; i < WORDS.length; i++) expect(app).toContain(`debugName="w${i}"`);
        // An alpha track declares no ground: no bg- on the root.
        expect(app).toContain('<View class="w-full h-full">');
      }
    });
  }, 60_000);
});

describe("every word in the picture at every frame of its window — all five styles", () => {
  async function sweep(name: StyleName, fps: number): Promise<{ failing: string[]; nodes: number }> {
    return withJobDir(async (dir) => {
      const s = parsed(spec({ style: { name }, fps }));
      await generateCaptions(s, dir, "test");
      const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
      if (!resolved.ok) throw new Error(resolved.message);
      await runBuild(resolved.value);
      const frames = Array.from({ length: s.durationFrames }, (_, f) => f);
      const nodes = await sweepNamedNodes(resolved.value, frames);
      const verdicts = evaluateAssertions({ assertions: resolved.value.sidecar.assertions, nodes, frames });
      return { failing: verdicts.filter((v) => !v.ok).map((v) => `${v.node}: ${v.detail}`), nodes: verdicts.length };
    });
  }

  // 60 fps is the case with no tick before frame 0: the first word's
  // entrance cannot start early, so every style draws it up from the start.
  for (const fps of [30, 60]) {
    for (const name of STYLE_NAMES) {
      test(`${name} at ${fps} fps`, async () => {
        const r = await sweep(name, fps);
        expect(r.nodes).toBe(WORDS.length);
        expect(r.failing).toEqual([]);
      }, 120_000);
    }
  }
});

describe("render --spec", () => {
  test("a job renders an alpha track whose floor is 0 and leaves the sample alone", async () => {
    const sample = join(ROOT, "compositions/captions/alpha-en");
    const before = readFileSync(join(sample, "app.tsx"), "utf8");
    await withJobDir(async (dir) => {
      const job = join(dir, "job.json");
      await Bun.write(job, JSON.stringify(spec({ style: { name: "pill-karaoke" } })));
      const out = join(dir, "out.mov");
      const r = await renderFromArgv([sample, "--spec", job, "--out", out, "--format", "mov", "--alpha", "--json"]);
      expect(r.exitCode).toBe(EXIT_OK);
      const json = r.json as { alphaFloor: number; frames: number; format: string };
      // 2.0 s is frame 60, and pill-karaoke holds its last page 300 ms.
      expect([json.alphaFloor, json.frames, json.format]).toEqual([0, 69, "mov"]);
      expect(existsSync(out)).toBe(true);
    });
    expect(readFileSync(join(sample, "app.tsx"), "utf8")).toBe(before);
  }, 120_000);

  test("a job the layout refuses fails the render with the layout's sentence", async () => {
    await withJobDir(async (dir) => {
      const job = join(dir, "job.json");
      const long = [{ text: "Pneumonoultramicroscopicsilicovolcanoconiosis", start: 0, end: 1 }];
      await Bun.write(job, JSON.stringify(spec({ transcript: { words: long, language: "en" }, style: { name: "highlight", minSize: 27 } })));
      const r = await renderFromArgv([join(ROOT, "compositions/captions/alpha-en"), "--spec", job, "--out", join(dir, "x.mov"), "--json"]);
      expect(r.exitCode).toBe(EXIT_FAIL);
      expect((r.json as { error: string }).error).toContain("is never broken");
    });
  }, 60_000);
});
