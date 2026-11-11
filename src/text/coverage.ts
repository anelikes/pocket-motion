/**
 * Which characters a job draws that its faces do not map, before anything is
 * staged or built.
 *
 * A build accepts a code point the face lacks and bakes the tofu cell, exit 0
 * (`docs/batch-qa-prototype.md`: 95 of 1,000 rows), and every gate then
 * passes a card whose fields are tofu that fits its boxes. The measurer's
 * refusal is the one that existed, and it costs a build. A face's cmap is a
 * table in the font file, so the question "does this face map this character"
 * is answered by reading that table: the sfnt table directory, then the
 * `cmap` table's format 4 (the Basic Multilingual Plane) and format 12 (all of
 * Unicode) Unicode subtables. Noto Sans SC Bold, 16 MB, reads in a few
 * milliseconds; the build it replaces takes seconds.
 *
 * WHAT IS CHECKED, EXACTLY. Every string a template draws from the job, each
 * against BOTH declared weights: this module does not know which weight a
 * template draws a field in, and a character one weight lacks is reported
 * with that weight named, so a refusal is never a pass a reader cannot audit.
 * A line break is not a glyph and is not checked. Case is applied first where
 * a template applies it (captions' `style.case`), because the characters
 * drawn are the ones checked.
 *
 * WHAT IT DOES NOT SAY. That the job fits. That the face's glyph for a
 * character it maps is the one a reader expects (Noto Sans SC draws U+2026 as
 * a centred ellipsis). Nothing about a face the generator itself declares
 * beyond the job's `fonts` — the templates here declare none.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { JobSpec } from "../manifest/spec.ts";
import { displayText } from "../captions/template.ts";

/** One string a template draws from a job. `field` is a JSON pointer into the job. */
export interface JobString {
  readonly field: string;
  readonly text: string;
}

/** One character a face does not map, in one field. */
export interface MissingGlyph {
  readonly field: string;
  readonly char: string;
  /** `U+20B9`. */
  readonly codePoint: string;
  readonly face: "regular" | "bold";
  /** The face file, as the job names it. */
  readonly file: string;
}

export interface CoverageReport {
  /** Strings checked, and distinct characters among them. */
  readonly strings: number;
  readonly characters: number;
  readonly missing: readonly MissingGlyph[];
}

const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

/**
 * Every code point a face maps, from its `cmap` table: the union of its
 * Unicode subtables in formats 4 and 12 (platform 0, or platform 3 with
 * encoding 1 or 10). A code point mapped to glyph 0 is not mapped. Throws on a
 * file with no such subtable, which no face this repository bakes is.
 */
export function readCmap(bytes: Uint8Array): Set<number> {
  const tables = u16(bytes, 4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!) === "cmap") {
      cmap = u32(bytes, rec + 8);
    }
  }
  if (cmap < 0) throw new Error("readCmap: the file has no cmap table");
  const out = new Set<number>();
  let read = 0;
  const subtables = u16(bytes, cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = u16(bytes, rec);
    const encoding = u16(bytes, rec + 2);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const at = cmap + u32(bytes, rec + 4);
    const format = u16(bytes, at);
    if (format === 4) {
      const segs = u16(bytes, at + 6) / 2;
      const ends = at + 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const offsets = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = u16(bytes, ends + s * 2);
        const start = u16(bytes, starts + s * 2);
        const delta = u16(bytes, deltas + s * 2);
        const offset = u16(bytes, offsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (offset === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = u16(bytes, offsets + s * 2 + offset + (c - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) out.add(c);
        }
      }
      read++;
    } else if (format === 12) {
      const groups = u32(bytes, at + 12);
      for (let g = 0; g < groups; g++) {
        const rec12 = at + 16 + g * 12;
        const start = u32(bytes, rec12);
        const end = u32(bytes, rec12 + 4);
        const glyph = u32(bytes, rec12 + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
      }
      read++;
    }
  }
  if (read === 0) throw new Error("readCmap: no Unicode cmap subtable in format 4 or 12");
  return out;
}

const cached = new Map<string, { key: string; set: Set<number> }>();

/** `readCmap` of a file, kept for the process while its size and mtime hold. */
export function faceCoverage(path: string): ReadonlySet<number> {
  const st = statSync(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cached.get(path);
  if (hit && hit.key === key) return hit.set;
  const set = readCmap(new Uint8Array(readFileSync(path)));
  cached.set(path, { key, set });
  return set;
}

/** Every string a template draws from the job, as it draws it. */
export function jobStrings(spec: JobSpec): JobString[] {
  switch (spec.template) {
    case "copy":
      return [
        { field: "/copy/eyebrow", text: spec.copy.eyebrow },
        { field: "/copy/headline", text: spec.copy.headline },
        { field: "/copy/body", text: spec.copy.body },
      ];
    case "lower-third":
      return [
        { field: "/copy/name", text: spec.copy.name },
        { field: "/copy/title", text: spec.copy.title },
      ];
    case "captions":
      return spec.transcript.words.map((w, i) => ({
        field: `/transcript/words/${i}`,
        text: displayText(w.text, spec.style.case, spec.transcript.language),
      }));
  }
}

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Check `strings` against each of `faces` (repo-relative or absolute paths,
 * resolved against `root`). One entry per (field, character, face), in field
 * order, then character order of first appearance.
 */
export function checkCoverage(
  strings: readonly JobString[],
  faces: { readonly regular: string; readonly bold: string },
  root: string,
): CoverageReport {
  const maps = (["regular", "bold"] as const).map((face) => ({
    face,
    file: faces[face],
    set: faceCoverage(resolve(root, faces[face])),
  }));
  const missing: MissingGlyph[] = [];
  const all = new Set<string>();
  for (const { field, text } of strings) {
    const seen = new Set<string>();
    for (const char of text) {
      if (char === "\n" || seen.has(char)) continue;
      seen.add(char);
      all.add(char);
      const cp = char.codePointAt(0)!;
      for (const m of maps) {
        if (!m.set.has(cp)) missing.push({ field, char, codePoint: hex(cp), face: m.face, file: m.file });
      }
    }
  }
  return { strings: strings.length, characters: all.size, missing };
}

/** `checkCoverage` over a parsed job's own strings and faces. */
export function jobCoverage(spec: JobSpec, root: string): CoverageReport {
  return checkCoverage(jobStrings(spec), spec.fonts, root);
}

/** One line per missing character, for a refusal a person reads. */
export function describeMissing(missing: readonly MissingGlyph[]): string[] {
  return missing.map((m) => `${m.field}: ${JSON.stringify(m.char)} ${m.codePoint} is not in ${m.face} (${m.file})`);
}
