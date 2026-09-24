/**
 * The enumerable author-facing surface, declared as data.
 *
 * `scripts/catalog.ts` renders this table as `CAPABILITIES.md`.
 * `tests/catalog.test.ts` checks every `pinned` literal against the named
 * source file, and executes every `probed` row: sidecar rows against
 * `parseSidecar`, animation rows against the vendored compiler, which has no
 * diagnostic codes and answers by throwing (`BakeProbe`).
 */

import {
  DURATION_FRAMES_MAX,
  DURATION_FRAMES_MIN,
  FOOTAGE_FIT_VALUES,
  GRID_PRODUCT_MAX,
  ID_RE,
  SUPERSAMPLE_VALUES,
  TEX_MAX_DIM,
  VALID_FPS,
} from "../manifest/sidecar.ts";

/** How thoroughly this repository has verified the row it renders. */
export type Verification =
  | "probed" // executed against the real implementation; a violation was made and rejected
  | "pinned"; // the stated literal was found in the implementing source file, nothing more

export interface Probe {
  /** The diagnostic code this input must produce. */
  readonly code: string;
  /** A sidecar that violates the row's constraint. */
  readonly input: unknown;
}

/**
 * A build-time input for the keyframe baker, and what it must do with it.
 *
 * The animation vocabulary is not sidecar-shaped and has no diagnostic codes:
 * it is `pocket.config.ts` theme data plus class literals, read by the
 * vendored compiler, which answers by throwing. `tests/catalog.test.ts` G6
 * registers the theme and compiles the literals against that compiler, so an
 * `animation` row saying "refused" has had the refusal executed rather than
 * read off a source file.
 */
export interface BakeProbe {
  /** What the author wrote. Names the case in a failure message. */
  readonly what: string;
  /**
   * Compile the literals as if a JSX `class=` attribute had held them.
   *
   * The collector knows this and `patches/0012` passes it on. It is the
   * evidence that separates a typo from a sentence, and it is stronger than
   * the "some other token parsed" heuristic it supersedes.
   */
  readonly fromClassAttribute?: boolean;
  /** `theme.keyframes`: name -> selector -> declarations. Defaults to a
   *  from/to opacity ramp named `appear`. */
  readonly keyframes?: Record<string, Record<string, Record<string, string>>>;
  /** `theme.animation`. Defaults to none, which is what a built-in needs. */
  readonly animation?: Record<string, { readonly value: string; readonly loop?: string }>;
  /** Class literals to compile. The first is the one under test. */
  readonly literals: readonly string[];
  /** What the compiler must do with it. */
  readonly outcome: BakeOutcome;
}

export type BakeOutcome =
  /** Throws, with this substring in the message. */
  | { readonly refuses: string }
  /**
   * Throws nothing and produces no style record for the first literal. The
   * token failed to parse, so the whole literal stopped being a class string —
   * the one refusal in this vocabulary that says nothing.
   */
  | { readonly dropsLiteral: true }
  /** Compiles to a record carrying an animation. Marks the accepted side of a
   *  boundary; it is not a violation, so it cannot by itself earn `probed`. */
  | { readonly bakes: true }
  /** Compiles to a record whose base props carry `prop` at exactly `value`
   *  (the u32 the compiler wrote). For a utility token rather than an
   *  animation: proves the token reached the style table as the number the
   *  core reads, not merely that it parsed. */
  | { readonly declares: { readonly prop: string; readonly value: number } };

/**
 * A module, and exactly which of its literals the collector may vouch for.
 *
 * A `bakeProbe` reaches `parseClassLiteral` with `fromClassAttribute` handed
 * to it, so it proves what the parser does with that evidence and nothing at
 * all about where the evidence comes from. The row below claims something
 * narrower: the collector records a literal only where it IS, on some
 * execution, the whole value of a `class=` attribute. Three edges decide it,
 * and each of them is a row below:
 *
 *   - a concatenation operand is not the value. `"animate-lid-"` in
 *     `class={"animate-lid-" + which()}` is never the class the node gets, and
 *     refusing one would report a half-token nobody wrote.
 *   - a backtick with nothing interpolated IS the value, and upstream refuses
 *     only an interpolated one. Missing it meant a single quote character
 *     decided whether a misspelt animation was loud or silent.
 *   - the left operand of `&&` is never the value, because a non-empty string
 *     is truthy. `||` and `??` are not the same and take both arms.
 *
 * These run the real transform and hold the recorded set exactly.
 */
export interface CollectProbe {
  /** What the author wrote. Names the case in a failure message. */
  readonly what: string;
  /** A module, compiled by `transformFile` the way a build compiles one. */
  readonly source: string;
  /** Every literal the collector must report, and no others. Order-free. */
  readonly records: readonly string[];
}

/**
 * A frame's geometry, given directly, and the codes it must produce.
 *
 * The finding codes are not sidecar keys and have no diagnostics: they are read
 * off a rendered frame by `src/render/findings.ts`, which takes boxes and
 * visibility verdicts and returns codes. So a row for one is probed by handing
 * that function a geometry and asserting what comes back — the boxes here are
 * the ones `compositions/layout-codes` actually produces, copied out of
 * `layout --json` rather than invented, so a row and its fixture cannot drift
 * into describing different pictures.
 */
export interface FindingProbe {
  /** What the geometry is. Names the case in a failure message. */
  readonly what: string;
  readonly viewport: readonly [number, number];
  readonly nodes: readonly FindingProbeNode[];
  /** `layoutAllow` entries in force. */
  readonly allow?: readonly {
    readonly node: string;
    readonly allow: "overlap" | "overflow" | "occlusion" | "canvas";
    readonly reason: string;
  }[];
  /** Every ACTIVE finding, as `code:name`, sorted. Exact — a probe that
   *  produced an extra code would be a predicate firing where nobody said. */
  readonly expect: readonly string[];
}

export interface FindingProbeNode {
  readonly id: number;
  readonly name?: string;
  readonly text?: string;
  /** x, y, w, h. */
  readonly box: readonly [number, number, number, number];
  readonly inPicture: boolean;
  readonly visibility?: "on-screen" | "covered" | "declared-invisible";
  /** x, y, w, h of the pixels it contributes, `null` for none, absent for
   *  "not measured" — the three states `probe()` distinguishes. */
  readonly ink?: readonly [number, number, number, number] | null;
  /** id of the nearest ancestor with a box. */
  readonly container?: number;
}

export interface CapabilityRow {
  /** Stable id, e.g. "sidecar.fps", "footage.tile", "assets.image". */
  readonly id: string;
  readonly group:
    | "sidecar"
    | "footage"
    | "fonts"
    | "sound"
    | "assets"
    | "animation"
    | "paint"
    | "declare"
    | "output"
    | "layout";
  /** Where the author writes it: "pocket-motion.json", "class literal", "<dir>/images.json", … */
  readonly declaredIn: string;
  /** The key or trigger as an author types it: "fps", "footage[].tile", 'src="*.png"'. */
  readonly key: string;
  readonly required: boolean;
  /** Rendered literal, or null when there is no default. */
  readonly defaultValue: string | null;
  /** One line, stating the mechanism. No slogans. */
  readonly constraint: string;
  /** The file that implements it, repo-relative, with a line number where it is one site. */
  readonly source: string;
  readonly verification: Verification;
  /** Diagnostic codes this row owns. Every code in the codebase belongs to exactly one row. */
  readonly diagnostics: readonly string[];
  /** For `verification: "probed"` rows: one or more inputs proving each code above. */
  readonly probes: readonly Probe[];
  /** For `verification: "pinned"` rows: exact substrings that must be present in `source`. */
  readonly pinned: readonly string[];
  /**
   * Build-time inputs run against the vendored compiler (G6). Optional rather
   * than a required empty array: only the `animation` group has any, and the
   * sidecar rows would carry thirty empty ones to say so.
   */
  readonly bakeProbes?: readonly BakeProbe[];
  /**
   * Modules run through the vendored collector (G7). Same reason as
   * `bakeProbes` for being optional: one row makes a claim about where a
   * literal was written, and it is the only one that can.
   */
  readonly collectProbes?: readonly CollectProbe[];
  /**
   * Geometries run through `findingsFor` (G8). Optional for the same reason as
   * the two above: only the `layout` group has any.
   */
  readonly findingProbes?: readonly FindingProbe[];
}

const MIN = {
  motion: 1 as const,
  durationFrames: 90,
  fps: 30,
};

const TRACK = {
  id: "a-roll",
  src: "clip.mp4",
  nodePrefix: "footage:a-roll",
  tile: 512,
  grid: [4, 3] as const,
};

const FACE = {
  regular: "assets/fonts/NotoSansSC-Regular.otf",
  bold: "assets/fonts/NotoSansSC-Bold.otf",
};

function omitRoot(...keys: readonly (keyof typeof MIN)[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...MIN };
  for (const key of keys) delete out[key];
  return out;
}

function track(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...TRACK, ...overrides };
}

function trackWithout(...keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...TRACK };
  for (const key of keys) delete out[key];
  return out;
}

function withTrack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...MIN, footage: [track(overrides)] };
}

function withTrackMissing(...keys: readonly string[]): Record<string, unknown> {
  return { ...MIN, footage: [trackWithout(...keys)] };
}

function withFonts(fonts: unknown): Record<string, unknown> {
  return { ...MIN, fonts };
}

const ALLOWANCE = {
  node: "caption",
  allow: "overlap",
  reason: "the lower third sits over it on purpose",
};

function allowance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...ALLOWANCE, ...overrides };
}

function allowanceWithout(...keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ALLOWANCE };
  for (const key of keys) delete out[key];
  return out;
}

function withSound(sound: unknown): Record<string, unknown> {
  return { ...MIN, sound };
}

function bed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { src: "assets/audio/bed.mp3", ...overrides };
}

function narrationLine(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: "vo-1", src: "assets/audio/vo.wav", startFrame: 0, ...overrides };
}

function dialogueLine(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "dl-1",
    src: "assets/audio/line.wav",
    track: "a-roll",
    sourceFrame: 0,
    ...overrides,
  };
}

function cueLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "hit-1", src: "assets/audio/sfx/x.mp3", atFrame: 0, ...overrides };
}

function withNarration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return withSound({ narration: [narrationLine(overrides)] });
}

function withCue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return withSound({ cues: [cueLine(overrides)] });
}

function withDialogue(
  overrides: Record<string, unknown> = {},
  footageOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...MIN,
    footage: [track(footageOverrides)],
    sound: { dialogue: [dialogueLine(overrides)] },
  };
}

export const SURFACE: readonly CapabilityRow[] = [
  // -------------------------------------------------------------------------
  // Sidecar root
  // -------------------------------------------------------------------------
  {
    id: "sidecar.motion",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "motion",
    required: true,
    defaultValue: null,
    constraint: "must be exactly 1; a non-object sidecar is rejected here too",
    source: "src/manifest/sidecar.ts:338",
    verification: "probed",
    diagnostics: ["sidecar.notObject", "sidecar.unknownKey", "sidecar.motion.required", "sidecar.motion.invalid"],
    probes: [
      { code: "sidecar.notObject", input: null },
      { code: "sidecar.unknownKey", input: { ...MIN, nope: 1 } },
      { code: "sidecar.motion.required", input: omitRoot("motion") },
      { code: "sidecar.motion.invalid", input: { ...MIN, motion: 2 } },
    ],
    pinned: [],
  },
  {
    id: "sidecar.durationFrames",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "durationFrames",
    required: true,
    defaultValue: null,
    constraint: `integer ${DURATION_FRAMES_MIN}..${DURATION_FRAMES_MAX} (2 hours at 30 fps)`,
    source: "src/manifest/sidecar.ts:356",
    verification: "probed",
    diagnostics: [
      "sidecar.durationFrames.required",
      "sidecar.durationFrames.notInteger",
      "sidecar.durationFrames.outOfRange",
    ],
    probes: [
      { code: "sidecar.durationFrames.required", input: omitRoot("durationFrames") },
      { code: "sidecar.durationFrames.notInteger", input: { ...MIN, durationFrames: 1.5 } },
      { code: "sidecar.durationFrames.outOfRange", input: { ...MIN, durationFrames: 0 } },
      {
        code: "sidecar.durationFrames.outOfRange",
        input: { ...MIN, durationFrames: DURATION_FRAMES_MAX + 1 },
      },
    ],
    pinned: [],
  },
  {
    id: "sidecar.fps",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "fps",
    required: true,
    defaultValue: null,
    constraint: `integer that divides 60 exactly (${VALID_FPS.join(",")})`,
    source: "src/manifest/sidecar.ts:389",
    verification: "probed",
    diagnostics: ["sidecar.fps.required", "sidecar.fps.notInteger", "sidecar.fps.notDivisorOf60"],
    probes: [
      { code: "sidecar.fps.required", input: omitRoot("fps") },
      { code: "sidecar.fps.notInteger", input: { ...MIN, fps: 30.5 } },
      { code: "sidecar.fps.notDivisorOf60", input: { ...MIN, fps: 24 } },
    ],
    pinned: [],
  },
  {
    id: "sidecar.supersample",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "supersample",
    required: false,
    defaultValue: "1",
    constraint: `one of ${SUPERSAMPLE_VALUES.join(", ")}; default 1 when absent`,
    source: "src/manifest/sidecar.ts:419",
    verification: "probed",
    diagnostics: ["sidecar.supersample.invalid"],
    probes: [{ code: "sidecar.supersample.invalid", input: { ...MIN, supersample: 3 } }],
    pinned: [],
  },
  {
    id: "sidecar.footage",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "footage",
    required: false,
    defaultValue: "[]",
    constraint: "array of track objects; default [] when absent",
    source: "src/manifest/sidecar.ts:486",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.notArray",
      "sidecar.footage.notObject",
      "sidecar.footage.unknownKey",
    ],
    probes: [
      { code: "sidecar.footage.notArray", input: { ...MIN, footage: {} } },
      { code: "sidecar.footage.notObject", input: { ...MIN, footage: ["nope"] } },
      { code: "sidecar.footage.unknownKey", input: withTrack({ typo: 1 }) },
    ],
    pinned: [],
  },
  {
    id: "sidecar.fonts",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "fonts",
    required: false,
    defaultValue: null,
    constraint: "object with regular and bold paths (the default face) and optional named `faces`, or absent for the build default face",
    source: "src/manifest/sidecar.ts:435",
    verification: "probed",
    diagnostics: ["sidecar.fonts.notObject", "sidecar.fonts.unknownKey", "sidecar.fonts.missing"],
    probes: [
      { code: "sidecar.fonts.notObject", input: withFonts("nope") },
      { code: "sidecar.fonts.unknownKey", input: withFonts({ ...FACE, italic: "x.ttf" }) },
      { code: "sidecar.fonts.missing", input: withFonts({ regular: FACE.regular }) },
    ],
    pinned: [],
  },
  {
    id: "sidecar.sound",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "sound",
    required: false,
    defaultValue: "{ narration: [], dialogue: [], cues: [] }",
    constraint:
      "optional object of bed / narration / dialogue / cues; absent materialises empty arrays and omits bed. ids are one namespace across narration, dialogue and cues",
    source: "src/manifest/sidecar.ts:523",
    verification: "probed",
    diagnostics: [
      "sidecar.sound.notObject",
      "sidecar.sound.unknownKey",
      "sidecar.sound.id.duplicate",
    ],
    probes: [
      { code: "sidecar.sound.notObject", input: withSound("nope") },
      { code: "sidecar.sound.unknownKey", input: withSound({ typo: 1 }) },
      {
        code: "sidecar.sound.id.duplicate",
        input: withSound({
          narration: [narrationLine({ id: "same" })],
          cues: [cueLine({ id: "same" })],
        }),
      },
    ],
    pinned: [],
  },

  {
    id: "sidecar.layoutAllow",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "layoutAllow",
    required: false,
    defaultValue: "[]",
    constraint:
      "array of { node, allow, reason }; `node` is a debugName, `allow` is one of overlap / overflow / occlusion / canvas, `reason` is a non-empty sentence. One entry per node+scope. Suppresses the matching `layout` finding codes and never changes a pixel",
    source: "src/manifest/sidecar.ts:594",
    verification: "probed",
    diagnostics: [
      "sidecar.layoutAllow.notArray",
      "sidecar.layoutAllow.notObject",
      "sidecar.layoutAllow.unknownKey",
      "sidecar.layoutAllow.node",
      "sidecar.layoutAllow.allow",
      "sidecar.layoutAllow.reason",
      "sidecar.layoutAllow.duplicate",
    ],
    probes: [
      { code: "sidecar.layoutAllow.notArray", input: { ...MIN, layoutAllow: {} } },
      { code: "sidecar.layoutAllow.notObject", input: { ...MIN, layoutAllow: ["caption"] } },
      {
        code: "sidecar.layoutAllow.unknownKey",
        input: { ...MIN, layoutAllow: [allowance({ note: "why" })] },
      },
      {
        code: "sidecar.layoutAllow.node",
        input: { ...MIN, layoutAllow: [allowanceWithout("node")] },
      },
      {
        code: "sidecar.layoutAllow.allow",
        input: { ...MIN, layoutAllow: [allowance({ allow: "occulsion" })] },
      },
      {
        code: "sidecar.layoutAllow.reason",
        input: { ...MIN, layoutAllow: [allowance({ reason: "   " })] },
      },
      {
        code: "sidecar.layoutAllow.duplicate",
        input: { ...MIN, layoutAllow: [allowance(), allowance()] },
      },
    ],
    pinned: [],
  },

  {
    id: "sidecar.assertions",
    group: "sidecar",
    declaredIn: "pocket-motion.json",
    key: "assertions",
    required: false,
    defaultValue: "[]",
    constraint:
      "array of { node, <one predicate> }; `node` is a debugName and the predicate is exactly one of inPicture [from,to] / entersBy / exitsBy / insideBox: true / dwellFrames / before. Frame values are inside the composition's clock. Evaluated by `assert` over sampled frames; changes no pixel",
    source: "src/manifest/sidecar.ts:750",
    verification: "probed",
    diagnostics: [
      "sidecar.assertions.notArray",
      "sidecar.assertions.notObject",
      "sidecar.assertions.unknownKey",
      "sidecar.assertions.node",
      "sidecar.assertions.predicate",
      "sidecar.assertions.inPicture",
      "sidecar.assertions.frame",
      "sidecar.assertions.insideBox",
      "sidecar.assertions.dwellFrames",
      "sidecar.assertions.before",
    ],
    probes: [
      { code: "sidecar.assertions.notArray", input: { ...MIN, assertions: {} } },
      { code: "sidecar.assertions.notObject", input: { ...MIN, assertions: ["caption"] } },
      {
        code: "sidecar.assertions.unknownKey",
        input: { ...MIN, assertions: [{ node: "caption", entersBy: 3, until: 9 }] },
      },
      {
        code: "sidecar.assertions.node",
        input: { ...MIN, assertions: [{ entersBy: 3 }] },
      },
      {
        // Two predicates in one entry are two assertions sharing one verdict.
        code: "sidecar.assertions.predicate",
        input: { ...MIN, assertions: [{ node: "caption", entersBy: 3, exitsBy: 40 }] },
      },
      {
        code: "sidecar.assertions.inPicture",
        input: { ...MIN, assertions: [{ node: "caption", inPicture: [40, 3] }] },
      },
      {
        code: "sidecar.assertions.frame",
        input: { ...MIN, assertions: [{ node: "caption", entersBy: MIN.durationFrames }] },
      },
      {
        code: "sidecar.assertions.insideBox",
        input: { ...MIN, assertions: [{ node: "caption", insideBox: false }] },
      },
      {
        code: "sidecar.assertions.dwellFrames",
        input: { ...MIN, assertions: [{ node: "caption", dwellFrames: 0 }] },
      },
      {
        code: "sidecar.assertions.before",
        input: { ...MIN, assertions: [{ node: "caption", before: "" }] },
      },
    ],
    pinned: [],
  },

  // -------------------------------------------------------------------------
  // Footage tracks
  // -------------------------------------------------------------------------
  {
    id: "footage.id",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "id",
    required: true,
    defaultValue: null,
    constraint: `non-empty string matching ${ID_RE}`,
    source: "src/manifest/sidecar.ts:582",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.id.required",
      "sidecar.footage.id.notString",
      "sidecar.footage.id.empty",
      "sidecar.footage.id.invalid",
      "sidecar.footage.id.duplicate",
    ],
    probes: [
      { code: "sidecar.footage.id.required", input: withTrackMissing("id") },
      { code: "sidecar.footage.id.notString", input: withTrack({ id: 1 }) },
      { code: "sidecar.footage.id.empty", input: withTrack({ id: "" }) },
      { code: "sidecar.footage.id.invalid", input: withTrack({ id: "A-Roll" }) },
      {
        code: "sidecar.footage.id.duplicate",
        input: { ...MIN, footage: [track({ id: "same" }), track({ id: "same", src: "other.mp4" })] },
      },
    ],
    pinned: [],
  },
  {
    id: "footage.src",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "src",
    required: true,
    defaultValue: null,
    constraint: "non-empty relative path; no leading / or drive letter, no `..` segments",
    source: "src/manifest/sidecar.ts:623",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.src.required",
      "sidecar.footage.src.notString",
      "sidecar.footage.src.empty",
      "sidecar.footage.src.absolute",
      "sidecar.footage.src.traversal",
    ],
    probes: [
      { code: "sidecar.footage.src.required", input: withTrackMissing("src") },
      { code: "sidecar.footage.src.notString", input: withTrack({ src: 1 }) },
      { code: "sidecar.footage.src.empty", input: withTrack({ src: "" }) },
      { code: "sidecar.footage.src.absolute", input: withTrack({ src: "/abs/path" }) },
      { code: "sidecar.footage.src.traversal", input: withTrack({ src: "../../etc/passwd" }) },
    ],
    pinned: [],
  },
  {
    id: "footage.nodePrefix",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "nodePrefix",
    required: true,
    defaultValue: null,
    constraint: "non-empty string naming the Image nodes this track writes",
    source: "src/manifest/sidecar.ts:645",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.nodePrefix.required",
      "sidecar.footage.nodePrefix.notString",
      "sidecar.footage.nodePrefix.empty",
    ],
    probes: [
      { code: "sidecar.footage.nodePrefix.required", input: withTrackMissing("nodePrefix") },
      { code: "sidecar.footage.nodePrefix.notString", input: withTrack({ nodePrefix: 1 }) },
      { code: "sidecar.footage.nodePrefix.empty", input: withTrack({ nodePrefix: "" }) },
    ],
    pinned: [],
  },
  {
    id: "footage.tile",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "tile",
    required: true,
    defaultValue: null,
    constraint: `power of two in 1..${TEX_MAX_DIM}`,
    source: "src/manifest/sidecar.ts:674",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.tile.required",
      "sidecar.footage.tile.notInteger",
      "sidecar.footage.tile.outOfRange",
      "sidecar.footage.tile.notPowerOfTwo",
    ],
    probes: [
      { code: "sidecar.footage.tile.required", input: withTrackMissing("tile") },
      { code: "sidecar.footage.tile.notInteger", input: withTrack({ tile: 256.5 }) },
      { code: "sidecar.footage.tile.outOfRange", input: withTrack({ tile: 1024 }) },
      { code: "sidecar.footage.tile.notPowerOfTwo", input: withTrack({ tile: 500 }) },
    ],
    pinned: [],
  },
  {
    id: "footage.grid",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "grid",
    required: true,
    defaultValue: null,
    constraint: `[cols, rows] of integers >= 1 whose product is <= ${GRID_PRODUCT_MAX}`,
    source: "src/manifest/sidecar.ts:719",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.grid.required",
      "sidecar.footage.grid.invalid",
      "sidecar.footage.grid.productTooLarge",
    ],
    probes: [
      { code: "sidecar.footage.grid.required", input: withTrackMissing("grid") },
      { code: "sidecar.footage.grid.invalid", input: withTrack({ grid: [1] }) },
      { code: "sidecar.footage.grid.productTooLarge", input: withTrack({ grid: [64, 65] }) },
    ],
    pinned: [],
  },
  {
    id: "footage.startFrame",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "startFrame",
    required: false,
    defaultValue: "0",
    constraint: "integer >= 0; default 0",
    source: "src/manifest/sidecar.ts:760",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.startFrame.notInteger",
      "sidecar.footage.startFrame.outOfRange",
    ],
    probes: [
      { code: "sidecar.footage.startFrame.notInteger", input: withTrack({ startFrame: 1.5 }) },
      { code: "sidecar.footage.startFrame.outOfRange", input: withTrack({ startFrame: -1 }) },
    ],
    pinned: [],
  },
  {
    id: "footage.endFrame",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "endFrame",
    required: false,
    defaultValue: "durationFrames",
    constraint: "integer >= 0, > startFrame, <= durationFrames; default durationFrames",
    source: "src/manifest/sidecar.ts:785",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.endFrame.notInteger",
      "sidecar.footage.endFrame.outOfRange",
      "sidecar.footage.endFrame.pastDuration",
      "sidecar.footage.endFrame.notAfterStart",
    ],
    probes: [
      { code: "sidecar.footage.endFrame.notInteger", input: withTrack({ endFrame: 1.5 }) },
      { code: "sidecar.footage.endFrame.outOfRange", input: withTrack({ endFrame: -1 }) },
      { code: "sidecar.footage.endFrame.pastDuration", input: withTrack({ endFrame: 91 }) },
      {
        code: "sidecar.footage.endFrame.notAfterStart",
        input: withTrack({ startFrame: 10, endFrame: 10 }),
      },
    ],
    pinned: [],
  },
  {
    id: "footage.sourceFrame",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "sourceFrame",
    required: false,
    defaultValue: "0",
    constraint: "integer >= 0; default 0",
    source: "src/manifest/sidecar.ts:833",
    verification: "probed",
    diagnostics: [
      "sidecar.footage.sourceFrame.notInteger",
      "sidecar.footage.sourceFrame.outOfRange",
    ],
    probes: [
      { code: "sidecar.footage.sourceFrame.notInteger", input: withTrack({ sourceFrame: 2.5 }) },
      { code: "sidecar.footage.sourceFrame.outOfRange", input: withTrack({ sourceFrame: -1 }) },
    ],
    pinned: [],
  },
  {
    id: "footage.fit",
    group: "footage",
    declaredIn: "pocket-motion.json",
    key: "fit",
    required: false,
    defaultValue: null,
    constraint: `one of ${FOOTAGE_FIT_VALUES.join(", ")}; absent means source and drawn aspects already agree`,
    source: "src/manifest/sidecar.ts:856",
    verification: "probed",
    diagnostics: ["sidecar.footage.fit.invalid"],
    probes: [{ code: "sidecar.footage.fit.invalid", input: withTrack({ fit: "fill" }) }],
    pinned: [],
  },

  // -------------------------------------------------------------------------
  // Fonts
  // -------------------------------------------------------------------------
  {
    id: "fonts.regular",
    group: "fonts",
    declaredIn: "pocket-motion.json",
    key: "regular",
    required: true,
    defaultValue: null,
    constraint: "string relative path to the regular face; same path rules as footage src",
    source: "src/manifest/sidecar.ts:464",
    verification: "probed",
    diagnostics: [
      "sidecar.fonts.regular.empty",
      "sidecar.fonts.regular.absolute",
      "sidecar.fonts.regular.traversal",
    ],
    probes: [
      { code: "sidecar.fonts.regular.empty", input: withFonts({ ...FACE, regular: "" }) },
      { code: "sidecar.fonts.regular.absolute", input: withFonts({ ...FACE, regular: "/x.ttf" }) },
      {
        code: "sidecar.fonts.regular.traversal",
        input: withFonts({ ...FACE, regular: "../x.ttf" }),
      },
    ],
    pinned: [],
  },
  {
    id: "fonts.bold",
    group: "fonts",
    declaredIn: "pocket-motion.json",
    key: "bold",
    required: true,
    defaultValue: null,
    constraint: "string relative path to the bold face; same path rules as footage src",
    source: "src/manifest/sidecar.ts:464",
    verification: "probed",
    diagnostics: [
      "sidecar.fonts.bold.empty",
      "sidecar.fonts.bold.absolute",
      "sidecar.fonts.bold.traversal",
    ],
    probes: [
      { code: "sidecar.fonts.bold.empty", input: withFonts({ ...FACE, bold: "" }) },
      { code: "sidecar.fonts.bold.absolute", input: withFonts({ ...FACE, bold: "/x.ttf" }) },
      { code: "sidecar.fonts.bold.traversal", input: withFonts({ ...FACE, bold: "../x.ttf" }) },
    ],
    pinned: [],
  },
  {
    id: "fonts.faces",
    group: "fonts",
    declaredIn: "pocket-motion.json",
    key: "faces",
    required: false,
    defaultValue: null,
    constraint:
      "optional object of name -> { regular, bold }: named faces a class literal selects with `font-[name]`. A name matches /^[a-z][a-z0-9-]*$/ (the class token's own rule), at most 8 faces, both weights required per face, same path rules as footage src. The build bakes every (size, weight, face) a literal uses into its own slot, all faces sharing the core's 128-slot table (19 pinned for the default pair and mono, 109 dynamic). `resolveComposition` refuses declared font files totalling more than 64 MiB, default pair included, each distinct file once",
    source: "src/manifest/sidecar.ts",
    verification: "probed",
    diagnostics: [
      "sidecar.fonts.faces.notObject",
      "sidecar.fonts.faces.tooMany",
      "sidecar.fonts.faces.name",
      "sidecar.fonts.faces.faceNotObject",
      "sidecar.fonts.faces.unknownKey",
      "sidecar.fonts.faces.missing",
      "sidecar.fonts.faces.regular.empty",
      "sidecar.fonts.faces.regular.absolute",
      "sidecar.fonts.faces.regular.traversal",
      "sidecar.fonts.faces.bold.empty",
      "sidecar.fonts.faces.bold.absolute",
      "sidecar.fonts.faces.bold.traversal",
    ],
    probes: [
      { code: "sidecar.fonts.faces.notObject", input: withFonts({ ...FACE, faces: ["display"] }) },
      {
        code: "sidecar.fonts.faces.tooMany",
        input: withFonts({
          ...FACE,
          faces: Object.fromEntries(
            ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((n) => [n, { ...FACE }]),
          ),
        }),
      },
      { code: "sidecar.fonts.faces.name", input: withFonts({ ...FACE, faces: { Display: { ...FACE } } }) },
      { code: "sidecar.fonts.faces.faceNotObject", input: withFonts({ ...FACE, faces: { display: "x.ttf" } }) },
      {
        code: "sidecar.fonts.faces.unknownKey",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, italic: "i.ttf" } } }),
      },
      {
        code: "sidecar.fonts.faces.missing",
        input: withFonts({ ...FACE, faces: { display: { regular: FACE.regular } } }),
      },
      {
        code: "sidecar.fonts.faces.regular.empty",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, regular: "" } } }),
      },
      {
        code: "sidecar.fonts.faces.regular.absolute",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, regular: "/x.ttf" } } }),
      },
      {
        code: "sidecar.fonts.faces.regular.traversal",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, regular: "../x.ttf" } } }),
      },
      {
        code: "sidecar.fonts.faces.bold.empty",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, bold: "" } } }),
      },
      {
        code: "sidecar.fonts.faces.bold.absolute",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, bold: "/x.ttf" } } }),
      },
      {
        code: "sidecar.fonts.faces.bold.traversal",
        input: withFonts({ ...FACE, faces: { display: { ...FACE, bold: "../x.ttf" } } }),
      },
    ],
    pinned: [],
  },

  // -------------------------------------------------------------------------
  // Sound
  // -------------------------------------------------------------------------
  {
    id: "sound.bed",
    group: "sound",
    declaredIn: "pocket-motion.json",
    key: "bed",
    required: false,
    defaultValue: null,
    constraint:
      "optional object; src required (same path rules as footage src); startAt default 0; gain default 1; fadeInMs/fadeOutMs default 0",
    source: "src/manifest/sidecar.ts:949",
    verification: "probed",
    diagnostics: [
      "sidecar.sound.bed.notObject",
      "sidecar.sound.bed.unknownKey",
      "sidecar.sound.bed.src.required",
      "sidecar.sound.bed.src.notString",
      "sidecar.sound.bed.src.empty",
      "sidecar.sound.bed.src.absolute",
      "sidecar.sound.bed.src.traversal",
      "sidecar.sound.bed.startAt.notNumber",
      "sidecar.sound.bed.startAt.outOfRange",
      "sidecar.sound.bed.gain.notNumber",
      "sidecar.sound.bed.gain.outOfRange",
      "sidecar.sound.bed.fadeInMs.notInteger",
      "sidecar.sound.bed.fadeInMs.outOfRange",
      "sidecar.sound.bed.fadeOutMs.notInteger",
      "sidecar.sound.bed.fadeOutMs.outOfRange",
    ],
    probes: [
      { code: "sidecar.sound.bed.notObject", input: withSound({ bed: "x.mp3" }) },
      { code: "sidecar.sound.bed.unknownKey", input: withSound({ bed: bed({ extra: 1 }) }) },
      { code: "sidecar.sound.bed.src.required", input: withSound({ bed: {} }) },
      { code: "sidecar.sound.bed.src.notString", input: withSound({ bed: bed({ src: 1 }) }) },
      { code: "sidecar.sound.bed.src.empty", input: withSound({ bed: bed({ src: "" }) }) },
      {
        code: "sidecar.sound.bed.src.absolute",
        input: withSound({ bed: bed({ src: "/abs.mp3" }) }),
      },
      {
        code: "sidecar.sound.bed.src.traversal",
        input: withSound({ bed: bed({ src: "../x.mp3" }) }),
      },
      {
        code: "sidecar.sound.bed.startAt.notNumber",
        input: withSound({ bed: bed({ startAt: "0" }) }),
      },
      {
        code: "sidecar.sound.bed.startAt.outOfRange",
        input: withSound({ bed: bed({ startAt: -1 }) }),
      },
      { code: "sidecar.sound.bed.gain.notNumber", input: withSound({ bed: bed({ gain: NaN }) }) },
      { code: "sidecar.sound.bed.gain.outOfRange", input: withSound({ bed: bed({ gain: 9 }) }) },
      {
        code: "sidecar.sound.bed.fadeInMs.notInteger",
        input: withSound({ bed: bed({ fadeInMs: 1.5 }) }),
      },
      {
        code: "sidecar.sound.bed.fadeInMs.outOfRange",
        input: withSound({ bed: bed({ fadeInMs: -1 }) }),
      },
      {
        code: "sidecar.sound.bed.fadeOutMs.notInteger",
        input: withSound({ bed: bed({ fadeOutMs: 1.5 }) }),
      },
      {
        code: "sidecar.sound.bed.fadeOutMs.outOfRange",
        input: withSound({ bed: bed({ fadeOutMs: -1 }) }),
      },
    ],
    pinned: [],
  },
  {
    id: "sound.narration",
    group: "sound",
    declaredIn: "pocket-motion.json",
    key: "narration",
    required: false,
    defaultValue: "[]",
    constraint:
      "array of lines on the composition clock; id+src+startFrame required; gain default 1; duck default 1 (no duck)",
    source: "src/manifest/sidecar.ts:1035",
    verification: "probed",
    diagnostics: [
      "sidecar.sound.narration.notArray",
      "sidecar.sound.narration.notObject",
      "sidecar.sound.narration.unknownKey",
      "sidecar.sound.narration.id.required",
      "sidecar.sound.narration.id.notString",
      "sidecar.sound.narration.id.empty",
      "sidecar.sound.narration.id.invalid",
      "sidecar.sound.narration.src.required",
      "sidecar.sound.narration.src.notString",
      "sidecar.sound.narration.src.empty",
      "sidecar.sound.narration.src.absolute",
      "sidecar.sound.narration.src.traversal",
      "sidecar.sound.narration.startFrame.required",
      "sidecar.sound.narration.startFrame.notInteger",
      "sidecar.sound.narration.startFrame.outOfRange",
      "sidecar.sound.narration.startFrame.pastDuration",
      "sidecar.sound.narration.gain.notNumber",
      "sidecar.sound.narration.gain.outOfRange",
      "sidecar.sound.narration.duck.notNumber",
      "sidecar.sound.narration.duck.outOfRange",
    ],
    probes: [
      { code: "sidecar.sound.narration.notArray", input: withSound({ narration: {} }) },
      { code: "sidecar.sound.narration.notObject", input: withSound({ narration: ["nope"] }) },
      {
        code: "sidecar.sound.narration.unknownKey",
        input: withNarration({ extra: 1 }),
      },
      {
        code: "sidecar.sound.narration.id.required",
        input: withSound({
          narration: [{ src: "assets/audio/vo.wav", startFrame: 0 }],
        }),
      },
      { code: "sidecar.sound.narration.id.notString", input: withNarration({ id: 1 }) },
      { code: "sidecar.sound.narration.id.empty", input: withNarration({ id: "" }) },
      { code: "sidecar.sound.narration.id.invalid", input: withNarration({ id: "VO" }) },
      {
        code: "sidecar.sound.narration.src.required",
        input: withSound({ narration: [{ id: "vo-1", startFrame: 0 }] }),
      },
      { code: "sidecar.sound.narration.src.notString", input: withNarration({ src: 1 }) },
      { code: "sidecar.sound.narration.src.empty", input: withNarration({ src: "" }) },
      {
        code: "sidecar.sound.narration.src.absolute",
        input: withNarration({ src: "/abs.wav" }),
      },
      {
        code: "sidecar.sound.narration.src.traversal",
        input: withNarration({ src: "../x.wav" }),
      },
      {
        code: "sidecar.sound.narration.startFrame.required",
        input: withSound({ narration: [{ id: "vo-1", src: "assets/audio/vo.wav" }] }),
      },
      {
        code: "sidecar.sound.narration.startFrame.notInteger",
        input: withNarration({ startFrame: 1.5 }),
      },
      {
        code: "sidecar.sound.narration.startFrame.outOfRange",
        input: withNarration({ startFrame: -1 }),
      },
      {
        code: "sidecar.sound.narration.startFrame.pastDuration",
        input: withNarration({ startFrame: 91 }),
      },
      { code: "sidecar.sound.narration.gain.notNumber", input: withNarration({ gain: NaN }) },
      { code: "sidecar.sound.narration.gain.outOfRange", input: withNarration({ gain: 9 }) },
      { code: "sidecar.sound.narration.duck.notNumber", input: withNarration({ duck: NaN }) },
      { code: "sidecar.sound.narration.duck.outOfRange", input: withNarration({ duck: 1.5 }) },
    ],
    pinned: [],
  },
  {
    id: "sound.dialogue",
    group: "sound",
    declaredIn: "pocket-motion.json",
    key: "dialogue",
    required: false,
    defaultValue: "[]",
    constraint:
      "array of lines on the clip clock; track must be a declared footage[].id; derived composition frame must fall inside that track's window",
    source: "src/manifest/sidecar.ts:1132",
    verification: "probed",
    diagnostics: [
      "sidecar.sound.dialogue.notArray",
      "sidecar.sound.dialogue.notObject",
      "sidecar.sound.dialogue.unknownKey",
      "sidecar.sound.dialogue.id.required",
      "sidecar.sound.dialogue.id.notString",
      "sidecar.sound.dialogue.id.empty",
      "sidecar.sound.dialogue.id.invalid",
      "sidecar.sound.dialogue.src.required",
      "sidecar.sound.dialogue.src.notString",
      "sidecar.sound.dialogue.src.empty",
      "sidecar.sound.dialogue.src.absolute",
      "sidecar.sound.dialogue.src.traversal",
      "sidecar.sound.dialogue.track.required",
      "sidecar.sound.dialogue.track.notString",
      "sidecar.sound.dialogue.track.unknown",
      "sidecar.sound.dialogue.sourceFrame.required",
      "sidecar.sound.dialogue.sourceFrame.notInteger",
      "sidecar.sound.dialogue.sourceFrame.outOfRange",
      "sidecar.sound.dialogue.gain.notNumber",
      "sidecar.sound.dialogue.gain.outOfRange",
      "sidecar.sound.dialogue.outsideWindow",
    ],
    probes: [
      { code: "sidecar.sound.dialogue.notArray", input: withSound({ dialogue: {} }) },
      { code: "sidecar.sound.dialogue.notObject", input: withSound({ dialogue: ["nope"] }) },
      { code: "sidecar.sound.dialogue.unknownKey", input: withDialogue({ extra: 1 }) },
      {
        code: "sidecar.sound.dialogue.id.required",
        input: {
          ...MIN,
          footage: [track()],
          sound: {
            dialogue: [
              { src: "assets/audio/line.wav", track: "a-roll", sourceFrame: 0 },
            ],
          },
        },
      },
      { code: "sidecar.sound.dialogue.id.notString", input: withDialogue({ id: 1 }) },
      { code: "sidecar.sound.dialogue.id.empty", input: withDialogue({ id: "" }) },
      { code: "sidecar.sound.dialogue.id.invalid", input: withDialogue({ id: "DL" }) },
      {
        code: "sidecar.sound.dialogue.src.required",
        input: {
          ...MIN,
          footage: [track()],
          sound: {
            dialogue: [{ id: "dl-1", track: "a-roll", sourceFrame: 0 }],
          },
        },
      },
      { code: "sidecar.sound.dialogue.src.notString", input: withDialogue({ src: 1 }) },
      { code: "sidecar.sound.dialogue.src.empty", input: withDialogue({ src: "" }) },
      { code: "sidecar.sound.dialogue.src.absolute", input: withDialogue({ src: "/abs.wav" }) },
      {
        code: "sidecar.sound.dialogue.src.traversal",
        input: withDialogue({ src: "../x.wav" }),
      },
      {
        code: "sidecar.sound.dialogue.track.required",
        input: {
          ...MIN,
          footage: [track()],
          sound: {
            dialogue: [{ id: "dl-1", src: "assets/audio/line.wav", sourceFrame: 0 }],
          },
        },
      },
      { code: "sidecar.sound.dialogue.track.notString", input: withDialogue({ track: 1 }) },
      {
        code: "sidecar.sound.dialogue.track.unknown",
        input: withSound({ dialogue: [dialogueLine()] }),
      },
      {
        code: "sidecar.sound.dialogue.sourceFrame.required",
        input: {
          ...MIN,
          footage: [track()],
          sound: {
            dialogue: [{ id: "dl-1", src: "assets/audio/line.wav", track: "a-roll" }],
          },
        },
      },
      {
        code: "sidecar.sound.dialogue.sourceFrame.notInteger",
        input: withDialogue({ sourceFrame: 1.5 }),
      },
      {
        code: "sidecar.sound.dialogue.sourceFrame.outOfRange",
        input: withDialogue({ sourceFrame: -1 }),
      },
      { code: "sidecar.sound.dialogue.gain.notNumber", input: withDialogue({ gain: NaN }) },
      { code: "sidecar.sound.dialogue.gain.outOfRange", input: withDialogue({ gain: 9 }) },
      {
        code: "sidecar.sound.dialogue.outsideWindow",
        input: withDialogue(
          { sourceFrame: 15 },
          { startFrame: 10, endFrame: 20, sourceFrame: 0 },
        ),
      },
    ],
    pinned: [],
  },
  {
    id: "sound.cues",
    group: "sound",
    declaredIn: "pocket-motion.json",
    key: "cues",
    required: false,
    defaultValue: "[]",
    constraint:
      "array of beat-pinned spot effects on the composition clock; id+src+atFrame required; gain default 1",
    source: "src/manifest/sidecar.ts:1251",
    verification: "probed",
    diagnostics: [
      "sidecar.sound.cues.notArray",
      "sidecar.sound.cues.notObject",
      "sidecar.sound.cues.unknownKey",
      "sidecar.sound.cues.id.required",
      "sidecar.sound.cues.id.notString",
      "sidecar.sound.cues.id.empty",
      "sidecar.sound.cues.id.invalid",
      "sidecar.sound.cues.src.required",
      "sidecar.sound.cues.src.notString",
      "sidecar.sound.cues.src.empty",
      "sidecar.sound.cues.src.absolute",
      "sidecar.sound.cues.src.traversal",
      "sidecar.sound.cues.atFrame.required",
      "sidecar.sound.cues.atFrame.notInteger",
      "sidecar.sound.cues.atFrame.outOfRange",
      "sidecar.sound.cues.atFrame.pastDuration",
      "sidecar.sound.cues.gain.notNumber",
      "sidecar.sound.cues.gain.outOfRange",
    ],
    probes: [
      { code: "sidecar.sound.cues.notArray", input: withSound({ cues: {} }) },
      { code: "sidecar.sound.cues.notObject", input: withSound({ cues: ["nope"] }) },
      { code: "sidecar.sound.cues.unknownKey", input: withCue({ extra: 1 }) },
      {
        code: "sidecar.sound.cues.id.required",
        input: withSound({ cues: [{ src: "assets/audio/sfx/x.mp3", atFrame: 0 }] }),
      },
      { code: "sidecar.sound.cues.id.notString", input: withCue({ id: 1 }) },
      { code: "sidecar.sound.cues.id.empty", input: withCue({ id: "" }) },
      { code: "sidecar.sound.cues.id.invalid", input: withCue({ id: "HIT" }) },
      {
        code: "sidecar.sound.cues.src.required",
        input: withSound({ cues: [{ id: "hit-1", atFrame: 0 }] }),
      },
      { code: "sidecar.sound.cues.src.notString", input: withCue({ src: 1 }) },
      { code: "sidecar.sound.cues.src.empty", input: withCue({ src: "" }) },
      { code: "sidecar.sound.cues.src.absolute", input: withCue({ src: "/abs.mp3" }) },
      { code: "sidecar.sound.cues.src.traversal", input: withCue({ src: "../x.mp3" }) },
      {
        code: "sidecar.sound.cues.atFrame.required",
        input: withSound({ cues: [{ id: "hit-1", src: "assets/audio/sfx/x.mp3" }] }),
      },
      { code: "sidecar.sound.cues.atFrame.notInteger", input: withCue({ atFrame: 1.5 }) },
      { code: "sidecar.sound.cues.atFrame.outOfRange", input: withCue({ atFrame: -1 }) },
      { code: "sidecar.sound.cues.atFrame.pastDuration", input: withCue({ atFrame: 91 }) },
      { code: "sidecar.sound.cues.gain.notNumber", input: withCue({ gain: NaN }) },
      { code: "sidecar.sound.cues.gain.outOfRange", input: withCue({ gain: 9 }) },
    ],
    pinned: [],
  },

  // -------------------------------------------------------------------------
  // Assets (discovered, not declared)
  // -------------------------------------------------------------------------
  {
    id: "assets.image",
    group: "assets",
    declaredIn: "class literal",
    key: 'src="*.png"',
    required: false,
    defaultValue: null,
    constraint:
      "a class-literal string matching /^[\\w./-]+\\.(?:png|svg)$/i is an asset name; looked for in the composition dir, then assets/images/ and assets/ INSIDE THE VENDORED TREE — build.ts resolves those two against its own root, not this repository's",
    source: "vendor/pocketjs/tools/build.ts:344-347",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      "/^[\\w./-]+\\.(?:png|svg)$/i",
      "assets/images/",
      'join(ROOT, "assets/"',
    ],
  },
  {
    id: "assets.image.dims",
    group: "assets",
    declaredIn: "class literal",
    key: "image dimensions",
    required: false,
    defaultValue: null,
    constraint: `each side 1..2048 px, a power of two or not (patches/0020, class motion: the software rasteriser samples by width and height); encodeImageEntry throws otherwise, naming the size. Sprite atlases and tilesets keep powers of two at most ${TEX_MAX_DIM}, and so do footage tiles (footage[].tile). A 2048x2048 image is 16 MiB in the pak and again in the core`,
    source: "vendor/pocketjs/framework/compiler/pak.ts:166",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ["IMG_MAX_DIM", "each side must be 1..", "encodeImageEntry"],
  },
  {
    id: "assets.image.missing",
    group: "assets",
    declaredIn: "class literal",
    key: "missing image",
    required: false,
    defaultValue: "32x32 placeholder",
    constraint:
      "a file the BUILD cannot find is not an error there: it bakes a 32×32 placeholder and everything downstream succeeds — valid pak, clean realm, stable reproducible digest. `lint` and `check` refuse it instead; see assets.image.missing.lint",
    source: "vendor/pocketjs/tools/build.ts:377-378",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ["placeholderImage()", "32x32 placeholder"],
  },
  {
    id: "assets.image.missing.lint",
    group: "assets",
    declaredIn: "class literal",
    key: "missing image (refused)",
    required: false,
    defaultValue: null,
    constraint:
      "`lint` and `check` fail with `images.missingFile` when a referenced name is on disk in none of the three places, naming the module, line and every path tried; discovery mirrors the build's — the same regex, string literals only, over the entry and the relative imports reachable from it. Fixture: compositions/missing-image",
    source: "src/lint/images.ts:49",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      'export const CODE_IMAGE_MISSING = "images.missingFile";',
      "/^[\\w./-]+\\.(?:png|svg)$/i",
      'join(upstream, "assets/images", name)',
    ],
  },
  {
    id: "assets.images-json",
    group: "assets",
    declaredIn: "<compositionDir>/images.json",
    key: "images.json",
    required: false,
    defaultValue: null,
    constraint: "<compositionDir>/images.json sets a per-image psm",
    source: "vendor/pocketjs/tools/build.ts:340",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ['join(appDir, "images.json")', "psm"],
  },
  {
    id: "assets.sprites-json",
    group: "assets",
    declaredIn: "<compositionDir>/sprites.json",
    key: "sprites.json",
    required: false,
    defaultValue: null,
    constraint: "<compositionDir>/sprites.json bakes an image as a sprite atlas instead of a still",
    source: "vendor/pocketjs/tools/build.ts:328",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ['join(appDir, "sprites.json")', "sprite-atlas"],
  },

  // -------------------------------------------------------------------------
  // Animation (pocket.config.ts theme + class literals)
  //
  // Motion is the largest part of the authoring surface and had no rows at
  // all until this section: everything below lived in `AUTHORING.md` prose and
  // compiler comments, which `AGENTS.md` already names as the category that
  // goes stale most often. Every refusal here is constructible, so the rows
  // are `probed` wherever the compiler actually rejects something.
  // -------------------------------------------------------------------------
  {
    id: "animation.config",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "pocket.config.ts",
    required: false,
    defaultValue: null,
    constraint:
      "a composition directory may carry its own pocket.config.ts; the build loads the one beside the entry, and its theme.keyframes / theme.animation are the only source of named animations",
    source: "vendor/pocketjs/tools/build.ts:170",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ['join(dirname(requestedEntry), "pocket.config.ts")'],
  },
  {
    id: "animation.class",
    group: "animation",
    declaredIn: "class literal",
    key: "animate-<name>",
    required: false,
    defaultValue: null,
    constraint:
      "binds a theme.animation entry to the node; a name no theme declares is refused and the message lists the declared names. The refusal needs evidence that the literal IS a class, because every string literal in the module reaches this parser: either the literal was the whole value of a JSX class= attribute, which the collector records (patches/0012), or some other token in it parsed. Neither holds for a class built by concatenation or interpolation — an operand of + and a quasi of an interpolated template are never the whole value, are not recorded, and still drop silently. A backtick with nothing interpolated into it IS the whole value and is recorded",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts:592",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a misspelt name in a literal whose other tokens are utilities",
        animation: { present: { value: "appear 1s" } },
        literals: ["animate-absent text-[20px] text-white"],
        outcome: { refuses: "names no animation. theme.animation declares" },
      },
      {
        what: "the message enumerates the built-ins as well as the theme",
        animation: { present: { value: "appear 1s" } },
        literals: ["animate-absent text-[20px]"],
        outcome: { refuses: "bounce, ping, present, pulse, spin" },
      },
      {
        what: "the same misspelling with nothing else, from nowhere in particular",
        animation: { present: { value: "appear 1s" } },
        literals: ["animate-absent"],
        outcome: { dropsLiteral: true },
      },
      {
        what: "the same misspelling with nothing else, from a class= attribute",
        animation: { present: { value: "appear 1s" } },
        literals: ["animate-absent"],
        fromClassAttribute: true,
        outcome: { refuses: "names no animation. theme.animation declares" },
      },
      {
        what: "a correct lone animation from a class= attribute still bakes",
        animation: { present: { value: "appear 1s" } },
        literals: ["animate-present"],
        fromClassAttribute: true,
        outcome: { bakes: true },
      },
      {
        what: "prose that mentions a name the theme does declare",
        animation: { present: { value: "appear 1s" } },
        literals: ["use animate-present on the title"],
        outcome: { dropsLiteral: true },
      },
      {
        what: "the same literal with the declared name",
        animation: { present: { value: "appear 1s" } },
        literals: ["animate-present text-[20px] text-white"],
        outcome: { bakes: true },
      },
    ],
    collectProbes: [
      {
        what: "a direct class= attribute",
        source: 'export const A = () => <div class="animate-a p-2" />;',
        records: ["animate-a p-2"],
      },
      {
        what: "both arms of a ternary of full literals",
        source: 'export const A = (p: any) => <div class={p.on ? "animate-a p-2" : "animate-b p-2"} />;',
        records: ["animate-a p-2", "animate-b p-2"],
      },
      {
        what: "the literal arm of a short-circuit",
        source: 'export const A = (p: any) => <div class={p.on && "animate-a p-2"} />;',
        records: ["animate-a p-2"],
      },
      {
        what: "a concatenation, whose operands are fragments and not the value",
        source: 'export const A = (p: any) => <div class={"animate-lid-" + p.which()} />;',
        records: [],
      },
      {
        what: "a concatenation of literals only — still fragments",
        source: 'export const A = () => <div class={"animate-" + "lid" + " p-2"} />;',
        records: [],
      },
      {
        what: "a value the pass cannot read at all",
        source: "export const A = (p: any) => <div class={p.cls()} />;",
        records: [],
      },
      {
        what: "a literal in some other attribute, which is not a class",
        source: 'export const A = () => <div debugName="animate-a p-2" />;',
        records: [],
      },
      {
        what: "a backtick with nothing interpolated, which is the whole value",
        source: "export const A = () => <div class={`animate-a p-2`} />;",
        records: ["animate-a p-2"],
      },
      {
        what: "a backtick arm of a ternary, same as its quoted sibling",
        source:
          "export const A = (p: any) => <div class={p.on ? `animate-a p-2` : \"animate-b p-2\"} />;",
        records: ["animate-a p-2", "animate-b p-2"],
      },
      {
        what: "an INTERPOLATED backtick arm, which is a fragment like a +",
        source:
          "export const A = (p: any) => <div class={p.on ? `animate-${p.x} p-2` : \"animate-b p-2\"} />;",
        records: ["animate-b p-2"],
      },
      {
        what: "the left of &&, which a truthy string never lets be the value",
        source: 'export const A = () => <div class={"animate-never p-2" && "animate-a p-2"} />;',
        records: ["animate-a p-2"],
      },
      {
        what: "the left of ||, which IS the value when it is a truthy string",
        source: 'export const A = (p: any) => <div class={"animate-a p-2" || p.other} />;',
        records: ["animate-a p-2"],
      },
      {
        what: "the left of ??, which is the value unless it is null",
        source: 'export const A = (p: any) => <div class={"animate-a p-2" ?? p.other} />;',
        records: ["animate-a p-2"],
      },
    ],
  },
  {
    id: "animation.builtin",
    group: "animation",
    declaredIn: "class literal",
    key: "animate-spin | ping | pulse | bounce",
    required: false,
    defaultValue: null,
    constraint:
      "four animations exist with no config at all (tailwindcss defaultTheme); bounce's translate of -25% is not bakeable and pins -25% of the 1.5rem default, -6px",
    source: "vendor/pocketjs/framework/compiler/animation.ts:76",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      "BUILTIN_ANIMATION",
      "spin 1s linear infinite",
      "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      "bounce 1s ease-in-out infinite",
    ],
    bakeProbes: [
      { what: "animate-spin with an empty theme", literals: ["animate-spin"], outcome: { bakes: true } },
      { what: "animate-pulse with an empty theme", literals: ["animate-pulse"], outcome: { bakes: true } },
    ],
  },
  {
    id: "overflow.mask",
    group: "animation",
    declaredIn: "class literal",
    key: "overflow-mask",
    required: false,
    defaultValue: null,
    constraint:
      "clips the node's children AND its own ground to the node's outline — its rounded rectangle under its transform — where `overflow-hidden` clips to the axis-aligned bounding box. Lays out and hit-tests as `overflow-hidden`. A square-cornered, unrotated window emits no mask and is `overflow-hidden` word for word. Drawn by this repository's software rasteriser only (patches/0013, class motion): no upstream backend knows the op",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "overflow-mask compiles to Overflow.Mask (2) in the style table",
        literals: ["overflow-mask rounded-full w-[200px] h-[200px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "overflow", value: 2 } },
      },
      {
        what: "overflow-hidden still compiles to Overflow.Hidden (1)",
        literals: ["overflow-hidden w-[200px] h-[200px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "overflow", value: 1 } },
      },
      {
        what: "a misspelling drops the literal like any unknown utility",
        literals: ["overflow-masked w-[200px] h-[200px]"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },
  {
    id: "animation.shorthand",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "theme.animation[name].value",
    required: true,
    defaultValue: null,
    constraint:
      "CSS animation shorthand subset, comma list: <name> <duration> [easing] [delay] [iterations] [direction] [fill]. A duration is required and at most two times may appear; iterations is `infinite` or an integer, fill is none/forwards/backwards/both; any other token is refused",
    source: "vendor/pocketjs/framework/compiler/animation.ts:387",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a shorthand with no duration",
        animation: { bad: { value: "appear" } },
        literals: ["animate-bad"],
        outcome: { refuses: "needs a duration" },
      },
      {
        what: "a token that is neither a time, a keyword, an easing nor a keyframes name",
        animation: { bad: { value: "appear 1s wobbly" } },
        literals: ["animate-bad"],
        outcome: { refuses: "cannot parse `wobbly`" },
      },
      {
        what: "three time values where duration and delay are the only two",
        animation: { bad: { value: "appear 1s 2s 3s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "has more than two time values" },
      },
      {
        what: "infinite iterations",
        animation: { ok: { value: "appear 1s infinite" } },
        literals: ["animate-ok"],
        outcome: { bakes: true },
      },
      {
        what: "a count, a fill mode and a delay together",
        animation: { ok: { value: "appear 1s 300ms 3 both" } },
        literals: ["animate-ok"],
        outcome: { bakes: true },
      },
    ],
  },
  {
    id: "animation.easing",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "easing (shorthand slot)",
    required: false,
    defaultValue: "ease",
    constraint:
      "linear, ease, ease-in, ease-out, ease-in-out, or cubic-bezier(x1,y1,x2,y2); any other word is refused as an unknown token. Absent means CSS's initial value, ease",
    source: "vendor/pocketjs/framework/compiler/animation.ts:321",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "an easing name CSS does not have",
        animation: { bad: { value: "appear 1s swing" } },
        literals: ["animate-bad"],
        outcome: { refuses: "cannot parse `swing`" },
      },
      {
        what: "a four-parameter cubic-bezier",
        animation: { ok: { value: "appear 1s cubic-bezier(0.2,0,0,1)" } },
        literals: ["animate-ok"],
        outcome: { bakes: true },
      },
    ],
  },
  {
    id: "animation.easing.named",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "named easing curves",
    required: false,
    defaultValue: null,
    constraint:
      "the named easings bake to their canonical CSS bezier parameters rather than to the core's polynomial easing ordinals, so a baked timeline plays the browser's curve",
    source: "vendor/pocketjs/framework/compiler/animation.ts:321",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      "bezier: [0.25, 0.1, 0.25, 1]",
      "bezier: [0.42, 0, 1, 1]",
      "bezier: [0, 0, 0.58, 1]",
      "bezier: [0.42, 0, 0.58, 1]",
    ],
  },
  {
    id: "animation.direction",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "direction (shorthand slot)",
    required: false,
    defaultValue: "normal",
    constraint:
      "normal or reverse; reverse bakes flipped segments and a time-reversed easing. alternate and alternate-reverse are refused — bake the mirrored keyframes explicitly",
    source: "vendor/pocketjs/framework/compiler/animation.ts:387",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "alternate",
        animation: { bad: { value: "appear 1s alternate" } },
        literals: ["animate-bad"],
        outcome: { refuses: "bake the mirrored keyframes explicitly" },
      },
      {
        what: "reverse",
        animation: { ok: { value: "appear 1s reverse" } },
        literals: ["animate-ok"],
        outcome: { bakes: true },
      },
    ],
  },
  {
    id: "animation.keyframes",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "theme.keyframes[name]",
    required: true,
    defaultValue: null,
    constraint:
      "selectors are from, to, or N% within 0..100, and comma lists of those; anything else is refused, and a block that pins no animatable property is refused too",
    source: "vendor/pocketjs/framework/compiler/animation.ts:433",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a selector that is neither from, to nor a percentage",
        keyframes: { appear: { from: { opacity: "0" }, halfway: { opacity: "0.5" }, to: { opacity: "1" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "bad keyframe selector `halfway`" },
      },
      {
        what: "a percentage above 100",
        keyframes: { appear: { from: { opacity: "0" }, "140%": { opacity: "0.5" }, to: { opacity: "1" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "out of range" },
      },
      {
        what: "a keyframes block with no declarations",
        keyframes: { appear: {} },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "animate nothing" },
      },
      {
        what: "a comma list of selectors",
        keyframes: { appear: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } } },
        animation: { ok: { value: "appear 1s" } },
        literals: ["animate-ok"],
        outcome: { bakes: true },
      },
    ],
  },
  {
    id: "animation.value",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "keyframe value",
    required: true,
    defaultValue: null,
    constraint:
      "build-time absolute only: px lengths, degrees, colors, unitless scalars. Percentages are refused because the core has no reference box at runtime, and calc() / var() because neither resolves at build time",
    source: "vendor/pocketjs/framework/compiler/animation.ts:141",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a percentage width",
        keyframes: { appear: { from: { width: "0%" }, to: { width: "100%" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "percentages are not bakeable" },
      },
      {
        what: "calc()",
        keyframes: { appear: { from: { width: "calc(100px + 1px)" }, to: { width: "200px" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "not build-time bakeable" },
      },
      {
        what: "var()",
        keyframes: { appear: { from: { width: "var(--w)" }, to: { width: "200px" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "not build-time bakeable" },
      },
    ],
  },
  {
    id: "animation.property",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "keyframe property",
    required: true,
    defaultValue: null,
    constraint:
      "an ANIMATABLE property, camelCase or kebab-case, or `transform` decomposed into translate/translateX/Y/Z, rotate/rotateX/Y and scale/scaleX/Y (perspective is ignored — it is static). Any other property or transform function is refused",
    source: "vendor/pocketjs/framework/compiler/animation.ts:216",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a property with no baked representation",
        keyframes: { appear: { from: { boxShadow: "0" }, to: { boxShadow: "1" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "unsupported property `boxShadow`" },
      },
      {
        what: "a transform function outside the decomposed set",
        keyframes: { appear: { from: { transform: "skewX(10deg)" }, to: { transform: "skewX(0deg)" } } },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "unsupported transform function" },
      },
      {
        what: "kebab-case, and a transform that mixes functions",
        keyframes: {
          appear: {
            from: { "background-color": "#000000", transform: "translateY(40px) scale(0.9)" },
            to: { "background-color": "#ffffff", transform: "translateY(0px) scale(1)" },
          },
        },
        animation: { ok: { value: "appear 1s" } },
        literals: ["animate-ok"],
        outcome: { bakes: true },
      },
    ],
  },
  {
    id: "animation.pinned-ends",
    group: "animation",
    declaredIn: "<compositionDir>/pocket.config.ts",
    key: "first and last keyframe",
    required: true,
    defaultValue: null,
    constraint:
      "every property an animation touches must be pinned at both from/0% and to/100%; CSS falls back to the computed style at the ends, and that is not bakeable",
    source: "vendor/pocketjs/framework/compiler/animation.ts:444",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a property that appears only at 50%",
        keyframes: {
          appear: { from: { opacity: "0" }, "50%": { opacity: "0.5", width: "10px" }, to: { opacity: "1" } },
        },
        animation: { bad: { value: "appear 1s" } },
        literals: ["animate-bad"],
        outcome: { refuses: "pinned at BOTH from/0% and to/100%" },
      },
    ],
  },
  {
    id: "animation.loop",
    group: "animation",
    declaredIn: "class literal",
    key: "animate-loop-[Ns]",
    required: false,
    defaultValue: "0 (play once)",
    constraint:
      "PocketJS extension, also writable as theme.animation[name].loop: restarts the whole comma list, delays included, every N ms. It needs an animate-<name> in the same class literal, and the period bakes to ticks at the realm's rate",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts:576",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a loop period with nothing to loop",
        animation: { ok: { value: "appear 1s" } },
        literals: ["animate-loop-[4s] text-[20px]"],
        outcome: { refuses: "needs an `animate-<name>` in the same literal" },
      },
      {
        what: "a period that is not a time",
        animation: { ok: { value: "appear 1s" } },
        literals: ["animate-ok animate-loop-[4] text-[20px]"],
        outcome: { refuses: "is not a loop period" },
      },
      {
        what: "a loop period beside the animation it loops",
        animation: { ok: { value: "appear 1s" } },
        literals: ["animate-ok animate-loop-[4s]"],
        outcome: { bakes: true },
      },
    ],
  },
  {
    id: "animation.tick-rate",
    group: "animation",
    declaredIn: "build command",
    key: "--hz=N",
    required: false,
    defaultValue: "60",
    constraint:
      "the rate timelines bake at: every delay and segment endpoint is a frame count at this rate. This realm steps the core at 60, so assertBakedTickRate refuses a bundle baked at any other rate, and refuses one that declares no rate at all",
    source: "src/runtime/boot.ts:152",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ["export function assertBakedTickRate", "__pocketTickHz", "TICKS_PER_SECOND"],
  },

  // -------------------------------------------------------------------------
  // Paint: class literals the vendored compiler reads for faces, text effects,
  // gradients, filters and blend modes. Probed like the animation rows: G6
  // compiles each literal and asserts the style-table value the core reads.
  // -------------------------------------------------------------------------
  {
    id: "paint.font-face",
    group: "paint",
    declaredIn: "class literal",
    key: "font-[name]",
    required: false,
    defaultValue: null,
    constraint:
      "selects the named face `name` from the sidecar's `fonts.faces` for this node's text. Every (px, weight, face) triple gets its own atlas slot, allocated after the pinned table in first-sight order; a face takes precedence over `font-mono`. A name no `--font-face-*` flag declared fails the BUILD (bake-font.ts: \"names a face this build does not declare\"), not the compile, because the compiler has not seen the sidecar. `openMeasurer` measures per face: `sizes: [{ px, bold, face }]`, `measure(px, bold, face)`",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "font-[display] at 40px takes the first dynamic slot (19)",
        literals: ["text-[40px] font-[display]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "fontSlot", value: 19 } },
      },
      {
        what: "a face name with an upper-case letter is not a utility and drops the literal",
        literals: ["text-[40px] font-[Display]"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },

  {
    id: "paint.text-stroke",
    group: "paint",
    declaredIn: "class literal",
    key: "text-stroke-[Npx] | text-stroke-<color> | text-stroke-outside|center",
    required: false,
    defaultValue: "no stroke; outside",
    constraint:
      "an outline around a Text node's glyphs. Width `text-stroke` (1px), `text-stroke-N` or `text-stroke-[Npx]`, at most 64 px; colour `text-stroke-<palette>` or `text-stroke-[#hex]`, transparent by default, so a width alone draws nothing. `outside` (default) grows outward and is painted under the fill; `center` straddles the glyph edge and is painted over it. With `text-transparent` the stroke is hollow text: the ring only. Width and colour animate in keyframes as `textStrokeWidth`/`textStrokeColor` (or `-webkit-text-stroke-width`/`-color`). Paint only — layout never grows for it, so an outside stroke is ink past the box (`text_box_overflow`). Coverage is a distance field over the run's own rasterised coverage, drawn by this repository's rasteriser only (patches/0017, class motion, op 66)",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "text-stroke-[4px] compiles to textStrokeWidth = 4.0",
        literals: ["text-stroke-[4px] text-stroke-red-500"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "textStrokeWidth", value: 1082130432 } },
      },
      {
        what: "text-stroke-center compiles to StrokePos.Center (1)",
        literals: ["text-stroke-2 text-stroke-center"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "textStrokePos", value: 1 } },
      },
      {
        what: "text-stroke-[#ff0000] compiles to the ABGR colour",
        literals: ["text-stroke-[#ff0000] text-stroke-2"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "textStrokeColor", value: 4278190335 } },
      },
      {
        what: "a width past 64 px is not a utility and drops the literal",
        literals: ["text-stroke-[65px] text-stroke-red-500"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },

  {
    id: "paint.blur",
    group: "paint",
    declaredIn: "class literal",
    key: "blur-sm|md|lg|xl|2xl|3xl | blur | blur-none | blur-[Npx]",
    required: false,
    defaultValue: "0 (no layer)",
    constraint:
      "a gaussian blur of the node AND its subtree as one layer (CSS `filter: blur()`); the value is the standard deviation in px — Tailwind v3 steps 4/8/12/16/24/40/64 — at most 128. Keyframe-animatable as `blur` or as `filter: \"blur(Npx)\"`, continuous in the deviation. Computed at 1/2, 1/4, 1/8 resolution from 8, 16, 32 px of deviation; crossing one of those moves a channel by at most 2 levels (core test, measured 1). The blur spreads inside the clip in force at the node, never past it. No background blur. Inside a perspective (3D) subtree it is ignored. patches/0018, class motion, ops 67/68",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "blur-md compiles to blur = 12.0",
        literals: ["blur-md w-[100px] h-[100px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "blur", value: 1094713344 } },
      },
      {
        what: "blur-[2.5px] compiles to blur = 2.5",
        literals: ["blur-[2.5px] w-[100px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "blur", value: 1075838976 } },
      },
      {
        what: "a deviation past 128 px is not a utility and drops the literal",
        literals: ["blur-[129px] w-[100px]"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },
  {
    id: "paint.drop-shadow",
    group: "paint",
    declaredIn: "class literal",
    key: "drop-shadow-[X_Y_B_#hex] | drop-shadow-<color> | text-shadow-… | glow-[B] | glow-<color> | glow-gain-[N]",
    required: false,
    defaultValue: "none (colour transparent); gain 1",
    constraint:
      "a shadow of the node and its subtree made from their alpha (CSS `drop-shadow()`): offset X, Y and blur RADIUS B in px (deviation B / 2, as CSS), at most 256; the colour as the fourth value or as `drop-shadow-<palette>`/`-[#hex]`, transparent by default, so geometry alone draws nothing. `text-shadow-` is the same props under CSS's name for text; `glow-[B]` is a shadow at offset 0 with its own `glow-<color>`; `glow-gain-[N]` (0..16) multiplies the blurred alpha, clamped, which thickens a glow. Offsets round to whole physical px. Every value is keyframe-animatable as `dropShadowX/Y/Blur/Color/Gain` or as `filter: \"drop-shadow(x y b color)\"`. The shadow sits under the node, inside the clip in force at it. patches/0018, class motion",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "drop-shadow-[4px_6px_10px_#ff0000] compiles the blur radius",
        literals: ["drop-shadow-[4px_6px_10px_#ff0000] w-[10px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "dropShadowBlur", value: 1092616192 } },
      },
      {
        what: "the fourth value is the colour",
        literals: ["drop-shadow-[4px_6px_10px_#ff0000] w-[10px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "dropShadowColor", value: 4278190335 } },
      },
      {
        what: "glow-gain-[2] compiles to dropShadowGain = 2",
        literals: ["glow-[24px] glow-amber-400 glow-gain-[2]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "dropShadowGain", value: 1073741824 } },
      },
      {
        what: "one length is not a shadow and drops the literal",
        literals: ["drop-shadow-[4px] w-[10px]"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },
  {
    id: "paint.blend",
    group: "paint",
    declaredIn: "class literal",
    key: "mix-blend-normal|multiply|screen|overlay|plus-lighter|add",
    required: false,
    defaultValue: "normal (no layer)",
    constraint:
      "composites the node and its subtree, as one layer, over what is beneath by the W3C separable blend function, then source-over (CSS `mix-blend-mode`). `plus-lighter` and `add` are linear dodge, min(1, backdrop + source), composited like the others rather than as a Porter-Duff plus. Integer on 0..255 channels. patches/0018, class motion",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "mix-blend-multiply compiles to BlendMode.Multiply (1)",
        literals: ["mix-blend-multiply w-[10px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "blendMode", value: 1 } },
      },
      {
        what: "mix-blend-plus-lighter compiles to BlendMode.Add (4)",
        literals: ["mix-blend-plus-lighter w-[10px]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "blendMode", value: 4 } },
      },
      {
        what: "a mode the rasteriser does not draw drops the literal",
        literals: ["mix-blend-difference w-[10px]"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },

  {
    id: "paint.gradient",
    group: "paint",
    declaredIn: "class literal",
    key: "via-<color> | from-N% via-N% to-N% | bg-linear-N | bg-linear-[Ndeg] | bg-linear-to-t|r|b|l | bg-radial | bg-[linear-gradient(…)] | bg-[radial-gradient(…)]",
    required: false,
    defaultValue: "legacy two-stop gradient",
    constraint:
      "a gradient ground with up to six stops (from, four vias, to), at any angle in CSS's convention (0deg = to top, 90deg = to right) or radial (the farthest-corner ellipse about the centre; no other shape or centre). Stops in an arbitrary gradient are `#hex` or palette names with an optional `N%`, `_` for a space, positions fixed up as CSS does; `via-<color>` alone sits at 50%. A literal with only `bg-gradient-to-* from-* to-*` keeps the two-stop path word for word. Interpolated premultiplied, so a stop fading to transparent keeps its colour. The gradient follows the node's transform, and fills the inside of a rounded border. Angle, stop colours and stop positions animate as `gradAngle`, `gradFrom`, `gradTo`, `gradVia1..4`, `gradFromPos`, `gradToPos`, `gradVia1Pos..4Pos`. patches/0019, class motion, ops 69/70",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "a via turns a legacy direction into the paint path (GradKind.Linear)",
        literals: ["bg-gradient-to-r from-red-500 via-white to-blue-500"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "gradKind", value: 1 } },
      },
      {
        what: "and `to-r` becomes the angle 90",
        literals: ["bg-gradient-to-r from-red-500 via-white to-blue-500"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "gradAngle", value: 1119092736 } },
      },
      {
        what: "bg-radial compiles to GradKind.Radial (2)",
        literals: ["bg-radial from-white to-black"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "gradKind", value: 2 } },
      },
      {
        what: "an arbitrary gradient's unpositioned middle stop is spread by CSS's rule",
        literals: ["bg-[linear-gradient(90deg,#ff0000,#00ff00,#0000ff_80%)]"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "gradVia1Pos", value: 1053609165 } },
      },
      {
        what: "seven stops are one more than the paint carries and drop the literal",
        literals: ["bg-[linear-gradient(#000,#111,#222,#333,#444,#555,#666)]"],
        fromClassAttribute: true,
        outcome: { dropsLiteral: true },
      },
    ],
  },
  {
    id: "paint.bg-clip-text",
    group: "paint",
    declaredIn: "class literal",
    key: "bg-clip-text | bg-clip-border",
    required: false,
    defaultValue: "border",
    constraint:
      "on a Text node, paints the node's ground into its glyphs instead of its box — the gradient (legacy or not) or the solid `bg-*` colour — and the text colour is not drawn, so the Tailwind idiom `bg-clip-text text-transparent bg-linear-90 from-… to-…` is gradient text. The gradient spans the node's box. A stroke is not painted by it. patches/0019, class motion",
    source: "vendor/pocketjs/framework/compiler/tailwind.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    bakeProbes: [
      {
        what: "bg-clip-text compiles to BgClip.Text (1)",
        literals: ["bg-clip-text text-transparent bg-linear-90 from-white to-black"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "bgClip", value: 1 } },
      },
      {
        what: "over a legacy two-stop gradient it takes the paint path",
        literals: ["bg-clip-text text-transparent bg-gradient-to-b from-white to-black"],
        fromClassAttribute: true,
        outcome: { declares: { prop: "gradKind", value: 1 } },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Declaring footage (generator side)
  //
  // Not sidecar keys, so they are not in the `footage` group — G2 holds that
  // group to `FOOTAGE_KEYS` exactly, and rightly. These are the two functions
  // that WRITE those keys and the nodes they refer to, which is what an
  // author actually calls.
  // -------------------------------------------------------------------------
  {
    id: "declare.tileNodes",
    group: "declare",
    declaredIn: "<compositionDir>/gen.ts",
    key: "tileNodes / footageTrack",
    required: false,
    defaultValue: null,
    constraint:
      "the one way footage tiles are declared. `tileNodes` emits one <Image debugName=… class=\"absolute left-… top-… w-[Npx] h-[Npx]\"> per cell and `footageTrack` emits the sidecar entry, both derived from ONE drawn width and height — including `grid`, which is therefore never typed. A track is one fact written twice and the drawn size IS the ingested size, so an edit that moves both consistently stretches the picture rather than failing",
    source: "src/footage/declare.ts:63",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      "export function tileNodes(",
      "export function footageTrack(",
      'class="absolute left-[',
    ],
  },
  {
    id: "declare.tileNamedByHand",
    group: "declare",
    declaredIn: "<compositionDir>/*.ts, *.tsx",
    key: "hand-written tile name (warned)",
    required: false,
    defaultValue: null,
    constraint:
      "`lint` WARNS with `footage.tileNamedByHand` when a `<nodePrefix>/tile:<col>:<row>` name for a prefix the sidecar DECLARES appears in a string or template literal it cannot attribute to `tileNodes`. A generated file is excused when the gen.ts beside it holds no such name; a generator that builds the name itself is reported on its own line. A warning, not a finding: it reads source text, does not run generators or resolve imports, and does not decide the exit code — `openFootage` refuses a track whose tiles are actually absent",
    source: "src/lint/tiles.ts:59",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      'export const CODE_TILE_NAMED_BY_HAND = "footage.tileNamedByHand";',
      "export function lintTileNames(",
      "if (nodePrefixes.length === 0) return [];",
    ],
  },

  // -------------------------------------------------------------------------
  // Output (render flags)
  //
  // Not a declared input: nothing here can move a pixel, because frames are
  // hashed before the sink is written to. They are catalogued anyway, because
  // an author choosing a delivery format is reading for exactly the facts
  // these rows hold — which codec, which pixel format, and what `--alpha`
  // does and does not buy.
  //
  // `pinned` rather than `probed`, and the difference is real: `probed` in
  // this catalogue means an input was constructed and the PARSER refused it,
  // and none of these go near `parseSidecar`. The constraint text names the
  // test that does read the file back with ffprobe.
  // -------------------------------------------------------------------------
  {
    id: "output.format",
    group: "output",
    declaredIn: "render command",
    key: "--format",
    required: false,
    defaultValue: "mp4",
    constraint:
      "mp4 | webm | mov | png-seq. mp4 is libx264 yuv420p; webm is libvpx-vp9 yuv420p with `-b:v 0` so --crf means quality; mov is prores_ks, profile 3 (422 HQ, yuv422p10le); png-seq writes <out>/%06d.png with no ffmpeg in the path and is byte-identical to `frame --at N`. With no --format the --out extension decides; a --format that disagrees with the extension is refused rather than silently winning. Read back with ffprobe in tests/format.test.ts",
    source: "src/render/encode.ts:106",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: [
      'export const OUTPUT_FORMATS = ["mp4", "webm", "mov", "png-seq"] as const;',
      "libvpx-vp9",
      "prores_ks",
      "yuv422p10le",
    ],
  },
  {
    id: "output.alpha",
    group: "output",
    declaredIn: "render command",
    key: "--alpha",
    required: false,
    defaultValue: "off",
    constraint:
      "asks the codec for an alpha channel: mov becomes ProRes 4444 (yuva444p10le in, yuva444p12le out — the 4444 bitstream is 12-bit), webm becomes yuva420p and the container gains alpha_mode=1 while the stream's own pix_fmt stays yuv420p, png-seq always carries all four channels. Refused for mp4, whose yuv420p has no alpha plane. The channel carries the picture: the rasteriser clears to transparent black (patches/0014), so a pixel no declared ground reaches has alpha 0 and a composition with a full-bleed ground is 255 everywhere — `render` measures and prints the floor rather than restating this",
    source: "src/render/encode.ts:169",
    verification: "pinned",
    diagnostics: [],
    probes: [],
    pinned: ['alpha ? "yuva444p10le" : "yuv422p10le"', 'alpha ? "yuva420p" : "yuv420p"'],
  },

  // -------------------------------------------------------------------------
  // Layout finding codes (read off a rendered frame, not declared)
  //
  // These are the only rows nobody writes. Everything above is an input an
  // author types; a finding is an output `layout` computes from the boxes and
  // the draw list, and `layoutAllow` above is how an author answers one. The
  // geometries below are copied out of `layout --json compositions/layout-codes
  // --at 0`, so a row and its fixture cannot drift into describing different
  // pictures.
  // -------------------------------------------------------------------------
  {
    id: "layout.text_not_painted",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "text_not_painted",
    required: false,
    defaultValue: null,
    constraint:
      "a named-or-text node emitted no geometry at this frame: faded out, zero-sized, or under an ancestor at opacity 0. Normal at any frame outside the node's window; excused by layoutAllow `occlusion`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `faded`, opacity 0 on the node itself",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "faded",
            text: "declared invisible: opacity 0 on this node",
            box: [80, 40, 698, 44],
            inPicture: false,
            visibility: "declared-invisible",
          },
        ],
        expect: ["text_not_painted:faded"],
      },
      {
        what: "the same node on screen",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "faded",
            text: "declared invisible: opacity 0 on this node",
            box: [80, 40, 698, 44],
            inPicture: true,
            visibility: "on-screen",
          },
        ],
        expect: [],
      },
    ],
  },
  {
    id: "layout.text_occluded",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "text_occluded",
    required: false,
    defaultValue: null,
    constraint:
      "a named-or-text node emitted geometry and no pixel of it survived — something painted over it. Excused by layoutAllow `occlusion`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `buried`, under an opaque lid that comes after it",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "buried",
            text: "painted, and no pixel survives",
            box: [100, 140, 507, 44],
            inPicture: false,
            visibility: "covered",
          },
        ],
        expect: ["text_occluded:buried"],
      },
      {
        what: "the same burial, excused",
        viewport: [1920, 1080],
        allow: [{ node: "buried", allow: "occlusion", reason: "the lid is the point" }],
        nodes: [
          {
            id: 1,
            name: "buried",
            text: "painted, and no pixel survives",
            box: [100, 140, 507, 44],
            inPicture: false,
            visibility: "covered",
          },
        ],
        expect: [],
      },
    ],
  },
  {
    id: "layout.panel_out_of_canvas",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "panel_out_of_canvas",
    required: false,
    defaultValue: null,
    constraint:
      "the canvas clamped the node's box to zero extent against one of its edges — it is wholly off screen. Layout clips every rect to the viewport before anything can read it, so a PARTIAL overhang leaves no trace and this says nothing about one. Excused by layoutAllow `canvas`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `offscreen`, declared at x=2000 on a 1920-wide canvas",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "offscreen",
            box: [1920, 620, 0, 120],
            inPicture: false,
            visibility: "declared-invisible",
          },
        ],
        expect: ["panel_out_of_canvas:offscreen", "text_not_painted:offscreen"],
      },
      {
        what: "a zero-width node that is NOT on an edge",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "hairline",
            box: [400, 620, 0, 120],
            inPicture: false,
            visibility: "declared-invisible",
          },
        ],
        expect: ["text_not_painted:hairline"],
      },
    ],
  },
  {
    id: "layout.escaped_container",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "escaped_container",
    required: false,
    defaultValue: null,
    constraint:
      "the node's box leaves the box of its nearest ancestor that has one. Not reported when that ancestor fills the canvas, because `panel_out_of_canvas` is the reading for that edge. Excused by layoutAllow `overflow`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `escapee`, 200px past its pane's right edge",
        viewport: [1920, 1080],
        nodes: [
          { id: 1, name: "pane", box: [80, 420, 400, 140], inPicture: true, visibility: "on-screen" },
          {
            id: 2,
            name: "escapee",
            box: [380, 450, 300, 80],
            inPicture: true,
            visibility: "on-screen",
            container: 1,
          },
        ],
        expect: ["escaped_container:escapee"],
      },
      {
        what: "layout-codes `wing`, the same shape with the sidecar allowance the fixture carries",
        viewport: [1920, 1080],
        allow: [
          {
            node: "wing",
            allow: "overflow",
            reason: "the cap is drawn wider than the frame it hangs on",
          },
        ],
        nodes: [
          {
            id: 1,
            name: "cap-frame",
            box: [1200, 420, 300, 140],
            inPicture: true,
            visibility: "on-screen",
          },
          {
            id: 2,
            name: "wing",
            box: [1160, 450, 380, 60],
            inPicture: true,
            visibility: "on-screen",
            container: 1,
          },
        ],
        expect: [],
      },
      {
        what: "a node inside a container that fills the canvas",
        viewport: [1920, 1080],
        nodes: [
          { id: 1, name: "root", box: [0, 0, 1920, 1080], inPicture: true, visibility: "on-screen" },
          {
            id: 2,
            name: "bar",
            box: [0, 0, 1920, 120],
            inPicture: true,
            visibility: "on-screen",
            container: 1,
          },
        ],
        expect: [],
      },
    ],
  },
  {
    id: "layout.content_overlap",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "content_overlap",
    required: false,
    defaultValue: null,
    constraint:
      "two NAMED nodes on screen whose boxes share positive area, neither an ancestor of the other and neither containing the other. Containment is the ordinary stacking relation (text over a background) and is not reported; sharing an edge is not overlapping. Reported against both, and an allowance on either excuses the pair. Excused by layoutAllow `overlap`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `overlap-a` and `overlap-b`, sharing a corner",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "overlap-a",
            text: "the earlier run",
            box: [80, 280, 238, 44],
            inPicture: true,
            visibility: "on-screen",
          },
          {
            id: 2,
            name: "overlap-b",
            text: "the later run, over its corner",
            box: [240, 310, 476, 44],
            inPicture: true,
            visibility: "on-screen",
          },
        ],
        expect: ["content_overlap:overlap-a", "content_overlap:overlap-b"],
      },
      {
        what: "an allowance on ONE participant excusing the pair",
        viewport: [1920, 1080],
        allow: [{ node: "overlap-a", allow: "overlap", reason: "they are one lockup" }],
        nodes: [
          {
            id: 1,
            name: "overlap-a",
            text: "the earlier run",
            box: [80, 280, 238, 44],
            inPicture: true,
            visibility: "on-screen",
          },
          {
            id: 2,
            name: "overlap-b",
            text: "the later run, over its corner",
            box: [240, 310, 476, 44],
            inPicture: true,
            visibility: "on-screen",
          },
        ],
        expect: [],
      },
      {
        what: "a full-bleed background CONTAINING a caption",
        viewport: [1920, 1080],
        nodes: [
          { id: 1, name: "lid", box: [80, 120, 1000, 110], inPicture: true, visibility: "on-screen" },
          {
            id: 2,
            name: "caption",
            text: "over it",
            box: [100, 140, 507, 44],
            inPicture: true,
            visibility: "on-screen",
          },
        ],
        expect: [],
      },
      {
        what: "two tiles of one grid, sharing an edge",
        viewport: [1280, 720],
        nodes: [
          {
            id: 1,
            name: "footage:a/tile:0:0",
            box: [0, 0, 510, 360],
            inPicture: true,
            visibility: "on-screen",
          },
          {
            id: 2,
            name: "footage:a/tile:1:0",
            box: [510, 0, 130, 360],
            inPicture: true,
            visibility: "on-screen",
          },
        ],
        expect: [],
      },
    ],
  },
  {
    id: "layout.text_box_overflow",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "text_box_overflow",
    required: false,
    defaultValue: null,
    constraint:
      "the node's INK reaches outside its own border box — the glyph run is wider or taller than the box layout gave it. Measured in pixels by hiding the node, not from an advance table. Excused by layoutAllow `overflow`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `too-long`, one unbroken line in a 520px box",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "too-long",
            text: "one line with no break in it, far wider than the box",
            box: [80, 780, 520, 44],
            inPicture: true,
            visibility: "on-screen",
            ink: [81, 787, 838, 35],
          },
        ],
        expect: ["text_box_overflow:too-long"],
      },
      {
        what: "ink inside the box, one px of antialiasing aside",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "fits",
            text: "short",
            box: [80, 780, 520, 44],
            inPicture: true,
            visibility: "on-screen",
            ink: [81, 787, 300, 35],
          },
        ],
        expect: [],
      },
    ],
  },
  {
    id: "layout.clipped_text",
    group: "layout",
    declaredIn: "layout --json findings[]",
    key: "clipped_text",
    required: false,
    defaultValue: null,
    constraint:
      "the node's box crosses its container's edge and its ink stops AT that edge — an `overflow-hidden` ancestor scissored the rest away. Excused by layoutAllow `overflow`",
    source: "src/render/findings.ts",
    verification: "probed",
    diagnostics: [],
    probes: [],
    pinned: [],
    findingProbes: [
      {
        what: "layout-codes `cut-off`, a 720px box in a 300px overflow-hidden strip",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "strip",
            box: [1200, 780, 300, 70],
            inPicture: true,
            visibility: "on-screen",
          },
          {
            id: 2,
            name: "cut-off",
            text: "this run is three times the strip it rides in",
            box: [1200, 780, 720, 44],
            inPicture: true,
            visibility: "on-screen",
            ink: [1200, 788, 300, 28],
            container: 1,
          },
        ],
        expect: ["clipped_text:cut-off", "escaped_container:cut-off"],
      },
      {
        what: "the same overhang with the ink surviving outside — an escape, not a clip",
        viewport: [1920, 1080],
        nodes: [
          {
            id: 1,
            name: "strip",
            box: [1200, 780, 300, 70],
            inPicture: true,
            visibility: "on-screen",
          },
          {
            id: 2,
            name: "spills",
            text: "this run is three times the strip it rides in",
            box: [1200, 780, 720, 44],
            inPicture: true,
            visibility: "on-screen",
            ink: [1200, 788, 700, 28],
            container: 1,
          },
        ],
        expect: ["escaped_container:spills"],
      },
    ],
  },
];
