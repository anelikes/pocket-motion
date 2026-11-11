import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "../../lib/task.ts";

/** WhisperX's aligned output: segments, each with its words and scores. */
const SEGMENTS = [
  {
    text: " Nobody tells you how loud the city gets at four in the morning.",
    words: [
      ["Nobody", 0.24, 0.62],
      ["tells", 0.62, 0.88],
      ["you", 0.88, 1.02],
      ["how", 1.02, 1.22],
      ["loud", 1.22, 1.58],
      ["the", 1.58, 1.7],
      ["city", 1.7, 2.06],
      ["gets", 2.06, 2.34],
      ["at", 2.34, 2.46],
      ["four", 2.46, 2.78],
      ["in", 2.78, 2.9],
      ["the", 2.9, 3.0],
      ["morning.", 3.0, 3.62],
    ],
  },
  {
    text: " Trucks, sirens, and somehow, birds.",
    words: [
      ["Trucks,", 4.1, 4.62],
      ["sirens,", 4.74, 5.3],
      ["and", 5.42, 5.6],
      ["somehow,", 5.6, 6.18],
      ["birds.", 6.34, 7.1],
    ],
  },
] as const;

export const WORDS = SEGMENTS.flatMap((s) => s.words.map(([word, start, end]) => ({ word, start, end })));

const whisperx = {
  segments: SEGMENTS.map((s) => ({
    start: s.words[0]![1],
    end: s.words[s.words.length - 1]![2],
    text: s.text,
    words: s.words.map(([word, start, end], i) => ({ word, start, end, score: 0.8 + ((i * 37) % 19) / 100 })),
  })),
  language: "en",
};

const FPS = 30;

export default {
  id: "karaoke-captions",
  ext: "mov",
  deliverExtra:
    " If you make it as a `render --spec` job rather than a composition you\n" +
    "  write, deliver instead exactly two files in that directory: the job's\n" +
    "  spec at `compositions/karaoke-captions/job.json`, and\n" +
    "  `compositions/karaoke-captions/README.md` holding the exact `render`\n" +
    "  command that renders it.",
  canvas: { w: 1080, h: 1920, fps: FPS, frames: { atLeast: Math.ceil((7.1 + 0.5) * FPS) } },
  async inputs(dir) {
    writeFileSync(join(dir, "words.json"), `${JSON.stringify(whisperx, null, 2)}\n`);
  },
  // Each word over the inside of its own window: a frame of slack at each
  // end, for where a word's first and last frame round to.
  assertions: () =>
    WORDS.map((w, i) => {
      const from = Math.ceil(w.start * FPS);
      const to = Math.max(from, Math.floor(w.end * FPS) - 1);
      return { node: `w${i}`, inPicture: [from, to] as [number, number] };
    }),
  async observe() {
    return [];
  },
  unchecked: ["that the spoken word is highlighted — no reading tells a highlight from any other style"],
} satisfies Task;
