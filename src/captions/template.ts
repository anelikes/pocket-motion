/**
 * The `captions` template: a parsed job spec in, a composition out.
 *
 *   transcript ──ingest.ts──▶ timed words
 *              ──layout.ts──▶ pages, lines, sizes, every word at a measured x
 *              ──styles.ts──▶ nodes and baked timelines
 *              ──here──────▶ main.tsx, app.tsx, pocket.config.ts, pocket.json,
 *                            pocket-motion.json (with one `inPicture` per word)
 *
 * WHY THIS IS A `render --spec` TEMPLATE AND NOT A COMMAND OF ITS OWN. The job
 * path already stages a throwaway tree, generates into it, builds, encodes in
 * every delivery format, refuses `--frames` and the other patches on a job,
 * renders a directory of jobs after parsing all of them, and opens a job in
 * `preview`. A `captions` command would be a second front door to that one
 * pipeline with its own copy of `--format`, `--alpha` and `--out-dir` to keep
 * in agreement with `render`'s — the second implementation `verify`'s design
 * warns is the one nobody tests. And a spec is data: the programmatic API can
 * hand one over as it is, where a command's argv would have to be rebuilt.
 *
 * An alpha track and a burned-in one are the same spec with and without
 * `footage`: without it the tree declares no ground, so the frames are
 * transparent wherever no caption paints (`render --format mov --alpha`);
 * with it the clip is a full-viewport tile grid under the captions.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { footageTrack, tileNodes } from "../footage/declare.ts";
import { gridOf, tileDebugName } from "../footage/tiling.ts";
import { TEX_MAX_DIM } from "../manifest/sidecar.ts";
import { parseSpec, SPEC_TEMPLATE_CAPTIONS, type CaptionsSpec } from "../manifest/spec.ts";
import { openMeasurer } from "../text/measure.ts";
import { isSpaceless } from "./ingest.ts";
import { ladderOf, layoutTrack, type LayoutWord, type TrackLayout } from "./layout.ts";
import { STYLE_DEFAULTS, keywordKey, metricsOf, renderStyle, type Rendered } from "./styles.ts";

const ROOT = resolve(import.meta.dir, "../..");
export const FOOTAGE_PREFIX = "footage:plate";

export async function loadCaptionsSpec(specPath: string): Promise<CaptionsSpec> {
  let raw: unknown;
  try {
    raw = await Bun.file(specPath).json();
  } catch (e) {
    throw new Error(`captions: failed to read ${specPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = parseSpec(raw, { root: ROOT });
  if (!parsed.ok) {
    throw new Error(
      `captions: invalid spec ${specPath}\n` +
        parsed.diagnostics.map((d) => `  ${d.path || "/"}: ${d.code}: ${d.message}`).join("\n"),
    );
  }
  if (parsed.value.template !== SPEC_TEMPLATE_CAPTIONS) {
    throw new Error(
      `captions: this generator is ${JSON.stringify(SPEC_TEMPLATE_CAPTIONS)}; got ${JSON.stringify(parsed.value.template)}`,
    );
  }
  return parsed.value;
}

/** A word as the style shows it. The spec's language decides the case mapping. */
export function displayText(text: string, mode: CaptionsSpec["style"]["case"], language: string): string {
  if (mode === "upper") return text.toLocaleUpperCase(language);
  if (mode === "lower") return text.toLocaleLowerCase(language);
  return text;
}

/** The characters a matrix scramble draws from: a spaceless transcript's own. */
export function scramblePool(spec: CaptionsSpec): string {
  if (!isSpaceless(spec.transcript.language)) return "";
  const chars = new Set<string>();
  for (const w of spec.transcript.words) for (const ch of w.text) if (!/[\p{P}\s]/u.test(ch)) chars.add(ch);
  return [...chars].sort().join("");
}

export interface Measured {
  readonly words: readonly LayoutWord[];
  readonly ladder: readonly number[];
  readonly layout: TrackLayout;
}

/** Measure the transcript against the faces the build will bake, and lay it out. */
export async function layoutCaptions(spec: CaptionsSpec): Promise<Measured> {
  const { style, layout: l, transcript } = spec;
  const words: LayoutWord[] = transcript.words.map((w) => ({
    text: displayText(w.text, style.case, transcript.language),
    start: w.start,
    end: w.end,
    segmentEnd: w.segmentEnd,
  }));
  const ladder = ladderOf(style.size, style.minSize);
  const face = { regular: join(ROOT, spec.fonts.regular), bold: join(ROOT, spec.fonts.bold) };
  for (const path of [face.regular, face.bold]) {
    if (!existsSync(path)) {
      throw new Error(`captions: ${path} is absent. It is fetched, not checked in — run \`bun scripts/assets.ts\`.`);
    }
  }
  const m = await openMeasurer({
    face,
    sizes: ladder.map((px) => ({ px, bold: true })),
    texts: words.map((w) => w.text),
    density: spec.supersample,
  });
  try {
    const d = STYLE_DEFAULTS[style.name];
    const layout = layoutTrack(words, {
      fps: spec.fps,
      durationFrames: spec.durationFrames,
      width: spec.viewport[0],
      height: spec.viewport[1],
      lineWidth: l.lineWidth,
      margin: l.margin,
      position: l.position,
      ladder,
      fit: d.fit,
      maxLines: l.maxLines,
      maxWords: l.maxWords,
      pauseMs: l.pauseMs,
      holdMs: l.holdMs,
      spaceless: isSpaceless(transcript.language),
      locale: transcript.language,
      metrics: (s) => metricsOf(style.name, s),
      measure: (text, s) => m.measure(s, true)(text),
      lineHeight: (s) => m.lineHeight(s, true),
    });
    return { words, ladder, layout };
  } finally {
    await m.close();
  }
}

export interface Generated {
  readonly spec: CaptionsSpec;
  readonly measured: Measured;
  readonly rendered: Rendered;
}

/**
 * The first line of every generated file. It names the `gen.ts` beside the
 * output, because that is the relationship `lint`'s tile check reads
 * (`generatedBy`, `src/lint/tiles.ts`): a generated file whose generator sits
 * next to it and holds no tile name of its own is excused, and the tile names
 * here come from `tileNodes`. A staged job has no `gen.ts` beside it, is never
 * linted, and gets a header that does not carry its throwaway directory.
 */
function headerFor(outDir: string): string {
  const rel = relative(ROOT, outDir);
  return rel.startsWith("compositions/")
    ? `// GENERATED by ${rel}/gen.ts through src/captions/template.ts — do not edit by hand.`
    : "// GENERATED by src/captions/template.ts for a render --spec job — do not edit by hand.";
}

function appSource(spec: CaptionsSpec, rendered: Rendered, header: string): string {
  const [w, h] = spec.viewport;
  const tiles = spec.footage
    ? `    <View class="absolute left-0 top-0 w-[${w}px] h-[${h}px]">\n` +
      tileNodes({ nodePrefix: FOOTAGE_PREFIX, width: w, height: h, tile: TEX_MAX_DIM, indent: "      " }) +
      "\n    </View>\n"
    : "";
  const imports = spec.footage ? "Image, Text, View" : "Text, View";
  const body = rendered.body
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
  return `${header}
// Mount-only: every word's time is a delay on a baked timeline the core plays itself.

import { ${imports} } from "@pocketjs/framework/components";

export default function Captions() {
  return (
    <View class="w-full h-full">
${tiles}${body}
    </View>
  );
}
`;
}

/** One entry per line: a keyframe block or a comma list is read as one thing. */
function table(record: Record<string, unknown>): string {
  const rows = Object.entries(record).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${rows.join("\n")}\n    }`;
}

function configSource(outDir: string, rendered: Rendered): string {
  const up = relative(outDir, ROOT) || ".";
  return `${headerFor(outDir)}
import { definePocketConfig } from "${up}/vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${table(rendered.keyframes)},
    animation: ${table(rendered.animation)},
  },
});
`;
}

function pocketSource(spec: CaptionsSpec, outDir: string, name: string): string {
  const rel = relative(ROOT, outDir);
  return (
    JSON.stringify(
      {
        $schema: "https://pocketjs.dev/schema/pocket-2.json",
        pocket: 2,
        id: `dev.pocket-stack.motion-captions-${name}`,
        name: `pocketjs-motion-captions-${name}`,
        title: `PocketJS Motion: captions / ${name}`,
        version: "0.1.0",
        engine: { capabilities: { requires: ["text.glyphs.baked"] } },
        app: {
          entry: `${rel}/main.tsx`,
          output: `motion-captions-${name}`,
          framework: "solid",
          viewport: { fixed: { logical: [...spec.viewport], presentation: "native" } },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function sidecarSource(spec: CaptionsSpec, rendered: Rendered): string {
  const [w, h] = spec.viewport;
  const footage = spec.footage
    ? [
        footageTrack({
          id: "plate",
          src: spec.footage.src,
          nodePrefix: FOOTAGE_PREFIX,
          tile: TEX_MAX_DIM,
          width: w,
          height: h,
          startFrame: 0,
          endFrame: spec.durationFrames,
          ...(spec.footage.fit !== undefined ? { fit: spec.footage.fit } : {}),
        }),
      ]
    : undefined;
  const assertions = rendered.named.map((n) => ({ node: n.node, inPicture: [n.window.from, n.window.to] }));
  // A burned-in caption is drawn over the clip on purpose, so `layout`'s
  // `content_overlap` between a word and a tile is the shape, not a finding.
  // Excused on the tiles, which is the side the intent is about.
  const layoutAllow = spec.footage
    ? (() => {
        const [cols, rows] = gridOf(w, h, TEX_MAX_DIM);
        const out: Array<{ node: string; allow: "overlap"; reason: string }> = [];
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            out.push({
              node: tileDebugName(FOOTAGE_PREFIX, col, row),
              allow: "overlap",
              reason: "the captions are burned into this clip, so words are drawn over its tiles",
            });
          }
        }
        return out;
      })()
    : undefined;
  return (
    JSON.stringify(
      {
        motion: 1,
        durationFrames: spec.durationFrames,
        fps: spec.fps,
        supersample: spec.supersample,
        fonts: { regular: spec.fonts.regular, bold: spec.fonts.bold },
        ...(footage ? { footage } : {}),
        ...(layoutAllow ? { layoutAllow } : {}),
        assertions,
      },
      null,
      2,
    ).replace(/\{\n\s+"node": ("[^"]+"),\n\s+"inPicture": \[\n\s+(\d+),\n\s+(\d+)\n\s+\]\n\s+\}/g, '{ "node": $1, "inPicture": [$2, $3] }') + "\n"
  );
}

/** Write the composition for `spec` into `outDir`. `name` keys its pocket.json. */
export async function generateCaptions(spec: CaptionsSpec, outDir: string, name: string): Promise<Generated> {
  const measured = await layoutCaptions(spec);
  const rendered = renderStyle({
    layout: measured.layout,
    params: {
      name: spec.style.name,
      colours: spec.style.colours,
      keywords: new Set(spec.style.keywords.map(keywordKey)),
    },
    fps: spec.fps,
    durationFrames: spec.durationFrames,
    width: spec.viewport[0],
    height: spec.viewport[1],
    scrambleFrom: scramblePool(spec),
  });
  await mkdir(outDir, { recursive: true });
  await Bun.write(
    join(outDir, "main.tsx"),
    `${headerFor(outDir)}\nimport { mount } from "@pocketjs/framework";\nimport Captions from "./app.tsx";\n\nmount(() => <Captions />);\n`,
  );
  await Bun.write(join(outDir, "app.tsx"), appSource(spec, rendered, headerFor(outDir)));
  await Bun.write(join(outDir, "pocket.config.ts"), configSource(outDir, rendered));
  await Bun.write(join(outDir, "pocket.json"), pocketSource(spec, outDir, name));
  await Bun.write(join(outDir, "pocket-motion.json"), sidecarSource(spec, rendered));
  return { spec, measured, rendered };
}

/** One line per page, for a person reading the generator's stderr. */
export function summary(g: Generated): string[] {
  const { layout } = g.measured;
  const sizes = [...new Set(layout.pages.map((p) => p.size))].join("/");
  return [
    `captions: ${g.spec.style.name}, ${g.measured.words.length} word(s) on ${layout.pages.length} page(s) at ${sizes}px, ` +
      `${g.spec.durationFrames} frames at ${g.spec.fps} fps, ${g.rendered.named.length} asserted node(s)`,
    ...layout.pages.map(
      (p) =>
        `  ${String(p.startFrame).padStart(5)}–${String(p.endFrame - 1).padEnd(5)} ` +
        p.lines.map((l) => l.units.map((u) => u.text).join(" ")).join(" / "),
    ),
  ];
}

/** `render --spec`: a throwaway tree under `dist/`, removed by `dispose`. */
export async function stageCaptionsJob(specPath: string): Promise<{ dir: string; dispose: () => Promise<void> }> {
  const spec = await loadCaptionsSpec(specPath);
  await mkdir(join(ROOT, "dist"), { recursive: true });
  const dir = await mkdtemp(join(ROOT, "dist", "captions-job-"));
  try {
    const g = await generateCaptions(spec, dir, "job");
    for (const line of summary(g)) console.error(line);
    return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * A sample's `gen.ts`: no arguments rewrites the sample from its
 * `spec.default.json`; `--spec <file> --out-dir <dir>` writes elsewhere, and
 * `--spec` alone is refused so a job cannot overwrite the sample.
 */
export async function runSampleGenerator(sampleDir: string, argv: readonly string[]): Promise<void> {
  let spec: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    const value = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error(`captions gen: ${tok} requires a path`);
      return v;
    };
    if (tok === "--spec") spec = value();
    else if (tok === "--out-dir") outDir = value();
    else throw new Error(`captions gen: unknown argument ${tok}`);
  }
  const dest = resolve(outDir ?? sampleDir);
  if (spec !== undefined && dest === resolve(sampleDir)) {
    throw new Error(
      "captions gen: --spec would write the sample; pass --out-dir, or render the job with " +
        `\`render ${relative(ROOT, sampleDir)} --spec <file> --out <file>\``,
    );
  }
  const name = relative(join(ROOT, "compositions", "captions"), resolve(sampleDir)).replace(/[^a-z0-9-]/gi, "-");
  const loaded = await loadCaptionsSpec(spec ?? join(sampleDir, "spec.default.json"));
  const g = await generateCaptions(loaded, dest, name);
  for (const line of summary(g)) console.error(line);
}
