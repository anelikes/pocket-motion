/**
 * The `captions` job spec, as catalogue rows.
 *
 * A job spec is not a sidecar: `parseSpec` reads it, and a row here is probed
 * by handing `parseSpec` a job that breaks the row's key (`specProbes`,
 * executed by `tests/catalog.test.ts` G9) rather than by `parseSidecar`. Every
 * probe starts from `JOB`, a job that parses, so each one breaks exactly one
 * thing. The keys are written as an author types them in the spec, dotted
 * below the root (`style.minSize`).
 *
 * `footage` is the one block this template shares with `lower-third`, parsed
 * by the same function, and its `spec.footage.*` codes are that parser's: the
 * row here is probed and owns none of them.
 */

import type { CapabilityRow, Probe } from "./surface.ts";

const DECLARED = 'job spec (`template: "captions"`)';
const SPEC = "src/captions/spec.ts";
const INGEST = "src/captions/ingest.ts";

/** A captions job that parses. */
const JOB: Record<string, unknown> = {
  spec: 1,
  template: "captions",
  viewport: [1280, 720],
  fps: 30,
  fonts: {
    regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
    bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
  },
  transcript: { words: [{ text: "Hello", start: 0, end: 0.5 }], language: "en" },
  style: { name: "highlight" },
};

const job = (overrides: Record<string, unknown>): Record<string, unknown> => ({ ...JOB, ...overrides });
const without = (key: string): Record<string, unknown> => {
  const out = { ...JOB };
  delete out[key];
  return out;
};
const transcript = (t: Record<string, unknown>): Record<string, unknown> => job({ transcript: t });
const file = (src: unknown, format: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  transcript({ src, format, language: "en", ...extra });
const words = (...ws: Array<[string, number, number]>): Record<string, unknown> =>
  transcript({ words: ws.map(([text, start, end]) => ({ text, start, end })), language: "en" });
const style = (s: Record<string, unknown>): Record<string, unknown> => job({ style: s });
const layout = (l: unknown): Record<string, unknown> => job({ layout: l });
const probe = (code: string, input: unknown): Probe => ({ code, input });

function row(
  key: string,
  r: Pick<CapabilityRow, "required" | "defaultValue" | "constraint" | "diagnostics"> & {
    readonly source?: string;
    readonly specProbes: readonly Probe[];
  },
): CapabilityRow {
  return {
    id: `captions.${key}`,
    group: "captions",
    declaredIn: DECLARED,
    key,
    source: r.source ?? SPEC,
    verification: "probed",
    probes: [],
    pinned: [],
    required: r.required,
    defaultValue: r.defaultValue,
    constraint: r.constraint,
    diagnostics: r.diagnostics,
    specProbes: r.specProbes,
  };
}

/** A colour key: which styles paint with it, its default per style, and a bad value for it. */
function colour(key: string, styleName: string, paints: string, defaults: string): CapabilityRow {
  return row(`style.${key}`, {
    required: false,
    defaultValue: defaults,
    constraint: `\`#RRGGBB\` or \`#RRGGBBAA\`; ${paints}`,
    diagnostics: key === "ink" ? ["spec.style.hex"] : [],
    specProbes: [probe("spec.style.hex", style({ name: styleName, [key]: "#abc" }))],
  });
}

export const CAPTIONS_ROWS: readonly CapabilityRow[] = [
  row("transcript", {
    required: true,
    defaultValue: null,
    constraint:
      "object naming the words exactly one way: `src` with `format` (a file) or `words` (inline). Read while the spec is parsed, so a directory of jobs refuses a bad transcript before it renders any of them",
    diagnostics: [
      "spec.transcript.required",
      "spec.transcript.notObject",
      "spec.transcript.unknownKey",
      "spec.transcript.source",
    ],
    specProbes: [
      probe("spec.transcript.required", without("transcript")),
      probe("spec.transcript.notObject", job({ transcript: "words.json" })),
      probe("spec.transcript.unknownKey", transcript({ words: [], language: "en", lang: "en" })),
      probe("spec.transcript.source", transcript({ language: "en" })),
    ],
  }),
  row("transcript.src", {
    required: false,
    defaultValue: null,
    constraint: "repo-relative path to a JSON file; same path rules as footage src",
    diagnostics: [
      "spec.transcript.src.missing",
      "spec.transcript.src.empty",
      "spec.transcript.src.absolute",
      "spec.transcript.src.traversal",
      "spec.transcript.missingFile",
      "spec.transcript.json",
    ],
    specProbes: [
      probe("spec.transcript.src.missing", file(7, "words")),
      probe("spec.transcript.src.empty", file("", "words")),
      probe("spec.transcript.src.absolute", file("/tmp/words.json", "words")),
      probe("spec.transcript.src.traversal", file("../words.json", "words")),
      probe("spec.transcript.missingFile", file("compositions/captions/alpha-en/absent.json", "words")),
      probe("spec.transcript.json", file("README.md", "words")),
    ],
  }),
  row("transcript.format", {
    required: false,
    defaultValue: null,
    constraint:
      "required with `src`: words | whisperx | openai — declared, never guessed from the file's keys. words is `{ words: [{ text, start, end }] }` with unknown keys refused; whisperx reads `segments[].words[]` of `{ word, start?, end? }` and closes a page at each segment's end; openai reads a word-level `verbose_json`, whose `words[]` carry no punctuation, and puts it back from `text` — refused when a word is not found there in order or `text` holds letters `words[]` does not. Inline `words` take no other format",
    source: INGEST,
    diagnostics: ["spec.transcript.format", "spec.transcript.shape", "spec.transcript.unaligned"],
    specProbes: [
      probe("spec.transcript.format", file("compositions/captions/alpha-en/transcript.whisperx.json", "srt")),
      probe("spec.transcript.shape", file("compositions/captions/burn-zh/transcript.openai.json", "whisperx")),
      probe("spec.transcript.unaligned", file("tests/fixtures/captions/unaligned.openai.json", "openai")),
    ],
  }),
  row("transcript.language", {
    required: true,
    defaultValue: null,
    constraint:
      "a BCP-47 tag. zh, ja, yue, wuu, th, lo, km and my are written without spaces: their words join with no gap and a word wider than a line breaks between its characters, keeping 禁則 (`NO_START` / `NO_END` in src/text/fit.ts). A language the file declares (WhisperX's code, OpenAI's name) must agree",
    diagnostics: ["spec.transcript.language"],
    specProbes: [
      probe("spec.transcript.language", transcript({ words: [{ text: "a", start: 0, end: 1 }], language: "english" })),
      probe(
        "spec.transcript.language",
        file("compositions/captions/alpha-en/transcript.whisperx.json", "whisperx", { language: "zh", untimed: "attach" }),
      ),
    ],
  }),
  row("transcript.untimed", {
    required: false,
    defaultValue: "refuse",
    constraint:
      "refuse | attach. A spoken token with no times — WhisperX leaves a numeral it could not align that way — is refused, naming it, or shown with the word before it. A token that is only punctuation is attached whatever this says: closing marks to the word before, opening marks to the word after",
    source: INGEST,
    diagnostics: ["spec.transcript.untimedMode", "spec.transcript.untimed"],
    specProbes: [
      probe("spec.transcript.untimedMode", transcript({ words: [], language: "en", untimed: "skip" })),
      probe("spec.transcript.untimed", file("compositions/captions/alpha-en/transcript.whisperx.json", "whisperx")),
    ],
  }),
  row("transcript.words", {
    required: false,
    defaultValue: null,
    constraint:
      "array of `{ text, start, end }`, seconds — inline, or what any format reduces to. Times are finite and >= 0, a word does not end before it starts, starts never go back; ends may overlap the next word. A word's frames are [round(start·fps), max(that + 1, round(end·fps))), clipped to its page",
    source: INGEST,
    diagnostics: ["spec.transcript.time", "spec.transcript.order", "spec.transcript.empty"],
    specProbes: [
      probe("spec.transcript.time", words(["a", 1, 0.5])),
      probe("spec.transcript.order", words(["a", 0.5, 0.8], ["b", 0.2, 0.9])),
      probe("spec.transcript.empty", words([" ", 0, 1])),
    ],
  }),
  row("style", {
    required: true,
    defaultValue: null,
    constraint: "object; `name` decides which other keys it may carry, and a key the named style does not read is refused",
    diagnostics: ["spec.style.required", "spec.style.notObject", "spec.style.unknownKey"],
    specProbes: [
      probe("spec.style.required", without("style")),
      probe("spec.style.notObject", job({ style: "highlight" })),
      probe("spec.style.unknownKey", style({ name: "highlight", keywords: ["hello"] })),
    ],
  }),
  row("style.name", {
    required: true,
    defaultValue: null,
    constraint:
      "highlight | pill-karaoke | clip-wipe | matrix-decode | kinetic-slam — the five treatments of src/captions/styles.ts, each keeping every word in the picture at every frame of its window",
    diagnostics: ["spec.style.name"],
    specProbes: [probe("spec.style.name", style({ name: "karaoke" }))],
  }),
  row("style.size", {
    required: false,
    defaultValue:
      "at a 1080 px short side, scaled to the viewport: highlight 80, pill-karaoke 72, clip-wipe 88, matrix-decode 96, kinetic-slam 160",
    constraint:
      "integer 8…240, px. The face's own ceiling is lower — Noto Sans SC bakes up to 176 — and the measurement build names it",
    diagnostics: ["spec.style.size"],
    specProbes: [probe("spec.style.size", style({ name: "highlight", size: 300 }))],
  }),
  row("style.minSize", {
    required: false,
    defaultValue: "0.7 × size (kinetic-slam 0.5)",
    constraint:
      "integer 8…size; the last rung of a 10% ladder down from size. The track takes the largest rung at which every word fits a line on its own (kinetic-slam: each page its own), and a word of a spaced language wider than the line at this size is refused rather than broken",
    diagnostics: ["spec.style.minSize"],
    specProbes: [probe("spec.style.minSize", style({ name: "highlight", size: 40, minSize: 50 }))],
  }),
  row("style.case", {
    required: false,
    defaultValue: "upper (pill-karaoke lower, matrix-decode none)",
    constraint: "upper | lower | none, mapped with the transcript's language",
    diagnostics: ["spec.style.case"],
    specProbes: [probe("spec.style.case", style({ name: "highlight", case: "title" }))],
  }),
  colour("ink", "highlight", "the text, in highlight, clip-wipe, matrix-decode and kinetic-slam", "#ffffff (matrix-decode #00ff41)"),
  colour("box", "highlight", "highlight's box behind the word being spoken", "#ff1745"),
  colour("pill", "pill-karaoke", "pill-karaoke's pill behind every line", "#e7e5e7"),
  colour("inactive", "pill-karaoke", "pill-karaoke's words before they are spoken", "#a6a6a6"),
  colour("active", "pill-karaoke", "pill-karaoke's words from 50 ms before they are spoken", "#1c1e1d"),
  colour("accent", "clip-wipe", "a keyword, in clip-wipe and kinetic-slam", "#ffd700"),
  colour("spoken", "clip-wipe", "clip-wipe's words once spoken", "#ffffff66"),
  row("style.keywords", {
    required: false,
    defaultValue: "[]",
    constraint:
      "array of non-empty strings, clip-wipe and kinetic-slam only; a word matches ignoring case and the punctuation attached to it, and is painted in `accent`",
    diagnostics: ["spec.style.keywords"],
    specProbes: [probe("spec.style.keywords", style({ name: "clip-wipe", keywords: [""] }))],
  }),
  row("layout", {
    required: false,
    defaultValue: "{}",
    constraint:
      "optional object. A page closes before a word when the pause before it is at least pauseMs, the word before ends a sentence or a WhisperX segment, the page holds maxWords, or the word would need more than maxLines lines — except that a word starting on the page's first frame always joins it. Lines are rebalanced to the same count with the least squared slack",
    diagnostics: ["spec.layout.notObject", "spec.layout.unknownKey"],
    specProbes: [
      probe("spec.layout.notObject", layout([])),
      probe("spec.layout.unknownKey", layout({ lines: 2 })),
    ],
  }),
  row("layout.position", {
    required: false,
    defaultValue: "bottom (kinetic-slam center)",
    constraint: "bottom | center | top; bottom and top sit `margin` from that edge",
    diagnostics: ["spec.layout.position"],
    specProbes: [probe("spec.layout.position", layout({ position: "middle" }))],
  }),
  row("layout.maxLines", {
    required: false,
    defaultValue: "2 (kinetic-slam 1)",
    constraint: "integer 1…4",
    diagnostics: ["spec.layout.maxLines"],
    specProbes: [probe("spec.layout.maxLines", layout({ maxLines: 0 }))],
  }),
  row("layout.maxWords", {
    required: false,
    defaultValue: "no limit (pill-karaoke 4, kinetic-slam 1)",
    constraint: "integer 1…100",
    diagnostics: ["spec.layout.maxWords"],
    specProbes: [probe("spec.layout.maxWords", layout({ maxWords: 0 }))],
  }),
  row("layout.pauseMs", {
    required: false,
    defaultValue: "400",
    constraint: "integer 0…10000; a pause at least this long between two words closes the page",
    diagnostics: ["spec.layout.pauseMs"],
    specProbes: [probe("spec.layout.pauseMs", layout({ pauseMs: -1 }))],
  }),
  row("layout.holdMs", {
    required: false,
    defaultValue: "500 (pill-karaoke and kinetic-slam 300)",
    constraint:
      "integer 0…10000; how long a page stays after its last word ends, cut short when the next page starts",
    diagnostics: ["spec.layout.holdMs"],
    specProbes: [probe("spec.layout.holdMs", layout({ holdMs: 20000 }))],
  }),
  row("layout.lineWidth", {
    required: false,
    defaultValue: "80% of the width at 16:9, 78% at 9:16, 84% at 1:1",
    constraint: "integer px 1…width: the widest the caption block may be, its boxes and pill included",
    diagnostics: ["spec.layout.lineWidth"],
    specProbes: [probe("spec.layout.lineWidth", layout({ lineWidth: 0 }))],
  }),
  row("layout.margin", {
    required: false,
    defaultValue: "10% of the height from the bottom (9:16: 22%); from the top, 8% (9:16: 12%)",
    constraint:
      "integer px 0…height/2. The 9:16 defaults keep clear of the button column and description band short-form players draw; they are this template's numbers, not a platform's",
    diagnostics: ["spec.layout.margin"],
    specProbes: [probe("spec.layout.margin", layout({ margin: 100000 }))],
  }),
  row("footage", {
    required: false,
    defaultValue: null,
    constraint:
      "optional `{ src, fit }`, lower-third's block: one clip drawn under the captions at the full viewport from frame 0 to durationFrames — the burned-in delivery. Absent, the tree declares no ground and the frames are transparent wherever no caption paints (`render --format mov --alpha`)",
    source: "src/manifest/spec.ts",
    diagnostics: [],
    specProbes: [probe("spec.footage.missingFile", job({ footage: { src: "assets/synthetic/absent.mp4" } }))],
  }),
  row("viewport", {
    required: false,
    defaultValue: "[1920, 1080]",
    constraint: "16:9, 9:16 or 1:1 exactly, even sides (yuv420p needs them), short side 360…2160",
    diagnostics: ["spec.viewport.aspect"],
    specProbes: [probe("spec.viewport.aspect", job({ viewport: [854, 480] }))],
  }),
  row("durationFrames", {
    required: false,
    defaultValue: "the last word's end frame plus the last page's hold",
    constraint: "when declared, refused if any word ends after it",
    diagnostics: ["spec.transcript.pastEnd"],
    specProbes: [probe("spec.transcript.pastEnd", job({ durationFrames: 5 }))],
  }),
];
