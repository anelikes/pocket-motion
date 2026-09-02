/**
 * Residue: no tracked file names material this repository no longer carries.
 *
 * Compositions, asset packs and scripts have been deleted from this tree. What
 * deletion does not reach is the prose and the code comments that pointed at
 * them — and that residue is the one defect shape this repository has recorded
 * more than once and had no gate for: a sentence nothing re-reads, going stale
 * where no test looks.
 *
 * TOKENS below is the vocabulary. Every tracked, non-symlink text file is read,
 * and a match is a failure. There is no allowlist: a file that matches is a
 * file to rewrite, and an allowlist that outlives what it excuses is the same
 * defect one level up.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/**
 * Each entry is a word or phrase that only the deleted material used.
 *
 * The Latin ones are matched case-insensitively. `round`, `brief`, `phase` and
 * `subject` carry a leading `\b` because without it `background 128` contains
 * `round 1` — a false positive found by running this list over `src/render/`.
 */
const TOKENS: readonly RegExp[] = [
  /aicut/i,
  /甲方/,
  /委托/,
  /需求单/,
  /简报/,
  /网盘/,
  /半淞园/,
  /北山口/,
  /留白/,
  /桐医/,
  /bansongyuan/i,
  /beishankou/i,
  /liubai/i,
  /tongyi/i,
  /gaozhi/i,
  /harborview/i,
  /\bbrief [0-9]/i,
  /\bphase ?7/i,
  /\bround [0-9]/i,
  /\bsubject [A-J]\b/i,
  /taste cycle/i,
  /second-author/i,
];

/**
 * `vendor/` is rebuilt from upstream, so nothing here is written by this
 * repository. `PLAN.md` and `PLAN-OPENSOURCE.md` are the working plans: they
 * are private and are removed before the tree is exported, so they are the two
 * files that may still name what was deleted. This file is skipped because it
 * IS the vocabulary — TOKENS above contains every word being searched for, so
 * a run that included it would report the search as its own first finding.
 * Found by committing the file and watching it fail against itself.
 */
const SKIPPED_PREFIXES = ["vendor/", "node_modules/"];
const SKIPPED_PATHS = new Set([
  "PLAN.md",
  "PLAN-OPENSOURCE.md",
  "tests/residue.test.ts",
]);

/** Bytes this search cannot read as text. Fonts, clips and tones. */
const BINARY = /\.(mp4|webm|mov|wav|mp3|png|jpe?g|otf|ttf|woff2?|pak|rgba)$/i;

/**
 * Tracked, non-symlink, textual paths.
 *
 * `git ls-files -s` rather than `git ls-files`, because the mode is what
 * separates a symlink from a file. The one symlink here is `CLAUDE.md ->
 * AGENTS.md`; following it would read the same bytes twice and report a second
 * path for one file's residue.
 */
function trackedTextFiles(): readonly string[] {
  const out = Bun.spawnSync(["git", "ls-files", "-s"], { cwd: ROOT }).stdout.toString();
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { mode: line.slice(0, 6), path: line.slice(tab + 1) };
    })
    .filter((e) => e.mode !== "120000")
    .map((e) => e.path)
    .filter((p) => !SKIPPED_PREFIXES.some((s) => p.startsWith(s)))
    .filter((p) => !SKIPPED_PATHS.has(p))
    .filter((p) => !BINARY.test(p))
    .sort();
}

/** Every token that appears in `path`, with the first line each is on. */
function hits(path: string): readonly string[] {
  let text: string;
  try {
    text = readFileSync(join(ROOT, path), "utf8");
  } catch {
    return [];
  }
  const found: string[] = [];
  const lines = text.split("\n");
  for (const token of TOKENS) {
    for (let i = 0; i < lines.length; i++) {
      if (token.test(lines[i]!)) {
        found.push(`${token.source} at line ${i + 1}`);
        break;
      }
    }
  }
  return found;
}

const FILES = trackedTextFiles();

describe("residue", () => {
  test("the tree is not empty and the search reaches it", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES).toContain("AGENTS.md");
    expect(FILES).toContain("scripts/digests.ts");
  });

  test("no tracked file names deleted material", () => {
    const offenders: string[] = [];
    for (const path of FILES) {
      const found = hits(path);
      if (found.length > 0) offenders.push(`${path}\n    ${found.join("\n    ")}`);
    }
    expect(offenders.join("\n  ")).toBe("");
  });
});
