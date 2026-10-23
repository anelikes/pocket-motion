/**
 * Word-level transcripts in, one list of timed words out.
 *
 * Three shapes are read, and which one a file is is DECLARED by the job spec
 * (`transcript.format`) rather than guessed from its keys: an OpenAI
 * `verbose_json` carries `segments` too, and a file that is half one shape and
 * half another should be refused under the name the author gave it rather
 * than read under whichever name its keys happened to match first.
 *
 *   words     this repository's own: `{ "words": [{ "text", "start", "end" }] }`,
 *             seconds, every key required, unknown keys refused. The same word
 *             objects may be written inline in the spec as `transcript.words`.
 *   whisperx  WhisperX's aligned output: `segments[].words[]` of
 *             `{ word, start?, end?, score? }`. Only the keys this reads are
 *             checked; the rest of the file is WhisperX's to evolve.
 *   openai    OpenAI's `verbose_json` with `timestamp_granularities: ["word"]`:
 *             a root `words[]` of `{ word, start, end }` and the full `text`.
 *
 * What every shape is reduced to, and the three rules that decide it:
 *
 * - **Punctuation is attached, never timed.** A token that is punctuation and
 *   nothing else is not a word anyone speaks: WhisperX emits CJK `，` and `。`
 *   as tokens of their own, often without times. Opening marks (`(`, `「`, `“`)
 *   go onto the word after them, everything else onto the word before. So no
 *   caption unit begins with `，`, which is the half of 行頭禁則 a transcript
 *   can violate before layout has seen it.
 * - **OpenAI's words carry no punctuation**, and its `text` does. It is put
 *   back by walking `text` and finding each word in order, as an exact
 *   substring; what lies between two words must be whitespace and
 *   punctuation. A word that is not found, or letters between two words, is
 *   refused (`spec.transcript.unaligned`) — the two halves of the file
 *   disagree about what was said, and choosing one would be a guess.
 * - **A spoken token without times is refused** unless the spec says
 *   `untimed: "attach"`. WhisperX leaves numerals it could not align untimed;
 *   attaching one to the word before it shows "in 1990" when "in" is spoken,
 *   which is a reasonable picture and a decision the author has to make,
 *   not one a default should make for them.
 */

import type { Diagnostic } from "../manifest/sidecar.ts";

export const TRANSCRIPT_FORMATS = ["words", "whisperx", "openai"] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export const UNTIMED_MODES = ["refuse", "attach"] as const;
export type UntimedMode = (typeof UNTIMED_MODES)[number];

/** Keys of one word in this repository's own schema. */
export const WORD_KEYS = new Set(["text", "start", "end"]);
/** Root keys of a `format: "words"` file. */
export const WORDS_FILE_KEYS = new Set(["words"]);

/** A timed word, after punctuation has been attached. Seconds. */
export interface CaptionWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** The last word of a transcript segment (WhisperX). A page closes after it. */
  readonly segmentEnd: boolean;
}

export type IngestResult =
  | { readonly ok: true; readonly words: readonly CaptionWord[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface IngestOptions {
  readonly format: TranscriptFormat;
  /** BCP-47 tag from the spec. Decides how attached text is joined. */
  readonly language: string;
  readonly untimed: UntimedMode;
  /** Where the transcript is declared, for diagnostics: `/transcript/src`
   *  for a file (a pointer INTO the file follows a `#`), `/transcript` for
   *  inline words. */
  readonly path: string;
}

/** A token before attachment: times may be absent (WhisperX). */
interface Token {
  text: string;
  start: number | undefined;
  end: number | undefined;
  segmentEnd: boolean;
  /** Where it came from, for a message: `segments/2/words/5`. */
  where: string;
}

/**
 * Languages written without spaces between words. A transcript in one of
 * these joins attached text without a space, and layout may break a word
 * between its characters (`src/captions/layout.ts`).
 */
const SPACELESS = new Set(["zh", "ja", "yue", "wuu", "th", "lo", "km", "my"]);

export const primaryLanguage = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0]!;
export const isSpaceless = (tag: string): boolean => SPACELESS.has(primaryLanguage(tag));

/** BCP-47 shape only: a 2–3 letter primary subtag and optional subtags. */
export const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * OpenAI reports `language` as an English name. Only these are checked
 * against the spec's tag; a name outside the table is not a disagreement,
 * because this file does not know what it means.
 */
const OPENAI_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  english: "en",
  chinese: "zh",
  japanese: "ja",
  korean: "ko",
  french: "fr",
  german: "de",
  spanish: "es",
  portuguese: "pt",
  italian: "it",
  russian: "ru",
  cantonese: "yue",
  thai: "th",
};

/** Punctuation and nothing else. */
const PUNCT_ONLY = /^\p{P}+$/u;
/** Marks that open: they belong to the word after them. */
const OPENING = /^[\p{Ps}\p{Pi}]+$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diag(code: string, path: string, message: string): Diagnostic {
  return { code, path, message };
}

const quote = (s: string): string => JSON.stringify(s);

/** Parse a transcript file's JSON into timed words. */
export function ingestTranscript(raw: unknown, o: IngestOptions): IngestResult {
  const diagnostics: Diagnostic[] = [];
  const tokens =
    o.format === "words"
      ? tokensOfWords(raw, o, diagnostics)
      : o.format === "whisperx"
        ? tokensOfWhisperX(raw, o, diagnostics)
        : tokensOfOpenAI(raw, o, diagnostics);
  return finish(tokens, o, diagnostics);
}

/** The spec's inline `transcript.words`: this repository's word objects, no file. */
export function ingestInlineWords(list: unknown, o: Omit<IngestOptions, "format">): IngestResult {
  const diagnostics: Diagnostic[] = [];
  const tokens = tokensOfWordList(list, `${o.path}/words`, diagnostics);
  return finish(tokens, { ...o, format: "words" }, diagnostics);
}

function finish(tokens: Token[] | undefined, o: IngestOptions, diagnostics: Diagnostic[]): IngestResult {
  if (diagnostics.length > 0 || tokens === undefined) return { ok: false, diagnostics };
  const words = attach(tokens, o, diagnostics);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  checkTimes(words, o, diagnostics);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, words };
}

/** Read `words[]` of `{text, start, end}` — the file form and the inline form. */
function tokensOfWordList(
  list: unknown,
  path: string,
  diagnostics: Diagnostic[],
): Token[] | undefined {
  if (!Array.isArray(list)) {
    diagnostics.push(
      diag("spec.transcript.shape", path, `\`words\` must be an array of { text, start, end }; got ${describe(list)}`),
    );
    return undefined;
  }
  const out: Token[] = [];
  list.forEach((w, i) => {
    const at = `${path}/${i}`;
    if (!isPlainObject(w)) {
      diagnostics.push(diag("spec.transcript.shape", at, `a word must be an object { text, start, end }; got ${describe(w)}`));
      return;
    }
    for (const key of Object.keys(w)) {
      if (!WORD_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "spec.transcript.unknownKey",
            `${at}/${key}`,
            `unknown key ${quote(key)}; allowed keys are ${[...WORD_KEYS].join(", ")}`,
          ),
        );
      }
    }
    if (typeof w.text !== "string") {
      diagnostics.push(diag("spec.transcript.shape", `${at}/text`, "`text` is required and must be a string"));
      return;
    }
    if (typeof w.start !== "number" || typeof w.end !== "number") {
      diagnostics.push(
        diag("spec.transcript.shape", at, "`start` and `end` are required and must be numbers of seconds"),
      );
      return;
    }
    out.push({ text: w.text, start: w.start, end: w.end, segmentEnd: false, where: `words/${i}` });
  });
  return out;
}

function tokensOfWords(raw: unknown, o: IngestOptions, diagnostics: Diagnostic[]): Token[] | undefined {
  if (!isPlainObject(raw)) {
    diagnostics.push(
      diag("spec.transcript.shape", o.path, `a \`words\` transcript is an object { "words": [...] }; got ${describe(raw)}`),
    );
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!WORDS_FILE_KEYS.has(key)) {
      diagnostics.push(
        diag(
          "spec.transcript.unknownKey",
          `${o.path}#/${key}`,
          `unknown key ${quote(key)}; allowed keys are ${[...WORDS_FILE_KEYS].join(", ")}`,
        ),
      );
    }
  }
  return tokensOfWordList(raw.words, `${o.path}#/words`, diagnostics);
}

function tokensOfWhisperX(raw: unknown, o: IngestOptions, diagnostics: Diagnostic[]): Token[] | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw.segments)) {
    diagnostics.push(
      diag(
        "spec.transcript.shape",
        o.path,
        "a WhisperX transcript is an object with `segments[]`, each carrying `words[]`; " +
          `got ${isPlainObject(raw) ? "an object without a `segments` array" : describe(raw)}`,
      ),
    );
    return undefined;
  }
  checkLanguage(raw.language, o, (lang) => lang, diagnostics);
  const out: Token[] = [];
  raw.segments.forEach((seg, si) => {
    const at = `${o.path}#/segments/${si}`;
    if (!isPlainObject(seg) || !Array.isArray(seg.words)) {
      diagnostics.push(
        diag(
          "spec.transcript.shape",
          at,
          "a WhisperX segment must carry `words[]` — this file was not aligned " +
            "(run WhisperX's alignment step, which is what produces word times)",
        ),
      );
      return;
    }
    const before = out.length;
    seg.words.forEach((w, wi) => {
      const wat = `${at}/words/${wi}`;
      if (!isPlainObject(w) || typeof w.word !== "string") {
        diagnostics.push(diag("spec.transcript.shape", wat, "a WhisperX word must be an object with a string `word`"));
        return;
      }
      const start = w.start;
      const end = w.end;
      if ((start !== undefined && typeof start !== "number") || (end !== undefined && typeof end !== "number")) {
        diagnostics.push(diag("spec.transcript.shape", wat, "`start` and `end` must be numbers of seconds when present"));
        return;
      }
      out.push({ text: w.word, start, end, segmentEnd: false, where: `segments/${si}/words/${wi}` });
    });
    if (out.length > before) out[out.length - 1]!.segmentEnd = true;
  });
  return out;
}

function tokensOfOpenAI(raw: unknown, o: IngestOptions, diagnostics: Diagnostic[]): Token[] | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw.words) || typeof raw.text !== "string") {
    diagnostics.push(
      diag(
        "spec.transcript.shape",
        o.path,
        "an OpenAI transcript is a `verbose_json` object with `text` and a root `words[]` — " +
          'request it with `timestamp_granularities: ["word"]`',
      ),
    );
    return undefined;
  }
  checkLanguage(raw.language, o, (name) => OPENAI_LANGUAGE_NAMES[name.toLowerCase()], diagnostics);
  const tokens: Token[] = [];
  raw.words.forEach((w, i) => {
    const at = `${o.path}#/words/${i}`;
    if (!isPlainObject(w) || typeof w.word !== "string" || typeof w.start !== "number" || typeof w.end !== "number") {
      diagnostics.push(diag("spec.transcript.shape", at, "an OpenAI word is { word: string, start: number, end: number }"));
      return;
    }
    tokens.push({ text: w.word, start: w.start, end: w.end, segmentEnd: false, where: `words/${i}` });
  });
  if (diagnostics.length > 0) return undefined;
  return restorePunctuation(tokens, raw.text, o, diagnostics);
}

/**
 * Put OpenAI's punctuation back from `text`.
 *
 * Between two words, everything must be whitespace or punctuation: marks
 * before the first whitespace close the word before, marks after the last
 * whitespace open the word after, and a mark standing alone between spaces
 * (` — `) closes the word before. Text before the first word opens it; text
 * after the last closes it.
 */
function restorePunctuation(
  tokens: Token[],
  text: string,
  o: IngestOptions,
  diagnostics: Diagnostic[],
): Token[] | undefined {
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const t of tokens) {
    const needle = t.text.trim();
    if (needle === "") {
      spans.push([cursor, cursor]);
      continue;
    }
    const at = text.indexOf(needle, cursor);
    if (at < 0) {
      diagnostics.push(
        diag(
          "spec.transcript.unaligned",
          `${o.path}#/${t.where}`,
          `word ${quote(needle)} is not in \`text\` after character ${cursor}; the words and the text ` +
            "disagree about what was said, so the punctuation cannot be put back",
        ),
      );
      return undefined;
    }
    spans.push([at, at + needle.length]);
    cursor = at + needle.length;
  }
  const out = tokens.map((t) => ({ ...t, text: t.text.trim() }));
  const gapOf = (from: number, to: number, where: string): string[] | undefined => {
    const gap = text.slice(from, to);
    if (/[^\s\p{P}]/u.test(gap)) {
      diagnostics.push(
        diag(
          "spec.transcript.unaligned",
          `${o.path}#/${where}`,
          `\`text\` carries ${quote(gap.trim())} between two words that \`words[]\` does not; ` +
            "the two halves of the file disagree about what was said",
        ),
      );
      return undefined;
    }
    return gap.split(/\s+/);
  };
  // Leading text opens the first word.
  const lead = gapOf(0, spans[0]?.[0] ?? 0, tokens[0]?.where ?? "words");
  if (lead === undefined) return undefined;
  if (out[0]) out[0].text = lead.join("") + out[0].text;
  for (let i = 0; i + 1 < out.length; i++) {
    const parts = gapOf(spans[i]![1], spans[i + 1]![0], tokens[i + 1]!.where);
    if (parts === undefined) return undefined;
    if (parts.length === 1) {
      // No whitespace between them: a CJK mark, or an apostrophe-split token.
      const mark = parts[0]!;
      if (mark !== "" && OPENING.test(mark)) out[i + 1]!.text = mark + out[i + 1]!.text;
      else out[i]!.text += mark;
      continue;
    }
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const middle = parts.slice(1, -1).filter((p) => p !== "");
    out[i]!.text += first + middle.map((m) => ` ${m}`).join("");
    out[i + 1]!.text = last + out[i + 1]!.text;
  }
  const tail = gapOf(spans[spans.length - 1]?.[1] ?? 0, text.length, tokens[tokens.length - 1]?.where ?? "words");
  if (tail === undefined) return undefined;
  if (out.length > 0) out[out.length - 1]!.text += tail.join("");
  return out;
}

function checkLanguage(
  declared: unknown,
  o: IngestOptions,
  toTag: (value: string) => string | undefined,
  diagnostics: Diagnostic[],
): void {
  if (typeof declared !== "string") return;
  const tag = toTag(declared);
  if (tag === undefined) return;
  if (primaryLanguage(tag) !== primaryLanguage(o.language)) {
    diagnostics.push(
      diag(
        "spec.transcript.language",
        `${o.path}#/language`,
        `the transcript says it is ${quote(declared)} and the spec says ${quote(o.language)}; ` +
          "the language decides whether words are joined with spaces and where a line may break, " +
          "so the two have to agree",
      ),
    );
  }
}

/**
 * Attach punctuation-only tokens to their neighbours, and untimed spoken
 * tokens when the spec allows it. Whitespace-only tokens carry nothing to draw
 * and are dropped.
 */
function attach(tokens: readonly Token[], o: IngestOptions, diagnostics: Diagnostic[]): CaptionWord[] {
  const joiner = isSpaceless(o.language) ? "" : " ";
  const cleaned = tokens
    .map((t) => ({ ...t, text: t.text.trim() }))
    .filter((t) => t.text !== "");

  const untimed = cleaned.filter(
    (t) => !PUNCT_ONLY.test(t.text) && (t.start === undefined || t.end === undefined),
  );
  if (untimed.length > 0 && o.untimed === "refuse") {
    diagnostics.push(
      diag(
        "spec.transcript.untimed",
        o.path,
        `${untimed.length} spoken word(s) carry no times: ` +
          untimed
            .slice(0, 6)
            .map((t) => `${quote(t.text)} (${t.where})`)
            .join(", ") +
          (untimed.length > 6 ? ", …" : "") +
          '. Give them times, or set `transcript.untimed: "attach"` to show each with the word before it',
      ),
    );
    return [];
  }

  const out: Array<{ text: string; start: number; end: number; segmentEnd: boolean }> = [];
  /** Opening marks (and leading untimed text) waiting for the next timed word. */
  let pendingOpen = "";
  for (const t of cleaned) {
    const timed = t.start !== undefined && t.end !== undefined;
    if (PUNCT_ONLY.test(t.text) || !timed) {
      const opens = PUNCT_ONLY.test(t.text) && OPENING.test(t.text);
      const prev = out[out.length - 1];
      if (opens || prev === undefined) {
        pendingOpen += (pendingOpen !== "" && !PUNCT_ONLY.test(t.text) ? joiner : "") + t.text;
        continue;
      }
      prev.text += (PUNCT_ONLY.test(t.text) ? "" : joiner) + t.text;
      if (t.end !== undefined) prev.end = Math.max(prev.end, t.end);
      prev.segmentEnd ||= t.segmentEnd;
      continue;
    }
    const lead = pendingOpen === "" ? "" : pendingOpen + (/\p{P}$/u.test(pendingOpen) ? "" : joiner);
    out.push({ text: lead + t.text, start: t.start!, end: t.end!, segmentEnd: t.segmentEnd });
    pendingOpen = "";
  }
  if (pendingOpen !== "") {
    const last = out[out.length - 1];
    if (last) last.text += pendingOpen;
  }
  if (out.length === 0) {
    diagnostics.push(diag("spec.transcript.empty", o.path, "the transcript has no timed word to show"));
  }
  return out;
}

/** Times are finite seconds, a word does not end before it starts, and starts never go back. */
function checkTimes(words: readonly CaptionWord[], o: IngestOptions, diagnostics: Diagnostic[]): void {
  let prev = -Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end < w.start) {
      diagnostics.push(
        diag(
          "spec.transcript.time",
          o.path,
          `word ${i} ${quote(w.text)} runs ${w.start}s → ${w.end}s; times are seconds ≥ 0 and a word ` +
            "cannot end before it starts",
        ),
      );
      continue;
    }
    if (w.start < prev) {
      diagnostics.push(
        diag(
          "spec.transcript.order",
          o.path,
          `word ${i} ${quote(w.text)} starts at ${w.start}s, before the word ahead of it (${prev}s); ` +
            "a caption shows words in the order they are spoken, so starts may not go back",
        ),
      );
    }
    prev = Math.max(prev, w.start);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
