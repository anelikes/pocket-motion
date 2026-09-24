/**
 * Acceptance tests for pocket-motion.json sidecar parse / validate / canonicalise.
 * Every rule in the task table maps to at least one rejecting case.
 */

import { describe, expect, test } from "bun:test";
import {
  parseSidecar,
  canonicalise,
  dialogueCompositionFrame,
  EMPTY_SOUND,
  VALID_FPS,
  type MotionSidecar,
  type Diagnostic,
} from "../src/manifest/sidecar.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function codes(diags: readonly Diagnostic[]): string[] {
  return diags.map((d) => d.code);
}

function findDiag(
  diags: readonly Diagnostic[],
  code: string,
): Diagnostic | undefined {
  return diags.find((d) => d.code === code);
}

function expectReject(
  input: unknown,
  code: string,
  path: string,
): Diagnostic {
  const result = parseSidecar(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  const d = findDiag(result.diagnostics, code);
  expect(d).toBeDefined();
  expect(d!.path).toBe(path);
  return d!;
}

const minimal = {
  motion: 1 as const,
  durationFrames: 90,
  fps: 30,
};

function fullFootage(overrides: Record<string, unknown> = {}) {
  return {
    id: "a-roll",
    src: "clip.mp4",
    nodePrefix: "footage:a-roll",
    tile: 512,
    grid: [4, 3],
    startFrame: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("parseSidecar — valid", () => {
  test("minimal sidecar materialises defaults", () => {
    const result = parseSidecar(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [],
      sound: { narration: [], dialogue: [], cues: [] },
      layoutAllow: [],
      assertions: [],
    });
  });

  test("full sidecar with two footage tracks", () => {
    const input = {
      motion: 1,
      durationFrames: 450,
      fps: 30,
      supersample: 2,
      footage: [
        fullFootage({ id: "a-roll", nodePrefix: "footage:a-roll" }),
        fullFootage({
          id: "b-roll",
          src: "assets/b.mp4",
          nodePrefix: "footage:b-roll",
          tile: 256,
          grid: [2, 2],
          startFrame: 10,
        }),
      ],
    };
    const result = parseSidecar(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.supersample).toBe(2);
    expect(result.value.footage).toHaveLength(2);
    expect(result.value.footage[0]).toEqual({
      id: "a-roll",
      src: "clip.mp4",
      nodePrefix: "footage:a-roll",
      tile: 512,
      grid: [4, 3],
      startFrame: 0,
      endFrame: 450,
      sourceFrame: 0,
    });
    expect(result.value.footage[1]?.startFrame).toBe(10);
    expect(result.value.footage[1]?.endFrame).toBe(450);
    expect(result.value.footage[1]?.sourceFrame).toBe(0);
    expect(result.value.footage[1]?.tile).toBe(256);
  });

  test("footage startFrame defaults to 0 when absent", () => {
    const { startFrame: _omit, ...track } = fullFootage();
    const result = parseSidecar({
      ...minimal,
      footage: [track],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.footage[0]?.startFrame).toBe(0);
  });

  test("footage endFrame defaults to durationFrames when absent", () => {
    const result = parseSidecar({
      ...minimal,
      footage: [fullFootage()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.footage[0]?.endFrame).toBe(minimal.durationFrames);
  });

  test("footage sourceFrame defaults to 0 when absent", () => {
    const result = parseSidecar({
      ...minimal,
      footage: [fullFootage()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.footage[0]?.sourceFrame).toBe(0);
  });

  test("every VALID_FPS value is accepted", () => {
    for (const fps of VALID_FPS) {
      const result = parseSidecar({ ...minimal, fps });
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Root-level rules
// ---------------------------------------------------------------------------

describe("parseSidecar — root rules", () => {
  test("rejects non-object input", () => {
    expectReject(null, "sidecar.notObject", "");
    expectReject([], "sidecar.notObject", "");
    expectReject("nope", "sidecar.notObject", "");
  });

  test("motion required", () => {
    const { motion: _m, ...rest } = minimal;
    expectReject(rest, "sidecar.motion.required", "/motion");
  });

  test("motion must be exactly 1", () => {
    expectReject({ ...minimal, motion: 2 }, "sidecar.motion.invalid", "/motion");
    expectReject({ ...minimal, motion: "1" }, "sidecar.motion.invalid", "/motion");
  });

  test("durationFrames required", () => {
    const { durationFrames: _d, ...rest } = minimal;
    expectReject(rest, "sidecar.durationFrames.required", "/durationFrames");
  });

  test("durationFrames must be integer", () => {
    expectReject(
      { ...minimal, durationFrames: 1.5 },
      "sidecar.durationFrames.notInteger",
      "/durationFrames",
    );
  });

  test("durationFrames lower bound", () => {
    const d = expectReject(
      { ...minimal, durationFrames: 0 },
      "sidecar.durationFrames.outOfRange",
      "/durationFrames",
    );
    expect(d.message).toContain("1");
  });

  test("durationFrames upper bound", () => {
    expectReject(
      { ...minimal, durationFrames: 216_001 },
      "sidecar.durationFrames.outOfRange",
      "/durationFrames",
    );
  });

  test("fps required", () => {
    const { fps: _f, ...rest } = minimal;
    expectReject(rest, "sidecar.fps.required", "/fps");
  });

  test("fps must be integer", () => {
    expectReject({ ...minimal, fps: 30.5 }, "sidecar.fps.notInteger", "/fps");
  });

  test("fps: 24 rejected with message naming the valid set", () => {
    const d = expectReject(
      { ...minimal, fps: 24 },
      "sidecar.fps.notDivisorOf60",
      "/fps",
    );
    expect(d.message).toContain("24");
    for (const n of VALID_FPS) {
      expect(d.message).toContain(String(n));
    }
  });

  test("supersample must be 1|2|4", () => {
    expectReject(
      { ...minimal, supersample: 3 },
      "sidecar.supersample.invalid",
      "/supersample",
    );
    expectReject(
      { ...minimal, supersample: 8 },
      "sidecar.supersample.invalid",
      "/supersample",
    );
  });

  test("footage must be an array when present", () => {
    expectReject(
      { ...minimal, footage: {} },
      "sidecar.footage.notArray",
      "/footage",
    );
  });

  test("unknown key at root", () => {
    expectReject(
      { ...minimal, extra: true },
      "sidecar.unknownKey",
      "/extra",
    );
  });
});

// ---------------------------------------------------------------------------
// Footage rules
// ---------------------------------------------------------------------------

describe("parseSidecar — footage rules", () => {
  function withTrack(overrides: Record<string, unknown>) {
    return { ...minimal, footage: [fullFootage(overrides)] };
  }

  test("footage entry must be object", () => {
    expectReject(
      { ...minimal, footage: ["nope"] },
      "sidecar.footage.notObject",
      "/footage/0",
    );
  });

  test("unknown key inside footage entry", () => {
    expectReject(
      withTrack({ typo: 1 }),
      "sidecar.footage.unknownKey",
      "/footage/0/typo",
    );
  });

  test("id required", () => {
    const track = fullFootage();
    const { id: _i, ...rest } = track;
    expectReject(
      { ...minimal, footage: [rest] },
      "sidecar.footage.id.required",
      "/footage/0/id",
    );
  });

  test("id empty", () => {
    expectReject(withTrack({ id: "" }), "sidecar.footage.id.empty", "/footage/0/id");
  });

  test("id must match pattern", () => {
    expectReject(
      withTrack({ id: "A-Roll" }),
      "sidecar.footage.id.invalid",
      "/footage/0/id",
    );
    expectReject(
      withTrack({ id: "-bad" }),
      "sidecar.footage.id.invalid",
      "/footage/0/id",
    );
    expectReject(
      withTrack({ id: "has_underscore" }),
      "sidecar.footage.id.invalid",
      "/footage/0/id",
    );
  });

  test("duplicate footage ids — diagnostic points at the second", () => {
    const result = parseSidecar({
      ...minimal,
      footage: [
        fullFootage({ id: "same" }),
        fullFootage({ id: "same", src: "other.mp4" }),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const d = findDiag(result.diagnostics, "sidecar.footage.id.duplicate");
    expect(d).toBeDefined();
    expect(d!.path).toBe("/footage/1/id");
  });

  test("src required", () => {
    const track = fullFootage();
    const { src: _s, ...rest } = track;
    expectReject(
      { ...minimal, footage: [rest] },
      "sidecar.footage.src.required",
      "/footage/0/src",
    );
  });

  test("src empty", () => {
    expectReject(
      withTrack({ src: "" }),
      "sidecar.footage.src.empty",
      "/footage/0/src",
    );
  });

  test("src path traversal rejected", () => {
    expectReject(
      withTrack({ src: "../../etc/passwd" }),
      "sidecar.footage.src.traversal",
      "/footage/0/src",
    );
  });

  test("src absolute path rejected", () => {
    expectReject(
      withTrack({ src: "/abs/path" }),
      "sidecar.footage.src.absolute",
      "/footage/0/src",
    );
  });

  test("nodePrefix required", () => {
    const track = fullFootage();
    const { nodePrefix: _n, ...rest } = track;
    expectReject(
      { ...minimal, footage: [rest] },
      "sidecar.footage.nodePrefix.required",
      "/footage/0/nodePrefix",
    );
  });

  test("nodePrefix empty", () => {
    expectReject(
      withTrack({ nodePrefix: "" }),
      "sidecar.footage.nodePrefix.empty",
      "/footage/0/nodePrefix",
    );
  });

  test("tile required", () => {
    const track = fullFootage();
    const { tile: _t, ...rest } = track;
    expectReject(
      { ...minimal, footage: [rest] },
      "sidecar.footage.tile.required",
      "/footage/0/tile",
    );
  });

  test("tile not integer", () => {
    expectReject(
      withTrack({ tile: 256.5 }),
      "sidecar.footage.tile.notInteger",
      "/footage/0/tile",
    );
  });

  test("tile: 500 rejected (not power of two)", () => {
    const d = expectReject(
      withTrack({ tile: 500 }),
      "sidecar.footage.tile.notPowerOfTwo",
      "/footage/0/tile",
    );
    expect(d.message).toContain("500");
  });

  test("tile: 1024 rejected (over 512)", () => {
    const d = expectReject(
      withTrack({ tile: 1024 }),
      "sidecar.footage.tile.outOfRange",
      "/footage/0/tile",
    );
    expect(d.message).toContain("1024");
  });

  test("grid required", () => {
    const track = fullFootage();
    const { grid: _g, ...rest } = track;
    expectReject(
      { ...minimal, footage: [rest] },
      "sidecar.footage.grid.required",
      "/footage/0/grid",
    );
  });

  test("grid invalid shape", () => {
    expectReject(
      withTrack({ grid: [1] }),
      "sidecar.footage.grid.invalid",
      "/footage/0/grid",
    );
    expectReject(
      withTrack({ grid: [0, 1] }),
      "sidecar.footage.grid.invalid",
      "/footage/0/grid",
    );
  });

  test("grid product too large", () => {
    const d = expectReject(
      withTrack({ grid: [64, 65] }), // 4160 > 4096
      "sidecar.footage.grid.productTooLarge",
      "/footage/0/grid",
    );
    expect(d.message).toContain("4096");
  });

  test("startFrame must be integer >= 0", () => {
    expectReject(
      withTrack({ startFrame: -1 }),
      "sidecar.footage.startFrame.outOfRange",
      "/footage/0/startFrame",
    );
    expectReject(
      withTrack({ startFrame: 1.5 }),
      "sidecar.footage.startFrame.notInteger",
      "/footage/0/startFrame",
    );
  });

  test("endFrame must be after startFrame", () => {
    expectReject(
      withTrack({ startFrame: 10, endFrame: 10 }),
      "sidecar.footage.endFrame.notAfterStart",
      "/footage/0/endFrame",
    );
    expectReject(
      withTrack({ startFrame: 10, endFrame: 4 }),
      "sidecar.footage.endFrame.notAfterStart",
      "/footage/0/endFrame",
    );
  });

  test("endFrame must not exceed durationFrames", () => {
    expectReject(
      withTrack({ endFrame: 91 }),
      "sidecar.footage.endFrame.pastDuration",
      "/footage/0/endFrame",
    );
  });

  test("endFrame and sourceFrame must be integers >= 0", () => {
    expectReject(
      withTrack({ endFrame: 1.5 }),
      "sidecar.footage.endFrame.notInteger",
      "/footage/0/endFrame",
    );
    expectReject(
      withTrack({ sourceFrame: -1 }),
      "sidecar.footage.sourceFrame.outOfRange",
      "/footage/0/sourceFrame",
    );
    expectReject(
      withTrack({ sourceFrame: 2.5 }),
      "sidecar.footage.sourceFrame.notInteger",
      "/footage/0/sourceFrame",
    );
  });

  test("fit accepts cover, contain, stretch and is omitted when absent", () => {
    for (const fit of ["cover", "contain", "stretch"] as const) {
      const result = parseSidecar(withTrack({ fit }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.value.footage[0]?.fit).toBe(fit);
    }
    const absent = parseSidecar(withTrack({}));
    expect(absent.ok).toBe(true);
    if (!absent.ok) throw new Error("unreachable");
    expect("fit" in (absent.value.footage[0] ?? {})).toBe(false);
  });

  test("fit rejects anything outside the enum", () => {
    const d = expectReject(
      withTrack({ fit: "fill" }),
      "sidecar.footage.fit.invalid",
      "/footage/0/fit",
    );
    expect(d.message).toContain("fill");
    expect(d.message).toContain("cover");
    expect(d.message).toContain("contain");
    expect(d.message).toContain("stretch");
    expectReject(withTrack({ fit: 1 }), "sidecar.footage.fit.invalid", "/footage/0/fit");
  });
});

// ---------------------------------------------------------------------------
// Multiple diagnostics
// ---------------------------------------------------------------------------

describe("parseSidecar — multiple violations", () => {
  test("reports every simultaneous violation", () => {
    const result = parseSidecar({
      motion: 99,
      durationFrames: -5,
      fps: 24,
      supersample: 3,
      unknownRoot: true,
      footage: [
        {
          id: "",
          src: "/abs",
          // nodePrefix missing
          tile: 500,
          grid: [0, 0],
          extra: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const c = codes(result.diagnostics);
    expect(c).toContain("sidecar.motion.invalid");
    expect(c).toContain("sidecar.durationFrames.outOfRange");
    expect(c).toContain("sidecar.fps.notDivisorOf60");
    expect(c).toContain("sidecar.supersample.invalid");
    expect(c).toContain("sidecar.unknownKey");
    expect(c).toContain("sidecar.footage.id.empty");
    expect(c).toContain("sidecar.footage.src.absolute");
    expect(c).toContain("sidecar.footage.nodePrefix.required");
    expect(c).toContain("sidecar.footage.tile.notPowerOfTwo");
    expect(c).toContain("sidecar.footage.grid.invalid");
    expect(c).toContain("sidecar.footage.unknownKey");
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// canonicalise
// ---------------------------------------------------------------------------

describe("parseSidecar — fonts", () => {
  const withFonts = (fonts: unknown) => parseSidecar({ ...minimal, fonts });
  const NOTO = {
    regular: "assets/fonts/NotoSansSC-Regular.otf",
    bold: "assets/fonts/NotoSansSC-Bold.otf",
  };

  test("a declared pair survives parsing verbatim", () => {
    const result = withFonts(NOTO);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.fonts).toEqual(NOTO);
  });

  test("absent means the build default, not an empty pair", () => {
    const result = parseSidecar(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect("fonts" in result.value).toBe(false);
  });

  test("one weight without the other is refused", () => {
    // A slot table allocates bold and regular independently, so a half-declared
    // pair is a build that bakes one of them from a face nobody wrote down.
    const result = withFonts({ regular: NOTO.regular });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics.some((d) => d.path === "/fonts/bold")).toBe(true);
  });

  test("absolute paths and traversal are refused, like footage src", () => {
    for (const bad of ["/etc/passwd", "../../../../etc/passwd", "C:\\fonts\\x.ttf"]) {
      const result = withFonts({ ...NOTO, regular: bad });
      expect({ bad, ok: result.ok }).toEqual({ bad, ok: false });
    }
  });

  test("unknown keys inside fonts are refused", () => {
    const result = withFonts({ ...NOTO, italic: "assets/fonts/x.otf" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics.some((d) => d.code === "sidecar.fonts.unknownKey")).toBe(true);
  });

  test("a non-object fonts value is refused", () => {
    expect(withFonts("assets/fonts/NotoSansSC-Regular.otf").ok).toBe(false);
    expect(withFonts([NOTO.regular, NOTO.bold]).ok).toBe(false);
  });
});

describe("canonicalise", () => {
  test("key insertion order does not affect output", () => {
    const a: MotionSidecar = {
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [],
      sound: EMPTY_SOUND,
      layoutAllow: [],
      assertions: [],
    };
    // Build an object with different insertion order via parse (defaults applied).
    const bResult = parseSidecar({
      fps: 30,
      durationFrames: 90,
      motion: 1,
    });
    expect(bResult.ok).toBe(true);
    if (!bResult.ok) throw new Error("unreachable");

    // Reconstruct with deliberately different key order.
    const c = {
      footage: [] as const,
      supersample: 1 as const,
      fps: 30,
      durationFrames: 90,
      motion: 1 as const,
      sound: EMPTY_SOUND,
      layoutAllow: [],
      assertions: [],
    } as MotionSidecar;

    expect(canonicalise(a)).toBe(canonicalise(bResult.value));
    expect(canonicalise(a)).toBe(canonicalise(c));
  });

  test("semantic change produces a different string", () => {
    const base: MotionSidecar = {
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [],
      sound: EMPTY_SOUND,
      layoutAllow: [],
      assertions: [],
    };
    const changed: MotionSidecar = { ...base, fps: 60 };
    expect(canonicalise(base)).not.toBe(canonicalise(changed));
  });

  test("footage track key order does not affect output", () => {
    const t1: MotionSidecar = {
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [
        {
          id: "a",
          src: "a.mp4",
          nodePrefix: "n",
          tile: 256,
          grid: [2, 2],
          startFrame: 0,
          endFrame: 90,
          sourceFrame: 0,
        },
      ],
      sound: EMPTY_SOUND,
      layoutAllow: [],
      assertions: [],
    };
    const t2: MotionSidecar = {
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [
        {
          sourceFrame: 0,
          endFrame: 90,
          startFrame: 0,
          grid: [2, 2],
          tile: 256,
          nodePrefix: "n",
          src: "a.mp4",
          id: "a",
        },
      ],
      sound: EMPTY_SOUND,
      layoutAllow: [],
      assertions: [],
    };
    expect(canonicalise(t1)).toBe(canonicalise(t2));
  });

  test("no insignificant whitespace", () => {
    const value: MotionSidecar = {
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [],
      sound: EMPTY_SOUND,
      layoutAllow: [],
      assertions: [],
    };
    const s = canonicalise(value);
    expect(s).not.toMatch(/\s/);
    // Round-trip through JSON.
    expect(JSON.parse(s)).toEqual({
      durationFrames: 90,
      footage: [],
      fps: 30,
      layoutAllow: [],
      assertions: [],
      motion: 1,
      sound: { cues: [], dialogue: [], narration: [] },
      supersample: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

describe("parseSidecar — sound", () => {
  const bed = { src: "assets/audio/silent-descent.mp3" };
  const line = {
    id: "vo-1",
    src: "assets/audio/vo.wav",
    startFrame: 0,
  };
  const cue = {
    id: "hit-1",
    src: "assets/audio/sfx/whoosh.mp3",
    atFrame: 10,
  };
  const spoken = {
    id: "dl-1",
    src: "assets/audio/line.wav",
    track: "a-roll",
    sourceFrame: 0,
  };

  function withSound(sound: unknown) {
    return { ...minimal, sound };
  }

  function withDialogue(
    dialogue: unknown,
    footageOverrides: Record<string, unknown> = {},
  ) {
    return {
      ...minimal,
      footage: [fullFootage(footageOverrides)],
      sound: { dialogue: [dialogue] },
    };
  }

  test("absent sound materialises empty arrays and omits bed", () => {
    const result = parseSidecar(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.sound).toEqual({
      narration: [],
      dialogue: [],
      cues: [],
    });
    expect("bed" in result.value.sound).toBe(false);
  });

  test("empty sound object materialises the same as absent", () => {
    const result = parseSidecar(withSound({}));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.sound).toEqual({
      narration: [],
      dialogue: [],
      cues: [],
    });
    expect("bed" in result.value.sound).toBe(false);
  });

  test("bed defaults startAt, gain, fadeInMs, fadeOutMs", () => {
    const result = parseSidecar(withSound({ bed }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.sound.bed).toEqual({
      src: bed.src,
      startAt: 0,
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
    });
  });

  test("narration defaults gain and duck", () => {
    const result = parseSidecar(withSound({ narration: [line] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.sound.narration[0]).toEqual({
      id: "vo-1",
      src: line.src,
      startFrame: 0,
      gain: 1,
      duck: 1,
    });
  });

  test("cue defaults gain", () => {
    const result = parseSidecar(withSound({ cues: [cue] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.sound.cues[0]).toEqual({
      id: "hit-1",
      src: cue.src,
      atFrame: 10,
      gain: 1,
    });
  });

  test("dialogue defaults gain and maps onto the composition clock", () => {
    const result = parseSidecar(
      withDialogue(
        { ...spoken, sourceFrame: 4 },
        { startFrame: 10, sourceFrame: 4, endFrame: 40 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const d = result.value.sound.dialogue[0]!;
    expect(d).toEqual({
      id: "dl-1",
      src: spoken.src,
      track: "a-roll",
      sourceFrame: 4,
      gain: 1,
    });
    expect(
      dialogueCompositionFrame(d, result.value.footage[0]!),
    ).toBe(10);
  });

  test("unknown keys refused at every sound level", () => {
    expectReject(withSound({ typo: 1 }), "sidecar.sound.unknownKey", "/sound/typo");
    expectReject(
      withSound({ bed: { ...bed, extra: 1 } }),
      "sidecar.sound.bed.unknownKey",
      "/sound/bed/extra",
    );
    expectReject(
      withSound({ narration: [{ ...line, extra: 1 }] }),
      "sidecar.sound.narration.unknownKey",
      "/sound/narration/0/extra",
    );
    expectReject(
      withDialogue({ ...spoken, extra: 1 }),
      "sidecar.sound.dialogue.unknownKey",
      "/sound/dialogue/0/extra",
    );
    expectReject(
      withSound({ cues: [{ ...cue, extra: 1 }] }),
      "sidecar.sound.cues.unknownKey",
      "/sound/cues/0/extra",
    );
  });

  test("sound must be an object; role lists must be arrays", () => {
    expectReject(withSound("nope"), "sidecar.sound.notObject", "/sound");
    expectReject(
      withSound({ narration: {} }),
      "sidecar.sound.narration.notArray",
      "/sound/narration",
    );
    expectReject(
      withSound({ dialogue: {} }),
      "sidecar.sound.dialogue.notArray",
      "/sound/dialogue",
    );
    expectReject(
      withSound({ cues: {} }),
      "sidecar.sound.cues.notArray",
      "/sound/cues",
    );
    expectReject(
      withSound({ bed: "x.mp3" }),
      "sidecar.sound.bed.notObject",
      "/sound/bed",
    );
  });

  test("src uses pathIssue per role", () => {
    expectReject(
      withSound({ bed: { src: "" } }),
      "sidecar.sound.bed.src.empty",
      "/sound/bed/src",
    );
    expectReject(
      withSound({ bed: { src: "/abs.mp3" } }),
      "sidecar.sound.bed.src.absolute",
      "/sound/bed/src",
    );
    expectReject(
      withSound({ bed: { src: "../x.mp3" } }),
      "sidecar.sound.bed.src.traversal",
      "/sound/bed/src",
    );
    expectReject(
      withSound({ narration: [{ ...line, src: "" }] }),
      "sidecar.sound.narration.src.empty",
      "/sound/narration/0/src",
    );
    expectReject(
      withDialogue({ ...spoken, src: "/abs.wav" }),
      "sidecar.sound.dialogue.src.absolute",
      "/sound/dialogue/0/src",
    );
    expectReject(
      withSound({ cues: [{ ...cue, src: "../x.mp3" }] }),
      "sidecar.sound.cues.src.traversal",
      "/sound/cues/0/src",
    );
  });

  test("ids are one namespace — a cue may not reuse a narration id", () => {
    const result = parseSidecar(
      withSound({
        narration: [line],
        cues: [{ ...cue, id: line.id }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const d = findDiag(result.diagnostics, "sidecar.sound.id.duplicate");
    expect(d).toBeDefined();
    expect(d!.path).toBe("/sound/cues/0/id");
    expect(d!.message).toContain("/sound/narration/0/id");
  });

  test("gains are finite numbers in 0..8; duck is in 0..1", () => {
    expectReject(
      withSound({ bed: { ...bed, gain: 9 } }),
      "sidecar.sound.bed.gain.outOfRange",
      "/sound/bed/gain",
    );
    expectReject(
      withSound({ bed: { ...bed, gain: Number.NaN } }),
      "sidecar.sound.bed.gain.notNumber",
      "/sound/bed/gain",
    );
    expectReject(
      withSound({ narration: [{ ...line, duck: 1.5 }] }),
      "sidecar.sound.narration.duck.outOfRange",
      "/sound/narration/0/duck",
    );
    expectReject(
      withSound({ narration: [{ ...line, duck: Number.POSITIVE_INFINITY }] }),
      "sidecar.sound.narration.duck.notNumber",
      "/sound/narration/0/duck",
    );
  });

  test("startAt and fade fields are non-negative; fades are integers", () => {
    expectReject(
      withSound({ bed: { ...bed, startAt: -0.1 } }),
      "sidecar.sound.bed.startAt.outOfRange",
      "/sound/bed/startAt",
    );
    expectReject(
      withSound({ bed: { ...bed, fadeInMs: 1.5 } }),
      "sidecar.sound.bed.fadeInMs.notInteger",
      "/sound/bed/fadeInMs",
    );
    expectReject(
      withSound({ bed: { ...bed, fadeOutMs: -1 } }),
      "sidecar.sound.bed.fadeOutMs.outOfRange",
      "/sound/bed/fadeOutMs",
    );
  });

  test("narration startFrame and cue atFrame cannot pass the duration", () => {
    expectReject(
      withSound({ narration: [{ ...line, startFrame: 91 }] }),
      "sidecar.sound.narration.startFrame.pastDuration",
      "/sound/narration/0/startFrame",
    );
    expectReject(
      withSound({ cues: [{ ...cue, atFrame: 91 }] }),
      "sidecar.sound.cues.atFrame.pastDuration",
      "/sound/cues/0/atFrame",
    );
    expectReject(
      withSound({ narration: [{ ...line, startFrame: -1 }] }),
      "sidecar.sound.narration.startFrame.outOfRange",
      "/sound/narration/0/startFrame",
    );
  });

  test("dialogue track must name a declared footage id", () => {
    const empty = expectReject(
      withSound({ dialogue: [spoken] }),
      "sidecar.sound.dialogue.track.unknown",
      "/sound/dialogue/0/track",
    );
    expect(empty.message).toContain("declares no footage");

    const named = expectReject(
      withDialogue({ ...spoken, track: "missing" }),
      "sidecar.sound.dialogue.track.unknown",
      "/sound/dialogue/0/track",
    );
    expect(named.message).toContain("a-roll");
  });

  test("dialogue must land inside its track's window", () => {
    // track window [10, 20); clip sourceFrame 0 → line sourceFrame 15
    // derives at 10 + (15 - 0) = 25, past the window.
    const d = expectReject(
      withDialogue(
        { ...spoken, sourceFrame: 15 },
        { startFrame: 10, endFrame: 20, sourceFrame: 0 },
      ),
      "sidecar.sound.dialogue.outsideWindow",
      "/sound/dialogue/0/sourceFrame",
    );
    expect(d.message).toContain("25");
    expect(d.message).toContain("[10, 20)");
  });

  test("id must match ID_RE", () => {
    expectReject(
      withSound({ narration: [{ ...line, id: "VO" }] }),
      "sidecar.sound.narration.id.invalid",
      "/sound/narration/0/id",
    );
  });
});

describe("fonts.faces", () => {
  const base = { motion: 1, durationFrames: 10, fps: 30 };
  const pair = { regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf", bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf" };
  test("named faces parse beside the default pair and are kept verbatim", () => {
    const r = parseSidecar({ ...base, fonts: { ...pair, faces: { display: { ...pair }, cjk: { ...pair } } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fonts?.faces).toEqual({ display: pair, cjk: pair });
  });
  test("a sidecar with no faces carries no faces key, so its identity projection is unchanged", () => {
    const r = parseSidecar({ ...base, fonts: pair });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("faces" in r.value.fonts!).toBe(false);
  });
  test("a face with one weight is refused", () => {
    const r = parseSidecar({ ...base, fonts: { ...pair, faces: { display: { regular: pair.regular } } } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.map((d) => d.code)).toContain("sidecar.fonts.faces.missing");
  });
});
