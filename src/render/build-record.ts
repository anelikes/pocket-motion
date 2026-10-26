/**
 * `build.json` — what produced the artifact, written beside it.
 *
 * The pak format is upstream's and does not carry the toolchain that baked it.
 * That was the remaining half of a known hole: four delivered cuts stopped
 * rebuilding to their recorded digests with the tracked source held fixed, the
 * bundles built at the time still reproduced them, and nothing in either
 * artifact said which Bun, which upstream commit or which patches had been in
 * front of it. Identity could hash the Bun it was RUNNING on, which answers a
 * different question — "what is here now", not "what made this".
 *
 * So every build this repository spawns writes this file into its `--outdir`,
 * and every command that reads a bundle refuses one that has none, the way
 * `assertBakedTickRate` refuses a bundle that does not publish its bake rate.
 * An absent record is refused rather than defaulted for the same reason: "no
 * toolchain declared" and "the declared toolchain is the running one" would
 * otherwise be the same observation.
 *
 * WHAT IS REFUSED, and why each:
 *
 * - no `build.json` beside the bundle. Unattributable.
 * - `bun` differs from the running `Bun.version`. The guest executes on the
 *   running one while the pak and bundle came out of the recorded one; a Bun
 *   change has moved pixels with the tracked source fixed. Rebuilding is the
 *   fix and it is cheap; rendering across the pair is a digest nobody can
 *   reproduce from the tree.
 * - `patches[]` differs from `patches/*.patch` on disk. The compiler that
 *   baked the pak was built from those files. The message names the first
 *   patch that differs.
 *
 * `builtAt` is deliberately NOT recorded. A timestamp is not an input, and one
 * in here would make every rebuild a different record for no reason a pixel
 * could see.
 *
 * The recorded `argv` names no directory. It is the identity component's
 * companion, and where a build ran is a property of the machine and the
 * moment, not of the build: `~/code/motion/dist/compositions/smoke` and
 * `/srv/ci/motion/dist/compositions/smoke` are the same build, and so are
 * `compositions/smoke` and the `dist/captions-job-Xq3/` a `render --spec`
 * job stages into. Each path token is written relative to what it belongs
 * to — the entry to the composition's directory, `--outdir` to the
 * directory this record sits in, the compiler to this package — and
 * `relativise` says how. Hashing them any other way would make identity
 * disagree between two builds of one set of declared inputs for the one
 * reason it exists to rule out.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { UPSTREAM } from "../vendor/upstream.ts";
import { fileURLToPath } from "node:url";

/** The repository root: this module sits at `src/render/`. */
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Name of the record, beside the bundle and pak it describes. */
export const BUILD_RECORD_FILE = "build.json";

export interface PatchDigest {
  /** File name in `patches/`, e.g. `0007-debug-hide-node.patch`. */
  readonly file: string;
  readonly sha256: string;
}

export interface BuildRecord {
  /** `Bun.version` of the process that ran the build. */
  readonly bun: string;
  /** `UPSTREAM.commit` — the vendored tree the compiler came from. */
  readonly upstream: string;
  /** `patches/*.patch` in sorted order, by content. */
  readonly patches: readonly PatchDigest[];
  /**
   * The build argv with every path relative to what it belongs to (see
   * `relativise`): `main.tsx`, `--outdir=.`, `vendor/pocketjs/tools/build.ts`.
   * Carries `--hz`, `--density` and the faces as the sidecar names them.
   */
  readonly argv: readonly string[];
}

/**
 * The directories a record's paths are written relative to. `outDir` is
 * always the directory the record is written into; the other two are the
 * composition's, when the build has one.
 */
export interface RecordAnchors {
  /** The composition's directory: its entry is named relative to it. */
  readonly compositionDir?: string;
  /**
   * The composition's repository — the cwd the build runs in. A face the
   * sidecar names by an absolute path under it is recorded relative to it.
   * Defaults to this package's root, the same directory in this repository.
   */
  readonly projectRoot?: string;
}

export function buildRecordPath(bundlePath: string): string {
  return join(dirname(bundlePath), BUILD_RECORD_FILE);
}

/**
 * Relative form of one argv token against the first anchor that contains it;
 * an absolute path under none of them stays whole.
 *
 * The anchors, in order, and what each token comes out as:
 *
 *   the record's own directory   --outdir=.
 *   the composition's directory  main.tsx
 *   this package's root          vendor/pocketjs/tools/build.ts
 *   the composition's project    assets/fonts/Face-Regular.ttf
 *
 * The first two are what make the record independent of where the
 * composition sits. Relative to the repository instead, as this used to be,
 * the entry and the outdir named the composition's path —
 * `compositions/smoke/main.tsx`, `dist/captions-job-Xq3/main.tsx` — so one
 * set of sources staged into two directories was two toolchains. The last two
 * are two roots because an installed package splits what one checkout holds:
 * the compiler is under THIS package (`node_modules/pocket-motion` in a
 * project that installed it) and a face the sidecar names is under the
 * project `buildSpawn` builds from. In this repository they are one
 * directory. The package root comes before the project so the compiler's
 * token reads the same however the package was installed — hoisted, nested
 * or global.
 */
function relativise(token: string, anchors: readonly string[]): string {
  const eq = token.indexOf("=");
  if (token.startsWith("--") && eq > 0) {
    return `${token.slice(0, eq)}=${relativise(token.slice(eq + 1), anchors)}`;
  }
  if (!isAbsolute(token)) return token;
  for (const anchor of anchors) {
    const rel = relative(anchor, token);
    if (rel === "") return ".";
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  return token;
}

/** Every `patches/*.patch`, sorted, by sha256. */
export async function patchDigests(): Promise<PatchDigest[]> {
  const dir = join(ROOT, "patches");
  const names = (
    await Array.fromAsync(new Bun.Glob("*.patch").scan({ cwd: dir }))
  ).sort();
  const out: PatchDigest[] = [];
  for (const file of names) {
    const bytes = await Bun.file(join(dir, file)).arrayBuffer();
    out.push({
      file,
      sha256: new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex"),
    });
  }
  return out;
}

/**
 * What a build running right now would record, written into `outDir`.
 * `anchors` are the composition's directory and project; see `relativise`.
 */
export async function currentBuildRecord(
  argv: readonly string[],
  outDir: string,
  anchors: RecordAnchors = {},
): Promise<BuildRecord> {
  const order = [
    resolve(outDir),
    ...(anchors.compositionDir ? [resolve(anchors.compositionDir)] : []),
    ROOT,
    resolve(anchors.projectRoot ?? ROOT),
  ];
  return {
    bun: Bun.version,
    upstream: UPSTREAM.commit,
    patches: await patchDigests(),
    argv: argv.map((token) => relativise(token, order)),
  };
}

/** Write the record into a build's `--outdir`. Returns what was written. */
export async function writeBuildRecord(
  outDir: string,
  argv: readonly string[],
  anchors: RecordAnchors = {},
): Promise<BuildRecord> {
  const record = await currentBuildRecord(argv, outDir, anchors);
  await Bun.write(join(outDir, BUILD_RECORD_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** The `--outdir` of a build argv, or null when it names none. */
export function outDirOf(argv: readonly string[]): string | null {
  for (const token of argv) {
    if (token.startsWith("--outdir=")) return token.slice("--outdir=".length);
  }
  return null;
}

function isRecord(v: unknown): v is BuildRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.bun === "string" &&
    typeof r.upstream === "string" &&
    Array.isArray(r.patches) &&
    r.patches.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as PatchDigest).file === "string" &&
        typeof (p as PatchDigest).sha256 === "string",
    ) &&
    Array.isArray(r.argv) &&
    r.argv.every((a) => typeof a === "string")
  );
}

/** The record beside `bundlePath`, or null when there is none to read. */
export async function readBuildRecord(bundlePath: string): Promise<BuildRecord | null> {
  const path = buildRecordPath(bundlePath);
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = await Bun.file(path).json();
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The first difference between a recorded patch set and the one on disk, as a
 * sentence, or null when they agree.
 */
function patchDrift(
  recorded: readonly PatchDigest[],
  disk: readonly PatchDigest[],
): string | null {
  const byName = new Map(disk.map((p) => [p.file, p.sha256]));
  for (const p of recorded) {
    const now = byName.get(p.file);
    if (now === undefined) return `${p.file} is no longer in patches/`;
    if (now !== p.sha256) {
      return `${p.file} has changed since (recorded ${p.sha256.slice(0, 12)}, on disk ${now.slice(0, 12)})`;
    }
  }
  const recordedNames = new Set(recorded.map((p) => p.file));
  for (const p of disk) {
    if (!recordedNames.has(p.file)) return `${p.file} was added to patches/ since`;
  }
  return null;
}

export class BuildRecordError extends Error {}

/**
 * The record beside `bundlePath`, or a `BuildRecordError` naming what to do.
 *
 * `buildCommand` is quoted back the way `assertBakedTickRate` quotes it, plus
 * the CLI command that records — `tools/build.ts` is upstream's and writes no
 * record, so telling someone to re-run it alone would be a loop.
 */
export async function assertBuildRecord(options: {
  readonly bundlePath: string;
  readonly compositionDir?: string;
  readonly buildCommand?: string;
}): Promise<BuildRecord> {
  const { bundlePath, buildCommand } = options;
  // The CLI command when there is a composition to name, and upstream's raw
  // one only when there is not: `tools/build.ts` writes no record, so printing
  // it as the fix for a missing record would be a loop.
  const rebuild = options.compositionDir
    ? `\n  bun src/cli/main.ts build ${relative(ROOT, options.compositionDir) || options.compositionDir}`
    : buildCommand
      ? `\n  ${buildCommand}`
      : "";

  const record = await readBuildRecord(bundlePath);
  if (!record) {
    throw new BuildRecordError(
      `PocketJS Motion: no readable ${BUILD_RECORD_FILE} beside ${bundlePath}, so the Bun, the ` +
        "upstream commit and the patches that produced it cannot be read. Upstream's " +
        "tools/build.ts writes no record; a build through this CLI does. Rebuild with:" +
        rebuild,
    );
  }
  if (record.bun !== Bun.version) {
    throw new BuildRecordError(
      `PocketJS Motion: ${bundlePath} was built by Bun ${record.bun}; this process is Bun ` +
        `${Bun.version}. The guest executes on the running one while the bundle and pak came ` +
        "out of the recorded one, and a Bun change has moved pixels with the tracked source " +
        "held fixed. Rebuild:" +
        rebuild,
    );
  }
  const drift = patchDrift(record.patches, await patchDigests());
  if (drift !== null) {
    throw new BuildRecordError(
      `PocketJS Motion: ${bundlePath} was built against a different patch set — ${drift}. The ` +
        "compiler that baked the pak was built from those files. Re-vendor and rebuild:\n" +
        "  bun scripts/vendor.ts" +
        rebuild,
    );
  }
  return record;
}
