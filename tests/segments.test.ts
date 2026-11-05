/**
 * A film rendered in pieces and joined is the film rendered whole.
 *
 * `render --range` renders a segment — every earlier frame folded, none
 * drawn — and `concat` joins segments into one film; `render --workers N` is
 * N of the first and one of the second on one machine. The claim is at the
 * level this project's determinism claim lives at: the frames before the
 * encoder. Three segments of `compositions/sound-roles` joined are held to
 * `trace`, hash for hash, and to a one-shot render's digest. That
 * composition is chosen because it folds through the most host state a
 * segment has to reproduce: a footage track presented every frame, and a
 * declared mix that must be muxed once over the joined film and never into
 * a segment.
 *
 * Each refusal is held twice: `planJoin` against manifests written here,
 * so every branch is reached without a render, and the CLI against real
 * segments, so the wiring is. RED, each seen 2026-11-05 by deleting the check
 * named and re-running this file:
 *
 * - the identity comparison between segments → "join.identity" cases fail;
 * - the gap branch of the coverage walk → both "join.gap" cases fail;
 * - the overlap branch → both "join.overlap" cases fail;
 * - `bitstreamRefusals` → the two-frame segment is joined, and
 *   "join.bitstream" fails;
 * - the WebM `setts` rewrite → the join's own read-back throws (1 ms early
 *   from the first segment that is not a whole number of milliseconds) and
 *   the webm case fails;
 * - the concat list's `duration` lines → the `gradients` mp4 case fails, on
 *   this machine: whether an x264 segment's edit list comes out short is a
 *   property of its bitstream, and libx264's bitstream of its thread count;
 * - `render()` treating `start` itself as folded → every case that renders
 *   a segment fails;
 * - the frame boundary skipped for folded frames, so footage is presented
 *   from `start` on → the footage-tracks case fails, and the sound-roles
 *   cases do not: nothing in sound-roles is drawn outside its track's window.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  MIN_SEGMENT_FRAMES,
  SEGMENT_KIND,
  SEGMENT_VERSION,
  planJoin,
  splitRange,
  type Segment,
  type SegmentManifest,
} from "../src/render/segment.ts";

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "src/cli/main.ts");
const SOUND_ROLES = "compositions/sound-roles";
const SMOKE = "compositions/smoke";
const GRADIENTS = "compositions/gradients";
const FOOTAGE_TRACKS = "compositions/footage-tracks";
const scratch = mkdtempSync(join(tmpdir(), "motion-segments-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function cli(argv: readonly string[]): Promise<{ code: number; json: Record<string, unknown>; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI, ...argv, "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, json: JSON.parse(stdout) as Record<string, unknown>, stderr };
}

function codes(json: Record<string, unknown>): string[] {
  return ((json.refusals ?? []) as Array<{ code: string }>).map((r) => r.code);
}

async function ffprobe(path: string, entries: string, stream = "v:0"): Promise<string> {
  const p = Bun.spawn(
    ["ffprobe", "-v", "error", "-select_streams", stream, "-show_entries", entries, "-of", "csv=p=0", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  return (await new Response(p.stdout).text()).trim();
}

const IDENTITY = { digest: "a".repeat(64), components: { bundle: "b", params: "p" } };

function fake(first: number, last: number, over: Partial<SegmentManifest> = {}): Segment {
  const manifest: SegmentManifest = {
    kind: SEGMENT_KIND,
    version: SEGMENT_VERSION,
    compositionId: "c",
    first,
    last,
    filmFrames: 90,
    fps: 30,
    format: "mp4",
    alpha: false,
    hash: "sha256",
    identity: IDENTITY,
    frameHashes: Array.from({ length: last - first + 1 }, (_, i) => `h${first + i}`),
    encoder: { argv: ["ffmpeg", "<out>"], ffmpeg: "ffmpeg version 8.0" },
    media: { name: `s${first}.mp4`, sha256: "m", bytes: 1 },
    ...over,
  };
  return { manifestPath: `/x/s${first}.mp4.segment.json`, mediaPath: `/x/s${first}.mp4`, manifest };
}

function refusedWith(segments: Segment[], expected?: Parameters<typeof planJoin>[1]): string[] {
  const plan = planJoin(segments, expected);
  return plan.ok ? [] : plan.refusals.map((r) => r.code);
}

describe("planJoin — each refusal, against manifests written here", () => {
  test("a cover of the film in any order is accepted, in film order", () => {
    const plan = planJoin([fake(60, 89), fake(0, 29), fake(30, 59)], { identity: IDENTITY, filmFrames: 90 });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.ordered.map((s) => s.manifest.first)).toEqual([0, 30, 60]);
  });

  test("join.gap — frames in no segment, inside, at the start and at the end", () => {
    expect(refusedWith([fake(0, 29), fake(60, 89)])).toEqual(["join.gap"]);
    expect(refusedWith([fake(30, 59), fake(60, 89)])).toEqual(["join.gap"]);
    expect(refusedWith([fake(0, 29), fake(30, 59)])).toEqual(["join.gap"]);
  });

  test("join.overlap — a frame in two segments, or past the film's end", () => {
    expect(refusedWith([fake(0, 39), fake(30, 89)])).toEqual(["join.overlap"]);
    expect(refusedWith([fake(0, 29), fake(30, 59), fake(30, 59), fake(60, 89)])).toEqual(["join.overlap"]);
    expect(refusedWith([fake(0, 89, { filmFrames: 80 }), fake(80, 89, { filmFrames: 80 })])).toContain("join.overlap");
  });

  test("join.identity — between segments, and against the composition", () => {
    const other = { digest: "c".repeat(64), components: { bundle: "B", params: "p" } };
    expect(refusedWith([fake(0, 29), fake(30, 59, { identity: other }), fake(60, 89)])).toEqual(["join.identity"]);
    const plan = planJoin([fake(0, 29), fake(30, 89)], { identity: other, filmFrames: 90 });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.refusals.map((r) => r.code)).toEqual(["join.identity"]);
      // A mismatch names what moved, not only that something did.
      expect(plan.refusals[0]!.message).toContain("differ in bundle");
    }
  });

  test("join.encoding — format, hash algorithm and encoder argv", () => {
    expect(refusedWith([fake(0, 29), fake(30, 89, { format: "mov" })])).toEqual(["join.encoding"]);
    expect(refusedWith([fake(0, 29), fake(30, 89, { hash: "fast" })])).toEqual(["join.encoding"]);
    expect(
      refusedWith([fake(0, 29), fake(30, 89, { encoder: { argv: ["ffmpeg", "-crf", "18", "<out>"], ffmpeg: "ffmpeg version 8.0" } })]),
    ).toEqual(["join.encoding"]);
  });

  test("join.frames — a manifest whose hashes do not cover its range", () => {
    expect(refusedWith([fake(0, 29, { frameHashes: ["x"] }), fake(30, 89)])).toEqual(["join.frames"]);
  });

  test("--workers never cuts a segment shorter than libx264 writes its reorder delay for", () => {
    expect(splitRange(90, 3, MIN_SEGMENT_FRAMES)).toEqual([[0, 30], [30, 60], [60, 90]]);
    expect(splitRange(7, 8, MIN_SEGMENT_FRAMES)).toEqual([[0, 4], [4, 7]]);
    expect(splitRange(2, 8, MIN_SEGMENT_FRAMES)).toEqual([[0, 2]]);
    for (let frames = 1; frames < 40; frames++) {
      for (const [a, b] of splitRange(frames, 8, MIN_SEGMENT_FRAMES)) {
        expect(b - a >= Math.min(MIN_SEGMENT_FRAMES, frames)).toBe(true);
      }
    }
  });
});

describe("three segments and a concat are the one-shot render", () => {
  const seg = (a: number, b: number) => join(scratch, `sr-${a}-${b}.mp4`);
  let traced: { frames: string[]; digest: string; identity: { digest: string } };

  test(
    "frame hash for frame hash, and the digest trace and a one-shot render report",
    async () => {
      expect((await cli(["build", SOUND_ROLES])).code).toBe(0);
      const t = await cli(["trace", SOUND_ROLES]);
      expect(t.code).toBe(0);
      traced = t.json as typeof traced;
      expect(traced.frames.length).toBe(180);

      const whole = await cli(["render", SOUND_ROLES, "--out", join(scratch, "whole.mp4")]);
      expect(whole.code).toBe(0);
      expect(whole.json.digest).toBe(traced.digest);

      const ranges: Array<[number, number]> = [[0, 59], [60, 119], [120, 179]];
      for (const [a, b] of ranges) {
        const r = await cli(["render", SOUND_ROLES, "--range", `${a}..${b}`, "--out", seg(a, b)]);
        expect(r.code).toBe(0);
        // A segment is not a film and does not carry a film's digest.
        expect(r.json.digest).toBeUndefined();
        expect((r.json.identity as { digest: string }).digest).toBe(traced.identity.digest);
        expect(r.json.soundDeferred).toBeString();
        const m = JSON.parse(readFileSync(`${seg(a, b)}.segment.json`, "utf8")) as SegmentManifest;
        expect(m.frameHashes).toEqual(traced.frames.slice(a, b + 1));
        // Sound is the joined film's, never a segment's.
        expect(await ffprobe(seg(a, b), "stream=codec_type", "a")).toBe("");
      }

      // Out of order on purpose: the join orders by range, not by argument.
      const joined = await cli([
        "concat", SOUND_ROLES, seg(120, 179), seg(0, 59), `${seg(60, 119)}.segment.json`,
        "--out", join(scratch, "joined.mp4"),
      ]);
      expect(joined.code).toBe(0);
      expect(joined.json.digest).toBe(traced.digest);
      expect(joined.json.identity).toEqual(traced.identity);
      expect((joined.json.join as { method: string }).method).toBe("stream copy");
      expect(joined.json.identityFromSegments).toEqual(["footage:clip"]);
      expect(Number(await ffprobe(join(scratch, "joined.mp4"), "stream=nb_frames"))).toBe(180);
      // The mix went in once, over the whole film.
      expect(await ffprobe(join(scratch, "joined.mp4"), "stream=codec_name", "a")).toBe("aac");
      expect((joined.json.sound as { sha256: string }).sha256).toBe(
        (whole.json.sound as { sha256: string }).sha256,
      );
    },
    900_000,
  );

  test(
    "render --workers 3 is the same film",
    async () => {
      const w = await cli(["render", SOUND_ROLES, "--workers", "3", "--out", join(scratch, "workers.mp4")]);
      expect(w.code).toBe(0);
      expect(w.json.digest).toBe(traced.digest);
      expect(w.json.identity).toEqual(traced.identity);
      expect((w.json.workers as { count: number }).count).toBe(3);
      // The scratch segments are gone; the delivery is the joined file.
      expect(existsSync(join(scratch, "workers.mp4"))).toBe(true);
      expect(
        (await Array.fromAsync(new Bun.Glob(".workers.mp4.segments-*").scan({ cwd: scratch, dot: true }))).length,
      ).toBe(0);
    },
    900_000,
  );

  test(
    "footage presented while folding: footage-tracks --workers 4",
    async () => {
      // A track's tiles hold the last frame presented to them once its
      // window has passed, so a segment that starts after a window has to
      // have presented the frames it folded through. sound-roles never
      // shows a held frame; footage-tracks does, and with the fold skipping
      // its frame boundaries its digest moved (d767fe1b…).
      expect((await cli(["build", FOOTAGE_TRACKS])).code).toBe(0);
      const t = await cli(["trace", FOOTAGE_TRACKS]);
      const w = await cli(["render", FOOTAGE_TRACKS, "--workers", "4", "--out", join(scratch, "tracks.mp4")]);
      expect(w.code).toBe(0);
      expect(w.json.digest).toBe(t.json.digest);
      expect(w.json.identity).toEqual(t.json.identity);
    },
    900_000,
  );

  test("join.gap through the CLI", async () => {
    const r = await cli(["concat", SOUND_ROLES, seg(0, 59), seg(120, 179), "--out", join(scratch, "gap.mp4")]);
    expect(r.code).toBe(1);
    expect(codes(r.json)).toEqual(["join.gap"]);
    expect(existsSync(join(scratch, "gap.mp4"))).toBe(false);
  }, 300_000);

  test(
    "join.overlap through the CLI",
    async () => {
      const extra = join(scratch, "sr-50-69.mp4");
      expect((await cli(["render", SOUND_ROLES, "--range", "50..69", "--out", extra])).code).toBe(0);
      const r = await cli([
        "concat", SOUND_ROLES, seg(0, 59), extra, seg(60, 119), seg(120, 179), "--out", join(scratch, "overlap.mp4"),
      ]);
      expect(r.code).toBe(1);
      expect(codes(r.json)).toEqual(["join.overlap", "join.overlap"]);
    },
    600_000,
  );

  test(
    "join.identity through the CLI: a segment of a 120-frame cut of the same composition",
    async () => {
      const other = join(scratch, "sr120-60-119.mp4");
      expect((await cli(["render", SOUND_ROLES, "--frames", "120", "--range", "60..119", "--out", other])).code).toBe(0);
      const r = await cli(["concat", SOUND_ROLES, seg(0, 59), other, seg(120, 179), "--out", join(scratch, "id.mp4")]);
      expect(r.code).toBe(1);
      expect(codes(r.json)).toEqual(["join.identity"]);
      expect(JSON.stringify(r.json.refusals)).toContain("differ in params");
    },
    600_000,
  );

  test("join.media — a segment edited after its manifest was written", async () => {
    const copy = join(scratch, "edited.mp4");
    writeFileSync(copy, readFileSync(seg(60, 119)));
    const manifest = JSON.parse(readFileSync(`${seg(60, 119)}.segment.json`, "utf8")) as SegmentManifest;
    writeFileSync(`${copy}.segment.json`, JSON.stringify({ ...manifest, media: { ...manifest.media, name: "edited.mp4" } }));
    writeFileSync(copy, Buffer.concat([readFileSync(copy), Buffer.from("x")]));
    const r = await cli(["concat", SOUND_ROLES, seg(0, 59), copy, seg(120, 179), "--out", join(scratch, "media.mp4")]);
    expect(r.code).toBe(1);
    expect(codes(r.json)).toEqual(["join.media"]);
  }, 300_000);

  test(
    "join.bitstream — a two-frame segment carries no reorder delay, and is refused before a join",
    async () => {
      const a = join(scratch, "sr-0-1.mp4");
      const b = join(scratch, "sr-2-59.mp4");
      expect((await cli(["render", SOUND_ROLES, "--range", "0..1", "--out", a])).code).toBe(0);
      expect((await cli(["render", SOUND_ROLES, "--range", "2..59", "--out", b])).code).toBe(0);
      const r = await cli(["concat", SOUND_ROLES, a, b, seg(60, 119), seg(120, 179), "--out", join(scratch, "delay.mp4")]);
      expect(r.code).toBe(1);
      expect(codes(r.json)).toEqual(["join.bitstream"]);
      expect(JSON.stringify(r.json.refusals)).toContain("reorderDelay");
    },
    600_000,
  );
});

describe("every container joins to the film trace reports", () => {
  test(
    "mp4: segments of unequal length, timestamps exactly i/30 s in 1/15360",
    async () => {
      // `gradients` at --workers 4 is 8/8/7/7 frames, and the second 8-frame
      // segment's edit list makes its container 10 ticks short of its frames;
      // offsetting the next by that put frame 16 on at 8182. It is content,
      // not length, that decides it — the first 8-frame segment is exact —
      // which is why this is a composition the ledger sweep found, not a
      // split chosen to be uneven.
      expect((await cli(["build", GRADIENTS])).code).toBe(0);
      const traced = await cli(["trace", GRADIENTS]);
      const out = join(scratch, "gradients.mp4");
      const r = await cli(["render", GRADIENTS, "--workers", "4", "--out", out]);
      expect(r.code).toBe(0);
      expect(r.json.digest).toBe(traced.json.digest);
      const pts = (await ffprobe(out, "packet=pts")).split("\n").map(Number).sort((a, b) => a - b);
      expect(pts).toEqual(Array.from({ length: 30 }, (_, i) => i * 512));
    },
    600_000,
  );

  test(
    "webm: four uneven segments, timestamps exactly i/30 s in milliseconds",
    async () => {
      expect((await cli(["build", SMOKE])).code).toBe(0);
      const traced = await cli(["trace", SMOKE, "--frames", "61"]);
      const out = join(scratch, "smoke.webm");
      const r = await cli(["render", SMOKE, "--frames", "61", "--workers", "4", "--format", "webm", "--out", out]);
      expect(r.code).toBe(0);
      expect(r.json.digest).toBe(traced.json.digest);
      // 61 frames over 4 makes segments of 16, 15, 15 and 15 frames: 533.3 ms,
      // 500 ms, 500 ms. Without the timestamp rewrite the demuxer offsets the
      // second segment by 533 and frames from 17 on land a millisecond early.
      const pts = (await ffprobe(out, "packet=pts")).split("\n").map(Number);
      expect(pts).toEqual(Array.from({ length: 61 }, (_, i) => Math.round((i * 1000) / 30)));
    },
    600_000,
  );

  test(
    "mov and png-seq",
    async () => {
      const traced = await cli(["trace", SMOKE, "--frames", "20"]);
      const mov = await cli(["render", SMOKE, "--frames", "20", "--workers", "3", "--format", "mov", "--out", join(scratch, "smoke.mov")]);
      expect(mov.code).toBe(0);
      expect(mov.json.digest).toBe(traced.json.digest);
      const png = await cli(["render", SMOKE, "--frames", "20", "--workers", "3", "--format", "png-seq", "--out", join(scratch, "frames")]);
      expect(png.code).toBe(0);
      expect(png.json.digest).toBe(traced.json.digest);
      expect((png.json.join as { method: string }).method).toBe("file copy");
    },
    600_000,
  );
});
