/**
 * Sound resolver and the lint / frame-path seam.
 *
 * lint refuses a declared file that is not on disk. resolveComposition —
 * what check / frame / trace / render share — does not look at sound.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run as runLint } from "../src/cli/commands/lint.ts";
import { run as runSound } from "../src/cli/commands/sound.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import { parseSidecar } from "../src/manifest/sidecar.ts";
import {
  sidecarCanonicalOf,
} from "../src/render/identity.ts";
import {
  bedVolumeExpression,
  formatFilterNumber,
  framesToMs,
  mixGraph,
  soundDeclared,
} from "../src/sound/mix.ts";
import { muxSound } from "../src/sound/mux.ts";
import { resolveSound, type ResolvedSoundElement } from "../src/sound/resolve.ts";
import {
  VERIFY_RESIDUAL_FLOOR_DB,
  VERIFY_RMS_FLOOR_DB,
  elementSampleStartSec,
  isBelowFloor,
  clipSpans,
  measureRmsDb,
  sampleOffsetsInVoiced,
  sourceTimeAt,
  verifyMix,
  envelopeFromAstatsLog,
  voicedFromEnvelope,
} from "../src/sound/verify.ts";

const ROOT = resolve(import.meta.dir, "..");
const SMOKE = join(ROOT, "compositions", "smoke");
const TMP = "/tmp/pocketjs-motion-sound-test";
const COMP = join(TMP, "compositions", "probe");

const MIN = { motion: 1 as const, durationFrames: 90, fps: 30 };

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(COMP, { recursive: true });
  writeFileSync(join(COMP, "main.tsx"), "export default function A() { return null; }\n");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function writeSidecar(sound: unknown, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(COMP, "pocket-motion.json"),
    JSON.stringify({ ...MIN, ...extra, sound }),
  );
}

describe("resolveSound", () => {
  test("a declared file on disk resolves to a repo-relative absolute path", () => {
    const parsed = parseSidecar({
      ...MIN,
      sound: { bed: { src: "assets/audio/silent-descent.mp3" } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const result = resolveSound(parsed.value, SMOKE);
    expect(result.ok).toBe(true);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]!.role).toBe("bed");
    expect(result.elements[0]!.path).toBe(
      join(ROOT, "assets/audio/silent-descent.mp3"),
    );
  });

  test("a declared file that is not on disk is an error; assets/ names the fetch command", () => {
    const parsed = parseSidecar({
      ...MIN,
      sound: { bed: { src: "assets/audio/does-not-exist.mp3" } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const result = resolveSound(parsed.value, SMOKE);
    expect(result.ok).toBe(false);
    expect(result.elements[0]!.path).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("sound.src.missing");
    expect(result.diagnostics[0]!.path).toBe("/sound/bed/src");
    expect(result.diagnostics[0]!.message).toContain("not on disk");
    expect(result.diagnostics[0]!.message).toContain("bun scripts/assets.ts");
  });

  test("a missing path outside assets/ does not name the fetch command", () => {
    const parsed = parseSidecar({
      ...MIN,
      sound: { narration: [{ id: "vo-1", src: "voice.wav", startFrame: 0 }] },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const result = resolveSound(parsed.value, SMOKE);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.message).toContain("not on disk");
    expect(result.diagnostics[0]!.message).not.toContain("bun scripts/assets.ts");
  });

  test("dialogue reports the derived composition frame", () => {
    const parsed = parseSidecar({
      ...MIN,
      footage: [
        {
          id: "a-roll",
          src: "clip.mp4",
          nodePrefix: "n",
          tile: 512,
          grid: [2, 2],
          startFrame: 10,
          endFrame: 40,
          sourceFrame: 4,
        },
      ],
      sound: {
        dialogue: [
          {
            id: "dl-1",
            src: "assets/audio/silent-descent.mp3",
            track: "a-roll",
            sourceFrame: 8,
          },
        ],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const result = resolveSound(parsed.value, SMOKE);
    expect(result.ok).toBe(true);
    expect(result.elements[0]!.compositionFrame).toBe(14);
    expect(result.elements[0]!.track).toBe("a-roll");
    expect(result.elements[0]!.sourceFrame).toBe(8);
  });
});

describe("lint refuses; resolveComposition stays deaf", () => {
  test("lint exits 1 when a declared sound file is missing", async () => {
    writeSidecar({ bed: { src: "assets/audio/does-not-exist.mp3" } });
    const result = await runLint({ dir: COMP, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_FAIL);
    const json = result.json as {
      ok: boolean;
      diagnostics: Array<{ code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.diagnostics.some((d) => d.code === "sound.src.missing")).toBe(
      true,
    );
    expect(
      json.diagnostics.some((d) => d.message.includes("bun scripts/assets.ts")),
    ).toBe(true);
  });

  test("resolveComposition does not refuse the same missing file", async () => {
    writeSidecar({ bed: { src: "assets/audio/does-not-exist.mp3" } });
    const resolved = await resolveComposition({
      dir: COMP,
      flags: { json: true },
      requireBundle: false,
    });
    expect(resolved.ok).toBe(true);
  });

  test("lint is clean when the declared file is on disk", async () => {
    mkdirSync(join(TMP, "assets", "audio"), { recursive: true });
    writeFileSync(join(TMP, "assets", "audio", "bed.mp3"), "not-really-audio");
    writeSidecar({ bed: { src: "assets/audio/bed.mp3" } });
    const result = await runLint({ dir: COMP, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_OK);
  });
});

describe("sound command", () => {
  test("nothing declared → exit 0", async () => {
    writeSidecar({});
    const result = await runSound({ dir: COMP, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as { ok: boolean; elements: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.elements).toHaveLength(0);
  });

  test("missing file → exit 1, element listed", async () => {
    writeSidecar({
      narration: [{ id: "vo-1", src: "assets/audio/nope.mp3", startFrame: 3 }],
    });
    const result = await runSound({ dir: COMP, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_FAIL);
    const json = result.json as {
      ok: boolean;
      elements: Array<{ id: string; path: string | null; role: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.elements[0]!.id).toBe("vo-1");
    expect(json.elements[0]!.path).toBeNull();
  });

  test("dialogue reports the composition frame it lands on", async () => {
    mkdirSync(join(TMP, "assets", "audio"), { recursive: true });
    writeFileSync(join(TMP, "assets", "audio", "line.wav"), "x");
    writeSidecar(
      {
        dialogue: [
          {
            id: "dl-1",
            src: "assets/audio/line.wav",
            track: "a-roll",
            sourceFrame: 8,
          },
        ],
      },
      {
        footage: [
          {
            id: "a-roll",
            src: "clip.mp4",
            nodePrefix: "n",
            tile: 512,
            grid: [2, 2],
            startFrame: 10,
            endFrame: 40,
            sourceFrame: 4,
          },
        ],
      },
    );
    const result = await runSound({ dir: COMP, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as {
      ok: boolean;
      elements: Array<{ compositionFrame?: number }>;
    };
    expect(json.ok).toBe(true);
    expect(json.elements[0]!.compositionFrame).toBe(14);
    expect((result.stdoutLines ?? []).some((l) => l.includes("composition 14"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// mix graph — strings only, no ffmpeg
// ---------------------------------------------------------------------------

function resolvedEl(
  overrides: Partial<ResolvedSoundElement> & Pick<ResolvedSoundElement, "role" | "src" | "pointer">,
): ResolvedSoundElement {
  return {
    id: null,
    path: "/tmp/fake.wav",
    ...overrides,
  };
}

describe("framesToMs", () => {
  test("converts at a rate that is not 30", () => {
    expect(framesToMs(3, 15)).toBe(200);
    expect(framesToMs(7, 20)).toBe(350);
    expect(framesToMs(1, 15)).toBe(1000 / 15);
  });
});

describe("mixGraph", () => {
  test("a bed is atrim + volume + afade, then amix", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      sound: {
        bed: {
          src: "assets/audio/cat-walk.mp3",
          startAt: 15.46,
          gain: 0.3,
          fadeInMs: 600,
          fadeOutMs: 1800,
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const graph = mixGraph(
      parsed.value.sound,
      [
        resolvedEl({
          role: "bed",
          src: "assets/audio/cat-walk.mp3",
          pointer: "/sound/bed/src",
          path: "/abs/cat-walk.mp3",
        }),
      ],
      15,
      90,
    );
    expect(graph.inputArgs).toEqual(["-i", "/abs/cat-walk.mp3"]);
    expect(graph.filter).toContain("[1:a]atrim=start=15.46:duration=6");
    expect(graph.filter).toContain("asetpts=PTS-STARTPTS");
    expect(graph.filter).toContain("volume=0.3");
    expect(graph.filter).toContain("afade=t=in:st=0:d=0.6");
    expect(graph.filter).toContain("afade=t=out:st=4.2:d=1.8");
    expect(graph.filter).toContain("amix=inputs=1:normalize=0:dropout_transition=0[a]");
    expect(graph.filter).not.toContain("eval=frame");
  });

  test("a bed declaring no fade gets no afade leg at all", () => {
    // `afade` reads `d=0` as "unset" and falls back to its `nb_samples`
    // default of 44100 samples — 0.92 s at 48 kHz. Measured on a constant
    // 220 Hz tone through `afade=t=in:st=0:d=0`: −45.13 dBFS at 0 s,
    // −25.52 at 0.5 s, level at 0.92 s, against −21.07 untouched. A bed
    // that asks for a hard start would have been faded for most of a
    // second, so the leg is omitted rather than emitted with d=0.
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      sound: { bed: { src: "assets/audio/cat-walk.mp3", gain: 0.3 } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.sound.bed).toMatchObject({ fadeInMs: 0, fadeOutMs: 0 });
    const graph = mixGraph(
      parsed.value.sound,
      [
        resolvedEl({
          role: "bed",
          src: "assets/audio/cat-walk.mp3",
          pointer: "/sound/bed/src",
          path: "/abs/cat-walk.mp3",
        }),
      ],
      15,
      90,
    );
    expect(graph.filter).not.toContain("afade");
    expect(graph.filter).toContain("volume=0.3");
  });

  test("one fade declared emits that leg only", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      sound: {
        bed: { src: "assets/audio/cat-walk.mp3", gain: 1, fadeOutMs: 1800 },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const graph = mixGraph(
      parsed.value.sound,
      [
        resolvedEl({
          role: "bed",
          src: "assets/audio/cat-walk.mp3",
          pointer: "/sound/bed/src",
          path: "/abs/cat-walk.mp3",
        }),
      ],
      15,
      90,
    );
    expect(graph.filter).not.toContain("afade=t=in");
    expect(graph.filter).toContain("afade=t=out:st=4.2:d=1.8");
  });

  test("the bed ducks under narration", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      sound: {
        bed: { src: "assets/audio/cat-walk.mp3", gain: 0.4 },
        narration: [
          {
            id: "vo-1",
            src: "assets/audio/silent-descent.mp3",
            startFrame: 15,
            duck: 0.25,
          },
        ],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const expr = bedVolumeExpression(0.4, [
      { startSec: 1, endSec: 2.5, duck: 0.25 },
    ]);
    expect(expr).toBe("0.4*if(between(t,1,2.5),0.25,1)");

    const graph = mixGraph(
      parsed.value.sound,
      [
        resolvedEl({
          role: "bed",
          src: "assets/audio/cat-walk.mp3",
          pointer: "/sound/bed/src",
          path: "/abs/bed.mp3",
        }),
        resolvedEl({
          id: "vo-1",
          role: "narration",
          src: "assets/audio/silent-descent.mp3",
          pointer: "/sound/narration/0/src",
          path: "/abs/vo.wav",
          durationSec: 1.5,
        }),
      ],
      15,
      90,
    );
    expect(graph.filter).toContain("eval=frame");
    expect(graph.filter).toContain("0.25");
    expect(graph.filter).toContain("between(t\\,1\\,2.5)");
    expect(graph.filter).toContain("adelay=1000:all=1");
    expect(graph.filter).toContain("amix=inputs=2:normalize=0:dropout_transition=0[a]");
  });

  test("a cue is adelay'd by framesToMs at the composition rate", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      sound: {
        cues: [{ id: "hit-1", src: "assets/audio/sfx/whoosh.mp3", atFrame: 3, gain: 0.8 }],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const graph = mixGraph(
      parsed.value.sound,
      [
        resolvedEl({
          id: "hit-1",
          role: "cue",
          src: "assets/audio/sfx/whoosh.mp3",
          pointer: "/sound/cues/0/src",
          path: "/abs/whoosh.mp3",
        }),
      ],
      15,
      90,
    );
    expect(graph.filter).toContain("adelay=200:all=1");
    expect(graph.filter).toContain("volume=0.8");
  });

  test("dialogue delays from the derived composition frame, not sourceFrame", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      footage: [
        {
          id: "a-roll",
          src: "clip.mp4",
          nodePrefix: "n",
          tile: 512,
          grid: [2, 2],
          startFrame: 10,
          endFrame: 40,
          sourceFrame: 4,
        },
      ],
      sound: {
        dialogue: [
          {
            id: "dl-1",
            src: "assets/audio/silent-descent.mp3",
            track: "a-roll",
            sourceFrame: 8,
          },
        ],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    // composition frame 14 at 15 fps = 933.333… ms, not sourceFrame 8
    const graph = mixGraph(
      parsed.value.sound,
      [
        resolvedEl({
          id: "dl-1",
          role: "dialogue",
          src: "assets/audio/silent-descent.mp3",
          pointer: "/sound/dialogue/0/src",
          path: "/abs/line.wav",
          compositionFrame: 14,
          sourceFrame: 8,
        }),
      ],
      15,
      90,
    );
    expect(graph.filter).toContain(`adelay=${formatFilterNumber(framesToMs(14, 15))}`);
    expect(graph.filter).not.toContain(`adelay=${formatFilterNumber(framesToMs(8, 15))}`);
  });

  test("duck=1 is omitted from the envelope", () => {
    expect(bedVolumeExpression(0.5, [{ startSec: 0, endSec: 1, duck: 1 }])).toBe("0.5");
  });

  test("omit drops one leg and does not name the omitted input", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 90,
      fps: 15,
      sound: {
        bed: { src: "assets/audio/cat-walk.mp3", gain: 0.4 },
        narration: [
          {
            id: "vo-1",
            src: "assets/audio/silent-descent.mp3",
            startFrame: 15,
            duck: 0.25,
          },
        ],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const elements = [
      resolvedEl({
        role: "bed",
        src: "assets/audio/cat-walk.mp3",
        pointer: "/sound/bed/src",
        path: "/abs/bed.mp3",
      }),
      resolvedEl({
        id: "vo-1",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        pointer: "/sound/narration/0/src",
        path: "/abs/vo.wav",
        durationSec: 1.5,
      }),
    ];
    const full = mixGraph(parsed.value.sound, elements, 15, 90);
    const omitted = mixGraph(
      parsed.value.sound,
      elements,
      15,
      90,
      "/sound/narration/0/src",
    );
    expect(full.filter).toContain("amix=inputs=2:normalize=0:dropout_transition=0[a]");
    expect(omitted.filter).toContain("amix=inputs=1:normalize=0:dropout_transition=0[a]");
    expect(full.inputArgs).toContain("/abs/vo.wav");
    expect(omitted.inputArgs).not.toContain("/abs/vo.wav");
    expect(omitted.inputArgs).toContain("/abs/bed.mp3");
    expect(full.filter).toContain("eval=frame");
    expect(omitted.filter).not.toContain("eval=frame");
    expect(omitted.filter).not.toContain("[n0]");
  });
});

describe("reel sidecar is identity-neutral", () => {
  test("adding the bed does not change sidecarCanonicalOf", () => {
    const reelPath = join(ROOT, "compositions", "reel", "pocket-motion.json");
    const raw = JSON.parse(readFileSync(reelPath, "utf8")) as Record<string, unknown>;
    const withSound = parseSidecar(raw);
    const silent = { ...raw };
    delete silent.sound;
    const without = parseSidecar(silent);
    expect(withSound.ok).toBe(true);
    expect(without.ok).toBe(true);
    if (!withSound.ok || !without.ok) throw new Error("unreachable");
    expect(soundDeclared(withSound.value.sound)).toBe(true);
    expect(soundDeclared(without.value.sound)).toBe(false);
    expect(sidecarCanonicalOf(withSound.value)).toBe(sidecarCanonicalOf(without.value));
  });
});

// ---------------------------------------------------------------------------
// verify — ffmpeg, short fixtures
// ---------------------------------------------------------------------------

const MIX_TMP = "/tmp/pocketjs-motion-sound-mix-test";

async function runFfmpeg(args: string[]): Promise<void> {
  const p = Bun.spawn(["ffmpeg", "-y", "-v", "error", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) {
    throw new Error(`ffmpeg ${args[0]} failed: ${err.trim()}`);
  }
}

async function decodeGraph(
  inputArgs: readonly string[],
  filter: string,
  durationSec: number,
): Promise<Uint8Array> {
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-t",
      "0.05",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[a]",
      "-t",
      String(durationSec),
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "2",
      "-ar",
      "48000",
      "pipe:1",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [buf, err, code] = await Promise.all([
    new Response(p.stdout).arrayBuffer(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) {
    throw new Error(`decodeGraph failed: ${err.trim()}`);
  }
  return new Uint8Array(buf);
}

describe("verifyMix", () => {
  beforeAll(async () => {
    rmSync(MIX_TMP, { recursive: true, force: true });
    mkdirSync(MIX_TMP, { recursive: true });
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:a",
      "pcm_s16le",
      join(MIX_TMP, "tone.wav"),
    ]);
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=1",
      "-c:a",
      "pcm_s16le",
      join(MIX_TMP, "tone2.wav"),
    ]);
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      "1",
      "-c:a",
      "pcm_s16le",
      join(MIX_TMP, "silent.wav"),
    ]);
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:r=15",
      "-frames:v",
      "30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      join(MIX_TMP, "picture.mp4"),
    ]);
  });

  afterAll(() => {
    rmSync(MIX_TMP, { recursive: true, force: true });
  });

  function sidecarWith(
    sound: unknown,
    extra: Record<string, unknown> = {},
  ): ReturnType<typeof parseSidecar> {
    return parseSidecar({
      motion: 1,
      durationFrames: 30,
      fps: 15,
      ...extra,
      sound,
    });
  }

  test("the floor treats −inf and values at or below it as silent", () => {
    expect(isBelowFloor(Number.NEGATIVE_INFINITY)).toBe(true);
    expect(isBelowFloor(VERIFY_RMS_FLOOR_DB)).toBe(true);
    expect(isBelowFloor(VERIFY_RMS_FLOOR_DB - 10)).toBe(true);
    expect(isBelowFloor(-20)).toBe(false);
  });

  test("a muxed tone is present", async () => {
    const parsed = sidecarWith({
      narration: [
        { id: "vo-1", src: "assets/audio/silent-descent.mp3", startFrame: 0 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const tone = join(MIX_TMP, "tone.wav");
    const elements: ResolvedSoundElement[] = [
      {
        id: "vo-1",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        path: tone,
        pointer: "/sound/narration/0/src",
        durationSec: 1,
      },
    ];
    const out = join(MIX_TMP, "tone-muxed.mp4");
    await muxSound({
      videoPath: join(MIX_TMP, "picture.mp4"),
      outputPath: out,
      graph: mixGraph(parsed.value.sound, elements, 15, 30),
      durationSec: 2,
    });
    const result = await verifyMix({
      sidecar: parsed.value,
      elements,
      producedPath: out,
      fps: 15,
    });
    expect(result.elements[0]!.status).toBe("present");
    expect(result.ok).toBe(true);
  }, 30_000);

  test("verify catches an unmuxed declared line", async () => {
    const full = sidecarWith({
      narration: [
        { id: "vo-1", src: "assets/audio/silent-descent.mp3", startFrame: 0 },
        { id: "vo-2", src: "assets/audio/silent-descent.mp3", startFrame: 15 },
      ],
    });
    const onlyFirst = sidecarWith({
      narration: [
        { id: "vo-1", src: "assets/audio/silent-descent.mp3", startFrame: 0 },
      ],
    });
    expect(full.ok && onlyFirst.ok).toBe(true);
    if (!full.ok || !onlyFirst.ok) throw new Error("unreachable");

    const tone = join(MIX_TMP, "tone.wav");
    const tone2 = join(MIX_TMP, "tone2.wav");
    const declared: ResolvedSoundElement[] = [
      {
        id: "vo-1",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        path: tone,
        pointer: "/sound/narration/0/src",
        durationSec: 1,
      },
      {
        id: "vo-2",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        path: tone2,
        pointer: "/sound/narration/1/src",
        durationSec: 1,
      },
    ];
    // Graph built without vo-2 — the line is declared, not mixed.
    const out = join(MIX_TMP, "missing-line.mp4");
    await muxSound({
      videoPath: join(MIX_TMP, "picture.mp4"),
      outputPath: out,
      graph: mixGraph(onlyFirst.value.sound, declared.slice(0, 1), 15, 30),
      durationSec: 2,
    });
    const result = await verifyMix({
      sidecar: full.value,
      elements: declared,
      producedPath: out,
      fps: 15,
    });
    expect(result.ok).toBe(false);
    expect(result.elements[0]!.status).toBe("present");
    expect(result.elements[1]!.status).toBe("unmuxed");
  }, 30_000);

  test("a silent source is reported, not passed", async () => {
    const parsed = sidecarWith({
      narration: [
        { id: "vo-quiet", src: "assets/audio/silent-descent.mp3", startFrame: 0 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const silent = join(MIX_TMP, "silent.wav");
    const sourceRms = await measureRmsDb(silent, 0);
    expect(isBelowFloor(sourceRms)).toBe(true);

    const elements: ResolvedSoundElement[] = [
      {
        id: "vo-quiet",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        path: silent,
        pointer: "/sound/narration/0/src",
        durationSec: 1,
      },
    ];
    const out = join(MIX_TMP, "silent-muxed.mp4");
    await muxSound({
      videoPath: join(MIX_TMP, "picture.mp4"),
      outputPath: out,
      graph: mixGraph(parsed.value.sound, elements, 15, 30),
      durationSec: 2,
    });
    const result = await verifyMix({
      sidecar: parsed.value,
      elements,
      producedPath: out,
      fps: 15,
    });
    expect(result.elements[0]!.status).toBe("source-silent");
    expect(result.ok).toBe(false);
  }, 30_000);

  test("a line under a bed is unmuxed when it is absent from the mix", async () => {
    const bed = join(MIX_TMP, "bed-220.wav");
    const vo = join(MIX_TMP, "vo-880.wav");
    const full = join(MIX_TMP, "full-bed-vo.wav");
    const missing = join(MIX_TMP, "missing-vo.wav");
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=220:duration=6",
      "-c:a", "pcm_s16le", bed,
    ]);
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
      "-c:a", "pcm_s16le", vo,
    ]);
    await runFfmpeg([
      "-i", bed, "-i", vo,
      "-filter_complex",
      "[1:a]adelay=2000:all=1[v];[0:a][v]amix=inputs=2:normalize=0",
      "-c:a", "pcm_s16le", full,
    ]);
    await runFfmpeg(["-i", bed, "-c:a", "pcm_s16le", missing]);

    const long = parseSidecar({
      motion: 1,
      durationFrames: 180,
      fps: 30,
      sound: {
        bed: { src: "assets/audio/silent-descent.mp3" },
        narration: [
          { id: "vo", src: "assets/audio/silent-descent.mp3", startFrame: 60 },
        ],
      },
    });
    expect(long.ok).toBe(true);
    if (!long.ok) throw new Error("unreachable");
    const elements: ResolvedSoundElement[] = [
      {
        id: null,
        role: "bed",
        src: "assets/audio/silent-descent.mp3",
        path: bed,
        pointer: "/sound/bed/src",
        durationSec: 6,
      },
      {
        id: "vo",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        path: vo,
        pointer: "/sound/narration/0/src",
        durationSec: 2,
      },
    ];

    const present = await verifyMix({
      sidecar: long.value,
      elements,
      producedPath: full,
      fps: 30,
    });
    const presentVo = present.elements.find((e) => e.role === "narration")!;
    expect(presentVo.status).toBe("present");
    expect(presentVo.residualRmsDb).not.toBeNull();
    expect(presentVo.residualRmsDb!).toBeGreaterThan(VERIFY_RESIDUAL_FLOOR_DB);
    expect(present.ok).toBe(true);

    const absent = await verifyMix({
      sidecar: long.value,
      elements,
      producedPath: missing,
      fps: 30,
    });
    const absentVo = absent.elements.find((e) => e.role === "narration")!;
    expect(absent.ok).toBe(false);
    expect(absentVo.status).toBe("unmuxed");
    expect(absentVo.residualRmsDb).not.toBeNull();
    expect(isBelowFloor(absentVo.residualRmsDb!, VERIFY_RESIDUAL_FLOOR_DB)).toBe(
      true,
    );
    expect(absent.elements.find((e) => e.role === "bed")!.status).toBe("present");
  }, 30_000);

  test("a bed 20 dB louder than the line cannot hide its absence", async () => {
    const bed = join(MIX_TMP, "bed-220-loud.wav");
    const vo = join(MIX_TMP, "vo-880-under-loud.wav");
    const full = join(MIX_TMP, "full-loud-bed.wav");
    const missing = join(MIX_TMP, "missing-vo-loud-bed.wav");
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=220:duration=6,volume=10",
      "-c:a", "pcm_s16le", bed,
    ]);
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
      "-c:a", "pcm_s16le", vo,
    ]);
    await runFfmpeg([
      "-i", bed, "-i", vo,
      "-filter_complex",
      "[1:a]adelay=2000:all=1[v];[0:a][v]amix=inputs=2:normalize=0",
      "-c:a", "pcm_s16le", full,
    ]);
    await runFfmpeg(["-i", bed, "-c:a", "pcm_s16le", missing]);

    const long = parseSidecar({
      motion: 1,
      durationFrames: 180,
      fps: 30,
      sound: {
        bed: { src: "assets/audio/silent-descent.mp3" },
        narration: [
          { id: "vo", src: "assets/audio/silent-descent.mp3", startFrame: 60 },
        ],
      },
    });
    expect(long.ok).toBe(true);
    if (!long.ok) throw new Error("unreachable");
    const elements: ResolvedSoundElement[] = [
      {
        id: null,
        role: "bed",
        src: "assets/audio/silent-descent.mp3",
        path: bed,
        pointer: "/sound/bed/src",
        durationSec: 6,
      },
      {
        id: "vo",
        role: "narration",
        src: "assets/audio/silent-descent.mp3",
        path: vo,
        pointer: "/sound/narration/0/src",
        durationSec: 2,
      },
    ];

    const present = await verifyMix({
      sidecar: long.value,
      elements,
      producedPath: full,
      fps: 30,
    });
    expect(present.elements.find((e) => e.role === "narration")!.status).toBe(
      "present",
    );
    expect(present.ok).toBe(true);

    const absent = await verifyMix({
      sidecar: long.value,
      elements,
      producedPath: missing,
      fps: 30,
    });
    expect(absent.ok).toBe(false);
    expect(absent.elements.find((e) => e.role === "narration")!.status).toBe(
      "unmuxed",
    );
  }, 30_000);

  test("sound --verify exits 1 on a silent source", async () => {
    mkdirSync(join(TMP, "assets", "audio"), { recursive: true });
    writeFileSync(
      join(TMP, "assets", "audio", "silent.wav"),
      new Uint8Array(await Bun.file(join(MIX_TMP, "silent.wav")).arrayBuffer()),
    );
    writeSidecar({
      narration: [{ id: "vo-1", src: "assets/audio/silent.wav", startFrame: 0 }],
    });
    const out = join(MIX_TMP, "cli-silent.mp4");
    const parsed = sidecarWith({
      narration: [{ id: "vo-1", src: "assets/audio/silent.wav", startFrame: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    await muxSound({
      videoPath: join(MIX_TMP, "picture.mp4"),
      outputPath: out,
      graph: mixGraph(
        parsed.value.sound,
        [
          {
            id: "vo-1",
            role: "narration",
            src: "assets/audio/silent.wav",
            path: join(TMP, "assets", "audio", "silent.wav"),
            pointer: "/sound/narration/0/src",
            durationSec: 1,
          },
        ],
        15,
        30,
      ),
      durationSec: 2,
    });
    const result = await runSound({
      dir: COMP,
      flags: { json: true },
      verify: out,
    });
    expect(result.exitCode).toBe(EXIT_FAIL);
    const json = result.json as { ok: boolean; verify: { elements: Array<{ status: string }> } };
    expect(json.ok).toBe(false);
    expect(json.verify.elements[0]!.status).toBe("source-silent");
  }, 30_000);
});

describe("reel old path vs new path", () => {
  test("decoded audio matches, and a perturbed bed field does not", async () => {
    const bed = join(ROOT, "assets/audio/cat-walk.mp3");
    if (!existsSync(bed)) {
      throw new Error("assets/audio/cat-walk.mp3 missing — bun scripts/assets.ts");
    }
    const durationFrames = 1071;
    const fps = 30;
    const durationSec = framesToMs(durationFrames, fps) / 1000;
    const parsed = parseSidecar({
      motion: 1,
      durationFrames,
      fps,
      sound: {
        bed: {
          src: "assets/audio/cat-walk.mp3",
          startAt: 15.46,
          gain: 0.3,
          fadeInMs: 600,
          fadeOutMs: 1800,
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const elements: ResolvedSoundElement[] = [
      {
        id: null,
        role: "bed",
        src: "assets/audio/cat-walk.mp3",
        path: bed,
        pointer: "/sound/bed/src",
      },
    ];
    const next = mixGraph(parsed.value.sound, elements, fps, durationFrames);
    const nextPcm = await decodeGraph(next.inputArgs, next.filter, durationSec);

    // The old path: -ss on the input, no atrim, fade seconds via toFixed(3).
    const vDur = durationSec;
    const oldFilter =
      `[1:a]volume=0.3,` +
      `afade=t=in:st=0:d=${(600 / 1000).toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, vDur - 1800 / 1000).toFixed(3)}:d=${(1800 / 1000).toFixed(3)}` +
      `[bed];[bed]amix=inputs=1:normalize=0:dropout_transition=0[a]`;
    const oldPcm = await decodeGraph(
      ["-ss", "15.46", "-i", bed],
      oldFilter,
      durationSec,
    );

    const sameLength = nextPcm.byteLength === oldPcm.byteLength;
    let firstDiff = -1;
    let maxAbs = 0;
    const n = Math.min(nextPcm.byteLength, oldPcm.byteLength);
    const nextView = new Int16Array(nextPcm.buffer, nextPcm.byteOffset, Math.floor(n / 2));
    const oldView = new Int16Array(oldPcm.buffer, oldPcm.byteOffset, Math.floor(n / 2));
    for (let i = 0; i < nextView.length; i++) {
      const d = Math.abs((nextView[i] ?? 0) - (oldView[i] ?? 0));
      if (d > 0 && firstDiff < 0) firstDiff = i;
      if (d > maxAbs) maxAbs = d;
    }

    // Recorded for the report: do not rewrite the graph to force a match.
    console.log(
      `reel compare: new ${nextPcm.byteLength} bytes, old ${oldPcm.byteLength} bytes, ` +
        `sameLength=${sameLength}, firstDiffSample=${firstDiff}, maxAbs=${maxAbs}`,
    );

    const perturbed = parseSidecar({
      motion: 1,
      durationFrames,
      fps,
      sound: {
        bed: {
          src: "assets/audio/cat-walk.mp3",
          startAt: 15.46,
          gain: 0.3,
          fadeInMs: 601,
          fadeOutMs: 1800,
        },
      },
    });
    expect(perturbed.ok).toBe(true);
    if (!perturbed.ok) throw new Error("unreachable");
    const perturbedGraph = mixGraph(
      perturbed.value.sound,
      elements,
      fps,
      durationFrames,
    );
    const perturbedPcm = await decodeGraph(
      perturbedGraph.inputArgs,
      perturbedGraph.filter,
      durationSec,
    );
    expect(perturbedPcm.byteLength).toBe(nextPcm.byteLength);
    let perturbedDiffers = false;
    for (let i = 0; i < nextPcm.byteLength; i++) {
      if (perturbedPcm[i] !== nextPcm[i]) {
        perturbedDiffers = true;
        break;
      }
    }
    expect(perturbedDiffers).toBe(true);
  }, 60_000);
});

describe("verify does not sample inside a fade", () => {
  // `sound --verify` used to call a present bed `truncated`: gain 0.14 out of
  // a 1.5 s fade-in measures -69.45 dBFS at the declared start, against a
  // -50 dBFS floor. Raising the gain until the check is satisfied would change
  // the delivery to suit the instrument; the check was the thing that was
  // wrong. A window taken during a transition describes the transition.
  const sidecar = {
    sound: {
      bed: { fadeInMs: 1500, fadeOutMs: 1800 },
      narration: [],
      dialogue: [],
      cues: [],
    },
  } as unknown as Parameters<typeof elementSampleStartSec>[1];

  test("a bed is sampled after its fade-in, not at its declared start", () => {
    const bed = { role: "bed", pointer: "/sound/bed/src" } as ResolvedSoundElement;
    expect(elementSampleStartSec(bed, sidecar, 0)).toBe(1.5);
    expect(elementSampleStartSec(bed, sidecar, 4)).toBe(5.5);
  });

  test("every other role keeps its declared start — only the bed fades in", () => {
    for (const role of ["narration", "dialogue", "cues"] as const) {
      const el = { role, pointer: `/sound/${role}/0/src` } as ResolvedSoundElement;
      expect(elementSampleStartSec(el, sidecar, 2.25)).toBe(2.25);
    }
  });

  test("a bed with no fade is sampled from its start", () => {
    const noFade = {
      sound: { bed: { fadeInMs: 0, fadeOutMs: 0 }, narration: [], dialogue: [], cues: [] },
    } as unknown as Parameters<typeof elementSampleStartSec>[1];
    const bed = { role: "bed", pointer: "/sound/bed/src" } as ResolvedSoundElement;
    expect(elementSampleStartSec(bed, noFade, 0)).toBe(0);
  });
});

describe("verify does not read a pause inside a line as an absence", () => {
  // `sound --verify` used to call every element of a correct mix `truncated`
  // for one reason: a sampled window landed in the silence between two
  // sentences. That window cannot answer whether the element muxed — with the
  // source silent there, the produced mix and the omit-mix are equal whether
  // or not it did.
  //
  // Measured on a 6 s line silent from 2 s to 4 s, mixed in full:
  // windows at 0 s and 5.9 s read −24.08 dB residual, the window at 2.95 s
  // read −inf against a −50 dB floor, and the line reported `truncated`.
  const TMP = "/tmp/pocketjs-motion-sound-pause-test";
  const p = (name: string) => join(TMP, name);

  beforeAll(async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    // A 2 s line, and the same line with 0.8–1.2 s silenced: at fps 15 over
    // 30 frames the three windows fall at 0 s, 0.95 s and 1.9 s, so the
    // middle one lands inside the pause.
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:a", "pcm_s16le", p("solid.wav")]);
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-af", "volume=volume=0:enable='between(t,0.8,1.2)'",
      "-c:a", "pcm_s16le", p("gapped.wav")]);
    await runFfmpeg(["-i", p("solid.wav"), "-t", "0.8",
      "-c:a", "pcm_s16le", p("half.wav")]);
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=2",
      "-c:a", "pcm_s16le", p("bed.wav")]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=black:s=32x32:r=15",
      "-frames:v", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
      p("picture.mp4")]);
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  function withBed(lineSrc: string, fadeInMs = 0) {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 30,
      fps: 15,
      sound: {
        bed: { src: "assets/audio/bed.mp3", gain: 0.3, fadeInMs },
        narration: [{ id: "vo-1", src: "assets/audio/line.mp3", startFrame: 0 }],
      },
    });
    if (!parsed.ok) throw new Error("fixture sidecar did not parse");
    const elements: ResolvedSoundElement[] = [
      { id: null, role: "bed", src: "assets/audio/bed.mp3",
        path: p("bed.wav"), pointer: "/sound/bed/src", durationSec: 2 },
      { id: "vo-1", role: "narration", src: "assets/audio/line.mp3",
        path: p(lineSrc), pointer: "/sound/narration/0/src", durationSec: 2 },
    ];
    return { sidecar: parsed.value, elements };
  }

  /** Mux `mixedSrc`, then verify against a sidecar declaring `declaredSrc`. */
  async function verifyMuxed(
    declaredSrc: string,
    mixedSrc: string,
    fadeInMs = 0,
  ) {
    const mixed = withBed(mixedSrc, fadeInMs);
    const out = p(`muxed-${mixedSrc}-${fadeInMs}.mp4`);
    await muxSound({
      videoPath: p("picture.mp4"),
      outputPath: out,
      graph: mixGraph(mixed.sidecar.sound, mixed.elements, 15, 30),
      durationSec: 2,
    });
    const declared = withBed(declaredSrc, fadeInMs);
    return await verifyMix({
      sidecar: declared.sidecar,
      elements: declared.elements,
      producedPath: out,
      fps: 15,
    });
  }

  test("a line with a pause in the middle, muxed in full, is present", async () => {
    const result = await verifyMuxed("gapped.wav", "gapped.wav");
    expect(result.elements.map((e) => [e.id, e.status])).toEqual([
      [null, "present"],
      ["vo-1", "present"],
    ]);
    expect(result.ok).toBe(true);
  }, 60_000);

  test("a line that really stops early is still truncated", async () => {
    const result = await verifyMuxed("solid.wav", "half.wav");
    const line = result.elements.find((e) => e.id === "vo-1")!;
    expect(line.status).toBe("truncated");
    expect(result.ok).toBe(false);
  }, 60_000);

  test("a line whose muxed audio really is missing that stretch is truncated", async () => {
    // Same produced file as the first test, but declared as the solid line:
    // the source has something to contribute at 0.95 s and the mix does not.
    const result = await verifyMuxed("solid.wav", "gapped.wav");
    const line = result.elements.find((e) => e.id === "vo-1")!;
    expect(line.status).toBe("truncated");
  }, 60_000);

  test("a bed whose fade-in is half the composition is present", async () => {
    // `mixOffsetSec` used to return the fade for a bed and
    // `elementSampleStartSec` added it again, so sampling began two fades
    // in. At fadeInMs 1000 on a 2 s composition that is the end of the
    // file, and a correctly muxed bed measured `unmuxed`.
    const result = await verifyMuxed("solid.wav", "solid.wav", 1000);
    const bed = result.elements.find((e) => e.role === "bed")!;
    expect(bed.status).toBe("present");
  }, 60_000);

  test("the astats metadata print parses into a per-window envelope", () => {
    const log = [
      "frame:0    pts:0       pts_time:0",
      "lavfi.astats.Overall.RMS_level=-53.135184",
      "frame:1    pts:4800    pts_time:0.1",
      "lavfi.astats.Overall.RMS_level=-25.380136",
      "frame:2    pts:9600    pts_time:0.2",
      "lavfi.astats.Overall.RMS_level=-inf",
    ].join("\n");
    expect(envelopeFromAstatsLog(log)).toEqual([
      [0, -53.135184],
      [0.1, -25.380136],
      [0.2, Number.NEGATIVE_INFINITY],
    ]);
    expect(envelopeFromAstatsLog("")).toEqual([]);
  });

  test("runs of windows above the floor become voiced spans", () => {
    // The `morning-mn2` shape: quiet at the head, in the middle and at the
    // tail, loud in between. silencedetect saw none of it — those dips are
    // room tone whose peaks clear -50 dB, not silence.
    const env: Array<[number, number]> = [
      [0, -53], [0.1, -25], [0.2, -22], [0.3, -51], [0.4, -21], [0.5, -52],
    ];
    const spans = voicedFromEnvelope(env, -50, 0.1);
    expect(spans.length).toBe(2);
    expect(spans[0]![0]).toBeCloseTo(0.1, 9);
    expect(spans[0]![1]).toBeCloseTo(0.3, 9);
    expect(spans[1]![0]).toBeCloseTo(0.4, 9);
    expect(spans[1]![1]).toBeCloseTo(0.5, 9);
    // A run that reaches the end still closes.
    const tail = voicedFromEnvelope([[0, -20], [0.1, -20]], -50, 0.1);
    expect(tail.length).toBe(1);
    expect(tail[0]![1]).toBeCloseTo(0.2, 9);
    expect(voicedFromEnvelope([[0, -60]], -50, 0.1)).toEqual([]);
  });

  test("clipSpans keeps only what is inside the element's own span", () => {
    const spans: Array<[number, number]> = [[0, 1], [2, 3], [4, 5]];
    expect(clipSpans(spans, 0.5, 4.5)).toEqual([[0.5, 1], [2, 3], [4, 4.5]]);
    expect(clipSpans(spans, 1, 2)).toEqual([]);
  });

  test("windows spread across voiced time and never start inside silence", () => {
    // The `morning-patient` shape: 2.84 s, speech either side of one pause.
    // Wall-time thirds land at 0, 1.37 and 2.74 — the leading silence, the
    // pause, and the trailing silence. Voiced-time thirds cannot.
    const voiced: Array<[number, number]> = [[0.2, 1.1], [1.6, 2.6]];
    const at = sampleOffsetsInVoiced(voiced, 0.1, 3);
    expect(at.length).toBe(3);
    for (const t of at) {
      const inside = voiced.some(([a, b]) => t >= a && t + 0.1 <= b);
      expect(inside).toBe(true);
    }
    // Reaches both ends: the first usable start and the last one.
    expect(at[0]).toBeCloseTo(0.2, 6);
    expect(at[2]!).toBeCloseTo(2.5, 6);
  });

  test("a voiced span shorter than the window cannot hold one", () => {
    expect(sampleOffsetsInVoiced([[1, 1.05]], 0.1, 3)).toEqual([]);
    expect(sampleOffsetsInVoiced([], 0.1, 3)).toEqual([]);
  });

  test("a line whose every wall-time third is silent is still present", async () => {
    // Built to the `morning-patient` proportions at this fixture's scale:
    // 2.8 s, silent 0-0.2, 1.1-1.6 and 2.6-2.8, so the thirds at 0, 1.35
    // and 2.7 all land on silence. Muxed in full.
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2.8",
      "-af", "volume=volume=0:enable='between(t,0,0.2)+between(t,1.1,1.6)+between(t,2.6,2.8)'",
      "-c:a", "pcm_s16le", p("thirds.wav")]);
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 42,
      fps: 15,
      sound: {
        narration: [{ id: "vo-1", src: "assets/audio/line.mp3", startFrame: 0 }],
      },
    });
    if (!parsed.ok) throw new Error("fixture sidecar did not parse");
    const elements: ResolvedSoundElement[] = [
      { id: "vo-1", role: "narration", src: "assets/audio/line.mp3",
        path: p("thirds.wav"), pointer: "/sound/narration/0/src", durationSec: 2.8 },
    ];
    const out = p("muxed-thirds.mp4");
    await muxSound({
      videoPath: p("picture.mp4"),
      outputPath: out,
      graph: mixGraph(parsed.value.sound, elements, 15, 42),
      durationSec: 2.8,
    });
    const result = await verifyMix({
      sidecar: parsed.value, elements, producedPath: out, fps: 15,
    });
    expect(result.elements[0]!.status).toBe("present");
  }, 60_000);

  test("sourceTimeAt seeks by startAt and does not re-apply the fade", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 30,
      fps: 15,
      sound: {
        bed: { src: "assets/audio/bed.mp3", startAt: 4, fadeInMs: 500 },
        narration: [{ id: "vo-1", src: "assets/audio/line.mp3", startFrame: 15 }],
      },
    });
    if (!parsed.ok) throw new Error("fixture sidecar did not parse");
    const bed = { role: "bed", pointer: "/sound/bed/src" } as ResolvedSoundElement;
    // Composition 0.5 s is 4.5 s into a bed that seeks to 4 s.
    expect(sourceTimeAt(bed, parsed.value, 0.5, 15)).toBe(4.5);
    const line = {
      id: "vo-1",
      role: "narration",
      pointer: "/sound/narration/0/src",
    } as ResolvedSoundElement;
    // The line starts at frame 15 — composition 1.2 s is 0.2 s into it.
    expect(sourceTimeAt(line, parsed.value, 1.2, 15)).toBeCloseTo(0.2, 10);
    expect(sourceTimeAt(line, parsed.value, 0, 15)).toBe(0);
  });
});
