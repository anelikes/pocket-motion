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

export interface SoundBed {
  readonly src: string;
  /** Seconds into the source. Default 0. */
  readonly startAt: number;
  /** Linear gain. Default 1. */
  readonly gain: number;
  readonly fadeInMs: number;
  readonly fadeOutMs: number;
}

export interface NarrationLine {
  readonly id: string;
  readonly src: string;
  /** Composition frame at which this line starts. */
  readonly startFrame: number;
  readonly gain: number;
  /** Linear gain applied to the bed while this line runs. Default 1 (no duck). */
  readonly duck: number;
}

export interface DialogueLine {
  readonly id: string;
  readonly src: string;
  /** A declared `footage[].id`. */
  readonly track: string;
  /** The clip's own frame at which this line starts. */
  readonly sourceFrame: number;
  readonly gain: number;
}

export interface SoundCue {
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

export interface MotionSidecar {
  readonly motion: 1;
  readonly durationFrames: number;
  readonly fps: number;
  readonly supersample: 1 | 2 | 4; // defaulted to 1 when absent
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

export const ROOT_KEYS = new Set([
  "motion",
  "durationFrames",
  "fps",
  "supersample",
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

export const SOUND_KEYS = new Set(["bed", "narration", "dialogue", "cues"]);

export const SOUND_BED_KEYS = new Set([
  "src",
  "startAt",
  "gain",
  "fadeInMs",
  "fadeOutMs",
]);

export const SOUND_NARRATION_KEYS = new Set([
  "id",
  "src",
  "startFrame",
  "gain",
  "duck",
]);

export const SOUND_DIALOGUE_KEYS = new Set([
  "id",
  "src",
  "track",
  "sourceFrame",
  "gain",
]);

export const SOUND_CUE_KEYS = new Set(["id", "src", "atFrame", "gain"]);

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
      footage,
      ...(fonts ? { fonts } : {}),
      sound,
      layoutAllow,
      assertions,
    },
  };
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
  const bed = parseSoundBed(raw, diagnostics);
  const narration = parseNarrationLines(raw, diagnostics, seenIds, durationFrames);
  const dialogue = parseDialogueLines(
    raw,
    diagnostics,
    seenIds,
    footageTracks,
  );
  const cues = parseSoundCues(raw, diagnostics, seenIds, durationFrames);

  return {
    ...(bed !== undefined ? { bed } : {}),
    narration,
    dialogue,
    cues,
  };
}

function parseSoundBed(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
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

  if (
    src === undefined ||
    startAt === undefined ||
    gain === undefined ||
    fadeInMs === undefined ||
    fadeOutMs === undefined
  ) {
    return undefined;
  }
  return { src, startAt, gain, fadeInMs, fadeOutMs };
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
    const duck = parseDuck(entry, base, diagnostics);

    if (
      id === undefined ||
      src === undefined ||
      startFrame === undefined ||
      gain === undefined ||
      duck === undefined
    ) {
      continue;
    }
    lines.push({ id, src, startFrame, gain, duck });
  }
  return lines;
}

function parseDialogueLines(
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
  seenIds: Map<string, string>,
  footageTracks: readonly FootageTrack[],
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

    if (trackId !== undefined && sourceFrame !== undefined) {
      const track = byId.get(trackId);
      if (track !== undefined) {
        const derived = dialogueCompositionFrame(
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

    if (
      id === undefined ||
      src === undefined ||
      trackId === undefined ||
      sourceFrame === undefined ||
      gain === undefined
    ) {
      continue;
    }
    lines.push({ id, src, track: trackId, sourceFrame, gain });
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

    if (
      id === undefined ||
      src === undefined ||
      atFrame === undefined ||
      gain === undefined
    ) {
      continue;
    }
    cues.push({ id, src, atFrame, gain });
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

function parseDuck(
  entry: Record<string, unknown>,
  base: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!("duck" in entry)) return 1;
  const value = entry.duck;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push(
      diag(
        "sidecar.sound.narration.duck.notNumber",
        `${base}/duck`,
        `\`duck\` must be a finite number in ${DUCK_MIN}..${DUCK_MAX}; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  if (value < DUCK_MIN || value > DUCK_MAX) {
    diagnostics.push(
      diag(
        "sidecar.sound.narration.duck.outOfRange",
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
