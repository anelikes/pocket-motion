/**
 * The `captions` job spec: a transcript, a style, and how pages are laid out.
 *
 * `src/manifest/spec.ts` parses the envelope every template shares (spec,
 * viewport, fps, durationFrames, supersample, fonts) and the optional
 * `footage` block lower-third already has, then hands the rest here. Unknown
 * keys are refused at every level, and a style's key set is the style's own:
 * `keywords` on `highlight` is refused rather than ignored, because a key the
 * style does not read is a key whose effect the author would be guessing at.
 *
 * The transcript is READ while the spec is parsed, not when the job runs. A
 * batch (`render --spec jobs/`) parses every job before it renders any, so a
 * transcript that is the wrong shape, is missing a time, or runs past the end
 * of the film stops the batch before the first frame is spent.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { Diagnostic } from "../manifest/sidecar.ts";
import { DURATION_FRAMES_MAX } from "../manifest/sidecar.ts";
import { pathIssue } from "../manifest/paths.ts";
import {
  LANGUAGE_TAG,
  TRANSCRIPT_FORMATS,
  UNTIMED_MODES,
  ingestInlineWords,
  ingestTranscript,
  type CaptionWord,
  type IngestResult,
  type TranscriptFormat,
  type UntimedMode,
} from "./ingest.ts";
import { POSITIONS, SAFE_AREAS, aspectOf, derivedDuration, type Position } from "./layout.ts";
import { frameOf } from "./clock.ts";
import {
  CASES,
  KEYWORD_STYLES,
  STYLE_COLOURS,
  STYLE_DEFAULTS,
  STYLE_NAMES,
  type StyleName,
  type TextCase,
} from "./styles.ts";

export const SPEC_TEMPLATE_CAPTIONS = "captions";

/** Root keys the `captions` template adds to the envelope. */
export const CAPTIONS_BODY_KEYS = ["transcript", "style", "layout", "footage"] as const;
export const CAPTIONS_TRANSCRIPT_KEYS = new Set(["src", "format", "language", "untimed", "words"]);
export const CAPTIONS_STYLE_COMMON_KEYS = ["name", "size", "minSize", "case"] as const;
export const CAPTIONS_LAYOUT_KEYS = new Set([
  "position",
  "maxLines",
  "maxWords",
  "pauseMs",
  "holdMs",
  "lineWidth",
  "margin",
]);

/** Every key `style` may carry when it names `name`. */
export function captionsStyleKeys(name: StyleName): Set<string> {
  return new Set([
    ...CAPTIONS_STYLE_COMMON_KEYS,
    ...Object.keys(STYLE_COLOURS[name]),
    ...(KEYWORD_STYLES.has(name) ? ["keywords"] : []),
  ]);
}

export const CAPTIONS_SIZE_MIN = 8;
/** The atlas cell is a byte tall, so no face bakes this large; the face's own
 *  ceiling is lower and the build names it (AGENTS.md). */
export const CAPTIONS_SIZE_MAX = 240;
export const CAPTIONS_SHORT_SIDE_MIN = 360;
export const CAPTIONS_SHORT_SIDE_MAX = 2160;
export const CAPTIONS_MAX_LINES = 4;
export const CAPTIONS_MAX_WORDS = 100;
export const CAPTIONS_MS_MAX = 10_000;

/**
 * Envelope keys whose meaning this template changes: `viewport` takes three
 * aspects instead of 1920×1080 alone, and `durationFrames`, when absent, is
 * the transcript's length rather than 1.
 */
export const CAPTIONS_ENVELOPE_RULES = ["viewport", "durationFrames"] as const;

const HEX = /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export interface CaptionsTranscript {
  /** Repo-relative, when the words came from a file. */
  readonly src?: string;
  readonly format: TranscriptFormat;
  readonly language: string;
  readonly untimed: UntimedMode;
  readonly words: readonly CaptionWord[];
}

export interface CaptionsStyle {
  readonly name: StyleName;
  readonly size: number;
  readonly minSize: number;
  readonly case: TextCase;
  /** Every colour the style paints, defaults materialised. */
  readonly colours: Readonly<Record<string, string>>;
  readonly keywords: readonly string[];
}

export interface CaptionsLayout {
  readonly position: Position;
  readonly maxLines: number;
  readonly maxWords: number | null;
  readonly pauseMs: number;
  readonly holdMs: number;
  readonly lineWidth: number;
  readonly margin: number;
}

export interface CaptionsBody {
  readonly transcript: CaptionsTranscript;
  readonly style: CaptionsStyle;
  readonly layout: CaptionsLayout;
  readonly durationFrames: number;
}

export interface CaptionsEnvelope {
  readonly viewport: readonly [number, number];
  readonly fps: number;
  /** The envelope's value, and whether the spec wrote it. */
  readonly durationFrames: number;
  readonly durationDeclared: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const diag = (code: string, path: string, message: string): Diagnostic => ({ code, path, message });

function unknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  code: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diag(code, `${path}/${key}`, `unknown key ${JSON.stringify(key)}; allowed keys are ${[...allowed].join(", ")}`),
      );
    }
  }
}

function intIn(
  value: unknown,
  min: number,
  max: number,
  code: string,
  path: string,
  what: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    diagnostics.push(diag(code, path, `\`${what}\` must be an integer ${min}…${max}; got ${JSON.stringify(value)}`));
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  code: string,
  path: string,
  what: string,
  diagnostics: Diagnostic[],
): T | undefined {
  if (!(values as readonly unknown[]).includes(value)) {
    diagnostics.push(
      diag(code, path, `\`${what}\` must be one of ${values.join(", ")}; got ${JSON.stringify(value)}`),
    );
    return undefined;
  }
  return value as T;
}

/** The viewport rule this template adds: three aspects, even sides, a sane size. */
export function checkCaptionsViewport(viewport: readonly [number, number], diagnostics: Diagnostic[]): void {
  const [w, h] = viewport;
  const short = Math.min(w, h);
  if (
    aspectOf(w, h) === undefined ||
    w % 2 !== 0 ||
    h % 2 !== 0 ||
    short < CAPTIONS_SHORT_SIDE_MIN ||
    short > CAPTIONS_SHORT_SIDE_MAX
  ) {
    diagnostics.push(
      diag(
        "spec.viewport.aspect",
        "/viewport",
        `the captions template lays out 16:9, 9:16 and 1:1 exactly, with even sides (yuv420p needs ` +
          `them) and a short side of ${CAPTIONS_SHORT_SIDE_MIN}…${CAPTIONS_SHORT_SIDE_MAX}; got ${w}×${h}`,
      ),
    );
  }
}

function parseTranscript(
  input: Record<string, unknown>,
  root: string,
  diagnostics: Diagnostic[],
): CaptionsTranscript | undefined {
  if (!("transcript" in input)) {
    diagnostics.push(diag("spec.transcript.required", "/transcript", "`transcript` is required"));
    return undefined;
  }
  const t = input.transcript;
  if (!isPlainObject(t)) {
    diagnostics.push(
      diag("spec.transcript.notObject", "/transcript", `\`transcript\` must be an object; got ${describe(t)}`),
    );
    return undefined;
  }
  const before = diagnostics.length;
  unknownKeys(t, CAPTIONS_TRANSCRIPT_KEYS, "/transcript", "spec.transcript.unknownKey", diagnostics);

  let language: string | undefined;
  if (typeof t.language !== "string" || !LANGUAGE_TAG.test(t.language)) {
    diagnostics.push(
      diag(
        "spec.transcript.language",
        "/transcript/language",
        "`transcript.language` is required: a BCP-47 tag such as `en` or `zh-Hans`. It decides whether " +
          `words are joined with spaces and where a line may break; got ${JSON.stringify(t.language)}`,
      ),
    );
  } else {
    language = t.language;
  }

  let untimed: UntimedMode = "refuse";
  if ("untimed" in t) {
    const u = oneOf(t.untimed, UNTIMED_MODES, "spec.transcript.untimedMode", "/transcript/untimed", "transcript.untimed", diagnostics);
    if (u !== undefined) untimed = u;
  }

  const hasSrc = "src" in t;
  const hasWords = "words" in t;
  if (hasSrc === hasWords) {
    diagnostics.push(
      diag(
        "spec.transcript.source",
        "/transcript",
        "`transcript` names its words exactly one way: `src` (a file, with `format`) or `words` (inline)",
      ),
    );
    return undefined;
  }

  if (hasWords) {
    if ("format" in t && t.format !== "words") {
      diagnostics.push(
        diag(
          "spec.transcript.format",
          "/transcript/format",
          `inline \`words\` are always this repository's own schema; \`format\` may only be "words" here, got ${JSON.stringify(t.format)}`,
        ),
      );
      return undefined;
    }
    if (language === undefined || diagnostics.length > before) return undefined;
    const r = ingestInlineWords(t.words, { language, untimed, path: "/transcript" });
    return collect(r, diagnostics, { format: "words", language, untimed });
  }

  const format = oneOf(t.format, TRANSCRIPT_FORMATS, "spec.transcript.format", "/transcript/format", "transcript.format", diagnostics);
  if (typeof t.src !== "string") {
    diagnostics.push(diag("spec.transcript.src.missing", "/transcript/src", "`transcript.src` must be a repo-relative path"));
    return undefined;
  }
  const issue = pathIssue(t.src, "src", "spec.transcript.src");
  if (issue) {
    diagnostics.push(diag(issue.code, "/transcript/src", issue.message));
    return undefined;
  }
  const abs = resolve(root, t.src);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    diagnostics.push(diag("spec.transcript.missingFile", "/transcript/src", `the transcript is not on disk: ${abs}`));
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    diagnostics.push(
      diag("spec.transcript.json", "/transcript/src", `the transcript is not JSON: ${e instanceof Error ? e.message : String(e)}`),
    );
    return undefined;
  }
  if (format === undefined || language === undefined || diagnostics.length > before) return undefined;
  const r = ingestTranscript(raw, { format, language, untimed, path: "/transcript/src" });
  return collect(r, diagnostics, { src: t.src, format, language, untimed });
}

function collect(
  r: IngestResult,
  diagnostics: Diagnostic[],
  base: Omit<CaptionsTranscript, "words">,
): CaptionsTranscript | undefined {
  if (!r.ok) {
    diagnostics.push(...r.diagnostics);
    return undefined;
  }
  return { ...base, words: r.words };
}

function parseStyle(
  input: Record<string, unknown>,
  viewport: readonly [number, number],
  diagnostics: Diagnostic[],
): CaptionsStyle | undefined {
  if (!("style" in input)) {
    diagnostics.push(diag("spec.style.required", "/style", `\`style\` is required, naming one of ${STYLE_NAMES.join(", ")}`));
    return undefined;
  }
  const s = input.style;
  if (!isPlainObject(s)) {
    diagnostics.push(diag("spec.style.notObject", "/style", `\`style\` must be an object; got ${describe(s)}`));
    return undefined;
  }
  const name = oneOf(s.name, STYLE_NAMES, "spec.style.name", "/style/name", "style.name", diagnostics);
  if (name === undefined) return undefined;
  unknownKeys(s, captionsStyleKeys(name), "/style", "spec.style.unknownKey", diagnostics);
  const d = STYLE_DEFAULTS[name];

  const scaled = Math.round((d.size * Math.min(viewport[0], viewport[1])) / 1080);
  let size = Math.min(CAPTIONS_SIZE_MAX, Math.max(CAPTIONS_SIZE_MIN, scaled));
  if ("size" in s) {
    const v = intIn(s.size, CAPTIONS_SIZE_MIN, CAPTIONS_SIZE_MAX, "spec.style.size", "/style/size", "style.size", diagnostics);
    if (v !== undefined) size = v;
  }
  let minSize = Math.max(CAPTIONS_SIZE_MIN, Math.round(size * d.minRatio));
  if ("minSize" in s) {
    const v = intIn(s.minSize, CAPTIONS_SIZE_MIN, size, "spec.style.minSize", "/style/minSize", "style.minSize", diagnostics);
    if (v !== undefined) minSize = v;
  }
  let textCase = d.case;
  if ("case" in s) {
    const v = oneOf(s.case, CASES, "spec.style.case", "/style/case", "style.case", diagnostics);
    if (v !== undefined) textCase = v;
  }
  const colours: Record<string, string> = {};
  for (const [key, fallback] of Object.entries(STYLE_COLOURS[name])) {
    if (!(key in s)) {
      colours[key] = fallback;
      continue;
    }
    const v = s[key];
    if (typeof v !== "string" || !HEX.test(v)) {
      diagnostics.push(
        diag("spec.style.hex", `/style/${key}`, `\`style.${key}\` must be \`#RRGGBB\` or \`#RRGGBBAA\`; got ${JSON.stringify(v)}`),
      );
      continue;
    }
    colours[key] = v.toLowerCase();
  }
  let keywords: string[] = [];
  if ("keywords" in s) {
    const k = s.keywords;
    if (!Array.isArray(k) || k.some((x) => typeof x !== "string" || x.trim() === "")) {
      diagnostics.push(
        diag("spec.style.keywords", "/style/keywords", "`style.keywords` must be an array of non-empty strings"),
      );
    } else {
      keywords = k as string[];
    }
  }
  return { name, size, minSize, case: textCase, colours, keywords };
}

function parseLayout(
  input: Record<string, unknown>,
  viewport: readonly [number, number],
  style: StyleName | undefined,
  diagnostics: Diagnostic[],
): CaptionsLayout | undefined {
  const raw = "layout" in input ? input.layout : {};
  if (!isPlainObject(raw)) {
    diagnostics.push(diag("spec.layout.notObject", "/layout", `\`layout\` must be an object; got ${describe(raw)}`));
    return undefined;
  }
  unknownKeys(raw, CAPTIONS_LAYOUT_KEYS, "/layout", "spec.layout.unknownKey", diagnostics);
  if (style === undefined) return undefined;
  const d = STYLE_DEFAULTS[style];
  const [w, h] = viewport;
  const aspect = aspectOf(w, h) ?? "16:9";
  const safe = SAFE_AREAS[aspect];
  let position = d.position;
  if ("position" in raw) {
    const v = oneOf(raw.position, POSITIONS, "spec.layout.position", "/layout/position", "layout.position", diagnostics);
    if (v !== undefined) position = v;
  }
  // Each code is written out rather than built from the key, so the catalogue
  // gate (`tests/catalog.test.ts` G9) can find every one by reading this file.
  const int = (key: string, code: string, min: number, max: number, fallback: number): number => {
    if (!(key in raw)) return fallback;
    return intIn(raw[key], min, max, code, `/layout/${key}`, `layout.${key}`, diagnostics) ?? fallback;
  };
  const maxLines = int("maxLines", "spec.layout.maxLines", 1, CAPTIONS_MAX_LINES, d.maxLines);
  const maxWords = "maxWords" in raw ? int("maxWords", "spec.layout.maxWords", 1, CAPTIONS_MAX_WORDS, 1) : d.maxWords;
  const pauseMs = int("pauseMs", "spec.layout.pauseMs", 0, CAPTIONS_MS_MAX, d.pauseMs);
  const holdMs = int("holdMs", "spec.layout.holdMs", 0, CAPTIONS_MS_MAX, d.holdMs);
  const lineWidth = int("lineWidth", "spec.layout.lineWidth", 1, w, Math.round(safe.lineWidth * w));
  const anchor = position === "top" ? safe.top : safe.bottom;
  const margin = int("margin", "spec.layout.margin", 0, Math.floor(h / 2), Math.round(anchor * h));
  return { position, maxLines, maxWords, pauseMs, holdMs, lineWidth, margin };
}

/**
 * Parse the `captions` body. `diagnostics` already holds the envelope's; this
 * appends its own and returns undefined when anything is wrong.
 */
export function parseCaptionsBody(
  input: Record<string, unknown>,
  root: string,
  env: CaptionsEnvelope,
  diagnostics: Diagnostic[],
): CaptionsBody | undefined {
  checkCaptionsViewport(env.viewport, diagnostics);
  const style = parseStyle(input, env.viewport, diagnostics);
  const layout = parseLayout(input, env.viewport, style?.name, diagnostics);
  const transcript = parseTranscript(input, root, diagnostics);
  if (!style || !layout || !transcript) return undefined;

  const ends = transcript.words.map((w) => Math.max(frameOf(w.start, env.fps) + 1, frameOf(w.end, env.fps)));
  const lastEnd = Math.max(...ends);
  let durationFrames = env.durationFrames;
  if (env.durationDeclared) {
    if (lastEnd > env.durationFrames) {
      const i = ends.indexOf(lastEnd);
      diagnostics.push(
        diag(
          "spec.transcript.pastEnd",
          "/durationFrames",
          `word ${i} ${JSON.stringify(transcript.words[i]!.text)} ends at frame ${lastEnd} at ${env.fps} fps, ` +
            `past the film's ${env.durationFrames} frames; raise \`durationFrames\` or omit it to take the ` +
            "transcript's own length",
        ),
      );
      return undefined;
    }
  } else {
    durationFrames = derivedDuration(transcript.words, env.fps, layout.holdMs);
    if (durationFrames > DURATION_FRAMES_MAX) {
      diagnostics.push(
        diag(
          "spec.transcript.pastEnd",
          "/transcript",
          `the transcript runs ${durationFrames} frames at ${env.fps} fps, past the ${DURATION_FRAMES_MAX} a film may have`,
        ),
      );
      return undefined;
    }
  }
  return { transcript, style, layout, durationFrames };
}
