/**
 * Transcripts in, timed words out (`src/captions/ingest.ts`).
 *
 * The shapes are the three a caption job can declare — this repository's own
 * `words`, WhisperX's aligned `segments[].words[]`, and OpenAI's word-level
 * `verbose_json` — and the cases are the ones those producers actually emit:
 * WhisperX's CJK punctuation as tokens of its own and its untimed numerals,
 * OpenAI's words with the punctuation stripped off and kept only in `text`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ingestInlineWords,
  ingestTranscript,
  isSpaceless,
  type IngestOptions,
  type IngestResult,
} from "../src/captions/ingest.ts";

const ROOT = resolve(import.meta.dir, "..");

const en = (format: IngestOptions["format"], extra: Partial<IngestOptions> = {}): IngestOptions => ({
  format,
  language: "en",
  untimed: "refuse",
  path: "/transcript/src",
  ...extra,
});

function words(r: IngestResult): string[] {
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return r.words.map((w) => w.text);
}

function codes(r: IngestResult): string[] {
  if (r.ok) throw new Error(`accepted: ${r.words.map((w) => w.text).join(" ")}`);
  return r.diagnostics.map((d) => d.code);
}

describe("format: words", () => {
  test("is read as written, in seconds", () => {
    const r = ingestTranscript({ words: [{ text: "Hi", start: 0, end: 0.4 }, { text: "there.", start: 0.4, end: 1 }] }, en("words"));
    expect(words(r)).toEqual(["Hi", "there."]);
    if (r.ok) expect(r.words[1]).toEqual({ text: "there.", start: 0.4, end: 1, segmentEnd: false });
  });

  test("an unknown key on the root or on a word is refused, naming the allowed keys", () => {
    const root = ingestTranscript({ words: [], lang: "en" }, en("words"));
    expect(codes(root)).toContain("spec.transcript.unknownKey");
    const word = ingestTranscript({ words: [{ text: "a", start: 0, end: 1, score: 1 }] }, en("words"));
    expect(codes(word)).toContain("spec.transcript.unknownKey");
    if (!word.ok) expect(word.diagnostics[0]!.message).toContain("allowed keys are text, start, end");
  });

  test("a word without both times is a shape error, not an untimed word", () => {
    expect(codes(ingestTranscript({ words: [{ text: "a", start: 0 }] }, en("words")))).toEqual(["spec.transcript.shape"]);
  });

  test("inline words report against the spec's own pointer", () => {
    const r = ingestInlineWords([{ text: "a", start: 0 }], { language: "en", untimed: "refuse", path: "/transcript" });
    if (r.ok) throw new Error("accepted");
    expect(r.diagnostics[0]!.path).toBe("/transcript/words/0");
  });
});

describe("format: whisperx", () => {
  const seg = (ws: unknown[]) => ({ start: 0, end: 9, text: "", words: ws });

  test("segments flatten in order, and the last word of each closes a segment", () => {
    const r = ingestTranscript(
      {
        segments: [
          seg([{ word: "One", start: 0, end: 0.3 }, { word: "two.", start: 0.3, end: 0.6 }]),
          seg([{ word: "Three", start: 1, end: 1.4 }]),
        ],
        language: "en",
      },
      en("whisperx"),
    );
    expect(words(r)).toEqual(["One", "two.", "Three"]);
    if (r.ok) expect(r.words.map((w) => w.segmentEnd)).toEqual([false, true, true]);
  });

  test("CJK punctuation tokens attach: closing marks to the word before, opening to the word after", () => {
    const r = ingestTranscript(
      {
        segments: [
          seg([
            { word: "他", start: 0, end: 0.2 },
            { word: "说" , start: 0.2, end: 0.4 },
            { word: "：" },
            { word: "「" },
            { word: "好", start: 0.6, end: 0.8 },
            { word: "」", start: 0.8, end: 0.9 },
            { word: "。" },
          ]),
        ],
      },
      { format: "whisperx", language: "zh", untimed: "refuse", path: "/transcript/src" },
    );
    expect(words(r)).toEqual(["他", "说：", "「好」。"]);
    // A timed closing mark extends the word it joins; an untimed one cannot.
    if (r.ok) expect(r.words[2]!.end).toBe(0.9);
  });

  test("an untimed spoken word is refused by default, naming it and where it is", () => {
    const r = ingestTranscript(
      { segments: [seg([{ word: "in", start: 0, end: 0.2 }, { word: "1990" }, { word: "too", start: 0.5, end: 0.7 }])] },
      en("whisperx"),
    );
    expect(codes(r)).toEqual(["spec.transcript.untimed"]);
    if (!r.ok) {
      expect(r.diagnostics[0]!.message).toContain('"1990" (segments/0/words/1)');
      expect(r.diagnostics[0]!.message).toContain('untimed: "attach"');
    }
  });

  test('untimed: "attach" joins it to the word before — with a space, or without in a spaceless language', () => {
    const latin = ingestTranscript(
      { segments: [seg([{ word: "in", start: 0, end: 0.2 }, { word: "1990" }, { word: "too", start: 0.5, end: 0.7 }])] },
      en("whisperx", { untimed: "attach" }),
    );
    expect(words(latin)).toEqual(["in 1990", "too"]);
    const zh = ingestTranscript(
      { segments: [seg([{ word: "在", start: 0, end: 0.2 }, { word: "1990" }, { word: "年", start: 0.5, end: 0.7 }])] },
      { format: "whisperx", language: "zh", untimed: "attach", path: "/transcript/src" },
    );
    expect(words(zh)).toEqual(["在1990", "年"]);
    // An untimed word before the first timed one opens it instead.
    const lead = ingestTranscript(
      { segments: [seg([{ word: "Well" }, { word: "yes", start: 0.5, end: 0.7 }])] },
      en("whisperx", { untimed: "attach" }),
    );
    expect(words(lead)).toEqual(["Well yes"]);
  });

  test("an unaligned file — segments without words — is a shape error that says how to align it", () => {
    const r = ingestTranscript({ segments: [{ start: 0, end: 1, text: "hi" }] }, en("whisperx"));
    expect(codes(r)).toEqual(["spec.transcript.shape"]);
    if (!r.ok) expect(r.diagnostics[0]!.message).toContain("alignment");
  });

  test("a file whose language disagrees with the spec is refused", () => {
    const r = ingestTranscript({ segments: [], language: "ja" }, en("whisperx"));
    expect(codes(r)).toContain("spec.transcript.language");
  });

  test("the alpha-en sample's transcript reads as its sample says", () => {
    const raw = JSON.parse(readFileSync(join(ROOT, "compositions/captions/alpha-en/transcript.whisperx.json"), "utf8"));
    expect(codes(ingestTranscript(raw, en("whisperx")))).toEqual(["spec.transcript.untimed"]);
    expect(words(ingestTranscript(raw, en("whisperx", { untimed: "attach" })))).toEqual([
      "Every", "word", "is", "timed.", "Same", "words,", "same", "bytes.",
      "Rendered", "in 2026", "without", "a", "browser.",
    ]);
  });
});

describe("format: openai", () => {
  const oa = (text: string, ws: Array<[string, number, number]>, language = "english") => ({
    task: "transcribe",
    language,
    text,
    words: ws.map(([word, start, end]) => ({ word, start, end })),
  });

  test("punctuation comes back from `text`: closing marks to the word before, opening to the word after", () => {
    const r = ingestTranscript(
      oa(' "Well," she said — finally. (Yes.)', [["Well", 0, 0.3], ["she", 0.3, 0.5], ["said", 0.5, 0.8], ["finally", 0.9, 1.4], ["Yes", 1.5, 1.8]]),
      en("openai"),
    );
    expect(words(r)).toEqual(['"Well,"', "she", "said —", "finally.", "(Yes.)"]);
  });

  test("CJK: marks with no space around them close the word before", () => {
    const raw = JSON.parse(readFileSync(join(ROOT, "compositions/captions/burn-zh/transcript.openai.json"), "utf8"));
    const r = ingestTranscript(raw, { format: "openai", language: "zh", untimed: "refuse", path: "/transcript/src" });
    expect(words(r)).toEqual(["每一帧", "都是", "哈希，", "没有", "浏览器。", "同样的", "输入，", "同样的", "字节。"]);
  });

  test("a word not found in `text`, in order, is refused rather than guessed", () => {
    const r = ingestTranscript(oa("Hello world.", [["world", 0, 0.3], ["Hello", 0.3, 0.6]]), en("openai"));
    expect(codes(r)).toEqual(["spec.transcript.unaligned"]);
  });

  test("letters in `text` that `words[]` does not carry are refused", () => {
    const r = ingestTranscript(oa("Hello uh world.", [["Hello", 0, 0.3], ["world", 0.5, 0.8]]), en("openai"));
    expect(codes(r)).toEqual(["spec.transcript.unaligned"]);
    if (!r.ok) expect(r.diagnostics[0]!.message).toContain('"uh"');
  });

  test("a language name the table knows is checked against the spec; one it does not know is not", () => {
    expect(codes(ingestTranscript(oa("Hi.", [["Hi", 0, 0.3]], "chinese"), en("openai")))).toEqual(["spec.transcript.language"]);
    expect(words(ingestTranscript(oa("Hi.", [["Hi", 0, 0.3]], "klingon"), en("openai")))).toEqual(["Hi."]);
  });

  test("a verbose_json without word timestamps is a shape error that names the request flag", () => {
    const r = ingestTranscript({ text: "Hi.", segments: [] }, en("openai"));
    expect(codes(r)).toEqual(["spec.transcript.shape"]);
    if (!r.ok) expect(r.diagnostics[0]!.message).toContain("timestamp_granularities");
  });
});

describe("times", () => {
  const list = (...ws: Array<[string, number, number]>) => ({ words: ws.map(([text, start, end]) => ({ text, start, end })) });

  test("a word that ends before it starts, or starts below zero, is refused", () => {
    expect(codes(ingestTranscript(list(["a", 1, 0.5]), en("words")))).toEqual(["spec.transcript.time"]);
    expect(codes(ingestTranscript(list(["a", -0.1, 0.5]), en("words")))).toEqual(["spec.transcript.time"]);
  });

  test("starts may not go back; overlapping ends are allowed", () => {
    expect(codes(ingestTranscript(list(["a", 0.5, 0.8], ["b", 0.4, 0.9]), en("words")))).toEqual(["spec.transcript.order"]);
    expect(words(ingestTranscript(list(["a", 0.5, 0.9], ["b", 0.6, 0.8]), en("words")))).toEqual(["a", "b"]);
  });

  test("a transcript of nothing but whitespace and punctuation has no word to show", () => {
    expect(codes(ingestTranscript(list([" ", 0, 0.2], ["。", 0.2, 0.3]), en("words")))).toEqual(["spec.transcript.empty"]);
  });
});

test("spaceless languages are the ones written without spaces between words", () => {
  expect(["zh", "zh-Hans", "ja-JP", "yue", "th"].map(isSpaceless)).toEqual([true, true, true, true, true]);
  expect(["en", "en-US", "ko", "fr", "de"].map(isSpaceless)).toEqual([false, false, false, false, false]);
});
