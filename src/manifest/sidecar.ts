/**
 * Parse / validate / canonicalise `pocket-motion.json`.
 *
 * Video-specific metadata cannot live in upstream `pocket.json`
 * (`additionalProperties: false` at the root). This sidecar sits alongside
 * it and is strict in the same spirit: unknown keys are errors, every
 * violation is reported, defaults are materialised on success.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** How a source whose aspect differs from the drawn size is reconciled. */
export type FootageFit = "cover" | "contain" | "stretch";

/**
 * One host-driven clip placement.
 *
 * Mapping: `sourceFrame + (compositionFrame - startFrame)`, presented only
 * while `startFrame <= compositionFrame < endFrame`.
 *
 * - `startFrame` — the composition frame at which this track begins being
 *   presented. Before it, the track is not presented at all; the tiles show
 *   whatever the guest declared. Default `0`.
 * - `endFrame` — the composition frame at which it stops, exclusive.
 *   Default: the composition's `durationFrames`.
 * - `sourceFrame` — the clip's own frame shown at `startFrame`. Default `0`.
 *   This is what lets one clip supply two different segments.
 * - `fit` — how to reconcile a source whose aspect differs from the drawn
 *   size. Absent means the aspects already agree: a mismatch without this
 *   field is a build-time error, not a silent stretch.
 *     - `cover` — fill the box, crop the overflow
 *     - `contain` — fit inside the box, pad the remainder
 *     - `stretch` — anamorphic squeeze; today's ingest, now stated
 */
export interface FootageTrack {
  readonly id: string;
  readonly src: string;
  readonly nodePrefix: string;
  readonly tile: number;
  readonly grid: readonly [cols: number, rows: number];
  readonly startFrame: number;
  readonly endFrame: number;
  readonly sourceFrame: number;
  /** How to reconcile a source whose aspect differs from the drawn size. */
  readonly fit?: FootageFit;
}

/**
 * The faces a composition is baked with.
 *
 * A font is an INPUT to the render's identity, not a preference: the same
 * composition built against another face has other advances, another atlas and
 * another digest. Until this field existed the choice lived in a `gen.ts`
 * comment, which means a recorded digest could not be reproduced from the
 * repository alone — and the build command the CLI prints when an artifact is
 * missing rebuilt with upstream's default face without saying so.
 */
export interface SidecarFonts {
  readonly regular: string;
  readonly bold: string;
  /**
   * Named faces a class literal selects with `font-[name]`, each a regular and
   * bold pair like the default above. Absent when the composition uses only
   * the default pair. Every face is an input to identity like the pair is.
   */
  readonly faces?: Readonly<Record<string, SidecarFace>>;
}

/** One named face: the files `font-[name]` bakes from. */
export interface SidecarFace {
  readonly regular: string;
  readonly bold: string;
}

/**
 * One breakpoint of a gain envelope.
 *
 * `frame` counts composition frames from the ELEMENT'S OWN START — composition
 * frame 0 for the bed, `startFrame` for a narration line, `atFrame` for a cue,
 * the derived composition frame for a dialogue line — so an envelope moves
 * with its element when the element is retimed, and a dialogue line's
 * envelope stays on its clip.
 */
export interface EnvelopePoint {
  readonly frame: number;
  /** Linear factor on the element's `gain`, 0..8. */
  readonly gain: number;
}

/**
 * A window of the composition in which the bed is multiplied by `duck`,
 * whatever else is or is not playing — the duck a narration line carries
 * lasts only as long as that line's file.
 */
export interface BedDuck {
  /** First composition frame of the window. */
  readonly startFrame: number;
  /** First composition frame after it: `[startFrame, endFrame)`, as footage. */
  readonly endFrame: number;
  /** Linear factor, 0..1. */
  readonly duck: number;
}

/**
 * The three keys below are absent unless written, and the parser fills in
 * nothing for them: absent `envelope` is a constant `gain`, absent `optional`
 * is a required file, absent `ducks` is no window of its own.
 */
interface SoundElementShapes {
  /** Piecewise-linear factor on `gain`, held after its last point. */
  readonly envelope?: readonly EnvelopePoint[];
  /**
   * Mixed when the file is on disk and SKIPPED when it is not, and `render`
   * says which. Only `true` is stored; `false` is the default and parses to
   * an absent key.
   */
  readonly optional?: true;
}

export interface SoundBed extends SoundElementShapes {
  readonly src: string;
  /** Seconds into the source. Default 0. */
  readonly startAt: number;
  /** Linear gain. Default 1. */
  readonly gain: number;
  readonly fadeInMs: number;
  readonly fadeOutMs: number;
  readonly ducks?: readonly BedDuck[];
}

export interface NarrationLine extends SoundElementShapes {
  readonly id: string;
  readonly src: string;
  /** Composition frame at which this line starts. */
  readonly startFrame: number;
  readonly gain: number;
  /** Linear gain applied to the bed while this line runs. Default 1 (no duck). */
  readonly duck: number;
}

export interface DialogueLine extends SoundElementShapes {
  readonly id: string;
  readonly src: string;
  /** A declared `footage[].id`. */
  readonly track: string;
  /** The clip's own frame at which this line starts. */
  readonly sourceFrame: number;
  readonly gain: number;
}

export interface SoundCue extends SoundElementShapes {
  readonly id: string;
  readonly src: string;
  /** Composition frame at which this cue fires. */
  readonly atFrame: number;
  readonly gain: number;
}

export interface SidecarSound {
  readonly bed?: SoundBed;
  readonly narration: readonly NarrationLine[];
  readonly dialogue: readonly DialogueLine[];
  readonly cues: readonly SoundCue[];
  /**
   * The last `silentTailMs` of the delivered audio are digital silence. The
   * mixer stops all sound `SILENT_TAIL_GUARD_MS` before it, and the bed's
   * fade-out completes there rather than at the end of the picture. Absent
   * means no tail.
   */
  readonly silentTailMs?: number;
}

/**
 * One finding `layout` may stop reporting for one named node, and why.
 *
 * A finding is a geometric reading, and geometry has intended cases: a lower
 * third is MEANT to sit over the shot under it, a marquee is MEANT to start
 * outside the canvas. Without a way to say so, the only ways to quiet one are
 * to delete the `debugName` — which removes the node from every other reading
 * too — or to stop running the check.
 *
 * `reason` is required and checked for being non-empty for the same cause
 * `EXEMPT` reasons are: an allowance nobody wrote a sentence for is a memory,
 * and a memory goes stale where no gate reads it. It is not matched against
 * anything; it is there to be read next to the entry that suppressed a finding.
 */
export interface LayoutAllowance {
  /** A node's `debugName`. Not an id — ids are assigned by the mount. */
  readonly node: string;
  readonly allow: LayoutAllowScope;
  readonly reason: string;
}

/** What one allowance covers. `src/render/findings.ts` holds the code map. */
export type LayoutAllowScope = "overlap" | "overflow" | "occlusion" | "canvas";

/**
 * What a node is supposed to do, checked against the picture rather than
 * against another number in the same file.
 *
 * Every predicate is evaluated over SAMPLED frames — the same sweep
 * `visibility` uses — so each one is a claim about the grid the command names
 * and not about every frame. `assert` prints the grid.
 *
 * Exactly one predicate per entry. Two in one object would be two assertions
 * sharing one verdict, and a reader could not tell which half failed.
 */
export type SidecarAssertion =
  /** Shown at every sampled frame in `[from, to]`, both ends included. */
  | { readonly node: string; readonly inPicture: readonly [number, number] }
  /** Shown at some sampled frame at or before this one. */
  | { readonly node: string; readonly entersBy: number }
  /** Shown at no sampled frame after this one. */
  | { readonly node: string; readonly exitsBy: number }
  /** At every sampled frame it has a box, the box is inside its container and
   *  inside the canvas — `escaped_container` and `panel_out_of_canvas` fire at
   *  no sampled frame. */
  | { readonly node: string; readonly insideBox: true }
  /** Shown across a run of consecutive sampled frames spanning at least this
   *  many composition frames. */
  | { readonly node: string; readonly dwellFrames: number }
  /** First shown at a sampled frame strictly earlier than this other node's. */
  | { readonly node: string; readonly before: string };

/**
 * A shutter: every frame is delivered as an EXPOSURE, the average of
 * `samples` renders with the transform timelines evaluated across `angle`/360
 * of the frame's duration, centred on the frame's own tick
 * (`patches/0034-shutter.patch`, `docs/shutter.design.md`).
 *
 * It moves pixels, so it is a sidecar key and an input to identity, and there
 * is no CLI flag that could stand in for it.
 */
export interface SidecarShutter {
  /** Degrees of the frame the shutter is open, 1..360. */
  readonly angle: number;
  /** Renders averaged per frame, 2..64. */
  readonly samples: number;
}

export interface MotionSidecar {
  readonly motion: 1;
  readonly durationFrames: number;
  readonly fps: number;
  readonly supersample: 1 | 2 | 4; // defaulted to 1 when absent
  /**
   * Absent means no shutter, and the parser fills in NOTHING when the key is
   * absent: identity hashes every key the parser returns, so a materialised
   * default would move the identity of every composition in the tree without
   * moving a pixel.
   */
  readonly shutter?: SidecarShutter;
  readonly footage: readonly FootageTrack[]; // defaulted to [] when absent
  /** Absent means the build's default face (upstream's Inter Display). */
  readonly fonts?: SidecarFonts;
  /**
   * Absent in the input means no sound; the parser materialises empty
   * `narration` / `dialogue` / `cues` arrays and omits `bed`.
   */
  readonly sound: SidecarSound;
  /** Defaulted to `[]` when absent. */
  readonly layoutAllow: readonly LayoutAllowance[];
  /** Defaulted to `[]` when absent. */
  readonly assertions: readonly SidecarAssertion[];
}

export interface Diagnostic {
  /** Stable machine-readable code, e.g. "sidecar.fps.notDivisorOf60". */
  readonly code: string;
  /** JSON Pointer into the input, e.g. "/footage/0/tile". */
  readonly path: string;
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly value: MotionSidecar }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

// ---------------------------------------------------------------------------
// Constants (mirror upstream)
// ---------------------------------------------------------------------------

/** Rates that divide 60 exactly — upstream `VALID_HZ`. */
export const VALID_FPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60] as const;

/** Upstream `TEX_MAX_DIM`. */
export const TEX_MAX_DIM = 512;

/** The vendored spec's `IMG_MAX_DIM` (patches/0020): an image's largest side,
 *  any size from 1. */
export const IMG_MAX_DIM = 2048;

export const DURATION_FRAMES_MIN = 1;
export const DURATION_FRAMES_MAX = 216_000; // 2 hours at 30 fps

export const GRID_PRODUCT_MAX = 4096;

export const SUPERSAMPLE_VALUES = [1, 2, 4] as const;

/** `shutter.angle`, in whole degrees. */
export const SHUTTER_ANGLE_MIN = 1;
export const SHUTTER_ANGLE_MAX = 360;
/**
 * `shutter.samples`. One sample is the unblurred frame under another
 * identity, so the floor is 2. The core's sums are exact to 256; 64 caps a
 * frame at 64 rasters, which is about 3 s on the heaviest scene measured
 * (`baselines/shutter.md`).
 */
export const SHUTTER_SAMPLES_MIN = 2;
export const SHUTTER_SAMPLES_MAX = 64;

export const SHUTTER_KEYS = new Set(["angle", "samples"]);

export const ROOT_KEYS = new Set([
  "motion",
  "durationFrames",
  "fps",
  "supersample",
  "shutter",
  "footage",
  "fonts",
  "sound",
  "layoutAllow",
  "assertions",
]);

export const LAYOUT_ALLOW_KEYS = new Set(["node", "allow", "reason"]);

export const LAYOUT_ALLOW_SCOPES = [
  "overlap",
  "overflow",
  "occlusion",
  "canvas",
] as const;

/**
 * Every key an assertion entry may carry: `node` plus the predicates.
 *
 * One set rather than one per predicate, because an entry names exactly one
 * predicate and which one is decided after the keys are known — a per-predicate
 * set could not report an unknown key on an entry whose predicate is missing.
 */
export const ASSERTION_KEYS = new Set([
  "node",
  "inPicture",
  "entersBy",
  "exitsBy",
  "insideBox",
  "dwellFrames",
  "before",
]);

/** The predicate keys, in the order the unknown-predicate message lists them. */
export const ASSERTION_PREDICATES = [
  "inPicture",
  "entersBy",
  "exitsBy",
  "insideBox",
  "dwellFrames",
  "before",
] as const;

export const FONT_KEYS = new Set(["regular", "bold", "faces"]);

/** The two weights every face declares — the default pair and each named one. */
export const FONT_WEIGHT_KEYS = ["regular", "bold"] as const;

/** Keys of one `fonts.faces[name]` entry. */
export const FONT_FACE_KEYS = new Set<string>(FONT_WEIGHT_KEYS);

/** A face name: what `font-[name]` accepts (vendored tailwind.ts FONT_FACE_NAME). */
export const FONT_FACE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Most named faces one composition may declare. Each face is two files the
 * build opens and every slot of it is an atlas in the pak, so the bound is on
 * build time and pak size rather than on the core, whose limit is the slot
 * table (MAX_FONT_SLOTS, 128, shared by every face and size).
 */
export const FONT_FACES_MAX = 8;

/**
 * Most bytes the declared font files may total, default pair included, each
 * distinct file counted once. The build parses every face with opentype.js in
 * one process and a CJK pair alone is 17 MB, so this bounds the build, not the
 * render. Checked by `resolveComposition`, which is where the files are opened.
 */
export const FONT_FILES_MAX_BYTES = 64 * 1024 * 1024;

export const SOUND_KEYS = new Set([
  "bed",
  "narration",
  "dialogue",
  "cues",
  "silentTailMs",
]);

/** Keys every element of every role accepts, each parsed by one function. */
export const SOUND_ELEMENT_KEYS = new Set(["envelope", "optional"]);

export const SOUND_BED_KEYS = new Set([
  "src",
  "startAt",
  "gain",
  "fadeInMs",
  "fadeOutMs",
  "ducks",
  ...SOUND_ELEMENT_KEYS,
]);

export const SOUND_NARRATION_KEYS = new Set([
  "id",
  "src",
  "startFrame",
  "gain",
  "duck",
  ...SOUND_ELEMENT_KEYS,
]);

export const SOUND_DIALOGUE_KEYS = new Set([
  "id",
  "src",
  "track",
  "sourceFrame",
  "gain",
  ...SOUND_ELEMENT_KEYS,
]);

export const SOUND_CUE_KEYS = new Set([
  "id",
  "src",
  "atFrame",
  "gain",
  ...SOUND_ELEMENT_KEYS,
]);

export const ENVELOPE_POINT_KEYS = new Set(["frame", "gain"]);

export const BED_DUCK_KEYS = new Set(["startFrame", "endFrame", "duck"]);

/**
 * One point is a constant, which `gain` already says. The ceiling bounds the
 * filter expression the mixer writes, one term per segment, on one argv.
 */
export const ENVELOPE_POINTS_MIN = 2;
export const ENVELOPE_POINTS_MAX = 64;

/**
 * How long before a declared silent tail the mixer stops all sound — the gate
 * closes and the bed's fade-out completes there, not at the tail itself.
 *
 * An AAC frame that sees any non-zero input can decode to non-zero samples
 * across the 2048-sample window it shares with the next one, and how many
 * depends on what the encoder spent on the frames before. Measured on
 * `compositions/sound-roles`' mix at 48 kHz, 192 kb/s, counting non-zero
 * s16 samples in the 500 ms tail with the gate closed this far before it:
 * 0 ms 1092, 10 ms 1130, 21 ms 194, 30 ms 112, 43 ms 0, 50 ms 0, 100 ms 0.
 * 50 ms is two 1024-sample frames at 44.1 kHz. The tail is still MEASURED
 * after the mux, so a mix at a lower rate, where two frames are longer, is
 * refused rather than assumed.
 */
export const SILENT_TAIL_GUARD_MS = 50;

/** Roles that carry a `src`, used as `pathIssue` prefixes. */
export const SOUND_SRC_ROLES = ["bed", "narration", "dialogue", "cues"] as const;

export type SoundSrcRole = (typeof SOUND_SRC_ROLES)[number];

export const GAIN_MIN = 0;
export const GAIN_MAX = 8;
export const DUCK_MIN = 0;
export const DUCK_MAX = 1;

export const EMPTY_SOUND: SidecarSound = {
  narration: [],
  dialogue: [],
  cues: [],
};

export const FOOTAGE_KEYS = new Set([
  "id",
  "src",
  "nodePrefix",
  "tile",
  "grid",
  "startFrame",
  "endFrame",
  "sourceFrame",
  "fit",
]);

export const FOOTAGE_FIT_VALUES = ["cover", "contain", "stretch"] as const;

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

function diag(code: string, path: string, message: string): Diagnostic {
  return { code, path, message };
}

/**
 * `fonts.faces`: name -> { regular, bold }.
 *
 * Every face is held to the default pair's rule — both weights or the face is
 * refused — because `font-[name] font-bold` bakes from the bold file and a
 * missing one would be a face nobody declared. The name is the `font-[name]`
 * token's, so a name the class parser would not accept is refused here rather
 * than declared and never reachable.
 */
function parseFaces(
  raw: unknown,
  diagnostics: Diagnostic[],
): Record<string, SidecarFace> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push(
      diag(
        "sidecar.fonts.faces.notObject",
        "/fonts/faces",
        `\`fonts.faces\` must be an object of name -> { regular, bold }; got ${describeType(raw)}`,
      ),
    );
    return undefined;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > FONT_FACES_MAX) {
    diagnostics.push(
      diag(
        "sidecar.fonts.faces.tooMany",
        "/fonts/faces",
        `\`fonts.faces\` declares ${entries.length} faces; at most ${FONT_FACES_MAX} are allowed`,
      ),
    );
  }
  const out: Record<string, SidecarFace> = {};
  let ok = true;
  for (const [name, face] of entries) {
    const at = `/fonts/faces/${name}`;
    if (!FONT_FACE_NAME_RE.test(name)) {
      diagnostics.push(
        diag(
          "sidecar.fonts.faces.name",
          at,
          `face name ${JSON.stringify(name)} must match ${FONT_FACE_NAME_RE} — it is the \`font-[name]\` class token`,
        ),
      );
      ok = false;
      continue;
    }
    if (typeof face !== "object" || face === null || Array.isArray(face)) {
      diagnostics.push(
        diag(
          "sidecar.fonts.faces.faceNotObject",
          at,
          `\`fonts.faces.${name}\` must be an object with \`regular\` and \`bold\`; got ${describeType(face)}`,
        ),
      );
      ok = false;
      continue;
    }
    const f = face as Record<string, unknown>;
    for (const key of Object.keys(f)) {
      if (!FONT_FACE_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.fonts.faces.unknownKey",
            `${at}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...FONT_FACE_KEYS].join(", ")}`,
          ),
        );
        ok = false;
      }
    }
    const parts: Record<string, string> = {};
    for (const key of FONT_WEIGHT_KEYS) {
      const value = f[key];
      if (typeof value !== "string") {
        diagnostics.push(
          diag(
            "sidecar.fonts.faces.missing",
            `${at}/${key}`,
            `\`fonts.faces.${name}.${key}\` must be a string path; got ${describeType(value)}`,
          ),
        );
        ok = false;
        continue;
      }
      const issue = pathIssue(value, `fonts.faces.${name}.${key}`, `sidecar.fonts.faces.${key}`);
      if (issue) {
        diagnostics.push(diag(issue.code, `${at}/${key}`, issue.message));
        ok = false;
      } else {
        parts[key] = value;
      }
    }
    if (parts.regular !== undefined && parts.bold !== undefined) {
      out[name] = { regular: parts.regular, bold: parts.bold };
    }
  }
  return ok ? out : undefined;
}

/**
 * Reject absolute paths and any `..` path segment.
 *
 * `field` names the key in the message and `prefix` the diagnostic code, so
 * the same rule covers `footage[].src` and `fonts.*` without either of them
 * inheriting the other's error codes.
 */
function pathIssue(
  src: string,
  field = "src",
  prefix = "sidecar.footage.src",
): { code: string; message: string } | null {
  if (src.length === 0) {
    return {
      code: `${prefix}.empty`,
      message: `\`${field}\` must be a non-empty relative path`,
    };
  }
  // Unix absolute, or Windows drive-letter absolute (C:\ / C:/), or
  // backslash-rooted on Windows-style inputs.
  if (src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("\\")) {
    return {
      code: `${prefix}.absolute`,
      message: `\`${field}\` must be a relative path; got absolute path ${JSON.stringify(src)}`,
    };
  }
  const segments = src.split(/[/\\]/);
  if (segments.some((s) => s === "..")) {
    return {
      code: `${prefix}.traversal`,
      message: `\`${field}\` must not contain \`..\` segments; got ${JSON.stringify(src)}`,
    };
  }
  return null;
}

/**
 * Composition frame at which a dialogue line starts.
 *
 * Footage mapping: the source frame shown at composition frame `f` is
 * `sourceFrame + (f - startFrame)`, presented while
 * `startFrame <= f < endFrame`. Inverting for a clip-clock `sourceFrame`
 * gives `track.startFrame + (line.sourceFrame - track.sourceFrame)`.
 */
export function dialogueCompositionFrame(
  line: Pick<DialogueLine, "sourceFrame">,
  track: Pick<FootageTrack, "startFrame" | "sourceFrame">,
): number {
  return track.startFrame + (line.sourceFrame - track.sourceFrame);
}

export function dialogueInWindow(
  compositionFrame: number,
  track: Pick<FootageTrack, "startFrame" | "endFrame">,
): boolean {
  return track.startFrame <= compositionFrame && compositionFrame < track.endFrame;
}

// ---------------------------------------------------------------------------
// parseSidecar
// ---------------------------------------------------------------------------

export function parseSidecar(input: unknown): ParseResult {
  const diagnostics: Diagnostic[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      diagnostics: [
        diag(
          "sidecar.notObject",
          "",
          `sidecar must be a JSON object; got ${describeType(input)}`,
        ),
      ],
    };
  }

  // Unknown keys at root — report all of them.
  for (const key of Object.keys(input)) {
    if (!ROOT_KEYS.has(key)) {
      diagnostics.push(
        diag(
          "sidecar.unknownKey",
          `/${key}`,
          `unknown key ${JSON.stringify(key)}; allowed keys are ${[...ROOT_KEYS].join(", ")}`,
        ),
      );
    }
  }

  // --- motion ---
  let motion: 1 | undefined;
  if (!("motion" in input)) {
    diagnostics.push(
      diag("sidecar.motion.required", "/motion", "`motion` is required and must be exactly 1"),
    );
  } else if (input.motion !== 1) {
    diagnostics.push(
      diag(
        "sidecar.motion.invalid",
        "/motion",
        `\`motion\` must be exactly 1; got ${JSON.stringify(input.motion)}`,
      ),
    );
  } else {
    motion = 1;
  }

  // --- durationFrames ---
  let durationFrames: number | undefined;
  if (!("durationFrames" in input)) {
    diagnostics.push(
      diag(
        "sidecar.durationFrames.required",
        "/durationFrames",
        `\`durationFrames\` is required (integer ${DURATION_FRAMES_MIN}..${DURATION_FRAMES_MAX})`,
      ),
    );
  } else if (!isInteger(input.durationFrames)) {
    diagnostics.push(
      diag(
        "sidecar.durationFrames.notInteger",
        "/durationFrames",
        `\`durationFrames\` must be an integer; got ${JSON.stringify(input.durationFrames)}`,
      ),
    );
  } else if (
    input.durationFrames < DURATION_FRAMES_MIN ||
    input.durationFrames > DURATION_FRAMES_MAX
  ) {
    diagnostics.push(
      diag(
        "sidecar.durationFrames.outOfRange",
        "/durationFrames",
        `\`durationFrames\` must be in ${DURATION_FRAMES_MIN}..${DURATION_FRAMES_MAX} (2 hours at 30fps); got ${input.durationFrames}`,
      ),
    );
  } else {
    durationFrames = input.durationFrames;
  }

  // --- fps ---
  let fps: number | undefined;
  if (!("fps" in input)) {
    diagnostics.push(
      diag(
        "sidecar.fps.required",
        "/fps",
        `\`fps\` is required and must divide 60 exactly (${VALID_FPS.join(",")})`,
      ),
    );
  } else if (!isInteger(input.fps)) {
    diagnostics.push(
      diag(
        "sidecar.fps.notInteger",
        "/fps",
        `\`fps\` must be an integer; got ${JSON.stringify(input.fps)}`,
      ),
    );
  } else if (!(VALID_FPS as readonly number[]).includes(input.fps)) {
    diagnostics.push(
      diag(
        "sidecar.fps.notDivisorOf60",
        "/fps",
        `\`fps\` must divide 60 exactly (${VALID_FPS.join(",")}); got ${input.fps}`,
      ),
    );
  } else {
    fps = input.fps;
  }

  // --- supersample (optional, default 1) ---
  let supersample: 1 | 2 | 4 = 1;
  if ("supersample" in input) {
    const ss = input.supersample;
    if (!(SUPERSAMPLE_VALUES as readonly number[]).includes(ss as number)) {
      diagnostics.push(
        diag(
          "sidecar.supersample.invalid",
          "/supersample",
          `\`supersample\` must be one of 1, 2, 4; got ${JSON.stringify(ss)}`,
        ),
      );
    } else {
      supersample = ss as 1 | 2 | 4;
    }
  }

  // --- shutter (optional; absent = none, and nothing is filled in) ---
  const shutter = "shutter" in input ? parseShutter(input.shutter, diagnostics) : undefined;

  // --- fonts (optional; absent = the build's default face) ---
  let fonts: SidecarFonts | undefined;
  if ("fonts" in input) {
    const raw = input.fonts;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      diagnostics.push(
        diag(
          "sidecar.fonts.notObject",
          "/fonts",
          `\`fonts\` must be an object with \`regular\` and \`bold\` (and optionally \`faces\`); got ${describeType(raw)}`,
        ),
      );
    } else {
      const obj = raw as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (!FONT_KEYS.has(key)) {
          diagnostics.push(
            diag(
              "sidecar.fonts.unknownKey",
              `/fonts/${key}`,
              `unknown key ${JSON.stringify(key)}; allowed keys are ${[...FONT_KEYS].join(", ")}`,
            ),
          );
        }
      }
      // Both weights or neither: a slot table allocates bold and regular
      // independently, so a half-declared pair is a build that bakes one of
      // them from a face nobody wrote down.
      const parts: Record<string, string> = {};
      for (const key of FONT_WEIGHT_KEYS) {
        const value = obj[key];
        if (typeof value !== "string") {
          diagnostics.push(
            diag(
              "sidecar.fonts.missing",
              `/fonts/${key}`,
              `\`fonts.${key}\` must be a string path; got ${describeType(value)}`,
            ),
          );
          continue;
        }
        const issue = pathIssue(value, `fonts.${key}`, `sidecar.fonts.${key}`);
        if (issue) diagnostics.push(diag(issue.code, `/fonts/${key}`, issue.message));
        else parts[key] = value;
      }
      const faces = "faces" in obj ? parseFaces(obj.faces, diagnostics) : undefined;
      if (parts.regular !== undefined && parts.bold !== undefined) {
        fonts = {
          regular: parts.regular,
          bold: parts.bold,
          ...(faces !== undefined ? { faces } : {}),
        };
      }
    }
  }

  // --- footage (optional, default []) ---
  let footage: FootageTrack[] = [];
  // Successfully parsed tracks, kept even when other diagnostics exist so
  // the dialogue track check can name them rather than treat every id as
  // unknown because a neighbour failed.
  const parsedFootageTracks: FootageTrack[] = [];
  if ("footage" in input) {
    if (!Array.isArray(input.footage)) {
      diagnostics.push(
        diag(
          "sidecar.footage.notArray",
          "/footage",
          `\`footage\` must be an array; got ${describeType(input.footage)}`,
        ),
      );
    } else {
      const seenIds = new Map<string, number>();
      const tracks: FootageTrack[] = [];

      for (let i = 0; i < input.footage.length; i++) {
        const entry = input.footage[i];
        const base = `/footage/${i}`;
        const track = parseFootageEntry(entry, base, diagnostics, seenIds, i, durationFrames);
        if (track !== null) {
          tracks.push(track);
        }
      }

      parsedFootageTracks.push(...tracks);
      // Only adopt tracks when the whole array is clean — partial success
      // would let callers act on incomplete data while diagnostics exist.
      if (diagnostics.length === 0) {
        footage = tracks;
      }
    }
  }

  // --- sound (optional; absent materialises empty arrays, no bed) ---
  const sound = parseSound(
    input,
    diagnostics,
    parsedFootageTracks,
    durationFrames,
    fps,
  );

  // --- layoutAllow (optional, default []) ---
  const layoutAllow = parseLayoutAllow(input, diagnostics);

  // --- assertions (optional, default []) ---
  const assertions = parseAssertions(input, diagnostics, durationFrames);

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  // All required fields validated above; TypeScript needs the narrowing.
  return {
    ok: true,
    value: {
      motion: motion!,
      durationFrames: durationFrames!,
      fps: fps!,
      supersample,
      ...(shutter ? { shutter } : {}),
      footage,
      ...(fonts ? { fonts } : {}),
      sound,
      layoutAllow,
      assertions,
    },
  };
}

// ---------------------------------------------------------------------------
// shutter
// ---------------------------------------------------------------------------

/**
 * `{ "angle": 180, "samples": 8 }`. Both keys required, both integers.
 *
 * `samples: 1` is refused on its own code rather than as out of range: it
 * would render exactly the unblurred frame under a different identity, so the
 * fix is to remove the key, and the message says that.
 */
function parseShutter(raw: unknown, diagnostics: Diagnostic[]): SidecarShutter | undefined {
  if (!isPlainObject(raw)) {
    diagnostics.push(
      diag(
        "sidecar.shutter.notObject",
        "/shutter",
        `\`shutter\` must be an object with \`angle\` and \`samples\`; got ${describeType(raw)}`,
      ),
    );
    return undefined;
  }
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (!SHUTTER_KEYS.has(key)) {
      ok = false;
      diagnostics.push(
        diag(
          "sidecar.shutter.unknownKey",
          `/shutter/${key}`,
          `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SHUTTER_KEYS].join(", ")}`,
        ),
      );
    }
  }
  const angle = raw.angle;
  if (!isInteger(angle) || angle < SHUTTER_ANGLE_MIN || angle > SHUTTER_ANGLE_MAX) {
    ok = false;
    diagnostics.push(
      diag(
        "sidecar.shutter.angle",
        "/shutter/angle",
        `\`shutter.angle\` must be an integer number of degrees in ${SHUTTER_ANGLE_MIN}..${SHUTTER_ANGLE_MAX}; got ${"angle" in raw ? JSON.stringify(angle) : "nothing"}`,
      ),
    );
  }
  const samples = raw.samples;
  if (samples === 1) {
    ok = false;
    diagnostics.push(
      diag(
        "sidecar.shutter.oneSample",
        "/shutter/samples",
        "`shutter.samples` of 1 renders the unblurred frame under a different identity; remove the `shutter` key instead",
      ),
    );
  } else if (!isInteger(samples) || samples < SHUTTER_SAMPLES_MIN || samples > SHUTTER_SAMPLES_MAX) {
    ok = false;
    diagnostics.push(
      diag(
        "sidecar.shutter.samples",
        "/shutter/samples",
        `\`shutter.samples\` must be an integer in ${SHUTTER_SAMPLES_MIN}..${SHUTTER_SAMPLES_MAX}; got ${"samples" in raw ? JSON.stringify(samples) : "nothing"}`,
      ),
    );
  }
  return ok ? { angle: angle as number, samples: samples as number } : undefined;
}

// ---------------------------------------------------------------------------
// layoutAllow
// ---------------------------------------------------------------------------

function parseLayoutAllow(
  input: Record<string, unknown>,
  diagnostics: Diagnostic[],
): LayoutAllowance[] {
  if (!("layoutAllow" in input)) return [];
  if (!Array.isArray(input.layoutAllow)) {
    diagnostics.push(
      diag(
        "sidecar.layoutAllow.notArray",
        "/layoutAllow",
        `\`layoutAllow\` must be an array; got ${describeType(input.layoutAllow)}`,
      ),
    );
    return [];
  }

  const out: LayoutAllowance[] = [];
  // node + scope, so the same node may excuse two different findings and a
  // repeat of one pair is the copy-paste it looks like.
  const seen = new Map<string, string>();
  for (let i = 0; i < input.layoutAllow.length; i++) {
    const entry = input.layoutAllow[i];
    const base = `/layoutAllow/${i}`;
    if (!isPlainObject(entry)) {
      diagnostics.push(
        diag(
          "sidecar.layoutAllow.notObject",
          base,
          `a layout allowance must be an object; got ${describeType(entry)}`,
        ),
      );
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!LAYOUT_ALLOW_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.layoutAllow.unknownKey",
            `${base}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...LAYOUT_ALLOW_KEYS].join(", ")}`,
          ),
        );
      }
    }

    const node = parseDebugName(entry, base, "node", "sidecar.layoutAllow.node", diagnostics);

    let allow: LayoutAllowScope | undefined;
    if (!("allow" in entry)) {
      diagnostics.push(
        diag(
          "sidecar.layoutAllow.allow",
          `${base}/allow`,
          `\`allow\` is required and must be one of ${LAYOUT_ALLOW_SCOPES.join(", ")}`,
        ),
      );
    } else if (!(LAYOUT_ALLOW_SCOPES as readonly unknown[]).includes(entry.allow)) {
      diagnostics.push(
        diag(
          "sidecar.layoutAllow.allow",
          `${base}/allow`,
          `\`allow\` must be one of ${LAYOUT_ALLOW_SCOPES.join(", ")}; got ${JSON.stringify(entry.allow)}`,
        ),
      );
    } else {
      allow = entry.allow as LayoutAllowScope;
    }

    const reason = parseReason(entry, base, "sidecar.layoutAllow.reason", diagnostics);

    if (node === undefined || allow === undefined || reason === undefined) continue;

    const key = `${node} ${allow}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      diagnostics.push(
        diag(
          "sidecar.layoutAllow.duplicate",
          base,
          `${JSON.stringify(node)} already allows ${allow} (first seen at ${prev})`,
        ),
      );
      continue;
    }
    seen.set(key, base);
    out.push({ node, allow, reason });
  }
  return out;
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

function parseAssertions(
  input: Record<string, unknown>,
  diagnostics: Diagnostic[],
  durationFrames: number | undefined,
): SidecarAssertion[] {
  if (!("assertions" in input)) return [];
  if (!Array.isArray(input.assertions)) {
    diagnostics.push(
      diag(
        "sidecar.assertions.notArray",
        "/assertions",
        `\`assertions\` must be an array; got ${describeType(input.assertions)}`,
      ),
    );
    return [];
  }

  const out: SidecarAssertion[] = [];
  for (let i = 0; i < input.assertions.length; i++) {
    const entry = input.assertions[i];
    const base = `/assertions/${i}`;
    if (!isPlainObject(entry)) {
      diagnostics.push(
        diag(
          "sidecar.assertions.notObject",
          base,
          `an assertion must be an object; got ${describeType(entry)}`,
        ),
      );
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!ASSERTION_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.assertions.unknownKey",
            `${base}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...ASSERTION_KEYS].join(", ")}`,
          ),
        );
      }
    }

    const node = parseDebugName(entry, base, "node", "sidecar.assertions.node", diagnostics);

    const named = ASSERTION_PREDICATES.filter((p) => p in entry);
    if (named.length !== 1) {
      diagnostics.push(
        diag(
          "sidecar.assertions.predicate",
          base,
          named.length === 0
            ? `an assertion must name exactly one of ${ASSERTION_PREDICATES.join(", ")}; it names none`
            : `an assertion must name exactly one of ${ASSERTION_PREDICATES.join(", ")}; ` +
              `it names ${named.length} (${named.join(", ")})`,
        ),
      );
      continue;
    }
    const predicate = named[0]!;
    const value = parsePredicate(entry, base, predicate, durationFrames, diagnostics);
    if (node === undefined || value === undefined) continue;
    out.push({ node, ...value } as SidecarAssertion);
  }
  return out;
}

/** The one predicate this entry names, or undefined when it does not hold. */
function parsePredicate(
  entry: Record<string, unknown>,
  base: string,
  predicate: (typeof ASSERTION_PREDICATES)[number],
  durationFrames: number | undefined,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const raw = entry[predicate];
  const path = `${base}/${predicate}`;
  // The window is the composition's own clock. `durationFrames` is undefined
  // only when it failed its own check above, and then every range here would be
  // a second complaint about the same key — so range checks are skipped and the
  // shape checks are not.
  const last = durationFrames === undefined ? undefined : durationFrames - 1;

  const frame = (v: unknown, code: string): number | undefined => {
    if (!isInteger(v) || v < 0) {
      diagnostics.push(
        diag(code, path, `\`${predicate}\` must be a frame index (integer >= 0); got ${JSON.stringify(v)}`),
      );
      return undefined;
    }
    if (last !== undefined && v > last) {
      diagnostics.push(
        diag(code, path, `\`${predicate}\` must be in 0..${last} (durationFrames ${durationFrames}); got ${v}`),
      );
      return undefined;
    }
    return v;
  };

  switch (predicate) {
    case "inPicture": {
      const code = "sidecar.assertions.inPicture";
      if (!Array.isArray(raw) || raw.length !== 2) {
        diagnostics.push(
          diag(code, path, `\`inPicture\` must be [from, to]; got ${describeType(raw)}`),
        );
        return undefined;
      }
      const from = frame(raw[0], code);
      const to = frame(raw[1], code);
      if (from === undefined || to === undefined) return undefined;
      if (from > to) {
        diagnostics.push(diag(code, path, `\`inPicture\` needs from <= to; got [${from}, ${to}]`));
        return undefined;
      }
      return { inPicture: [from, to] as const };
    }
    case "entersBy":
    case "exitsBy": {
      const v = frame(raw, "sidecar.assertions.frame");
      return v === undefined ? undefined : { [predicate]: v };
    }
    case "insideBox": {
      if (raw !== true) {
        diagnostics.push(
          diag(
            "sidecar.assertions.insideBox",
            path,
            `\`insideBox\` must be exactly true; got ${JSON.stringify(raw)}`,
          ),
        );
        return undefined;
      }
      return { insideBox: true };
    }
    case "dwellFrames": {
      const code = "sidecar.assertions.dwellFrames";
      if (!isInteger(raw) || raw < 1) {
        diagnostics.push(
          diag(code, path, `\`dwellFrames\` must be an integer >= 1; got ${JSON.stringify(raw)}`),
        );
        return undefined;
      }
      if (durationFrames !== undefined && raw > durationFrames) {
        diagnostics.push(
          diag(code, path, `\`dwellFrames\` ${raw} is longer than the ${durationFrames}-frame composition`),
        );
        return undefined;
      }
      return { dwellFrames: raw };
    }
    case "before": {
      const other = parseDebugName(entry, base, "before", "sidecar.assertions.before", diagnostics);
      return other === undefined ? undefined : { before: other };
    }
  }
}

/** A `debugName` reference: present, a string, non-empty. */
function parseDebugName(
  entry: Record<string, unknown>,
  base: string,
  field: string,
  code: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!(field in entry)) {
    diagnostics.push(diag(code, `${base}/${field}`, `\`${field}\` is required and names a node's debugName`));
    return undefined;
  }
  const value = entry[field];
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(
      diag(
        code,
        `${base}/${field}`,
        `\`${field}\` must be a non-empty string naming a node's debugName; got ${describeType(value)}`,
      ),
    );
    return undefined;
  }
  return value;
}

/** A written reason: present, a string, not only whitespace. */
function parseReason(
  entry: Record<string, unknown>,
  base: string,
  code: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!("reason" in entry)) {
    diagnostics.push(
      diag(code, `${base}/reason`, "`reason` is required — an allowance nobody wrote a sentence for is a memory"),
    );
    return undefined;
  }
  const value = entry.reason;
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(
      diag(
        code,
        `${base}/reason`,
        `\`reason\` must be a non-empty string; got ${describeType(value)}`,
      ),
    );
    return undefined;
  }
  return value;
}

function parseFootageEntry(
  entry: unknown,
  base: string,
  diagnostics: Diagnostic[],
  seenIds: Map<string, number>,
  index: number,
  durationFrames: number | undefined,
): FootageTrack | null {
  if (!isPlainObject(entry)) {
    diagnostics.push(
      diag(
        "sidecar.footage.notObject",
        base,
        `footage entry must be an object; got ${describeType(entry)}`,
      ),
    );
    return null;
  }

  for (const key of Object.keys(entry)) {
    if (!FOOTAGE_KEYS.has(key)) {
      diagnostics.push(
        diag(
          "sidecar.footage.unknownKey",
          `${base}/${key}`,
          `unknown key ${JSON.stringify(key)} in footage entry; allowed keys are ${[...FOOTAGE_KEYS].join(", ")}`,
        ),
      );
    }
  }

  let id: string | undefined;
  if (!("id" in entry)) {
    diagnostics.push(
      diag("sidecar.footage.id.required", `${base}/id`, "`id` is required"),
    );
  } else if (typeof entry.id !== "string") {
    diagnostics.push(
      diag(
        "sidecar.footage.id.notString",
        `${base}/id`,
        `\`id\` must be a string; got ${describeType(entry.id)}`,
      ),
    );
  } else if (entry.id.length === 0) {
    diagnostics.push(
      diag("sidecar.footage.id.empty", `${base}/id`, "`id` must be non-empty"),
    );
  } else if (!ID_RE.test(entry.id)) {
    diagnostics.push(
      diag(
        "sidecar.footage.id.invalid",
        `${base}/id`,
        `\`id\` must match /^[a-z0-9][a-z0-9-]*$/; got ${JSON.stringify(entry.id)}`,
      ),
    );
  } else {
    const prev = seenIds.get(entry.id);
    if (prev !== undefined) {
      diagnostics.push(
        diag(
          "sidecar.footage.id.duplicate",
          `${base}/id`,
          `\`id\` ${JSON.stringify(entry.id)} is duplicated (first seen at /footage/${prev}/id)`,
        ),
      );
    } else {
      seenIds.set(entry.id, index);
      id = entry.id;
    }
  }

  let src: string | undefined;
  if (!("src" in entry)) {
    diagnostics.push(
      diag("sidecar.footage.src.required", `${base}/src`, "`src` is required"),
    );
  } else if (typeof entry.src !== "string") {
    diagnostics.push(
      diag(
        "sidecar.footage.src.notString",
        `${base}/src`,
        `\`src\` must be a string; got ${describeType(entry.src)}`,
      ),
    );
  } else {
    const issue = pathIssue(entry.src);
    if (issue !== null) {
      diagnostics.push(diag(issue.code, `${base}/src`, issue.message));
    } else {
      src = entry.src;
    }
  }

  let nodePrefix: string | undefined;
  if (!("nodePrefix" in entry)) {
    diagnostics.push(
      diag(
        "sidecar.footage.nodePrefix.required",
        `${base}/nodePrefix`,
        "`nodePrefix` is required",
      ),
    );
  } else if (typeof entry.nodePrefix !== "string") {
    diagnostics.push(
      diag(
        "sidecar.footage.nodePrefix.notString",
        `${base}/nodePrefix`,
        `\`nodePrefix\` must be a string; got ${describeType(entry.nodePrefix)}`,
      ),
    );
  } else if (entry.nodePrefix.length === 0) {
    diagnostics.push(
      diag(
        "sidecar.footage.nodePrefix.empty",
        `${base}/nodePrefix`,
        "`nodePrefix` must be non-empty",
      ),
    );
  } else {
    nodePrefix = entry.nodePrefix;
  }

  let tile: number | undefined;
  if (!("tile" in entry)) {
    diagnostics.push(
      diag(
        "sidecar.footage.tile.required",
        `${base}/tile`,
        `\`tile\` is required (power of two, 1..${TEX_MAX_DIM})`,
      ),
    );
  } else if (!isInteger(entry.tile)) {
    diagnostics.push(
      diag(
        "sidecar.footage.tile.notInteger",
        `${base}/tile`,
        `\`tile\` must be an integer; got ${JSON.stringify(entry.tile)}`,
      ),
    );
  } else {
    if (entry.tile < 1 || entry.tile > TEX_MAX_DIM) {
      diagnostics.push(
        diag(
          "sidecar.footage.tile.outOfRange",
          `${base}/tile`,
          `\`tile\` must be in 1..${TEX_MAX_DIM} (TEX_MAX_DIM); got ${entry.tile}`,
        ),
      );
    }
    if (!isPowerOfTwo(entry.tile)) {
      diagnostics.push(
        diag(
          "sidecar.footage.tile.notPowerOfTwo",
          `${base}/tile`,
          `\`tile\` must be a power of two; got ${entry.tile}`,
        ),
      );
    }
    if (
      entry.tile >= 1 &&
      entry.tile <= TEX_MAX_DIM &&
      isPowerOfTwo(entry.tile)
    ) {
      tile = entry.tile;
    }
  }

  let grid: readonly [number, number] | undefined;
  if (!("grid" in entry)) {
    diagnostics.push(
      diag(
        "sidecar.footage.grid.required",
        `${base}/grid`,
        "`grid` is required as [cols, rows] with cols*rows <= 4096",
      ),
    );
  } else if (!Array.isArray(entry.grid) || entry.grid.length !== 2) {
    diagnostics.push(
      diag(
        "sidecar.footage.grid.invalid",
        `${base}/grid`,
        `\`grid\` must be a two-element array [cols, rows]; got ${JSON.stringify(entry.grid)}`,
      ),
    );
  } else {
    const [cols, rows] = entry.grid as [unknown, unknown];
    const colsOk = isInteger(cols) && cols >= 1;
    const rowsOk = isInteger(rows) && rows >= 1;
    if (!colsOk || !rowsOk) {
      diagnostics.push(
        diag(
          "sidecar.footage.grid.invalid",
          `${base}/grid`,
          `\`grid\` elements must be integers >= 1; got ${JSON.stringify(entry.grid)}`,
        ),
      );
    } else if (cols * rows > GRID_PRODUCT_MAX) {
      diagnostics.push(
        diag(
          "sidecar.footage.grid.productTooLarge",
          `${base}/grid`,
          `\`grid\` product cols*rows must be <= ${GRID_PRODUCT_MAX}; got ${cols}*${rows}=${cols * rows}`,
        ),
      );
    } else {
      grid = [cols, rows];
    }
  }

  let startFrame: number | undefined = 0;
  if ("startFrame" in entry) {
    if (!isInteger(entry.startFrame)) {
      diagnostics.push(
        diag(
          "sidecar.footage.startFrame.notInteger",
          `${base}/startFrame`,
          `\`startFrame\` must be an integer >= 0; got ${JSON.stringify(entry.startFrame)}`,
        ),
      );
      startFrame = undefined;
    } else if (entry.startFrame < 0) {
      diagnostics.push(
        diag(
          "sidecar.footage.startFrame.outOfRange",
          `${base}/startFrame`,
          `\`startFrame\` must be >= 0; got ${entry.startFrame}`,
        ),
      );
      startFrame = undefined;
    } else {
      startFrame = entry.startFrame;
    }
  }

  let endFrame: number | undefined;
  if ("endFrame" in entry) {
    if (!isInteger(entry.endFrame)) {
      diagnostics.push(
        diag(
          "sidecar.footage.endFrame.notInteger",
          `${base}/endFrame`,
          `\`endFrame\` must be an integer >= 0; got ${JSON.stringify(entry.endFrame)}`,
        ),
      );
    } else if (entry.endFrame < 0) {
      diagnostics.push(
        diag(
          "sidecar.footage.endFrame.outOfRange",
          `${base}/endFrame`,
          `\`endFrame\` must be >= 0; got ${entry.endFrame}`,
        ),
      );
    } else {
      endFrame = entry.endFrame;
      if (durationFrames !== undefined && entry.endFrame > durationFrames) {
        diagnostics.push(
          diag(
            "sidecar.footage.endFrame.pastDuration",
            `${base}/endFrame`,
            `\`endFrame\` must be <= durationFrames (${durationFrames}); got ${entry.endFrame}`,
          ),
        );
      }
    }
  } else if (durationFrames !== undefined) {
    endFrame = durationFrames;
  }

  if (
    startFrame !== undefined &&
    endFrame !== undefined &&
    endFrame <= startFrame
  ) {
    diagnostics.push(
      diag(
        "sidecar.footage.endFrame.notAfterStart",
        `${base}/endFrame`,
        `\`endFrame\` must be > startFrame (${startFrame}); got ${endFrame}`,
      ),
    );
  }

  let sourceFrame = 0;
  if ("sourceFrame" in entry) {
    if (!isInteger(entry.sourceFrame)) {
      diagnostics.push(
        diag(
          "sidecar.footage.sourceFrame.notInteger",
          `${base}/sourceFrame`,
          `\`sourceFrame\` must be an integer >= 0; got ${JSON.stringify(entry.sourceFrame)}`,
        ),
      );
    } else if (entry.sourceFrame < 0) {
      diagnostics.push(
        diag(
          "sidecar.footage.sourceFrame.outOfRange",
          `${base}/sourceFrame`,
          `\`sourceFrame\` must be >= 0; got ${entry.sourceFrame}`,
        ),
      );
    } else {
      sourceFrame = entry.sourceFrame;
    }
  }

  let fit: FootageFit | undefined;
  if ("fit" in entry) {
    if (!(FOOTAGE_FIT_VALUES as readonly string[]).includes(entry.fit as string)) {
      diagnostics.push(
        diag(
          "sidecar.footage.fit.invalid",
          `${base}/fit`,
          `\`fit\` must be one of cover, contain, stretch; got ${JSON.stringify(entry.fit)}`,
        ),
      );
    } else {
      fit = entry.fit as FootageFit;
    }
  }

  if (
    id === undefined ||
    src === undefined ||
    nodePrefix === undefined ||
    tile === undefined ||
    grid === undefined ||
    startFrame === undefined ||
    endFrame === undefined
  ) {
    return null;
  }

  return {
    id,
    src,
    nodePrefix,
    tile,
    grid,
    startFrame,
    endFrame,
    sourceFrame,
    ...(fit !== undefined ? { fit } : {}),
  };
}

function parseSound(
  input: Record<string, unknown>,
  diagnostics: Diagnostic[],
  footageTracks: readonly FootageTrack[],
  durationFrames: number | undefined,
  fps: number | undefined,
): SidecarSound {
  if (!("sound" in input)) {
    return { narration: [], dialogue: [], cues: [] };
  }

  const raw = input.sound;
  if (!isPlainObject(raw)) {
    diagnostics.push(
      diag(
        "sidecar.sound.notObject",
        "/sound",
        `\`sound\` must be an object; got ${describeType(raw)}`,
      ),
    );
    return { narration: [], dialogue: [], cues: [] };
  }

  for (const key of Object.keys(raw)) {
    if (!SOUND_KEYS.has(key)) {
      diagnostics.push(
        diag(
          "sidecar.sound.unknownKey",
          `/sound/${key}`,
          `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SOUND_KEYS].join(", ")}`,
        ),
      );
    }
  }

  const seenIds = new Map<string, string>();
  const bed = parseSoundBed(raw, diagnostics, durationFrames);
  const narration = parseNarrationLines(raw, diagnostics, seenIds, durationFrames);
  const dialogue = parseDialogueLines(
    raw,
    diagnostics,
    seenIds,
    footageTracks,
    durationFrames,
  );
  const cues = parseSoundCues(raw, diagnostics, seenIds, durationFrames);
  const silentTailMs = parseSilentTail(
    raw,
    diagnostics,
    { bed, narration, dialogue, cues },
    footageTracks,
    durationFrames,
    fps,
  );

  return {
    ...(bed !== undefined ? { bed } : {}),
    narration,
    dialogue,
    cues,
    ...(silentTailMs !== undefined ? { silentTailMs } : {}),
  };
}

/**
 * `silentTailMs`: the last N ms of the delivered audio are digital silence.
 *
 * Three things are refused here because they are knowable from the sidecar
 * alone: a tail with nothing to mix under it, a tail as long as the film, and
 * a bed whose fade-out — which completes where the tail begins — does not fit
 * before it. An element that STARTS inside the tail is refused too, naming
 * the frame: the gate would remove all of it. An element that starts before
 * the tail and runs into it is refused by `render`, which has probed the
 * file's length (`tailOverruns`, `src/sound/mix.ts`); whether the result is
 * silent is measured after the mux, because the encoder is the last thing
 * that can put a sample there.
 */
function parseSilentTail(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
  parsed: {
    readonly bed: SoundBed | undefined;
    readonly narration: readonly NarrationLine[];
    readonly dialogue: readonly DialogueLine[];
    readonly cues: readonly SoundCue[];
  },
  footageTracks: readonly FootageTrack[],
  durationFrames: number | undefined,
  fps: number | undefined,
): number | undefined {
  if (!("silentTailMs" in raw)) return undefined;
  const value = raw.silentTailMs;
  const at = "/sound/silentTailMs";
  if (!isInteger(value)) {
    diagnostics.push(
      diag(
        "sidecar.sound.silentTailMs.notInteger",
        at,
        `\`silentTailMs\` must be an integer number of milliseconds >= 1; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < 1) {
    diagnostics.push(
      diag(
        "sidecar.sound.silentTailMs.outOfRange",
        at,
        `\`silentTailMs\` must be >= 1; got ${value}. Remove the key for no tail`,
      ),
    );
    return undefined;
  }
  const declared =
    raw.bed !== undefined ||
    (Array.isArray(raw.narration) && raw.narration.length > 0) ||
    (Array.isArray(raw.dialogue) && raw.dialogue.length > 0) ||
    (Array.isArray(raw.cues) && raw.cues.length > 0);
  if (!declared) {
    diagnostics.push(
      diag(
        "sidecar.sound.silentTailMs.nothingToMix",
        at,
        "`silentTailMs` declares silence at the end of a mix, and this sidecar declares nothing to mix",
      ),
    );
    return undefined;
  }
  if (durationFrames === undefined || fps === undefined) return value;

  const durationMs = (durationFrames * 1000) / fps;
  if (value + SILENT_TAIL_GUARD_MS >= durationMs) {
    diagnostics.push(
      diag(
        "sidecar.sound.silentTailMs.pastDuration",
        at,
        `\`silentTailMs\` (${value}) and the ${SILENT_TAIL_GUARD_MS} ms the mixer stops before it ` +
          `must be shorter than the composition (${durationMs} ms)`,
      ),
    );
    return undefined;
  }
  const tailStartMs = durationMs - value;
  // Sound stops SILENT_TAIL_GUARD_MS before the tail, so that is where the
  // bed's fade-out completes and the last instant anything can start.
  const gateMs = tailStartMs - SILENT_TAIL_GUARD_MS;
  let ok = true;
  if (parsed.bed !== undefined && parsed.bed.fadeOutMs > gateMs) {
    diagnostics.push(
      diag(
        "sidecar.sound.silentTailMs.noRoomForFade",
        "/sound/bed/fadeOutMs",
        `the bed's fade-out completes ${SILENT_TAIL_GUARD_MS} ms before the ${value} ms silent tail, ` +
          `at ${gateMs} ms, so it must be <= ${gateMs}; got ${parsed.bed.fadeOutMs}`,
      ),
    );
    ok = false;
  }
  const startsInTail = (frame: number, path: string, label: string): void => {
    const startMs = (frame * 1000) / fps;
    if (startMs < gateMs) return;
    diagnostics.push(
      diag(
        "sidecar.sound.silentTailMs.startsInTail",
        path,
        `${label} starts at composition frame ${frame} (${startMs} ms), at or after ${gateMs} ms, ` +
          `where sound stops ${SILENT_TAIL_GUARD_MS} ms before the ${value} ms silent tail; ` +
          "the gate would remove all of it",
      ),
    );
    ok = false;
  };
  parsed.narration.forEach((line, i) =>
    startsInTail(line.startFrame, `/sound/narration/${i}/startFrame`, `narration ${JSON.stringify(line.id)}`),
  );
  const byId = new Map(footageTracks.map((t) => [t.id, t]));
  parsed.dialogue.forEach((line, i) => {
    const track = byId.get(line.track);
    if (track === undefined) return;
    startsInTail(
      dialogueCompositionFrame(line, track),
      `/sound/dialogue/${i}/sourceFrame`,
      `dialogue ${JSON.stringify(line.id)}`,
    );
  });
  parsed.cues.forEach((cue, i) =>
    startsInTail(cue.atFrame, `/sound/cues/${i}/atFrame`, `cue ${JSON.stringify(cue.id)}`),
  );
  return ok ? value : undefined;
}

/**
 * `optional`: only a boolean. `true` is stored, `false` — the default, a
 * required file — is stored as nothing, so the two spellings of "required"
 * parse to one value.
 */
function parseOptional(
  entry: Record<string, unknown>,
  base: string,
  diagnostics: Diagnostic[],
): { readonly optional?: true } | undefined {
  if (!("optional" in entry)) return {};
  if (typeof entry.optional !== "boolean") {
    diagnostics.push(
      diag(
        "sidecar.sound.optional.notBoolean",
        `${base}/optional`,
        `\`optional\` must be true or false; got ${JSON.stringify(entry.optional)}`,
      ),
    );
    return undefined;
  }
  return entry.optional ? { optional: true } : {};
}

/**
 * `envelope`: points `{ frame, gain }` on the element's own clock.
 *
 * The first point is at frame 0, so the level at the element's start is
 * written rather than extrapolated; frames strictly increase, so no instant
 * has two values; and the last value is held, which is the one rule the
 * reader is not shown in the data. A point past the end of the composition
 * is refused because no frame of the film reaches it — `startFrame` is the
 * element's composition start, or undefined when that could not be derived
 * (a dialogue line on a track that failed to parse), and then that check is
 * skipped rather than guessed.
 */
function parseEnvelope(
  entry: Record<string, unknown>,
  base: string,
  startFrame: number | undefined,
  durationFrames: number | undefined,
  diagnostics: Diagnostic[],
): { readonly envelope?: readonly EnvelopePoint[] } | undefined {
  if (!("envelope" in entry)) return {};
  const raw = entry.envelope;
  const at = `${base}/envelope`;
  if (!Array.isArray(raw)) {
    diagnostics.push(
      diag(
        "sidecar.sound.envelope.notArray",
        at,
        `\`envelope\` must be an array of { frame, gain } points; got ${describeType(raw)}`,
      ),
    );
    return undefined;
  }
  if (raw.length < ENVELOPE_POINTS_MIN) {
    diagnostics.push(
      diag(
        "sidecar.sound.envelope.tooFew",
        at,
        `\`envelope\` needs at least ${ENVELOPE_POINTS_MIN} points; got ${raw.length}. ` +
          "A single level is a constant — write it as `gain` and remove the envelope",
      ),
    );
    return undefined;
  }
  if (raw.length > ENVELOPE_POINTS_MAX) {
    diagnostics.push(
      diag(
        "sidecar.sound.envelope.tooMany",
        at,
        `\`envelope\` may have at most ${ENVELOPE_POINTS_MAX} points; got ${raw.length}`,
      ),
    );
    return undefined;
  }
  const points: EnvelopePoint[] = [];
  let ok = true;
  for (let i = 0; i < raw.length; i++) {
    const point = raw[i];
    const p = `${at}/${i}`;
    if (!isPlainObject(point)) {
      diagnostics.push(
        diag(
          "sidecar.sound.envelope.pointNotObject",
          p,
          `envelope point must be an object { frame, gain }; got ${describeType(point)}`,
        ),
      );
      ok = false;
      continue;
    }
    for (const key of Object.keys(point)) {
      if (!ENVELOPE_POINT_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.sound.envelope.unknownKey",
            `${p}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...ENVELOPE_POINT_KEYS].join(", ")}`,
          ),
        );
        ok = false;
      }
    }
    const frame = parseRequiredNonNegInt(
      point,
      p,
      "frame",
      "sidecar.sound.envelope.frame.required",
      "sidecar.sound.envelope.frame.notInteger",
      "sidecar.sound.envelope.frame.outOfRange",
      diagnostics,
    );
    let gain: number | undefined;
    if (!("gain" in point)) {
      diagnostics.push(
        diag("sidecar.sound.envelope.gain.required", `${p}/gain`, "`gain` is required"),
      );
    } else {
      gain = parseGain(
        point,
        p,
        "sidecar.sound.envelope.gain.notNumber",
        "sidecar.sound.envelope.gain.outOfRange",
        diagnostics,
      );
    }
    if (frame === undefined || gain === undefined) {
      ok = false;
      continue;
    }
    if (i === 0 && frame !== 0) {
      diagnostics.push(
        diag(
          "sidecar.sound.envelope.firstNotZero",
          `${p}/frame`,
          `the first envelope point must be at frame 0, the element's own start; got ${frame}`,
        ),
      );
      ok = false;
    }
    const prev = points[points.length - 1];
    if (prev !== undefined && frame <= prev.frame) {
      diagnostics.push(
        diag(
          "sidecar.sound.envelope.notIncreasing",
          `${p}/frame`,
          `envelope frames must strictly increase; frame ${frame} follows ${prev.frame}`,
        ),
      );
      ok = false;
    }
    if (
      startFrame !== undefined &&
      durationFrames !== undefined &&
      startFrame + frame > durationFrames
    ) {
      diagnostics.push(
        diag(
          "sidecar.sound.envelope.pastDuration",
          `${p}/frame`,
          `envelope point at frame ${frame} of an element starting at composition frame ` +
            `${startFrame} lands on ${startFrame + frame}, past durationFrames (${durationFrames})`,
        ),
      );
      ok = false;
    }
    points.push({ frame, gain });
  }
  return ok ? { envelope: points } : undefined;
}

/**
 * `bed.ducks`: windows `[startFrame, endFrame)` on the composition clock in
 * which the bed is multiplied by `duck`. They multiply each other and every
 * narration line's `duck` where they overlap.
 */
function parseBedDucks(
  entry: Record<string, unknown>,
  base: string,
  durationFrames: number | undefined,
  diagnostics: Diagnostic[],
): { readonly ducks?: readonly BedDuck[] } | undefined {
  if (!("ducks" in entry)) return {};
  const raw = entry.ducks;
  const at = `${base}/ducks`;
  if (!Array.isArray(raw)) {
    diagnostics.push(
      diag(
        "sidecar.sound.bed.ducks.notArray",
        at,
        `\`ducks\` must be an array of { startFrame, endFrame, duck }; got ${describeType(raw)}`,
      ),
    );
    return undefined;
  }
  const ducks: BedDuck[] = [];
  let ok = true;
  for (let i = 0; i < raw.length; i++) {
    const window = raw[i];
    const p = `${at}/${i}`;
    if (!isPlainObject(window)) {
      diagnostics.push(
        diag(
          "sidecar.sound.bed.ducks.notObject",
          p,
          `duck window must be an object { startFrame, endFrame, duck }; got ${describeType(window)}`,
        ),
      );
      ok = false;
      continue;
    }
    for (const key of Object.keys(window)) {
      if (!BED_DUCK_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.sound.bed.ducks.unknownKey",
            `${p}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...BED_DUCK_KEYS].join(", ")}`,
          ),
        );
        ok = false;
      }
    }
    const startFrame = parseRequiredFrame(
      window,
      p,
      "startFrame",
      durationFrames,
      "sidecar.sound.bed.ducks.startFrame.required",
      "sidecar.sound.bed.ducks.startFrame.notInteger",
      "sidecar.sound.bed.ducks.startFrame.outOfRange",
      "sidecar.sound.bed.ducks.startFrame.pastDuration",
      diagnostics,
    );
    const endFrame = parseRequiredFrame(
      window,
      p,
      "endFrame",
      durationFrames,
      "sidecar.sound.bed.ducks.endFrame.required",
      "sidecar.sound.bed.ducks.endFrame.notInteger",
      "sidecar.sound.bed.ducks.endFrame.outOfRange",
      "sidecar.sound.bed.ducks.endFrame.pastDuration",
      diagnostics,
    );
    let duck: number | undefined;
    if (!("duck" in window)) {
      diagnostics.push(
        diag("sidecar.sound.bed.ducks.duck.required", `${p}/duck`, "`duck` is required"),
      );
    } else {
      duck = parseDuck(
        window,
        p,
        "sidecar.sound.bed.ducks.duck.notNumber",
        "sidecar.sound.bed.ducks.duck.outOfRange",
        diagnostics,
      );
    }
    if (startFrame === undefined || endFrame === undefined || duck === undefined) {
      ok = false;
      continue;
    }
    if (endFrame <= startFrame) {
      diagnostics.push(
        diag(
          "sidecar.sound.bed.ducks.empty",
          `${p}/endFrame`,
          `a duck window is [startFrame, endFrame) and must hold a frame; got [${startFrame}, ${endFrame})`,
        ),
      );
      ok = false;
      continue;
    }
    ducks.push({ startFrame, endFrame, duck });
  }
  return ok ? { ducks } : undefined;
}

function parseSoundBed(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
  durationFrames: number | undefined,
): SoundBed | undefined {
  if (!("bed" in raw)) return undefined;

  const entry = raw.bed;
  const base = "/sound/bed";
  if (!isPlainObject(entry)) {
    diagnostics.push(
      diag(
        "sidecar.sound.bed.notObject",
        base,
        `\`sound.bed\` must be an object; got ${describeType(entry)}`,
      ),
    );
    return undefined;
  }

  for (const key of Object.keys(entry)) {
    if (!SOUND_BED_KEYS.has(key)) {
      diagnostics.push(
        diag(
          "sidecar.sound.bed.unknownKey",
          `${base}/${key}`,
          `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SOUND_BED_KEYS].join(", ")}`,
        ),
      );
    }
  }

  const src = parseSoundSrc(
    entry,
    base,
    "bed",
    "sidecar.sound.bed.src.required",
    "sidecar.sound.bed.src.notString",
    diagnostics,
  );
  const startAt = parseNonNegNumber(
    entry,
    base,
    "startAt",
    0,
    "sidecar.sound.bed.startAt.notNumber",
    "sidecar.sound.bed.startAt.outOfRange",
    diagnostics,
  );
  const gain = parseGain(
    entry,
    base,
    "sidecar.sound.bed.gain.notNumber",
    "sidecar.sound.bed.gain.outOfRange",
    diagnostics,
  );
  const fadeInMs = parseNonNegInt(
    entry,
    base,
    "fadeInMs",
    0,
    "sidecar.sound.bed.fadeInMs.notInteger",
    "sidecar.sound.bed.fadeInMs.outOfRange",
    diagnostics,
  );
  const fadeOutMs = parseNonNegInt(
    entry,
    base,
    "fadeOutMs",
    0,
    "sidecar.sound.bed.fadeOutMs.notInteger",
    "sidecar.sound.bed.fadeOutMs.outOfRange",
    diagnostics,
  );
  // The bed starts at composition frame 0, so its envelope's frames are
  // composition frames.
  const envelope = parseEnvelope(entry, base, 0, durationFrames, diagnostics);
  const ducks = parseBedDucks(entry, base, durationFrames, diagnostics);
  const optional = parseOptional(entry, base, diagnostics);

  if (
    src === undefined ||
    startAt === undefined ||
    gain === undefined ||
    fadeInMs === undefined ||
    fadeOutMs === undefined ||
    envelope === undefined ||
    ducks === undefined ||
    optional === undefined
  ) {
    return undefined;
  }
  return { src, startAt, gain, fadeInMs, fadeOutMs, ...envelope, ...ducks, ...optional };
}

function parseNarrationLines(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
  seenIds: Map<string, string>,
  durationFrames: number | undefined,
): NarrationLine[] {
  if (!("narration" in raw)) return [];
  if (!Array.isArray(raw.narration)) {
    diagnostics.push(
      diag(
        "sidecar.sound.narration.notArray",
        "/sound/narration",
        `\`sound.narration\` must be an array; got ${describeType(raw.narration)}`,
      ),
    );
    return [];
  }

  const lines: NarrationLine[] = [];
  for (let i = 0; i < raw.narration.length; i++) {
    const entry = raw.narration[i];
    const base = `/sound/narration/${i}`;
    if (!isPlainObject(entry)) {
      diagnostics.push(
        diag(
          "sidecar.sound.narration.notObject",
          base,
          `narration line must be an object; got ${describeType(entry)}`,
        ),
      );
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!SOUND_NARRATION_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.sound.narration.unknownKey",
            `${base}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SOUND_NARRATION_KEYS].join(", ")}`,
          ),
        );
      }
    }

    const id = parseSoundId(
      entry,
      base,
      "sidecar.sound.narration.id.required",
      "sidecar.sound.narration.id.notString",
      "sidecar.sound.narration.id.empty",
      "sidecar.sound.narration.id.invalid",
      seenIds,
      diagnostics,
    );
    const src = parseSoundSrc(
      entry,
      base,
      "narration",
      "sidecar.sound.narration.src.required",
      "sidecar.sound.narration.src.notString",
      diagnostics,
    );
    const startFrame = parseRequiredFrame(
      entry,
      base,
      "startFrame",
      durationFrames,
      "sidecar.sound.narration.startFrame.required",
      "sidecar.sound.narration.startFrame.notInteger",
      "sidecar.sound.narration.startFrame.outOfRange",
      "sidecar.sound.narration.startFrame.pastDuration",
      diagnostics,
    );
    const gain = parseGain(
      entry,
      base,
      "sidecar.sound.narration.gain.notNumber",
      "sidecar.sound.narration.gain.outOfRange",
      diagnostics,
    );
    const duck =
      "duck" in entry
        ? parseDuck(
            entry,
            base,
            "sidecar.sound.narration.duck.notNumber",
            "sidecar.sound.narration.duck.outOfRange",
            diagnostics,
          )
        : 1;
    const envelope = parseEnvelope(entry, base, startFrame, durationFrames, diagnostics);
    const optional = parseOptional(entry, base, diagnostics);

    if (
      id === undefined ||
      src === undefined ||
      startFrame === undefined ||
      gain === undefined ||
      duck === undefined ||
      envelope === undefined ||
      optional === undefined
    ) {
      continue;
    }
    lines.push({ id, src, startFrame, gain, duck, ...envelope, ...optional });
  }
  return lines;
}

function parseDialogueLines(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
  seenIds: Map<string, string>,
  footageTracks: readonly FootageTrack[],
  durationFrames: number | undefined,
): DialogueLine[] {
  if (!("dialogue" in raw)) return [];
  if (!Array.isArray(raw.dialogue)) {
    diagnostics.push(
      diag(
        "sidecar.sound.dialogue.notArray",
        "/sound/dialogue",
        `\`sound.dialogue\` must be an array; got ${describeType(raw.dialogue)}`,
      ),
    );
    return [];
  }

  const byId = new Map(footageTracks.map((t) => [t.id, t]));
  const declaredIds = footageTracks.map((t) => t.id);
  const lines: DialogueLine[] = [];

  for (let i = 0; i < raw.dialogue.length; i++) {
    const entry = raw.dialogue[i];
    const base = `/sound/dialogue/${i}`;
    if (!isPlainObject(entry)) {
      diagnostics.push(
        diag(
          "sidecar.sound.dialogue.notObject",
          base,
          `dialogue line must be an object; got ${describeType(entry)}`,
        ),
      );
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!SOUND_DIALOGUE_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.sound.dialogue.unknownKey",
            `${base}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SOUND_DIALOGUE_KEYS].join(", ")}`,
          ),
        );
      }
    }

    const id = parseSoundId(
      entry,
      base,
      "sidecar.sound.dialogue.id.required",
      "sidecar.sound.dialogue.id.notString",
      "sidecar.sound.dialogue.id.empty",
      "sidecar.sound.dialogue.id.invalid",
      seenIds,
      diagnostics,
    );
    const src = parseSoundSrc(
      entry,
      base,
      "dialogue",
      "sidecar.sound.dialogue.src.required",
      "sidecar.sound.dialogue.src.notString",
      diagnostics,
    );
    const trackId = parseDialogueTrack(entry, base, byId, declaredIds, diagnostics);
    const sourceFrame = parseRequiredNonNegInt(
      entry,
      base,
      "sourceFrame",
      "sidecar.sound.dialogue.sourceFrame.required",
      "sidecar.sound.dialogue.sourceFrame.notInteger",
      "sidecar.sound.dialogue.sourceFrame.outOfRange",
      diagnostics,
    );
    const gain = parseGain(
      entry,
      base,
      "sidecar.sound.dialogue.gain.notNumber",
      "sidecar.sound.dialogue.gain.outOfRange",
      diagnostics,
    );

    let derived: number | undefined;
    if (trackId !== undefined && sourceFrame !== undefined) {
      const track = byId.get(trackId);
      if (track !== undefined) {
        derived = dialogueCompositionFrame(
          { sourceFrame },
          track,
        );
        if (!dialogueInWindow(derived, track)) {
          diagnostics.push(
            diag(
              "sidecar.sound.dialogue.outsideWindow",
              `${base}/sourceFrame`,
              `dialogue line starts at composition frame ${derived}, ` +
                `outside track ${JSON.stringify(trackId)}'s window ` +
                `[${track.startFrame}, ${track.endFrame})`,
            ),
          );
        }
      }
    }

    // The envelope rides the line's own start, which for dialogue is the
    // composition frame the clip mapping derives — so it moves with the clip.
    const envelope = parseEnvelope(entry, base, derived, durationFrames, diagnostics);
    const optional = parseOptional(entry, base, diagnostics);

    if (
      id === undefined ||
      src === undefined ||
      trackId === undefined ||
      sourceFrame === undefined ||
      gain === undefined ||
      envelope === undefined ||
      optional === undefined
    ) {
      continue;
    }
    lines.push({ id, src, track: trackId, sourceFrame, gain, ...envelope, ...optional });
  }
  return lines;
}

function parseSoundCues(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
  seenIds: Map<string, string>,
  durationFrames: number | undefined,
): SoundCue[] {
  if (!("cues" in raw)) return [];
  if (!Array.isArray(raw.cues)) {
    diagnostics.push(
      diag(
        "sidecar.sound.cues.notArray",
        "/sound/cues",
        `\`sound.cues\` must be an array; got ${describeType(raw.cues)}`,
      ),
    );
    return [];
  }

  const cues: SoundCue[] = [];
  for (let i = 0; i < raw.cues.length; i++) {
    const entry = raw.cues[i];
    const base = `/sound/cues/${i}`;
    if (!isPlainObject(entry)) {
      diagnostics.push(
        diag(
          "sidecar.sound.cues.notObject",
          base,
          `sound cue must be an object; got ${describeType(entry)}`,
        ),
      );
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!SOUND_CUE_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "sidecar.sound.cues.unknownKey",
            `${base}/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SOUND_CUE_KEYS].join(", ")}`,
          ),
        );
      }
    }

    const id = parseSoundId(
      entry,
      base,
      "sidecar.sound.cues.id.required",
      "sidecar.sound.cues.id.notString",
      "sidecar.sound.cues.id.empty",
      "sidecar.sound.cues.id.invalid",
      seenIds,
      diagnostics,
    );
    const src = parseSoundSrc(
      entry,
      base,
      "cues",
      "sidecar.sound.cues.src.required",
      "sidecar.sound.cues.src.notString",
      diagnostics,
    );
    const atFrame = parseRequiredFrame(
      entry,
      base,
      "atFrame",
      durationFrames,
      "sidecar.sound.cues.atFrame.required",
      "sidecar.sound.cues.atFrame.notInteger",
      "sidecar.sound.cues.atFrame.outOfRange",
      "sidecar.sound.cues.atFrame.pastDuration",
      diagnostics,
    );
    const gain = parseGain(
      entry,
      base,
      "sidecar.sound.cues.gain.notNumber",
      "sidecar.sound.cues.gain.outOfRange",
      diagnostics,
    );

    const envelope = parseEnvelope(entry, base, atFrame, durationFrames, diagnostics);
    const optional = parseOptional(entry, base, diagnostics);

    if (
      id === undefined ||
      src === undefined ||
      atFrame === undefined ||
      gain === undefined ||
      envelope === undefined ||
      optional === undefined
    ) {
      continue;
    }
    cues.push({ id, src, atFrame, gain, ...envelope, ...optional });
  }
  return cues;
}

function parseSoundSrc(
  entry: Record<string, unknown>,
  base: string,
  role: SoundSrcRole,
  requiredCode: string,
  notStringCode: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!("src" in entry)) {
    diagnostics.push(diag(requiredCode, `${base}/src`, "`src` is required"));
    return undefined;
  }
  if (typeof entry.src !== "string") {
    diagnostics.push(
      diag(
        notStringCode,
        `${base}/src`,
        `\`src\` must be a string; got ${describeType(entry.src)}`,
      ),
    );
    return undefined;
  }
  const issue = pathIssue(entry.src, "src", `sidecar.sound.${role}.src`);
  if (issue !== null) {
    diagnostics.push(diag(issue.code, `${base}/src`, issue.message));
    return undefined;
  }
  return entry.src;
}

function parseSoundId(
  entry: Record<string, unknown>,
  base: string,
  requiredCode: string,
  notStringCode: string,
  emptyCode: string,
  invalidCode: string,
  seenIds: Map<string, string>,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!("id" in entry)) {
    diagnostics.push(diag(requiredCode, `${base}/id`, "`id` is required"));
    return undefined;
  }
  if (typeof entry.id !== "string") {
    diagnostics.push(
      diag(
        notStringCode,
        `${base}/id`,
        `\`id\` must be a string; got ${describeType(entry.id)}`,
      ),
    );
    return undefined;
  }
  if (entry.id.length === 0) {
    diagnostics.push(diag(emptyCode, `${base}/id`, "`id` must be non-empty"));
    return undefined;
  }
  if (!ID_RE.test(entry.id)) {
    diagnostics.push(
      diag(
        invalidCode,
        `${base}/id`,
        `\`id\` must match /^[a-z0-9][a-z0-9-]*$/; got ${JSON.stringify(entry.id)}`,
      ),
    );
    return undefined;
  }
  const prev = seenIds.get(entry.id);
  if (prev !== undefined) {
    diagnostics.push(
      diag(
        "sidecar.sound.id.duplicate",
        `${base}/id`,
        `\`id\` ${JSON.stringify(entry.id)} is duplicated (first seen at ${prev})`,
      ),
    );
    return undefined;
  }
  seenIds.set(entry.id, `${base}/id`);
  return entry.id;
}

function parseDialogueTrack(
  entry: Record<string, unknown>,
  base: string,
  byId: Map<string, FootageTrack>,
  declaredIds: readonly string[],
  diagnostics: Diagnostic[],
): string | undefined {
  if (!("track" in entry)) {
    diagnostics.push(
      diag(
        "sidecar.sound.dialogue.track.required",
        `${base}/track`,
        "`track` is required",
      ),
    );
    return undefined;
  }
  if (typeof entry.track !== "string") {
    diagnostics.push(
      diag(
        "sidecar.sound.dialogue.track.notString",
        `${base}/track`,
        `\`track\` must be a string; got ${describeType(entry.track)}`,
      ),
    );
    return undefined;
  }
  if (!byId.has(entry.track)) {
    const message =
      declaredIds.length === 0
        ? `dialogue line names track ${JSON.stringify(entry.track)} but this sidecar declares no footage`
        : `dialogue line names track ${JSON.stringify(entry.track)}; declared footage ids are ${declaredIds.join(", ")}`;
    diagnostics.push(
      diag("sidecar.sound.dialogue.track.unknown", `${base}/track`, message),
    );
    return undefined;
  }
  return entry.track;
}

function parseGain(
  entry: Record<string, unknown>,
  base: string,
  notNumberCode: string,
  outOfRangeCode: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!("gain" in entry)) return 1;
  const value = entry.gain;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push(
      diag(
        notNumberCode,
        `${base}/gain`,
        `\`gain\` must be a finite number in ${GAIN_MIN}..${GAIN_MAX}; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < GAIN_MIN || value > GAIN_MAX) {
    diagnostics.push(
      diag(
        outOfRangeCode,
        `${base}/gain`,
        `\`gain\` must be in ${GAIN_MIN}..${GAIN_MAX}; got ${value}`,
      ),
    );
    return undefined;
  }
  return value;
}

/** `duck` when present: a linear factor in DUCK_MIN..DUCK_MAX. */
function parseDuck(
  entry: Record<string, unknown>,
  base: string,
  notNumberCode: string,
  outOfRangeCode: string,
  diagnostics: Diagnostic[],
): number | undefined {
  const value = entry.duck;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push(
      diag(
        notNumberCode,
        `${base}/duck`,
        `\`duck\` must be a finite number in ${DUCK_MIN}..${DUCK_MAX}; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < DUCK_MIN || value > DUCK_MAX) {
    diagnostics.push(
      diag(
        outOfRangeCode,
        `${base}/duck`,
        `\`duck\` must be in ${DUCK_MIN}..${DUCK_MAX}; got ${value}`,
      ),
    );
    return undefined;
  }
  return value;
}

function parseNonNegNumber(
  entry: Record<string, unknown>,
  base: string,
  field: string,
  defaultValue: number,
  notNumberCode: string,
  outOfRangeCode: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!(field in entry)) return defaultValue;
  const value = entry[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push(
      diag(
        notNumberCode,
        `${base}/${field}`,
        `\`${field}\` must be a finite number >= 0; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < 0) {
    diagnostics.push(
      diag(
        outOfRangeCode,
        `${base}/${field}`,
        `\`${field}\` must be >= 0; got ${value}`,
      ),
    );
    return undefined;
  }
  return value;
}

function parseNonNegInt(
  entry: Record<string, unknown>,
  base: string,
  field: string,
  defaultValue: number,
  notIntegerCode: string,
  outOfRangeCode: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!(field in entry)) return defaultValue;
  const value = entry[field];
  if (!isInteger(value)) {
    diagnostics.push(
      diag(
        notIntegerCode,
        `${base}/${field}`,
        `\`${field}\` must be an integer >= 0; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < 0) {
    diagnostics.push(
      diag(
        outOfRangeCode,
        `${base}/${field}`,
        `\`${field}\` must be >= 0; got ${value}`,
      ),
    );
    return undefined;
  }
  return value;
}

function parseRequiredNonNegInt(
  entry: Record<string, unknown>,
  base: string,
  field: string,
  requiredCode: string,
  notIntegerCode: string,
  outOfRangeCode: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!(field in entry)) {
    diagnostics.push(diag(requiredCode, `${base}/${field}`, `\`${field}\` is required`));
    return undefined;
  }
  const value = entry[field];
  if (!isInteger(value)) {
    diagnostics.push(
      diag(
        notIntegerCode,
        `${base}/${field}`,
        `\`${field}\` must be an integer >= 0; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < 0) {
    diagnostics.push(
      diag(
        outOfRangeCode,
        `${base}/${field}`,
        `\`${field}\` must be >= 0; got ${value}`,
      ),
    );
    return undefined;
  }
  return value;
}

function parseRequiredFrame(
  entry: Record<string, unknown>,
  base: string,
  field: string,
  durationFrames: number | undefined,
  requiredCode: string,
  notIntegerCode: string,
  outOfRangeCode: string,
  pastDurationCode: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!(field in entry)) {
    diagnostics.push(diag(requiredCode, `${base}/${field}`, `\`${field}\` is required`));
    return undefined;
  }
  const value = entry[field];
  if (!isInteger(value)) {
    diagnostics.push(
      diag(
        notIntegerCode,
        `${base}/${field}`,
        `\`${field}\` must be an integer in 0..durationFrames; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < 0) {
    diagnostics.push(
      diag(
        outOfRangeCode,
        `${base}/${field}`,
        `\`${field}\` must be >= 0; got ${value}`,
      ),
    );
    return undefined;
  }
  if (durationFrames !== undefined && value > durationFrames) {
    diagnostics.push(
      diag(
        pastDurationCode,
        `${base}/${field}`,
        `\`${field}\` must be <= durationFrames (${durationFrames}); got ${value}`,
      ),
    );
    return undefined;
  }
  return value;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ---------------------------------------------------------------------------
// canonicalise
// ---------------------------------------------------------------------------

/**
 * Deterministic serialisation for hashing: keys sorted, no insignificant
 * whitespace, defaults materialised. Two inputs that mean the same thing
 * must produce the same string.
 */
export function canonicalise(value: object): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}
