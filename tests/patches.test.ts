/**
 * `patches/` is two classes and the draw-list op range is a number. Both are
 * stated in `patches/README.md`; this holds them to the tree so they are
 * checked rather than remembered.
 *
 * The classes: `upstream` is a change that belongs in pocket-stack/pocketjs
 * and is rebased onto its main when submitted; `motion` is a change this
 * rasteriser needs and no upstream target will ever draw, never submitted,
 * with the reason in the patch's own header. A patch with no row, a row with
 * no patch, and a `motion` patch whose header does not say why are each a
 * failure here.
 *
 * The range: `MOTION_DRAW_OP_BASE` in `src/vendor/draw-ops.ts`. Upstream
 * allocates op codes densely from 1 and took 10 for `surfaceQuad` after
 * `0008` had given 10 to POLY, so "the next free number" is not a place this
 * repository can put an op. Every `DRAW_OP` key in the vendored spec named in
 * `MOTION_DRAW_OPS` must sit at or above the base, every other one below it,
 * and no two may share a number — the last is what turns red when the pin
 * moves onto a collision.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { MOTION_DRAW_OP_BASE, MOTION_DRAW_OPS } from "../src/vendor/draw-ops.ts";
import { patchFiles } from "../src/vendor/status.ts";

const ROOT = resolve(import.meta.dir, "..");
const PATCHES = join(ROOT, "patches");
const README = join(PATCHES, "README.md");
const SPEC = join(ROOT, "vendor", "pocketjs", "contracts", "spec", "spec.ts");

type PatchClass = "upstream" | "motion";
interface Row {
  readonly number: string;
  readonly cls: PatchClass;
}

/** Rows of the README's patch table — `| NNNN | upstream | …` or `| NNNN | motion | …`. */
function readmeRows(md: string): Row[] {
  const rows: Row[] = [];
  for (const line of md.split("\n")) {
    const m = /^\| (\d{4}) \| (upstream|motion) \|/.exec(line);
    if (m) rows.push({ number: m[1]!, cls: m[2] as PatchClass });
  }
  return rows;
}

/** Everything before the first `diff --git` — what `git apply` skips and a reader reads. */
function patchHeader(patch: string): string {
  const i = patch.indexOf("\ndiff --git ");
  return i < 0 ? patch : patch.slice(0, i);
}

/** The reason a `motion` patch gives for never going upstream, or null. */
function motionReason(header: string): string | null {
  const m = /^pocket-motion-only: (\S.*)$/m.exec(header);
  return m ? m[1]!.trim() : null;
}

describe("patches/README.md classifies every patch", () => {
  test("one row per patch file, one patch file per row", async () => {
    const files = await patchFiles();
    const rows = readmeRows(readFileSync(README, "utf8"));
    const byNumber = new Map(files.map((f) => [f.slice(0, 4), f]));

    for (const f of files) {
      const matching = rows.filter((r) => r.number === f.slice(0, 4));
      expect(matching, `${f} has no row in patches/README.md`).toHaveLength(1);
    }
    for (const r of rows) {
      expect(byNumber.has(r.number), `README row ${r.number} names no patches/${r.number}-*.patch`).toBe(true);
    }
    expect(rows.length).toBe(files.length);
  });

  test("a motion patch says in its header why it is not upstream-bound", async () => {
    const files = await patchFiles();
    const rows = readmeRows(readFileSync(README, "utf8"));
    for (const r of rows.filter((r) => r.cls === "motion")) {
      const f = files.find((f) => f.startsWith(r.number))!;
      const header = patchHeader(readFileSync(join(PATCHES, f), "utf8"));
      expect(motionReason(header), `${f} is class motion and its header has no \`pocket-motion-only:\` line`).not.toBeNull();
    }
  });

  test("the parsers themselves, on literals (there is no motion patch yet to be red on)", () => {
    expect(readmeRows("| 0001 | upstream | x | y | z |\n| 0002 | motion | x | y | z |\n| # | class |")).toEqual([
      { number: "0001", cls: "upstream" },
      { number: "0002", cls: "motion" },
    ]);
    expect(readmeRows("| 0003 | neither | x |")).toEqual([]);

    const header = "A note.\npocket-motion-only: the software rasteriser reads the framebuffer back; PSP GE cannot.\n";
    expect(motionReason(header)).toBe("the software rasteriser reads the framebuffer back; PSP GE cannot.");
    expect(motionReason("A note with no reason line.\n")).toBeNull();
    expect(motionReason("pocket-motion-only:\n")).toBeNull();
    expect(patchHeader(`${header}diff --git a/x b/x\n+1`)).toBe(header.slice(0, -1));
    // The reason must be in the header, not somewhere in the diff.
    expect(motionReason(patchHeader("no reason\ndiff --git a/x b/x\n+pocket-motion-only: hidden in a hunk\n"))).toBeNull();
  });
});

describe("the reserved draw-list op range", () => {
  test("upstream's ops are below the base, this repository's at or above it, and no number is shared", async () => {
    const spec = (await import(SPEC)) as { DRAW_OP: Record<string, number> };
    const ops = Object.entries(spec.DRAW_OP);
    expect(ops.length).toBeGreaterThan(0);

    for (const name of MOTION_DRAW_OPS) {
      expect(name in spec.DRAW_OP, `MOTION_DRAW_OPS names ${name}, which the vendored spec does not carry`).toBe(true);
    }
    for (const [name, code] of ops) {
      if (MOTION_DRAW_OPS.includes(name)) {
        expect(code, `${name} is this repository's and must be >= ${MOTION_DRAW_OP_BASE}`).toBeGreaterThanOrEqual(MOTION_DRAW_OP_BASE);
      } else {
        expect(code, `${name} is upstream's and must be < ${MOTION_DRAW_OP_BASE}`).toBeLessThan(MOTION_DRAW_OP_BASE);
      }
    }
    const codes = ops.map(([, c]) => c);
    expect(new Set(codes).size, `two DRAW_OP keys share a number: ${JSON.stringify(spec.DRAW_OP)}`).toBe(codes.length);
  });
});
