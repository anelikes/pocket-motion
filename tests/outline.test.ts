/**
 * `src/text/outline.ts`: a word set as outlines into a box, cut into letters.
 *
 * compositions/mg-bauhaus stamps BAUHAUS a letter per sixteenth from these
 * plates, so two things have to hold: the letters placed at their offsets
 * are the word again, and every cut falls in a gap between glyphs, never
 * through one.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { loadFace, setWord } from "../src/text/outline.ts";

const ROOT = resolve(import.meta.dir, "..");
const face = await loadFace(join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"));

describe("setWord", () => {
  for (const orient of ["up", "across"] as const) {
    test(`${orient}: the letters reassemble into the word, contiguous and in reading order`, () => {
      const set = setWord(face, "BAUHAUS", 120, 960, [17, 17, 17], orient, 2);
      expect([set.w, set.h]).toEqual(orient === "up" ? [120, 960] : [960, 120]);
      expect(set.letters).toHaveLength(7);
      const sorted = [...set.letters].sort((a, b) => a.at - b.at);
      expect(sorted[0]!.at).toBe(0);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.at).toBe(sorted[i - 1]!.at + sorted[i - 1]!.size);
      expect(sorted[sorted.length - 1]!.at + sorted[sorted.length - 1]!.size).toBe(960);
      // reading order: across, the first letter is leftmost; up, it is at the foot
      const first = set.letters[0]!;
      expect(orient === "up" ? first.at + first.size : first.at).toBe(orient === "up" ? 960 : 0);
      // pixel for pixel
      const W = set.word.width;
      for (const l of set.letters) {
        const lo = l.at * 2;
        for (let j = 0; j < l.plate.height; j++) {
          for (let i = 0; i < l.plate.width; i++) {
            const a = l.plate.rgba[(j * l.plate.width + i) * 4 + 3]!;
            const b = orient === "up" ? set.word.rgba[((lo + j) * W + i) * 4 + 3]! : set.word.rgba[(j * W + lo + i) * 4 + 3]!;
            if (a !== b) throw new Error(`letter at ${l.at}: pixel ${i},${j} is ${a}, the word has ${b}`);
          }
        }
      }
    });
  }

  test("every cut falls in a gap between glyphs", () => {
    const set = setWord(face, "BAUHAUS", 120, 960, [17, 17, 17], "across", 2);
    const W = set.word.width;
    const H = set.word.height;
    for (const l of set.letters.slice(1)) {
      const x = l.at * 2;
      let ink = 0;
      for (let y = 0; y < H; y++) ink = Math.max(ink, set.word.rgba[(y * W + x) * 4 + 3]!, set.word.rgba[(y * W + x - 1) * 4 + 3]!);
      expect(ink).toBeLessThan(32);
    }
  });
});
