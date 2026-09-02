#!/usr/bin/env bun
/**
 * A text card whose line breaks are decided by measurement, not by eye.
 *
 * Copy, palette, fonts and duration come from a spec JSON (`spec.default.json`
 * when none is passed). The generator is the only writer of class literals:
 * user copy is JSON-stringified into text nodes, palette hex becomes
 * `bg-[#rrggbb]` / `text-[#rrggbb]`. A headline that cannot fit still fails
 * here, before anything boots for render.
 *
 *   bun scripts/assets.ts
 *   bun compositions/copy/gen.ts
 *   bun src/cli/main.ts render compositions/copy --spec job.json --out out.mp4
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { copyStageSources } from "../../src/cli/stage-sources.ts";
import { glowColumnNodes, writeGlowColumn } from "../../src/image/glow.ts";
import { parseSpec, SPEC_TEMPLATE_COPY, type CopySpec } from "../../src/manifest/spec.ts";
import { fitToBox, wrapLines, cachedWidth } from "../../src/text/fit.ts";
import { openMeasurer } from "../../src/text/measure.ts";

export { copyStageSources, STAGE_SKIP } from "../../src/cli/stage-sources.ts";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = new URL(".", import.meta.url).pathname;
const DEFAULT_SPEC = join(DIR, "spec.default.json");

export const VIEW = { w: 1920, h: 1080 } as const;

/** The content column: everything below is laid out against this width. */
export const COLUMN = 1200;

/** The headline gets whatever size fits; the rest are fixed. */
const HEADLINE_LADDER = [96, 84, 76, 68, 60, 52] as const;
const EYEBROW_PX = 28;
const BODY_PX = 34;

/** Two headline lines at the largest candidate is the space the design allows. */
const HEADLINE_BOX = { maxWidth: COLUMN, maxHeight: 2 * 116 } as const;

/** `gap-8` is 32px; `h-1` is 4px. */
const STACK_GAP = 32;
const RULE_H = 4;

export interface Fitted {
  readonly eyebrow: string;
  readonly headline: { text: string; px: number; lines: number };
  readonly body: { text: string; lines: number };
  readonly lineHeight: { eyebrow: number; headline: number; body: number };
}

/**
 * CLI of this file rewrites the sample. A job is `render --spec`. `--spec`
 * is accepted only with `--out-dir`, so a job cannot land on the sample
 * through this entry.
 */
export function parseGenArgv(argv: readonly string[] = process.argv.slice(2)): {
  readonly specPath: string;
  readonly outDir: string;
} {
  let spec: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--spec") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("copy gen: --spec requires a path");
      spec = v;
      continue;
    }
    if (tok === "--out-dir") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("copy gen: --out-dir requires a path");
      outDir = v;
      continue;
    }
    if (tok.startsWith("-")) throw new Error(`copy gen: unknown flag ${tok}`);
    throw new Error(
      "copy gen: a job spec is `render compositions/copy --spec <file> --out <file.mp4>`; " +
        "this command regenerates the sample (or `--out-dir`)",
    );
  }
  const dest = resolve(outDir ?? DIR);
  if (spec !== undefined && dest === resolve(DIR)) {
    throw new Error(
      "copy gen: --spec would write the sample; pass --out-dir, or use " +
        "`render compositions/copy --spec <file> --out <file.mp4>`",
    );
  }
  return { specPath: spec ?? DEFAULT_SPEC, outDir: dest };
}

export async function loadSpec(specPath: string = DEFAULT_SPEC): Promise<CopySpec> {
  let raw: unknown;
  try {
    raw = await Bun.file(specPath).json();
  } catch (e) {
    throw new Error(`copy gen: failed to read ${specPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = parseSpec(raw, { root: ROOT });
  if (!parsed.ok) {
    throw new Error(
      `copy gen: invalid spec ${specPath}\n` +
        parsed.diagnostics.map((d) => `  ${d.path || "/"}: ${d.code}: ${d.message}`).join("\n"),
    );
  }
  if (parsed.value.template !== SPEC_TEMPLATE_COPY) {
    throw new Error(
      `copy gen: this generator is ${JSON.stringify(SPEC_TEMPLATE_COPY)}; got ${JSON.stringify(parsed.value.template)}`,
    );
  }
  return parsed.value;
}

export async function fit(spec: CopySpec): Promise<Fitted> {
  const face = {
    regular: join(ROOT, spec.fonts.regular),
    bold: join(ROOT, spec.fonts.bold),
  };
  if (!existsSync(face.regular)) {
    throw new Error(
      `compositions/copy: ${face.regular} is absent. It is fetched, not checked in — ` +
        "run `bun scripts/assets.ts`.",
    );
  }

  const { eyebrow, headline: headlineText, body } = spec.copy;

  const measurer = await openMeasurer({
    face,
    sizes: [
      { px: EYEBROW_PX },
      { px: BODY_PX },
      ...HEADLINE_LADDER.map((px) => ({ px, bold: true })),
    ],
    texts: [eyebrow, headlineText, body],
  });

  try {
    const headline = fitToBox(
      headlineText,
      HEADLINE_BOX,
      HEADLINE_LADDER.map((px) => ({
        px,
        measure: measurer.measure(px, true),
        lineHeight: measurer.lineHeight(px, true),
      })),
      "zh",
    );
    if (headline.overflows) {
      throw new Error(
        `compositions/copy: the headline does not fit ${HEADLINE_BOX.maxWidth}x` +
          `${HEADLINE_BOX.maxHeight} even at ${HEADLINE_LADDER.at(-1)}px — widen the box or cut the copy`,
      );
    }

    const eyebrowMeasure = measurer.measure(EYEBROW_PX);
    const eyebrowLines = wrapLines(eyebrow, { maxWidth: COLUMN, measure: eyebrowMeasure, locale: "zh" });
    const bodyMeasure = measurer.measure(BODY_PX);
    const bodyLines = wrapLines(body, { maxWidth: COLUMN, measure: bodyMeasure, locale: "zh" });
    const bodyWidth = cachedWidth(bodyMeasure);
    const eyebrowWidth = cachedWidth(eyebrowMeasure);

    console.error(
      `copy: headline ${headline.px}px x ${headline.lines.length} line(s), ` +
        `${headline.width}/${COLUMN}px wide`,
    );
    for (const l of headline.lines) console.error(`  | ${l}`);
    console.error(
      `copy: eyebrow ${EYEBROW_PX}px x ${eyebrowLines.length} line(s), ` +
        `widest ${Math.max(...eyebrowLines.map((l) => eyebrowWidth([l])))}/${COLUMN}px`,
    );
    console.error(
      `copy: body ${BODY_PX}px x ${bodyLines.length} line(s), ` +
        `widest ${Math.max(...bodyLines.map((l) => bodyWidth([l])))}/${COLUMN}px`,
    );

    return {
      eyebrow: eyebrowLines.join("\n"),
      headline: { text: headline.text, px: headline.px, lines: headline.lines.length },
      body: { text: bodyLines.join("\n"), lines: bodyLines.length },
      lineHeight: {
        eyebrow: measurer.lineHeight(EYEBROW_PX),
        headline: measurer.lineHeight(headline.px, true),
        body: measurer.lineHeight(BODY_PX),
      },
    };
  } finally {
    await measurer.close();
  }
}

function fill(hex: string): string {
  return `bg-[${hex}]`;
}

function ink(hex: string): string {
  return `text-[${hex}]`;
}

export function copyStackHeight(f: Fitted): number {
  const eyebrowLines = f.eyebrow.split("\n").length;
  return (
    f.lineHeight.eyebrow * eyebrowLines +
    STACK_GAP +
    f.lineHeight.headline * f.headline.lines +
    STACK_GAP +
    RULE_H +
    STACK_GAP +
    f.lineHeight.body * f.body.lines
  );
}


export function source(f: Fitted, spec: CopySpec, glow?: boolean): string {
  const p = spec.palette;
  const imports = glow
    ? `import { Image, Text, View } from "@pocketjs/framework/components";`
    : `import { Text, View } from "@pocketjs/framework/components";`;
  const glowNodes = glow ? glowColumnNodes(COLUMN, copyStackHeight(f), "        ") : "";
  const columnClass = glow
    ? `relative w-[${COLUMN}px] flex-col gap-8`
    : `w-[${COLUMN}px] flex-col gap-8`;
  return `// GENERATED by compositions/copy/gen.ts — do not edit.
//
// Every '\\n' below was placed by measuring the renderer's own advances at build
// time, and the headline size was chosen the same way. Regenerate rather than
// retouching: an edit here is a line break nothing measured.

${imports}

export default function Copy() {
  return (
    <View class="w-full h-full ${fill(p.ground)} flex-col justify-center items-center">
      <View class="${columnClass}">
${glowNodes}        <Text class="text-[${EYEBROW_PX}px] ${ink(p.accent)} tracking-wide">{${JSON.stringify(f.eyebrow)}}</Text>
        <Text class="text-[${f.headline.px}px] font-bold ${ink(p.ink)}">{${JSON.stringify(f.headline.text)}}</Text>
        <View class="w-[${COLUMN}px] h-1 rounded ${fill(p.rule)}" />
        <Text class="text-[${BODY_PX}px] ${ink(p.muted)}">{${JSON.stringify(f.body.text)}}</Text>
      </View>
    </View>
  );
}
`;
}

export function sidecarSource(spec: CopySpec): string {
  return (
    JSON.stringify(
      {
        motion: 1,
        durationFrames: spec.durationFrames,
        fps: spec.fps,
        supersample: spec.supersample,
        fonts: {
          regular: spec.fonts.regular,
          bold: spec.fonts.bold,
        },
      },
      null,
      2,
    ) + "\n"
  );
}

export async function generate(specPath: string = DEFAULT_SPEC, outDir: string = DIR): Promise<CopySpec> {
  const spec = await loadSpec(specPath);
  const fitted = await fit(spec);
  if (spec.glow) await writeGlowColumn(outDir);
  await Bun.write(join(outDir, "app.tsx"), source(fitted, spec, spec.glow === true));
  await Bun.write(join(outDir, "pocket-motion.json"), sidecarSource(spec));
  return spec;
}

/**
 * A throwaway composition directory for one job. Writes generated sources
 * there so `compositions/copy` stays the ledger's sample. `repoRootOf` on
 * `dist/<id>` is two levels up — the repository root — so sidecar font
 * paths still resolve.
 */
export async function stageJob(specPath: string): Promise<{ dir: string; dispose: () => Promise<void> }> {
  await mkdir(join(ROOT, "dist"), { recursive: true });
  const dir = await mkdtemp(join(ROOT, "dist", "copy-job-"));
  try {
    await copyStageSources(DIR, dir);
    await generate(specPath, dir);
    return {
      dir,
      dispose: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

if (import.meta.main) {
  const { specPath, outDir } = parseGenArgv();
  await mkdir(outDir, { recursive: true });
  await generate(specPath, outDir);
  console.log(`copy: wrote ${join(outDir, "app.tsx")}`);
}
