/**
 * Input identity — everything that can move a pixel, hashed into one value.
 *
 * The determinism claim is "same input, same frames on any machine". That is
 * only meaningful if "input" is defined exhaustively, so this is the definition:
 * anything absent here is something we are implicitly asserting cannot change
 * the output. `DELIBERATELY_ABSENT` is that assertion, written down.
 *
 * The toolchain is here because it can move a pixel: four delivered cuts
 * rebuilt to different digests after a Bun change with the tracked source
 * held fixed. ffmpeg's version is not, and the two facts do not conflict.
 * Decoding happens at ingest and its result is hashed as an artifact
 * (`src/footage/ingest.ts`); the render path holds no decoder and the encoder
 * runs after the frames are already hashed. ffmpeg is recorded on the ingest
 * manifest for provenance. The toolchain is recorded here because it is on the
 * path that produces the pak and executes the guest — there is no hashed
 * artifact in front of it.
 *
 * IT IS THE RECORDED TOOLCHAIN, NOT THE RUNNING ONE. `toolchain` used to be
 * `Bun.version` read out of this process, which answers "what is here now"
 * rather than "what made this" — and the two are the same only because
 * `resolveComposition` refuses a bundle whose `build.json` names another Bun
 * (`src/render/build-record.ts`). So the component now hashes what that file
 * says: the Bun, the upstream commit, every `patches/*.patch` by content, and
 * the build argv — which is where `--hz` and `--density` are written down.
 * A pak baked by a different compiler is a different input whether or not the
 * bundle bytes differ, and before this nothing said which compiler that was.
 *
 * `Bun.revision` is not a component. It is the compile-time git sha, not
 * the release: the official `bun-v1.3.11` tag is commit `a04817ce`, and
 * this binary's `Bun.revision` is its parent `af24e281` (one test-only
 * commit sits between them). The same version number does not name one
 * revision, so hashing it would make identity a function of how Bun was
 * obtained.
 */

import { canonicalise } from "../manifest/sidecar.ts";
import { readBuildRecord, type BuildRecord } from "./build-record.ts";

export interface IdentityInputs {
  /** The built guest bundle. */
  readonly bundlePath: string;
  /** The asset pak: style table, font atlases, baked timelines, images. */
  readonly pakPath?: string;
  /**
   * `pocket-motion.json`, canonicalised from `identityProjection` — see
   * `sidecarCanonicalOf`. A raw `canonicalise(sidecar)` would let a future
   * `sound` key into a digest whose frames it cannot change.
   */
  readonly sidecarCanonical?: string;
  /** Font files the atlases were baked from. */
  readonly fontPaths?: readonly string[];
  /** Frozen footage artifacts (ingest output), by track id. */
  readonly footageHashes?: Readonly<Record<string, string>>;
  /** Viewport and rate — different values are a different render. */
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationFrames: number;
  readonly renderScale?: number;
  readonly rasterDensity?: number;
  /**
   * What built the bundle, from `build.json` beside it. Required: the
   * toolchain has moved pixels with the tracked source held fixed, and the
   * artifact is the only thing that can say which one produced it.
   */
  readonly buildRecord: BuildRecord;
}

export interface InputIdentity {
  /** The single value to compare across machines. */
  readonly digest: string;
  /** Per-component digests, so a mismatch says *what* changed. */
  readonly components: Readonly<Record<string, string>>;
}

/**
 * Inputs deliberately excluded from identity, each with the reason it cannot
 * move a pixel. An entry here is a claim the test suite proves, not a note.
 */
export const DELIBERATELY_ABSENT = [
  {
    what: "the ffmpeg build",
    why: "decoding happens at ingest and its result is hashed as an artifact; the render path holds no decoder and the encoder runs after the frames are hashed",
  },
  {
    what: "sound",
    why: "audio is a separate mux pass and the frame hash never opens an audio file; a sound declaration changes the delivery, never a pixel",
  },
  {
    what: "the wall clock",
    why: "the guest realm poisons Date, Date.now, performance, and the timer functions; touching one throws",
  },
  {
    what: "the locale",
    why: "the guest realm poisons Intl and every toLocale*/localeCompare method; the render formats nothing from the host locale",
  },
  {
    what: "the machine's installed fonts",
    why: "faces are either declared as repo-relative paths in the sidecar or the build's default; the guest never reads the system font directory",
  },
  {
    what: "where the checkout sits on disk",
    why: "`build.json` records the build argv repo-relative, so the same build under two directories is one toolchain component; an absolute path is a property of the machine and would make identity disagree across machines for the one reason it exists to rule out",
  },
  {
    what: "when the build ran",
    why: "`build.json` records no timestamp; two builds of the same inputs write the same record, and a clock reading cannot move a pixel",
  },
  {
    what: "`layoutAllow` and `assertions`",
    why: "both are read by the commands that INSPECT a rendered frame and by nothing that produces one; the render never opens either key, so excusing a finding about a film, or asserting something about it, cannot change the film",
  },
] as const;

/**
 * Keys the sidecar carries that the render never opens.
 *
 * `canonicalise()` serialises every own key, and the parser MATERIALISES
 * defaults — so a key added to the schema appears in every parsed sidecar in
 * the tree, present in the file or not, and would move the identity of every
 * composition here without moving one pixel. Each entry is in
 * `DELIBERATELY_ABSENT` with the reason it cannot.
 */
const NOT_IN_IDENTITY = new Set(["sound", "layoutAllow", "assertions"]);

/**
 * The sidecar as identity hashes it. Drops the keys above whether or not they
 * are present: a sound block left in would change the identity of a render
 * whose frames are byte-identical, and so would an assertion about one.
 */
export function identityProjection(sidecar: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sidecar)) {
    if (NOT_IN_IDENTITY.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Canonical form of the sound-free projection — what `sidecarCanonical` is. */
export function sidecarCanonicalOf(sidecar: object): string {
  return canonicalise(identityProjection(sidecar));
}

/**
 * The toolchain component's inputs, read off the artifact.
 *
 * Every command that renders has already been handed this by
 * `resolveComposition`; this is for the callers that hold only a bundle path.
 * It throws rather than falling back to the running process: a render whose
 * toolchain is unknown is exactly what the record exists to stop.
 */
export async function recordedToolchain(
  bundlePath: string,
): Promise<Pick<IdentityInputs, "buildRecord">> {
  const buildRecord = await readBuildRecord(bundlePath);
  if (!buildRecord) {
    throw new Error(
      `PocketJS Motion: no build.json beside ${bundlePath}; input identity has no toolchain to hash`,
    );
  }
  return { buildRecord };
}

async function fileDigest(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function textDigest(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function sortedComponents(components: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(components).sort()) {
    out[key] = components[key]!;
  }
  return out;
}

export async function computeIdentity(inputs: IdentityInputs): Promise<InputIdentity> {
  const components: Record<string, string> = {};

  components["bundle"] = await fileDigest(inputs.bundlePath);
  if (inputs.pakPath) components["pak"] = await fileDigest(inputs.pakPath);
  if (inputs.sidecarCanonical) components["sidecar"] = textDigest(inputs.sidecarCanonical);

  for (const font of inputs.fontPaths ?? []) {
    components[`font:${font.slice(font.lastIndexOf("/") + 1)}`] = await fileDigest(font);
  }
  for (const [id, hash] of Object.entries(inputs.footageHashes ?? {})) {
    components[`footage:${id}`] = hash;
  }

  // Render parameters are inputs too: the same bundle at a different viewport is
  // a different picture.
  components["params"] = textDigest(
    JSON.stringify({
      width: inputs.width,
      height: inputs.height,
      fps: inputs.fps,
      durationFrames: inputs.durationFrames,
      renderScale: inputs.renderScale ?? 1,
      rasterDensity: inputs.rasterDensity ?? 1,
    }),
  );

  components["toolchain"] = textDigest(
    JSON.stringify({
      bun: inputs.buildRecord.bun,
      upstream: inputs.buildRecord.upstream,
      patches: inputs.buildRecord.patches.map((p) => `${p.file}:${p.sha256}`),
      argv: inputs.buildRecord.argv,
    }),
  );

  // Sorted so the digest does not depend on insertion order.
  const digest = textDigest(
    Object.keys(components)
      .sort()
      .map((k) => `${k}=${components[k]}`)
      .join("\n"),
  );
  return { digest, components: sortedComponents(components) };
}
