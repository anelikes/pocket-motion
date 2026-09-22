/**
 * The build-time measurement pass a composition's `gen.ts` calls before it
 * decides where its lines break.
 *
 * Measuring text means asking the renderer, and the renderer is the wasm core,
 * so there is no measuring without a build: `ops.measureText` resolves a font
 * SLOT, slots are allocated by the compiler from the classes a composition
 * uses, and a slot's advances come from the atlas baked into that build's pak.
 * This does that build — a throwaway composition holding exactly the strings
 * and sizes asked about — and hands back measurement functions in the shape
 * `src/text/fit.ts` consumes.
 *
 * The circularity is only apparent. What is measured is a corpus and a set of
 * sizes, not the finished composition, so the finished composition is free to
 * depend on the answer.
 *
 *     const m = await openMeasurer({ face, sizes: [{ px: 38 }], texts: [COPY] });
 *     const lines = wrapLines(COPY, { maxWidth: 800, measure: m.measure(38), locale: "zh" });
 *     // ...emit `lines.join("\n")` into the generated app.tsx
 *
 * ## Every measurement is guarded against its own build
 *
 * A codepoint the atlas does not carry measures as the tofu cell, so an
 * unbaked character yields a plausible width and passes every consistency
 * check that does not know what was baked. `measure()` refuses instead. This is
 * not hypothetical: it is how a Chinese paragraph came to be measured against a
 * build holding a third of it, and the numbers moved with nothing on screen to
 * explain why (`baselines/text-fitting.md`).
 *
 * The same applies to raster density, for a different reason. Atlas v4 stores
 * LOGICAL advances, so the two bakes do share an advance table: measured over
 * the shipped faces at three slots each, 0 of 261 HarmonyOS Sans advances and
 * 0 of 324 Noto Sans SC advances move between density 1 and 2, line height
 * included. What density changes is the coverage cell's raster size. `density`
 * here must still be the sidecar's `supersample`, so the measurement build is
 * verified to carry the density it was asked for — the same slot table the
 * finished pak will carry — the same way it is verified to carry the sizes.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAtlases, type AtlasHeader } from "./atlas.ts";
import type { Measure } from "./fit.ts";
import { hardenedBootWorld, pocketjsRoot } from "../runtime/boot.ts";
import { withBuildLock } from "../vendor/build-lock.ts";
import { fileURLToPath } from "node:url";

export interface FaceFiles {
  readonly regular: string;
  readonly bold: string;
}

export interface SizeRequest {
  readonly px: number;
  readonly bold?: boolean;
}

export interface MeasurerOptions {
  /** The faces the finished composition will be baked with. Measuring against
   *  any other face measures a different set of advances. */
  readonly face: FaceFiles;
  /** Every size the caller will measure at. */
  readonly sizes: readonly SizeRequest[];
  /** Every string the caller will measure, so its codepoints are baked. */
  readonly texts: readonly string[];
  /**
   * Raster density of the composition being measured for — its sidecar's
   * `supersample`. Default 1.
   *
   * Not a quality knob: atlas v4 stores LOGICAL advances, which do not change
   * with density for the faces this repository ships. Coverage cell size does.
   * `density` still has to match the composition bake so this measurer verifies
   * the same slot table the finished pak will carry.
   */
  readonly density?: number;
  /** Where the throwaway build goes. Removed on `close()` unless `keep`. */
  readonly workdir?: string;
  readonly keep?: boolean;
  /**
   * Measure against a CACHED metrics-only bake of `charset` instead of a
   * per-call build. The bake carries every codepoint of `charset` (ASCII
   * 32..126 is always baked) at every size in `sizes`, with `--metrics-only`:
   * real advances, kerning and line metrics in 1x1 empty cells, kilobytes
   * per slot where coverage would be tens of megabytes. It is built once
   * under the build lock, keyed by faces, sizes, density, charset and the
   * baker's own source, and every later call boots it in milliseconds.
   *
   * A string in `texts` with a character outside `charset` makes this call
   * fall back to the per-call build, silently correct rather than refused:
   * the cache is an optimisation of the same measurement, and `unmapped()`
   * still answers against whatever was actually baked.
   */
  readonly cache?: MeasureCache;
}

export interface MeasureCache {
  /** Every codepoint the cached bake carries. */
  readonly charset: string;
  /** Cache root; default `<repo>/dist/.measure`. One directory per key. */
  readonly dir?: string;
}

export interface Measurer {
  /** Width in logical px on one line, tracking 0 — `fit.ts`'s `Measure`. */
  measure(px: number, bold?: boolean): Measure;
  /** Atlas line advance in px, which `measureText` cannot report. */
  lineHeight(px: number, bold?: boolean): number;
  /** Characters of `text` this build did not bake. */
  unmapped(text: string, px: number, bold?: boolean): string[];
  readonly atlas: (px: number, bold?: boolean) => AtlasHeader;
  close(): Promise<void>;
}

const clsOf = (s: SizeRequest): string => `text-[${s.px}px]${s.bold ? " font-bold" : ""}`;
const keyOf = (px: number, bold: boolean): string => `${px}:${bold ? "b" : "r"}`;

/**
 * The measurement composition.
 *
 * Codepoints are collected from string literals anywhere in the module
 * (`framework/compiler/jsx-plugin.ts` walks `StringLiteral`), so the corpus
 * array is enough to bake them; the `Text` per size is what makes the compiler
 * allocate a slot for that size.
 */
function source(sizes: readonly SizeRequest[], texts: readonly string[]): string {
  const corpus = texts.map((t) => `  ${JSON.stringify(t)},`).join("\n");
  const nodes = sizes
    .map((s, i) => `      <Text class="${clsOf(s)}">{CORPUS[${i % Math.max(1, texts.length)}]}</Text>`)
    .join("\n");
  return `// GENERATED by src/text/measure.ts — a throwaway build whose only job is to
// bake the atlases a fit step measures against. Never rendered.

import { Text, View } from "@pocketjs/framework/components";

const CORPUS = [
${corpus}
];

export default function Measure() {
  return (
    <View class="w-full h-full flex-col">
${nodes}
    </View>
  );
}
`;
}

/**
 * Builds are serialised through `src/vendor/build-lock.ts`.
 *
 * `styles.generated.ts` is a SINGLE FILE that every build rewrites, and it is
 * the only place the px -> slot assignment is published (it is tree-shaken out
 * of the bundle, so the build's own artefacts do not carry it). Two builds
 * overlapping means reading one build's slot table against another build's pak,
 * and the result of that is not an error — it is the advances of a DIFFERENT
 * FONT SIZE, a number that looks entirely reasonable. The cmap guard cannot see
 * it either, because the codepoints are the same.
 *
 * This module used to hold a queue of its OWN, which serialised measurement
 * builds against each other and nothing else. That left the case the queue was
 * written for wide open in the direction that actually happens: a COMPOSITION
 * build through `runBuild` landing between the measurement build's write and
 * the `import` below. Reproduced by starting one 300 ms into a measurement
 * build; `verifySlots` throws, so the measurement is refused rather than wrong,
 * but a correct pair of builds fails. The lock is now shared with `runBuild`,
 * and it covers other processes too — which is what the note here used to
 * concede a queue could not.
 *
 * `verifySlots` stays regardless: it is what covers a build this repository
 * never spawned, run by hand against the same vendored tree.
 */

/**
 * Refuse a slot table that did not come from this build's pak.
 *
 * A stale mirror almost never agrees with the pak it is paired against: the slot
 * SET differs as soon as the two builds used different sizes, and the weight
 * flags differ as soon as they used different weights. What remains after those
 * two is a table whose cell heights do not rise with the font size, which no
 * single bake produces.
 */
function verifySlots(
  wanted: readonly SizeRequest[],
  bySize: Map<string, AtlasHeader>,
  density: number,
): void {
  const seen = new Set<number>();
  for (const s of wanted) {
    const header = bySize.get(keyOf(s.px, s.bold ?? false));
    if (!header) {
      throw new Error(
        `openMeasurer: the slot table has no entry for ${s.px}px ${s.bold ? "bold" : "regular"}, ` +
          "which this build was asked to bake — styles.generated.ts is not this build's",
      );
    }
    if (header.density !== density) {
      throw new Error(
        `openMeasurer: slot ${header.slot} is baked at density ${header.density} but ${density} ` +
          "was asked for — this is not the slot table the composition will bake",
      );
    }
    if (header.bold !== (s.bold ?? false)) {
      throw new Error(
        `openMeasurer: slot ${header.slot} is baked ${header.bold ? "bold" : "regular"} but the ` +
          `slot table calls it ${s.bold ? "bold" : "regular"} — styles.generated.ts is not this build's`,
      );
    }
    seen.add(header.slot);
  }
  // Cell height is a monotone function of the size for one face, so a table
  // whose order disagrees with the pak's is a table from somewhere else.
  for (const bold of [false, true]) {
    const rungs = wanted
      .filter((s) => (s.bold ?? false) === bold)
      .map((s) => ({ px: s.px, cellH: bySize.get(keyOf(s.px, bold))!.cellH }))
      .sort((a, b) => a.px - b.px);
    for (let i = 1; i < rungs.length; i++) {
      if (rungs[i]!.cellH < rungs[i - 1]!.cellH) {
        throw new Error(
          `openMeasurer: ${rungs[i]!.px}px bakes a shorter cell (${rungs[i]!.cellH}) than ` +
            `${rungs[i - 1]!.px}px (${rungs[i - 1]!.cellH}) — styles.generated.ts is not this build's`,
        );
      }
    }
  }
  if (seen.size !== wanted.length) {
    throw new Error(
      `openMeasurer: ${wanted.length} sizes requested but they resolve to ${seen.size} distinct ` +
        "slots — two sizes share a slot, which one bake does not do",
    );
  }
}

export async function openMeasurer(options: MeasurerOptions): Promise<Measurer> {
  if (options.cache) {
    const outside = textsOutside(options.texts, options.cache.charset);
    if (outside.length === 0) return openCachedMeasurer(options, options.cache);
  }
  // The lock spans the build AND the read-back below, not just the spawn: the
  // window this closes ends at `verifySlots`, not at the child's exit.
  return withBuildLock("a measurement pass", () => openMeasurerUnserialised(options));
}

/** Characters of `texts` the cached charset does not carry (ASCII is always baked). */
export function textsOutside(texts: readonly string[], charset: string): string[] {
  const have = new Set<string>([...charset]);
  const out = new Set<string>();
  for (const t of texts) {
    for (const c of t) {
      const cp = c.codePointAt(0)!;
      if (c === "\n" || (cp >= 32 && cp <= 126)) continue;
      if (!have.has(c)) out.add(c);
    }
  }
  return [...out];
}

function checkedDensity(density: number): void {
  if (!Number.isInteger(density) || density < 1) {
    throw new Error(`openMeasurer: density must be a positive integer; got ${density}`);
  }
}

async function openMeasurerUnserialised(options: MeasurerOptions): Promise<Measurer> {
  const { face, sizes, texts } = options;
  const density = options.density ?? 1;
  if (sizes.length === 0) throw new Error("openMeasurer: no sizes requested");
  checkedDensity(density);
  const root = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
  // A shared dist/.measure directory is a race: two `render --spec` processes
  // overwrite each other's corpus and the loser reports a missing codepoint
  // in its own copy. Per-run unless the caller passed `workdir`.
  const owned = options.workdir === undefined;
  const work = options.workdir ?? (await mkdtemp(join(tmpdir(), "pocketjs-measure-")));
  try {
    const dist = join(work, "dist");
    const bySize = await buildMeasurement(work, dist, { face, sizes, texts, density, root, extraArgs: [] });
    return measurerOver(dist, bySize, {
      metricsOnly: false,
      close: async () => {
        if (!options.keep) await rm(work, { recursive: true, force: true });
      },
    });
  } catch (e) {
    if (owned && !options.keep) await rm(work, { recursive: true, force: true });
    throw e;
  }
}

/** `<cache dir>/slots.json`: the px -> slot table this bake was read with. */
interface SlotsFile {
  readonly slots: Record<string, number>;
}

/**
 * A measurement against a cached metrics-only bake.
 *
 * The key is everything that decides an advance: both face files by content,
 * the size set, the density, the charset, and the baker and build sources —
 * so a change to `bake-font.ts` retires every cache it wrote. A miss builds
 * into `<dir>.tmp-<pid>` under the build lock and renames it into place, so
 * a reader never sees a half-written cache and two writers racing leave one
 * complete copy. The mirror is read once, at write time, into `slots.json`;
 * a hit reads that file and never touches the shared mirror at all.
 */
async function openCachedMeasurer(options: MeasurerOptions, cache: MeasureCache): Promise<Measurer> {
  const { face, sizes } = options;
  const density = options.density ?? 1;
  if (sizes.length === 0) throw new Error("openMeasurer: no sizes requested");
  checkedDensity(density);
  const root = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
  const key = await cacheKey(face, sizes, density, cache.charset);
  const dir = join(cache.dir ?? join(root, "dist", ".measure"), key);
  const dist = join(dir, "dist");

  let bySize = await readCachedSlots(dist);
  if (!bySize) {
    bySize = await withBuildLock("a metrics-only measurement bake", async () => {
      // Re-check under the lock: another process may have written it.
      const again = await readCachedSlots(dist);
      if (again) return again;
      const tmp = `${dir}.tmp-${process.pid}`;
      await rm(tmp, { recursive: true, force: true });
      const built = await buildMeasurement(tmp, join(tmp, "dist"), {
        face, sizes, texts: [], density, root,
        extraArgs: ["--metrics-only", `--extra-chars=${cache.charset}`],
      });
      const slots: Record<string, number> = {};
      for (const [k, h] of built) slots[k] = h.slot;
      await Bun.write(join(tmp, "dist", "slots.json"), JSON.stringify({ slots } satisfies SlotsFile));
      await mkdir(join(dir, ".."), { recursive: true });
      try {
        await rename(tmp, dir);
      } catch {
        // Lost the race to a complete copy; use that one.
        await rm(tmp, { recursive: true, force: true });
      }
      const now = await readCachedSlots(dist);
      if (!now) throw new Error(`openMeasurer: the metrics cache at ${dir} did not come back readable`);
      return now;
    });
  }
  verifySlots(sizes, bySize, density);
  return measurerOver(dist, bySize, { metricsOnly: true, close: async () => {} });
}

async function cacheKey(
  face: FaceFiles,
  sizes: readonly SizeRequest[],
  density: number,
  charset: string,
): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  const digest = async (path: string): Promise<string> => {
    const f = new Bun.CryptoHasher("sha256");
    f.update(await Bun.file(path).arrayBuffer());
    return f.digest("hex");
  };
  h.update(`face:${await digest(face.regular)}:${await digest(face.bold)}\n`);
  h.update(`baker:${await digest(join(pocketjsRoot(), "framework/compiler/bake-font.ts"))}\n`);
  h.update(`build:${await digest(join(pocketjsRoot(), "tools/build.ts"))}\n`);
  h.update(`sizes:${[...new Set(sizes.map((s) => keyOf(s.px, s.bold === true)))].sort().join(",")}\n`);
  h.update(`density:${density}\n`);
  const cs = new Bun.CryptoHasher("sha256");
  cs.update(charset);
  h.update(`charset:${cs.digest("hex")}\n`);
  return h.digest("hex").slice(0, 32);
}

/** The slot table and atlases of a complete cache, or undefined when absent. */
async function readCachedSlots(dist: string): Promise<Map<string, AtlasHeader> | undefined> {
  const slotsPath = join(dist, "slots.json");
  const pakPath = join(dist, "main.pak");
  if (!existsSync(slotsPath) || !existsSync(pakPath) || !existsSync(join(dist, "main.js"))) return undefined;
  const file = (await Bun.file(slotsPath).json()) as SlotsFile;
  const atlases = await readAtlases(pakPath);
  const bySize = new Map<string, AtlasHeader>();
  for (const [k, slot] of Object.entries(file.slots)) {
    const header = atlases.get(slot);
    if (header) bySize.set(k, header);
  }
  return bySize;
}

/**
 * Spawn the measurement build into `dist` and read the slot table back out of
 * the mirror. Callers hold the build lock; the read-back is the reason.
 */
async function buildMeasurement(
  work: string,
  dist: string,
  o: {
    readonly face: FaceFiles;
    readonly sizes: readonly SizeRequest[];
    readonly texts: readonly string[];
    readonly density: number;
    readonly root: string;
    readonly extraArgs: readonly string[];
  },
): Promise<Map<string, AtlasHeader>> {
  const { face, sizes, texts, density, root } = o;
  await mkdir(work, { recursive: true });
  await Bun.write(join(work, "app.tsx"), source(sizes, texts.length > 0 ? texts : [""]));
  await Bun.write(
    join(work, "main.tsx"),
    '// @title measurement pass\nimport { mount } from "@pocketjs/framework";\nimport Measure from "./app.tsx";\n\nmount(() => <Measure />);\n',
  );

  const build = Bun.spawn(
    [
      "bun", join(pocketjsRoot(), "tools/build.ts"), join(work, "main.tsx"),
      `--outdir=${dist}`, "--framework=solid",
      `--font-regular=${face.regular}`, `--font-bold=${face.bold}`,
      ...(density > 1 ? [`--density=${density}`] : []),
      ...o.extraArgs,
    ],
    { stdout: "pipe", stderr: "pipe", cwd: root },
  );
  const [out, err] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if ((await build.exited) !== 0) {
    throw new Error(`openMeasurer: the measurement build failed\n${out}\n${err}`);
  }

  // styles.generated.ts is rewritten by every build (an ignored mirror — see
  // tools/build.ts), so it has to be re-imported past the module cache or a
  // second measurement pass reads the first one's slot assignment.
  const generated = (await import(
    `${pocketjsRoot()}/framework/src/styles.generated.ts?measure=${Bun.nanoseconds()}`
  )) as { FONT_SLOTS: Record<number, { px: number; bold: boolean }> };

  const pakPath = join(dist, "main.pak");
  if (!existsSync(pakPath)) throw new Error(`openMeasurer: no pak at ${pakPath}`);
  const atlases = await readAtlases(pakPath);

  const bySize = new Map<string, AtlasHeader>();
  for (const [slot, v] of Object.entries(generated.FONT_SLOTS)) {
    const header = atlases.get(Number(slot));
    if (header) bySize.set(keyOf(v.px, v.bold), header);
  }

  verifySlots(sizes, bySize, density);
  return bySize;
}

/** Boot the built measurement world and wrap it as a `Measurer`. */
async function measurerOver(
  dist: string,
  bySize: ReadonlyMap<string, AtlasHeader>,
  o: { readonly metricsOnly: boolean; readonly close: () => Promise<void> },
): Promise<Measurer> {
  const world = await hardenedBootWorld({
    bundlePath: join(dist, "main.js"),
    pakPath: join(dist, "main.pak"),
    // Nothing is rendered, so the viewport only has to be legal.
    width: 64,
    height: 64,
    hz: 30,
    allowMetricsOnly: o.metricsOnly,
  });
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  const raw = (world.ops as { measureText: (s: string, slot: number) => number }).measureText;

  const atlas = (px: number, bold = false): AtlasHeader => {
    const header = bySize.get(keyOf(px, bold));
    if (!header) {
      throw new Error(
        `openMeasurer: no slot baked for ${px}px ${bold ? "bold" : "regular"} — ` +
          "every size measured has to be listed in `sizes`",
      );
    }
    return header;
  };

  const unmapped = (text: string, px: number, bold = false): string[] => {
    const { codepoints } = atlas(px, bold);
    return [...new Set([...text])].filter((c) => c !== "\n" && !codepoints.has(c.codePointAt(0)!));
  };

  return {
    atlas,
    unmapped,
    lineHeight: (px, bold = false) => atlas(px, bold).lineHeight,
    measure: (px, bold = false) => {
      const slot = atlas(px, bold).slot;
      return (text: string) => {
        const missing = unmapped(text, px, bold);
        if (missing.length > 0) {
          throw new Error(
            `openMeasurer: ${missing.length} codepoint(s) of this string were never baked ` +
              `(${missing.slice(0, 8).join("")}) — they measure as the tofu cell, which is a ` +
              "plausible number and a wrong one. Add the string to `texts`, or the face has " +
              "no glyph for it.",
          );
        }
        return raw(text, slot);
      };
    },
    close: o.close,
  };
}
