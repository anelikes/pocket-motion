#!/usr/bin/env bun
/**
 * A name plate in the lower third. Line breaks and the name size are measured
 * at build time. Optional logo and one footage track come from the spec.
 *
 *   bun compositions/lower-third/gen.ts
 *   bun src/cli/main.ts render compositions/lower-third --spec job.json --out out.mp4
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { copyStageSources } from "../../src/cli/stage-sources.ts";
import { footageTrack, tileNodes } from "../../src/footage/declare.ts";
import { glowColumnNodes, writeGlowColumn } from "../../src/image/glow.ts";
import {
  logoLogicalSize,
  parseSpec,
  SPEC_TEMPLATE_LOWER_THIRD,
  type LowerThirdSpec,
} from "../../src/manifest/spec.ts";
import { TEX_MAX_DIM } from "../../src/manifest/sidecar.ts";
import { cachedWidth, fitToBox, wrapLines } from "../../src/text/fit.ts";
import { openMeasurer } from "../../src/text/measure.ts";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = new URL(".", import.meta.url).pathname;
const DEFAULT_SPEC = join(DIR, "spec.default.json");

export const VIEW = { w: 1920, h: 1080 } as const;
export const TILE = TEX_MAX_DIM;
export const FOOTAGE_PREFIX = "footage:plate";

/** Name and title sit in this column, left-aligned in the lower third. */
export const COLUMN = 720;

const NAME_LADDER = [56, 48, 42, 36, 32] as const;
const TITLE_PX = 28;
/** `gap-2` is 8px; the rule is `h-[2px]`. */
const STACK_GAP = 8;
const RULE_H = 2;

export interface Fitted {
  readonly name: { text: string; px: number; lines: number };
  readonly title: { text: string; lines: number };
  readonly lineHeight: { name: number; title: number };
}

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
      if (!v || v.startsWith("-")) throw new Error("lower-third gen: --spec requires a path");
      spec = v;
      continue;
    }
    if (tok === "--out-dir") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("lower-third gen: --out-dir requires a path");
      outDir = v;
      continue;
    }
    if (tok.startsWith("-")) throw new Error(`lower-third gen: unknown flag ${tok}`);
    throw new Error(
      "lower-third gen: a job spec is `render compositions/lower-third --spec <file> --out <file.mp4>`; " +
        "this command regenerates the sample (or `--out-dir`)",
    );
  }
  const dest = resolve(outDir ?? DIR);
  if (spec !== undefined && dest === resolve(DIR)) {
    throw new Error(
      "lower-third gen: --spec would write the sample; pass --out-dir, or use " +
        "`render compositions/lower-third --spec <file> --out <file.mp4>`",
    );
  }
  return { specPath: spec ?? DEFAULT_SPEC, outDir: dest };
}

export async function loadSpec(specPath: string = DEFAULT_SPEC): Promise<LowerThirdSpec> {
  let raw: unknown;
  try {
    raw = await Bun.file(specPath).json();
  } catch (e) {
    throw new Error(
      `lower-third gen: failed to read ${specPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const parsed = parseSpec(raw, { root: ROOT });
  if (!parsed.ok) {
    throw new Error(
      `lower-third gen: invalid spec ${specPath}\n` +
        parsed.diagnostics.map((d) => `  ${d.path || "/"}: ${d.code}: ${d.message}`).join("\n"),
    );
  }
  if (parsed.value.template !== SPEC_TEMPLATE_LOWER_THIRD) {
    throw new Error(
      `lower-third gen: this generator is ${JSON.stringify(SPEC_TEMPLATE_LOWER_THIRD)}; got ${JSON.stringify(parsed.value.template)}`,
    );
  }
  return parsed.value;
}

export async function fit(spec: LowerThirdSpec): Promise<Fitted> {
  const face = {
    regular: join(ROOT, spec.fonts.regular),
    bold: join(ROOT, spec.fonts.bold),
  };
  if (!existsSync(face.regular)) {
    throw new Error(
      `compositions/lower-third: ${face.regular} is absent. It is fetched, not checked in — ` +
        "run `bun scripts/assets.ts`.",
    );
  }

  const { name: nameText, title } = spec.copy;
  const measurer = await openMeasurer({
    face,
    sizes: [{ px: TITLE_PX }, ...NAME_LADDER.map((px) => ({ px, bold: true }))],
    texts: [nameText, title],
  });

  try {
    // Two lines at the largest candidate — measured line height, not a
    // constant that matches none of the rungs.
    const nameBox = {
      maxWidth: COLUMN,
      maxHeight: 2 * measurer.lineHeight(NAME_LADDER[0], true),
    };
    const name = fitToBox(
      nameText,
      nameBox,
      NAME_LADDER.map((px) => ({
        px,
        measure: measurer.measure(px, true),
        lineHeight: measurer.lineHeight(px, true),
      })),
      "zh",
    );
    if (name.overflows) {
      throw new Error(
        `compositions/lower-third: the name does not fit ${nameBox.maxWidth}x` +
          `${nameBox.maxHeight} even at ${NAME_LADDER.at(-1)}px — widen the box or cut the copy`,
      );
    }
    const titleMeasure = measurer.measure(TITLE_PX);
    const titleLines = wrapLines(title, { maxWidth: COLUMN, measure: titleMeasure, locale: "zh" });
    const titleWidth = cachedWidth(titleMeasure);
    console.error(
      `lower-third: name ${name.px}px x ${name.lines.length} line(s), ${name.width}/${COLUMN}px wide`,
    );
    for (const l of name.lines) console.error(`  | ${l}`);
    console.error(
      `lower-third: title ${TITLE_PX}px x ${titleLines.length} line(s), ` +
        `widest ${Math.max(...titleLines.map((l) => titleWidth([l])))}/${COLUMN}px`,
    );
    return {
      name: { text: name.text, px: name.px, lines: name.lines.length },
      title: { text: titleLines.join("\n"), lines: titleLines.length },
      lineHeight: {
        name: measurer.lineHeight(name.px, true),
        title: measurer.lineHeight(TITLE_PX),
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

function footageTiles(): string {
  const nodes = tileNodes({
    nodePrefix: FOOTAGE_PREFIX,
    width: VIEW.w,
    height: VIEW.h,
    tile: TILE,
    indent: "      ",
  });
  return `    <View class="absolute inset-0">\n${nodes}\n    </View>`;
}

export function nameStackHeight(f: Fitted): number {
  return (
    f.lineHeight.name * f.name.lines + STACK_GAP + RULE_H + STACK_GAP + f.lineHeight.title * f.title.lines
  );
}


export function source(
  f: Fitted,
  spec: LowerThirdSpec,
  logoFile?: { name: string; w: number; h: number },
  glow?: boolean,
): string {
  const p = spec.palette;
  const usesImage = spec.footage !== undefined || logoFile !== undefined || glow === true;
  const imports = usesImage
    ? `import { Image, Text, View } from "@pocketjs/framework/components";`
    : `import { Text, View } from "@pocketjs/framework/components";`;
  const tiles = spec.footage ? `${footageTiles()}\n` : "";
  const logo = logoFile
    ? `        <Image debugName="logo" class="w-[${logoFile.w}px] h-[${logoFile.h}px]" src="${logoFile.name}" />\n`
    : "";
  const glowNodes = glow ? glowColumnNodes(COLUMN, nameStackHeight(f), "            ") : "";
  const nameColClass = glow
    ? `relative w-[${COLUMN}px] flex-col gap-2`
    : `w-[${COLUMN}px] flex-col gap-2`;
  return `// GENERATED by compositions/lower-third/gen.ts — do not edit.

${imports}

export default function LowerThird() {
  return (
    <View class="w-full h-full ${fill(p.ground)} relative">
${tiles}      <View class="absolute left-[80px] bottom-[80px] flex-row items-end gap-5">
${logo}        <View class="flex-row items-stretch gap-4">
          <View class="w-[6px] ${fill(p.bar)}" />
          <View class="${nameColClass}">
${glowNodes}            <Text class="text-[${f.name.px}px] font-bold ${ink(p.ink)}">{${JSON.stringify(f.name.text)}}</Text>
            <View class="w-[${COLUMN}px] h-[2px] ${fill(p.accent)}" />
            <Text class="text-[${TITLE_PX}px] ${ink(p.muted)}">{${JSON.stringify(f.title.text)}}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
`;
}

export function sidecarSource(spec: LowerThirdSpec): string {
  const footage = spec.footage
    ? [
        footageTrack({
          id: "plate",
          src: spec.footage.src,
          nodePrefix: FOOTAGE_PREFIX,
          tile: TILE,
          width: VIEW.w,
          height: VIEW.h,
          startFrame: 0,
          endFrame: spec.durationFrames,
          ...(spec.footage.fit !== undefined ? { fit: spec.footage.fit } : {}),
        }),
      ]
    : undefined;
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
        ...(footage ? { footage } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

function logoDest(
  spec: LowerThirdSpec,
): { name: string; w: number; h: number; from: string } | undefined {
  if (!spec.logo) return undefined;
  const from = join(ROOT, spec.logo);
  const size = logoLogicalSize(from);
  if (!size) throw new Error(`lower-third gen: unreadable logo ${from}`);
  const name = size.kind === "svg" ? "logo.svg" : "logo.png";
  return { name, w: size.w, h: size.h, from };
}

export async function generate(
  specPath: string = DEFAULT_SPEC,
  outDir: string = DIR,
): Promise<LowerThirdSpec> {
  const spec = await loadSpec(specPath);
  const fitted = await fit(spec);
  if (spec.glow) await writeGlowColumn(outDir);
  const logo = logoDest(spec);
  if (logo) await copyFile(logo.from, join(outDir, logo.name));
  await Bun.write(join(outDir, "app.tsx"), source(fitted, spec, logo, spec.glow === true));
  await Bun.write(join(outDir, "pocket-motion.json"), sidecarSource(spec));
  return spec;
}

export async function stageJob(specPath: string): Promise<{ dir: string; dispose: () => Promise<void> }> {
  await mkdir(join(ROOT, "dist"), { recursive: true });
  const dir = await mkdtemp(join(ROOT, "dist", "lower-third-job-"));
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
  console.log(`lower-third: wrote ${join(outDir, "app.tsx")}`);
}
