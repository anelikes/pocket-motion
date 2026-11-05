/**
 * A film rendered in pieces, and the join that makes it one file again.
 *
 * A SEGMENT is frames `first..last` of a film, rendered by `render --range`
 * (`render()` with `range`: every earlier frame folded, none drawn), encoded
 * on its own, and written with a manifest beside it: its frame hashes, the
 * input identity it was rendered under, and the encoder argv that wrote it.
 * `concat` and `render --workers` join segments through this module, and the
 * join claims three things, each from something it examined:
 *
 * 1. **The segments are one film.** One identity — the composition's, where
 *    the caller can compute it — one hash algorithm, one encoder argv, and
 *    their ranges cover `[0, filmFrames)` with no gap and no overlap
 *    (`planJoin`, pure, so each refusal is testable without a render).
 * 2. **The film digest.** The segments' frame hashes, in film order, folded
 *    by `FrameHashSequence` — the digest `trace` reports for the same
 *    identity, because a segment's hashes are taken where `trace`'s are.
 *    That equality is held by `tests/segments.test.ts` rather than argued.
 * 3. **The joined file holds the segments' frames.** After a stream copy the
 *    file is read back: one packet per frame, decode timestamps increasing,
 *    a keyframe where each segment starts, presentation timestamps exactly
 *    `i / fps`, and every decoded frame equal to the frame that segment
 *    decodes to on its own (`verifyJoin`). Encoded bytes are not compared
 *    with a one-shot render's and are not equal to them: x264's rate control
 *    and GOP placement see a segment's frames only. The pixels BEFORE the
 *    encoder are what claim 2 is about.
 *
 * WHAT A STREAM COPY NEEDS, MEASURED (ffmpeg 8.0, 2026-11-05):
 *
 * - Each segment is an independent encode, so its first frame is an IDR
 *   (x264), a keyframe (VP9) or intra (ProRes), and no frame refers across
 *   a boundary. Nothing needs pre-roll: no codec here refers to a frame
 *   before the one the encoder was handed first. The check after the join
 *   reads the keyframe flag at every segment start rather than trusting it.
 * - libx264 at `medium` writes a two-frame reorder delay (first dts at
 *   pts − 2 frames) for a segment of three or more frames, and none for one
 *   or two. A one-frame segment after a long one made the concat demuxer
 *   print "Non-monotonic DTS … changing to …" and rewrite the timestamps.
 *   So the delay is measured per segment and a set that disagrees is
 *   refused; `splitRange` never makes a segment shorter than
 *   `MIN_SEGMENT_FRAMES`.
 * - The concat demuxer offsets each file by the one before's container
 *   duration, and two containers round it. An x264 MP4's passes through its
 *   edit list and can come out short — a 26-frame segment of synthetic frames
 *   at 30 fps read 13302 ticks of 1/15360 where its frames span 13312, a
 *   25-frame one exactly 12800 — and the joined frames after a short one came
 *   out early. The read-back below found it on 5 of the 42 ledger
 *   compositions at `--workers 4`, every one a split into unequal segments.
 *   So every file's duration is written into the list from its frame count.
 *   That is enough for MP4 and MOV, whose 1/15360 holds a frame of 30 or 60
 *   fps exactly. Matroska stores milliseconds: a 31-frame segment lasts
 *   1033.3 ms, and 39 of 90 joined timestamps came out 1 ms early against a
 *   one-shot encode. WebM is joined with its timestamps rewritten from the
 *   packet index (`setts=ts=round(N/(fps*TB))`, VP9 packets being one per
 *   frame in display order), which made all 90 equal to the one-shot's.
 * - VP9's alpha survives the copy: the AlphaMode element is carried and
 *   libvpx decodes `yuva420p` from the joined file, so the decoded-frame
 *   comparison below covers the alpha plane.
 */

import { copyFileSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { InputIdentity } from "./identity.ts";
import { FrameHashSequence, type FrameHash, type HashAlgorithm } from "./hash.ts";
import { ffmpegArgs, isOutputFormat, type EncodeOptions, type OutputFormat } from "./encode.ts";

export const SEGMENT_KIND = "pocket-motion/segment";
export const SEGMENT_VERSION = 1;

/** The placeholder a manifest writes where the encoder argv names its output. */
export const OUTPUT_PLACEHOLDER = "<out>";

/**
 * The shortest segment `splitRange` makes. libx264 `medium` writes its
 * reorder delay from the third frame on (measured at 30 and 60 fps); a
 * shorter segment carries none, and `planJoin`'s measured check refuses it
 * after a longer one. The rule here only keeps `--workers` from making one.
 */
export const MIN_SEGMENT_FRAMES = 3;

export interface SegmentManifest {
  readonly kind: typeof SEGMENT_KIND;
  readonly version: typeof SEGMENT_VERSION;
  readonly compositionId: string;
  /** Film frame numbers, both inclusive. */
  readonly first: number;
  readonly last: number;
  /** The film this is a piece of — part of `identity`, written out for the coverage check. */
  readonly filmFrames: number;
  readonly fps: number;
  readonly format: OutputFormat;
  readonly alpha: boolean;
  readonly hash: HashAlgorithm;
  readonly identity: InputIdentity;
  /** One per frame, `first` to `last`. */
  readonly frameHashes: readonly FrameHash[];
  /** The smallest alpha byte in these frames, when the format measures one. */
  readonly alphaFloor?: number;
  /**
   * `ffmpegArgs` of the encode, its output path written as `<out>`, and the
   * first line of `ffmpeg -version`. Both null for `png-seq`, which runs no
   * ffmpeg.
   */
  readonly encoder: { readonly argv: readonly string[] | null; readonly ffmpeg: string | null };
  /**
   * The rendered file — or directory, for `png-seq` — by name beside the
   * manifest, so a set of segments moved together still resolves.
   */
  readonly media: { readonly name: string; readonly sha256: string; readonly bytes: number };
}

/** A manifest and the paths it was read from. */
export interface Segment {
  readonly manifestPath: string;
  readonly mediaPath: string;
  readonly manifest: SegmentManifest;
}

/** `<out>.segment.json`, beside the segment's file or directory. */
export function segmentManifestPath(out: string): string {
  return `${out}.segment.json`;
}

/** Contiguous ranges, remainder spread over the first few, none shorter than `minFrames`. */
export function splitRange(
  frames: number,
  workers: number,
  minFrames = 1,
): Array<[start: number, end: number]> {
  const most = Math.max(1, Math.floor(frames / Math.max(1, minFrames)));
  const n = Math.max(1, Math.min(workers, frames, most));
  const base = Math.floor(frames / n);
  const extra = frames % n;
  const out: Array<[number, number]> = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push([at, at + size]);
    at += size;
  }
  return out;
}

/**
 * The encoder argv a manifest records: what `render()` reported it asked
 * the encode leg for, with the output path replaced so two segments written
 * to two names compare equal.
 */
export function recordedEncoderArgv(encode: Omit<EncodeOptions, "outputPath">): string[] {
  return ffmpegArgs({ ...encode, outputPath: OUTPUT_PLACEHOLDER });
}

/**
 * sha256 of a segment's media. A file hashes as its bytes; a `png-seq`
 * directory as one line per PNG, `<name> <sha256>`, in name order — so a
 * directory with a frame added, removed, renamed or rewritten hashes
 * differently.
 */
export async function mediaDigest(path: string): Promise<{ sha256: string; bytes: number }> {
  const st = statSync(path);
  if (!st.isDirectory()) {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()));
    return { sha256: hasher.digest("hex"), bytes: st.size };
  }
  const lines: string[] = [];
  let bytes = 0;
  for (const name of readdirSync(path).sort()) {
    const data = new Uint8Array(await Bun.file(join(path, name)).arrayBuffer());
    bytes += data.length;
    lines.push(`${name} ${new Bun.CryptoHasher("sha256").update(data).digest("hex")}`);
  }
  return { sha256: new Bun.CryptoHasher("sha256").update(lines.join("\n")).digest("hex"), bytes };
}

/** First line of `ffmpeg -version`, or null when it does not run. */
export async function ffmpegVersionLine(): Promise<string | null> {
  try {
    const p = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return code === 0 ? (out.split("\n")[0] ?? "").trim() : null;
  } catch {
    return null;
  }
}

/**
 * Read a segment by its output path or by its manifest path. Throws on a
 * file that is not there or not a segment manifest; the caller turns that
 * into a usage error, because it is the invocation that named it.
 */
export async function readSegment(arg: string): Promise<Segment> {
  const manifestPath = arg.endsWith(".segment.json") ? arg : segmentManifestPath(arg);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `no segment manifest at ${manifestPath} — a segment is what \`render --range <first>..<last> --out <file>\` writes, ` +
        "and its manifest is <file>.segment.json beside it",
    );
  }
  let raw: unknown;
  try {
    raw = await Bun.file(manifestPath).json();
  } catch (e) {
    throw new Error(`${manifestPath} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const problem = manifestProblem(raw);
  if (problem) throw new Error(`${manifestPath} is not a segment manifest: ${problem}`);
  const manifest = raw as SegmentManifest;
  return { manifestPath, mediaPath: join(dirname(manifestPath), manifest.media.name), manifest };
}

function manifestProblem(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const m = raw as Record<string, unknown>;
  if (m.kind !== SEGMENT_KIND) return `kind is ${JSON.stringify(m.kind)}, not ${JSON.stringify(SEGMENT_KIND)}`;
  if (m.version !== SEGMENT_VERSION) return `version ${JSON.stringify(m.version)}; this reads ${SEGMENT_VERSION}`;
  for (const k of ["first", "last", "filmFrames", "fps"]) {
    if (!Number.isInteger(m[k])) return `${k} is not an integer`;
  }
  if (typeof m.format !== "string" || !isOutputFormat(m.format)) return "format is not one this renders";
  if (m.hash !== "sha256" && m.hash !== "fast") return "hash is neither sha256 nor fast";
  const id = m.identity as { digest?: unknown; components?: unknown } | undefined;
  if (typeof id?.digest !== "string" || typeof id.components !== "object" || id.components === null) {
    return "identity has no digest and components";
  }
  if (!Array.isArray(m.frameHashes) || !m.frameHashes.every((h) => typeof h === "string")) {
    return "frameHashes is not a list of strings";
  }
  const media = m.media as { name?: unknown; sha256?: unknown } | undefined;
  if (typeof media?.name !== "string" || typeof media.sha256 !== "string") return "media has no name and sha256";
  if (basename(media.name) !== media.name) return "media.name is not a bare file name";
  return null;
}

export type JoinRefusalCode =
  | "join.identity"
  | "join.gap"
  | "join.overlap"
  | "join.encoding"
  | "join.frames"
  | "join.media"
  | "join.bitstream";

export interface JoinRefusal {
  readonly code: JoinRefusalCode;
  readonly message: string;
}

function label(s: Segment): string {
  return `${basename(s.mediaPath)} (frames ${s.manifest.first}..${s.manifest.last})`;
}

/** Which identity components differ, by name. */
export function identityDifference(a: InputIdentity, b: InputIdentity): string[] {
  const keys = new Set([...Object.keys(a.components), ...Object.keys(b.components)]);
  return [...keys].sort().filter((k) => a.components[k] !== b.components[k]);
}

/**
 * Everything about a set of segments that can be refused before a byte is
 * joined: their identity (against each other, and against `expected` when the
 * caller computed the composition's), how they were hashed and encoded, how
 * many hashes each holds, and whether their ranges cover the film exactly
 * once. Pure — no file is read — so `tests/segments.test.ts` drives every
 * refusal against manifests it writes, and against real ones.
 */
export function planJoin(
  segments: readonly Segment[],
  expected?: { readonly identity?: InputIdentity; readonly filmFrames?: number },
): { ok: true; ordered: Segment[] } | { ok: false; refusals: JoinRefusal[] } {
  const refusals: JoinRefusal[] = [];
  if (segments.length === 0) {
    return { ok: false, refusals: [{ code: "join.gap", message: "no segments" }] };
  }
  const ordered = [...segments].sort(
    (a, b) => a.manifest.first - b.manifest.first || a.manifest.last - b.manifest.last,
  );
  const ref = ordered[0]!;

  for (const s of ordered.slice(1)) {
    if (s.manifest.identity.digest !== ref.manifest.identity.digest) {
      refusals.push({
        code: "join.identity",
        message:
          `${label(s)} was rendered under identity ${s.manifest.identity.digest.slice(0, 12)}, ` +
          `${label(ref)} under ${ref.manifest.identity.digest.slice(0, 12)}; they differ in ` +
          `${identityDifference(ref.manifest.identity, s.manifest.identity).join(", ")}. ` +
          "Pieces of two inputs are not one film.",
      });
    }
  }
  if (expected?.identity && ref.manifest.identity.digest !== expected.identity.digest) {
    refusals.push({
      code: "join.identity",
      message:
        `the segments were rendered under identity ${ref.manifest.identity.digest.slice(0, 12)}, and this ` +
        `composition is ${expected.identity.digest.slice(0, 12)}; they differ in ` +
        `${identityDifference(expected.identity, ref.manifest.identity).join(", ")}. ` +
        "Rebuild or re-render so the two agree.",
    });
  }

  const fields: Array<[string, (m: SegmentManifest) => unknown]> = [
    ["format", (m) => m.format],
    ["alpha", (m) => m.alpha],
    ["hash algorithm", (m) => m.hash],
    ["encoder argv", (m) => JSON.stringify(m.encoder.argv)],
    ["ffmpeg", (m) => m.encoder.ffmpeg],
    ["fps", (m) => m.fps],
  ];
  for (const s of ordered.slice(1)) {
    for (const [name, read] of fields) {
      if (read(s.manifest) !== read(ref.manifest)) {
        refusals.push({
          code: "join.encoding",
          message:
            `${label(s)} has ${name} ${String(read(s.manifest))} and ${label(ref)} has ` +
            `${String(read(ref.manifest))}. A stream copy joins bitstreams one configuration ` +
            "wrote, and a digest mixes hashes of one algorithm.",
        });
      }
    }
  }

  for (const s of ordered) {
    const { first, last, frameHashes } = s.manifest;
    if (last < first || frameHashes.length !== last - first + 1) {
      refusals.push({
        code: "join.frames",
        message: `${label(s)} holds ${frameHashes.length} frame hashes for ${last - first + 1} frames`,
      });
    }
  }

  // Segments that disagree here already disagree in identity (`params`
  // holds the frame count), so only the film they all name is compared.
  const film = expected?.filmFrames ?? ref.manifest.filmFrames;
  if (ref.manifest.filmFrames !== film) {
    refusals.push({
      code: "join.identity",
      message: `the segments are pieces of a ${ref.manifest.filmFrames}-frame film; this one has ${film}`,
    });
  }
  let next = 0;
  let prev: Segment | undefined;
  for (const s of ordered) {
    const { first, last } = s.manifest;
    if (first > next) {
      refusals.push({
        code: "join.gap",
        message:
          `frames ${next}..${first - 1} are in no segment` +
          (prev ? ` (between ${label(prev)} and ${label(s)})` : ` (before ${label(s)})`),
      });
    } else if (first < next && prev) {
      refusals.push({
        code: "join.overlap",
        message:
          `frames ${first}..${Math.min(last, next - 1)} are in ${label(prev)} and in ${label(s)}; ` +
          "a frame is joined once",
      });
    }
    if (last + 1 > next) {
      next = last + 1;
      prev = s;
    }
  }
  if (next < film) {
    refusals.push({
      code: "join.gap",
      message: `frames ${next}..${film - 1} are in no segment (after ${prev ? label(prev) : "the last"})`,
    });
  }
  if (next > film) {
    refusals.push({
      code: "join.overlap",
      message: `the segments run to frame ${next - 1}; the film ends at ${film - 1}`,
    });
  }

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, ordered };
}

/** The digest `trace` reports, from the segments' hashes in film order. */
export function filmDigest(ordered: readonly Segment[]): { frames: FrameHash[]; digest: FrameHash } {
  const seq = new FrameHashSequence(ordered[0]?.manifest.hash);
  for (const s of ordered) for (const h of s.manifest.frameHashes) seq.pushHash(h);
  return { frames: [...seq.frames], digest: seq.digest() };
}

/** Each segment's media is on disk and is the bytes its manifest says it rendered. */
export async function checkMedia(ordered: readonly Segment[]): Promise<JoinRefusal[]> {
  const out: JoinRefusal[] = [];
  for (const s of ordered) {
    if (!existsSync(s.mediaPath)) {
      out.push({ code: "join.media", message: `${label(s)}: ${s.mediaPath} is missing` });
      continue;
    }
    const got = await mediaDigest(s.mediaPath);
    if (got.sha256 !== s.manifest.media.sha256) {
      out.push({
        code: "join.media",
        message:
          `${label(s)}: ${s.mediaPath} is not the file its manifest recorded ` +
          `(sha256 ${got.sha256.slice(0, 12)}, recorded ${s.manifest.media.sha256.slice(0, 12)})`,
      });
    }
  }
  return out;
}

interface Proc {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function exec(argv: readonly string[]): Promise<Proc> {
  const p = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

async function execOk(argv: readonly string[]): Promise<string> {
  const r = await exec(argv);
  if (r.code !== 0) {
    throw new Error(`PocketJS Motion: ${argv[0]} exited ${r.code}: ${argv.join(" ")}\n${r.stderr.trim()}`);
  }
  return r.stdout;
}

/** What a stream copy needs to agree between segments, read from each file. */
export interface StreamParameters {
  readonly codec: string;
  readonly profile: string | null;
  readonly pixFmt: string;
  readonly width: number;
  readonly height: number;
  readonly timeBase: string;
  readonly frameRate: string;
  readonly extradata: string | null;
  /** First packet's pts − dts, in the stream's time base: the reorder delay. */
  readonly reorderDelay: number;
}

export async function probeStream(path: string): Promise<StreamParameters> {
  const json = JSON.parse(
    await execOk([
      "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_data_hash", "murmur3",
      "-show_entries",
      "stream=codec_name,profile,pix_fmt,width,height,time_base,r_frame_rate,extradata_hash",
      "-of", "json", path,
    ]),
  ) as { streams?: Array<Record<string, unknown>> };
  const s = json.streams?.[0];
  if (!s) throw new Error(`PocketJS Motion: ${path} has no video stream`);
  const first = (
    await execOk([
      "ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
      "-show_entries", "packet=pts,dts", "-of", "csv=p=0", path,
    ])
  )
    .trim()
    .split("\n")[0]!
    .split(",");
  return {
    codec: String(s.codec_name),
    profile: typeof s.profile === "string" ? s.profile : null,
    pixFmt: String(s.pix_fmt),
    width: Number(s.width),
    height: Number(s.height),
    timeBase: String(s.time_base),
    frameRate: String(s.r_frame_rate),
    extradata: typeof s.extradata_hash === "string" ? s.extradata_hash : null,
    reorderDelay: Number(first[0]) - Number(first[1]),
  };
}

/**
 * Refuse a set whose bitstreams a stream copy cannot join as one: a
 * different codec, picture, time base or parameter set, or — measured above
 * — a different reorder delay.
 */
export function bitstreamRefusals(
  ordered: readonly Segment[],
  params: readonly StreamParameters[],
): JoinRefusal[] {
  // Pairwise at each boundary, because a boundary is where a stream copy
  // breaks: one odd segment is one refusal, wherever it sits.
  const out: JoinRefusal[] = [];
  for (let i = 1; i < params.length; i++) {
    const p = params[i]!;
    const prev = params[i - 1]!;
    for (const key of Object.keys(prev) as Array<keyof StreamParameters>) {
      if (p[key] === prev[key]) continue;
      const why =
        key === "reorderDelay"
          ? " — libx264 writes its reorder delay only for a segment of three or more frames, and a " +
            "stream copy across two delays leaves the demuxer rewriting decode timestamps"
          : "";
      out.push({
        code: "join.bitstream",
        message:
          `at the join of ${label(ordered[i - 1]!)} and ${label(ordered[i]!)}: ${key} ` +
          `${String(prev[key])} then ${String(p[key])}${why}`,
      });
    }
  }
  return out;
}

/**
 * Every refusal, then the join — the sequence `concat` and `render --workers`
 * both run. `hash` is the algorithm the caller asked for, if it asked; the
 * segments' own is what their hashes are, so a request for another is refused
 * rather than answered with a digest of the wrong kind.
 */
export async function checkAndJoin(
  segments: readonly Segment[],
  expected: { readonly identity?: InputIdentity; readonly filmFrames: number; readonly hash?: HashAlgorithm },
  outputPath: string,
): Promise<
  | {
      ok: true;
      ordered: Segment[];
      report: JoinReport;
      frames: FrameHash[];
      digest: FrameHash;
      alphaFloor?: number;
    }
  | { ok: false; refusals: JoinRefusal[] }
> {
  const plan = planJoin(segments, expected);
  if (!plan.ok) return plan;
  const { ordered } = plan;
  const hash = ordered[0]!.manifest.hash;
  if (expected.hash !== undefined && expected.hash !== hash) {
    return {
      ok: false,
      refusals: [
        {
          code: "join.encoding",
          message: `--hash ${expected.hash} was asked for, and the segments' frames were hashed with ${hash}`,
        },
      ],
    };
  }
  const media = await checkMedia(ordered);
  if (media.length > 0) return { ok: false, refusals: media };
  if (ordered[0]!.manifest.format !== "png-seq") {
    const params = await Promise.all(ordered.map((s) => probeStream(s.mediaPath)));
    const bits = bitstreamRefusals(ordered, params);
    if (bits.length > 0) return { ok: false, refusals: bits };
  }
  const report = await joinSegments(ordered, outputPath);
  const floors = ordered.map((s) => s.manifest.alphaFloor).filter((a): a is number => a !== undefined);
  return {
    ok: true,
    ordered,
    report,
    ...filmDigest(ordered),
    ...(floors.length === ordered.length ? { alphaFloor: Math.min(...floors) } : {}),
  };
}

/** How the joined file was made and what reading it back found. */
export interface JoinReport {
  /** `stream copy` for the ffmpeg formats, `file copy` for `png-seq`. */
  readonly method: "stream copy" | "file copy";
  readonly segments: number;
  readonly frames: number;
  /** Every check below held; the join throws when one does not. */
  readonly verified: readonly string[];
}

function quoteConcat(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * Join planned, media-checked segments into `outputPath` and read the result
 * back. Throws when the read-back disagrees with the segments — a join this
 * module made and cannot vouch for is not delivered as if it could be.
 */
export async function joinSegments(
  ordered: readonly Segment[],
  outputPath: string,
): Promise<JoinReport> {
  const { format, fps, filmFrames } = ordered[0]!.manifest;
  if (format === "png-seq") return joinPngSequence(ordered, outputPath, filmFrames);

  // Each file's duration is stated from its frame count rather than read off
  // its container: the demuxer offsets the next file by it, and an MP4's
  // passes through its edit list, which can leave it short of the frames (see
  // the header). Microseconds of the cumulative boundary, so rounding never
  // adds up.
  const us = (frame: number) => Math.round((frame * 1_000_000) / fps);
  const list = `${outputPath}.concat.txt`;
  await Bun.write(
    list,
    ordered
      .map((s) => {
        const d = us(s.manifest.last + 1) - us(s.manifest.first);
        return `file ${quoteConcat(s.mediaPath)}\nduration ${d}us\n`;
      })
      .join(""),
  );
  try {
    await execOk([
      "ffmpeg", "-y", "-v", "error",
      "-f", "concat", "-safe", "0", "-i", list,
      "-map", "0:v:0", "-c", "copy",
      ...(format === "webm" ? ["-bsf:v", `setts=ts=round(N/(${fps}*TB))`] : []),
      "-fflags", "+bitexact", "-f", format, outputPath,
    ]);
  } finally {
    rmSync(list, { force: true });
  }
  return { method: "stream copy", segments: ordered.length, frames: filmFrames, verified: await verifyJoin(ordered, outputPath) };
}

/** `-f framehash` of every decoded frame. libvpx for VP9, so the alpha plane is decoded too. */
async function decodedFrameHashes(path: string, format: OutputFormat): Promise<string[]> {
  const out = await execOk([
    "ffmpeg", "-v", "error",
    ...(format === "webm" ? ["-c:v", "libvpx-vp9"] : []),
    "-i", path, "-map", "0:v:0", "-f", "framehash", "-hash", "murmur3", "-",
  ]);
  return out
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.slice(l.lastIndexOf(",") + 1).trim());
}

async function verifyJoin(ordered: readonly Segment[], outputPath: string): Promise<string[]> {
  const { format, fps, filmFrames } = ordered[0]!.manifest;
  const fail = (what: string): never => {
    throw new Error(`PocketJS Motion: the joined file ${outputPath} ${what}`);
  };
  const [joined, parts, tb, packets] = await Promise.all([
    decodedFrameHashes(outputPath, format),
    Promise.all(ordered.map((s) => decodedFrameHashes(s.mediaPath, format))),
    execOk([
      "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=time_base",
      "-of", "csv=p=0", outputPath,
    ]),
    execOk([
      "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts,dts,flags",
      "-of", "csv=p=0", outputPath,
    ]),
  ]);

  const rows = packets
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const [pts, dts, flags] = l.split(",");
      return { pts: Number(pts), dts: Number(dts), key: (flags ?? "").startsWith("K") };
    });
  if (rows.length !== filmFrames) fail(`has ${rows.length} packets for ${filmFrames} frames`);
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i]!.dts > rows[i - 1]!.dts)) fail(`has decode timestamp ${rows[i]!.dts} after ${rows[i - 1]!.dts} at packet ${i}`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.dts > rows[i]!.pts) fail(`decodes packet ${i} after it is presented (dts ${rows[i]!.dts} > pts ${rows[i]!.pts})`);
  }
  for (const s of ordered) {
    if (!rows[s.manifest.first]!.key) fail(`has no keyframe where ${label(s)} starts`);
  }
  const [num, den] = tb.trim().split("/").map(Number) as [number, number];
  const pts = rows.map((r) => r.pts).sort((a, b) => a - b);
  for (let i = 0; i < pts.length; i++) {
    const want = Math.round((i * den) / (fps * num));
    if (pts[i] !== want) fail(`presents frame ${i} at ${pts[i]} (time base ${num}/${den}); ${i}/${fps} s is ${want}`);
  }

  if (joined.length !== filmFrames) fail(`decodes to ${joined.length} frames, not ${filmFrames}`);
  let at = 0;
  for (let k = 0; k < ordered.length; k++) {
    const part = parts[k]!;
    const s = ordered[k]!;
    if (part.length !== s.manifest.last - s.manifest.first + 1) {
      fail(`was joined from ${label(s)}, which decodes to ${part.length} frames on its own`);
    }
    for (let i = 0; i < part.length; i++, at++) {
      if (joined[at] !== part[i]) fail(`decodes frame ${at} differently from ${label(s)} on its own`);
    }
  }

  return [
    `${filmFrames} packets, decode timestamps increasing, none presented before it is decoded`,
    `a keyframe at each of ${ordered.length} segment starts`,
    `presentation timestamps exactly i/${fps} s in time base ${num}/${den}`,
    `all ${filmFrames} decoded frames equal to the segments' own decodes, in order`,
  ];
}

async function joinPngSequence(
  ordered: readonly Segment[],
  outputPath: string,
  filmFrames: number,
): Promise<JoinReport> {
  mkdirSync(outputPath, { recursive: true });
  if (readdirSync(outputPath).length > 0) {
    throw new Error(`PocketJS Motion: ${outputPath} is not empty; png-seq joins into an empty directory`);
  }
  for (const s of ordered) {
    for (const name of readdirSync(s.mediaPath).sort()) {
      // A clone where the volume can make one (APFS), a copy where it cannot.
      copyFileSync(join(s.mediaPath, name), join(outputPath, name), fsConstants.COPYFILE_FICLONE);
    }
  }
  const names = readdirSync(outputPath).sort();
  const want = Array.from({ length: filmFrames }, (_, i) => `${String(i).padStart(6, "0")}.png`);
  if (names.length !== want.length || names.some((n, i) => n !== want[i])) {
    throw new Error(
      `PocketJS Motion: the joined directory ${outputPath} holds ${names.length} files; ` +
        `a ${filmFrames}-frame film is 000000.png..${want.at(-1)}`,
    );
  }
  // Read back, a segment's frames at a time, hashed the way `mediaDigest`
  // hashed that segment's own directory.
  for (const s of ordered) {
    const lines: string[] = [];
    for (let f = s.manifest.first; f <= s.manifest.last; f++) {
      const data = new Uint8Array(await Bun.file(join(outputPath, want[f]!)).arrayBuffer());
      lines.push(`${want[f]} ${new Bun.CryptoHasher("sha256").update(data).digest("hex")}`);
    }
    const got = new Bun.CryptoHasher("sha256").update(lines.join("\n")).digest("hex");
    if (got !== s.manifest.media.sha256) {
      throw new Error(`PocketJS Motion: the joined directory ${outputPath} does not hold ${label(s)}'s frames`);
    }
  }
  return {
    method: "file copy",
    segments: ordered.length,
    frames: filmFrames,
    verified: [
      `${filmFrames} PNGs named 000000..${String(filmFrames - 1).padStart(6, "0")}`,
      `each segment's frames read back equal to the bytes its manifest recorded`,
    ],
  };
}
