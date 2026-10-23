/**
 * Resolve a composition directory into paths + render parameters.
 *
 * A composition dir holds main.tsx, pocket.json, pocket-motion.json.
 * Built artifacts live under --bundle/--pak, defaulting to
 * <repo>/dist/<the composition's path relative to the repository>.
 * Dimensions / fps / frames / supersample default from the sidecar + pocket.json
 * viewport; CLI flags override.
 */

import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  FONT_FILES_MAX_BYTES,
  parseSidecar,
  type Diagnostic,
  type MotionSidecar,
  type SidecarShutter,
} from "../manifest/sidecar.ts";
import {
  assertBuildRecord,
  BuildRecordError,
  type BuildRecord,
} from "../render/build-record.ts";
import { TICKS_PER_SECOND, pocketjsRoot } from "../runtime/boot.ts";
import { buildEnv } from "../vendor/cache.ts";
import { readAtlases, type AtlasHeader } from "../text/atlas.ts";
import { UsageError } from "./args.ts";
import type { GlobalFlags } from "./types.ts";

export interface PocketAppManifest {
  readonly id?: string;
  readonly name?: string;
  readonly app?: {
    readonly entry?: string;
    readonly output?: string;
    readonly framework?: string;
    readonly viewport?: {
      readonly fixed?: {
        readonly logical?: readonly [number, number] | number[];
      };
    };
  };
}

export interface ResolvedComposition {
  readonly dir: string;
  readonly entryPath: string;
  readonly pocketPath: string;
  readonly sidecarPath: string;
  readonly pocket: PocketAppManifest;
  readonly sidecar: MotionSidecar;
  readonly compositionId: string;
  readonly outputName: string;
  readonly distDir: string;
  readonly bundlePath: string;
  readonly pakPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationFrames: number;
  readonly supersample: 1 | 2 | 4;
  /**
   * The sidecar's `shutter`, or null. Only the sidecar sets it — there is no
   * flag — and every command that boots a world passes it on, because
   * `BootOptions.shutter` has no default.
   */
  readonly shutter: SidecarShutter | null;
  /** Absolute paths to the declared faces, or undefined for the build default.
   *  `faces` holds the named faces (`fonts.faces`), present only when declared. */
  readonly fontPaths?: {
    readonly regular: string;
    readonly bold: string;
    readonly faces?: Readonly<Record<string, { readonly regular: string; readonly bold: string }>>;
  };
  /** Exact build command that would produce the missing artifact. */
  readonly buildCommand: string;
  /** The same command as argv, so a path with a space is not split. */
  readonly buildArgs: readonly string[];
  /**
   * What built the bundle — read from `build.json` beside it. Present exactly
   * when `requireBundle` was not false, because that is when the artifacts
   * were required to exist and were checked.
   */
  readonly buildRecord?: BuildRecord;
}

export interface ResolveOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
  /**
   * When true (default for boot-driving commands), missing bundle/pak is a
   * usage error with the exact build command. Lint does not need artifacts.
   */
  readonly requireBundle?: boolean;
}

export type ResolveResult =
  | { readonly ok: true; readonly value: ResolvedComposition }
  | {
      readonly ok: false;
      readonly kind: "usage" | "sidecar";
      readonly message: string;
      readonly diagnostics?: readonly Diagnostic[];
      readonly sidecarPath?: string;
    };

export async function resolveComposition(
  options: ResolveOptions,
): Promise<ResolveResult> {
  const dir = resolve(options.dir);
  if (!existsSync(dir)) {
    return {
      ok: false,
      kind: "usage",
      message: `composition directory not found: ${dir}`,
    };
  }

  const pocketPath = join(dir, "pocket.json");
  const sidecarPath = join(dir, "pocket-motion.json");

  if (!existsSync(sidecarPath)) {
    return {
      ok: false,
      kind: "usage",
      message: `missing pocket-motion.json in ${dir}`,
    };
  }

  let sidecarRaw: unknown;
  try {
    sidecarRaw = await Bun.file(sidecarPath).json();
  } catch (e) {
    return {
      ok: false,
      kind: "usage",
      message: `failed to read ${sidecarPath}: ${errMsg(e)}`,
    };
  }

  const parsed = parseSidecar(sidecarRaw);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "sidecar",
      message: `invalid pocket-motion.json`,
      diagnostics: parsed.diagnostics,
      sidecarPath,
    };
  }

  let pocket: PocketAppManifest = {};
  if (existsSync(pocketPath)) {
    try {
      pocket = (await Bun.file(pocketPath).json()) as PocketAppManifest;
    } catch (e) {
      return {
        ok: false,
        kind: "usage",
        message: `failed to read ${pocketPath}: ${errMsg(e)}`,
      };
    }
  }

  const entryRel = pocket.app?.entry;
  const entryPath = entryRel
    ? resolve(dir, "..", "..", entryRel) // entry is repo-relative in smoke
    : join(dir, "main.tsx");
  // Prefer the composition-local main.tsx when present — pocket.json entry may
  // be written relative to the monorepo root and only valid there.
  const localEntry = join(dir, "main.tsx");
  const resolvedEntry = existsSync(localEntry)
    ? localEntry
    : existsSync(entryPath)
      ? entryPath
      : localEntry;

  const entryStem = basename(resolvedEntry).replace(/\.tsx?$/, "");
  const declaredOutput = pocket.app?.output;
  // Upstream tools/build.ts without a ResolvedBuildPlan names the artifact
  // after the entry stem; with a plan it uses app.output. Prefer the file that
  // actually exists so agents are not blocked by the naming mismatch.
  const outputName = declaredOutput ?? entryStem;

  // One dist directory per composition. A direct (non-plan) upstream build
  // names the artifact after the entry stem, so every composition here would
  // otherwise write `dist/main.js` over the last one's — two compositions
  // silently sharing a bundle is the exact class of mixup this tool exists to
  // rule out. The flat paths stay in the candidate list so an artifact built
  // the old way is still found.
  //
  // The key is the composition's path relative to the repository, not its last
  // segment. `basename` only tells siblings apart: two cuts of one delivery
  // are `<name>/g/9x16` and `<name>/h/9x16`, which share a basename, so both
  // resolved to the same directory and a build of either wrote over the
  // other's bundle. `trace` does not build, so the second cut traced reported
  // the first one's pixels under its own name.
  //
  // ONE dist root, at the repository root, whatever depth the composition sits
  // at. It used to be a fixed `<dir>/../../dist`, which made the root a
  // function of that depth — `compositions/<name>` landed in `dist/`,
  // `compositions/<name>/<variant>` in `compositions/dist/`, and
  // `compositions/<name>/<cut>/<variant>` in `compositions/<name>/dist/`. Three
  // roots in one tree, two of them inside the source tree preview watches, and
  // a build command copied out of prose sent the artifact to whichever one the
  // prose happened to describe. `repoRootOf` already derived the repository
  // root for the sidecar's font paths; the dist root now uses the same one.
  const repoRoot = repoRootOf(dir);
  const distRoot = join(repoRoot, "dist");
  const distDir = join(distRoot, relative(repoRoot, dir));
  const defaultBundleCandidates = uniquePaths([
    join(distDir, `${entryStem}.js`),
    join(distDir, `${outputName}.js`),
    join(distRoot, `${outputName}.js`),
    join(distRoot, `${entryStem}.js`),
  ]);
  const defaultPakCandidates = uniquePaths([
    join(distDir, `${entryStem}.pak`),
    join(distDir, `${outputName}.pak`),
    join(distRoot, `${outputName}.pak`),
    join(distRoot, `${entryStem}.pak`),
  ]);

  const bundlePath = options.flags.bundle
    ? resolve(options.flags.bundle)
    : (defaultBundleCandidates.find((p) => existsSync(p)) ??
      defaultBundleCandidates[0]!);
  const pakPath = options.flags.pak
    ? resolve(options.flags.pak)
    : (defaultPakCandidates.find((p) => existsSync(p)) ??
      defaultPakCandidates[0]!);

  const framework = pocket.app?.framework ?? "solid";
  const buildOutDir = dirname(bundlePath);

  // Viewport: pocket.json fixed.logical, else 1920×1080.
  const logical = pocket.app?.viewport?.fixed?.logical;
  let width = 1920;
  let height = 1080;
  if (
    Array.isArray(logical) &&
    logical.length >= 2 &&
    typeof logical[0] === "number" &&
    typeof logical[1] === "number"
  ) {
    width = logical[0];
    height = logical[1];
  }

  if (options.flags.width !== undefined) width = options.flags.width;
  if (options.flags.height !== undefined) height = options.flags.height;

  const fps = options.flags.fps ?? parsed.value.fps;
  const durationFrames = options.flags.frames ?? parsed.value.durationFrames;
  let supersample: 1 | 2 | 4 = parsed.value.supersample;
  if (options.flags.supersample !== undefined) {
    if (
      options.flags.supersample !== 1 &&
      options.flags.supersample !== 2 &&
      options.flags.supersample !== 4
    ) {
      return {
        ok: false,
        kind: "usage",
        message: `--supersample must be 1, 2, or 4; got ${options.flags.supersample}`,
      };
    }
    supersample = options.flags.supersample;
  }

  // Non-plan builds write <entryStem>.js into --outdir. Tell the agent the
  // exact command that produces a loadable artifact for this composition —
  // including the tick rate, because the realm always steps the core at 60 Hz
  // and a keyframe timeline is a frame count at the rate it was baked at, so a
  // bundle built at another `--hz` plays every animation at the wrong speed
  // (`assertBakedTickRate`). 60 is also build.ts's default, so stating it
  // changes no output byte; what it changes is that the recipe now says which
  // rate it depends on instead of inheriting one.
  // Also including the density, because supersampling is not free for text:
  // `renderScale=N` against a density-1 atlas copies glyph cells with
  // nearest-neighbour (measured in baselines/phase0-acceptance.md). The two flags are one recipe, so the command
  // this CLI prints is the whole recipe.
  // `repoRoot` above is also where a sidecar's relative font paths resolve
  // from: they are the same paths the documented build command is typed with.
  const fonts = parsed.value.fonts;
  const namedFaces = Object.entries(fonts?.faces ?? {});
  const fontPaths = fonts
    ? {
        regular: resolve(repoRoot, fonts.regular),
        bold: resolve(repoRoot, fonts.bold),
        ...(namedFaces.length > 0
          ? {
              faces: Object.fromEntries(
                namedFaces.map(([name, f]) => [
                  name,
                  { regular: resolve(repoRoot, f.regular), bold: resolve(repoRoot, f.bold) },
                ]),
              ),
            }
          : {}),
      }
    : undefined;

  const buildArgs = [
    "bun",
    `${pocketjsRoot()}/tools/build.ts`,
    resolvedEntry,
    `--outdir=${buildOutDir}`,
    `--framework=${framework}`,
    `--hz=${TICKS_PER_SECOND}`,
    ...(supersample > 1 ? [`--density=${supersample}`] : []),
    ...(fonts ? [`--font-regular=${fonts.regular}`, `--font-bold=${fonts.bold}`] : []),
    ...namedFaces.flatMap(([name, f]) => [
      `--font-face-regular=${name}=${f.regular}`,
      `--font-face-bold=${name}=${f.bold}`,
    ]),
  ];
  const buildCommand = buildArgs.map(quoteArg).join(" ");

  const compositionId =
    (typeof pocket.id === "string" && pocket.id) ||
    (typeof pocket.name === "string" && pocket.name) ||
    outputName;

  let buildRecord: BuildRecord | undefined;
  if (options.requireBundle !== false) {
    // A declared face that is not on disk is the CJK case: Noto Sans SC is
    // fetched, not tracked, so a fresh clone that skipped `scripts/assets.ts`
    // would otherwise fail somewhere deeper with a less useful message.
    const declaredFiles: [string, string][] = fontPaths
      ? [
          ["regular", fontPaths.regular],
          ["bold", fontPaths.bold],
          ...Object.entries(fontPaths.faces ?? {}).flatMap(([name, f]): [string, string][] => [
            [`${name} regular`, f.regular],
            [`${name} bold`, f.bold],
          ]),
        ]
      : [];
    for (const [weight, path] of declaredFiles) {
      if (!existsSync(path)) {
        return {
          ok: false,
          kind: "usage",
          message:
            `the ${weight} face this composition declares is not on disk: ${path}\n` +
            "Fetch the digest-pinned assets with:\n  bun scripts/assets.ts",
        };
      }
    }
    const fontBytes = [...new Set(declaredFiles.map(([, path]) => path))].reduce(
      (sum, path) => sum + statSync(path).size,
      0,
    );
    if (fontBytes > FONT_FILES_MAX_BYTES) {
      return {
        ok: false,
        kind: "usage",
        message:
          `the declared font files total ${(fontBytes / 1048576).toFixed(1)} MiB; at most ` +
          `${FONT_FILES_MAX_BYTES / 1048576} MiB are allowed (fonts.regular, fonts.bold and every fonts.faces entry, ` +
          "each distinct file once)",
      };
    }
    if (!existsSync(bundlePath)) {
      return {
        ok: false,
        kind: "usage",
        message: `bundle not found: ${bundlePath}\n` + buildHint(dir, buildCommand),
      };
    }
    // pak is optional for asset-free compositions, but we still surface a
    // clear message when the default path is missing AND a pak flag was set.
    if (options.flags.pak && !existsSync(pakPath)) {
      return {
        ok: false,
        kind: "usage",
        message: `pak not found: ${pakPath}\n` + buildHint(dir, buildCommand),
      };
    }
    if (existsSync(pakPath)) {
      const wrong = densityMismatch(await readAtlases(pakPath), supersample);
      if (wrong) {
        return {
          ok: false,
          kind: "usage",
          message:
            `pak baked at density ${wrong.density}, rendering at supersample ${supersample} ` +
            `(font slot ${wrong.slot}, ${wrong.cellW}×${wrong.cellH} cells).\n` +
            "Every glyph would be a rescaled copy of a cell baked for another density, and the " +
            "advances differ between densities — so a build-time fit measured against this pak " +
            "is measuring a different font than the one that draws.\n" +
            `Rebuild with:\n  ${buildCommand}`,
        };
      }
    }
    // What produced this bundle, or a refusal. A bundle with no `build.json`
    // beside it cannot say which Bun, which upstream commit or which patches
    // were in front of it, and identity would then be hashing the toolchain
    // this process happens to be running rather than the one that baked the
    // pak. Same shape as `assertBakedTickRate`: absent is refused, not
    // defaulted.
    try {
      buildRecord = await assertBuildRecord({
        bundlePath,
        compositionDir: dir,
        buildCommand,
      });
    } catch (e) {
      if (!(e instanceof BuildRecordError)) throw e;
      return { ok: false, kind: "usage", message: e.message };
    }
  }

  return {
    ok: true,
    value: {
      dir,
      entryPath: resolvedEntry,
      pocketPath,
      sidecarPath,
      pocket,
      sidecar: parsed.value,
      compositionId,
      outputName,
      distDir,
      bundlePath,
      pakPath,
      width,
      height,
      fps,
      durationFrames,
      supersample,
      shutter: parsed.value.shutter ?? null,
      ...(fontPaths ? { fontPaths } : {}),
      buildCommand,
      buildArgs,
      ...(buildRecord ? { buildRecord } : {}),
    },
  };
}

/**
 * What to run when an artifact is missing, and what it will actually spawn.
 *
 * Two lines rather than one because the raw upstream builder writes no
 * `build.json` and every command that reads a bundle needs one — so the
 * command to type is the CLI's, and the argv is shown because it is the whole
 * recipe (faces, `--hz`, `--density`) and because a person debugging a build
 * needs to see it.
 */
function buildHint(dir: string, buildCommand: string): string {
  return (
    `Build it with:\n  bun src/cli/main.ts build ${dir}\n` +
    `which runs, and records beside the artifacts:\n  ${buildCommand}`
  );
}

/** Quote one argv token so the printed command survives spaces. */
export function quoteArg(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Everything `Bun.spawn` needs to run a composition's build.
 *
 * The one supported way to start one. `buildCommand` is for printing: splitting
 * it on spaces turned `/…/copy dist/main.js` into two argv tokens, and the
 * failure surfaced three layers down as `cannot resolve app "dist"`. Callers
 * used to choose between the two fields themselves; taking the composition
 * leaves nothing to choose, so reaching for the printed string is a type error
 * instead of a build that runs against shredded paths.
 *
 * `cwd` is the repository root, and upstream's builder hands
 * `root: process.cwd()` to `Bun.build` since 66caf4e5, so the module paths a
 * bundle carries are relative to the repository rather than to wherever the
 * caller stood. `env` names the transform cache (`src/vendor/cache.ts`).
 */
export function buildSpawn(
  c: Pick<ResolvedComposition, "buildArgs" | "dir">,
): { readonly argv: string[]; readonly cwd: string; readonly env: Record<string, string> } {
  return { argv: [...c.buildArgs], cwd: repoRootOf(c.dir), env: buildEnv() };
}

/**
 * The first atlas whose baked density disagrees with the density being
 * rendered, or null when they all agree.
 *
 * A pak carrying no atlas at all (a composition with no text) has nothing to
 * disagree, so it renders at any supersample — geometry genuinely is free.
 */
export function densityMismatch(
  atlases: ReadonlyMap<number, AtlasHeader>,
  supersample: number,
): AtlasHeader | null {
  for (const header of atlases.values()) {
    if (header.density !== supersample) return header;
  }
  return null;
}

/**
 * The directory containing the nearest `compositions/` ancestor of `dir` —
 * the repository root, however deep the composition sits. Falls back to the
 * historical `dir/../..` when `dir` is not under a `compositions/` tree
 * (tests exercise compositions from temp directories).
 *
 * Everything derived from a composition's position in the tree comes through
 * here: the dist root, the sidecar's relative font paths, and the cwd a build
 * spawns in. A second derivation of the same root is how the dist root ended
 * up depending on how deep a cut was nested.
 */
export function repoRootOf(dir: string): string {
  const abs = resolve(dir);
  const parts = abs.split(sep);
  const i = parts.lastIndexOf("compositions");
  if (i > 0) return parts.slice(0, i).join(sep) || sep;
  return resolve(abs, "../..");
}

export async function listCompositionSources(
  dir: string,
): Promise<string[]> {
  const entries = await Array.fromAsync(
    new Bun.Glob("*.{ts,tsx}").scan({ cwd: dir, absolute: true }),
  );
  return entries.sort();
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Throw UsageError when resolve failed with kind usage. */
export function unwrapResolve(result: ResolveResult): ResolvedComposition {
  if (result.ok) return result.value;
  if (result.kind === "usage") throw new UsageError(result.message);
  // sidecar failures are findings (exit 1), not usage — callers handle them.
  throw new UsageError(result.message);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
