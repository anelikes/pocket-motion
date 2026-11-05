/**
 * Codepoints that were drawn as tofu, and the text nodes that carry them.
 *
 * A font lookup that finds no glyph in the slot's face or in any face of the
 * declared fallback chain (`fonts.fallback`) lays out and draws the tofu box,
 * and before `patches/0063` nothing on the host could tell: the realm stays
 * clean, the digest reproduces, and a title with an emoji in it ships a
 * rectangle. The core now keeps the distinct codepoints that missed
 * (`ui_glyph_missed`), and `BootedWorld.missingGlyphs` reads them.
 *
 * Which NODE drew one is a host-side join: the DevTools tree carries each
 * text node's string, and a node is named when its string contains a missed
 * codepoint. The join is exact for the codepoint and an over-approximation
 * for the node: a codepoint one face maps and another does not misses only
 * under the slot that lacks it, and every node whose text contains it is
 * named.
 */

import { existsSync } from "node:fs";

import type { ResolvedComposition } from "../cli/resolve.ts";
import { hardenedBootWorld } from "../runtime/boot.ts";

/**
 * The codepoints a composition's mounted text misses, read off a throwaway
 * world after its first frame — mount and one layout, which measures every
 * text node in the tree, shown yet or not. What `render --spec` refuses a job
 * on before anything is encoded, whichever way it renders.
 */
export async function mountedMissingGlyphs(c: ResolvedComposition): Promise<readonly number[]> {
  const world = await hardenedBootWorld({
    bundlePath: c.bundlePath,
    pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
    width: c.width,
    height: c.height,
    hz: c.fps,
    renderScale: c.supersample,
    // Layout only; this world renders nothing.
    shutter: null,
    buildCommand: c.buildCommand,
  });
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  return world.missingGlyphs();
}

/** `U+1F525` — the form every report here prints. */
export function codepointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** One text node that carries at least one missed codepoint. */
export interface MissingGlyphNode {
  /** The node's `debugName`, or null when it has none. */
  readonly name: string | null;
  /** Its text, as the tree carries it. */
  readonly text: string;
  /** The missed codepoints it contains, ascending, as `U+XXXX`. */
  readonly codepoints: readonly string[];
}

interface TreeNode {
  readonly n?: string;
  readonly x?: string;
  readonly k?: readonly TreeNode[];
}

/** Every text node of a DevTools tree whose string carries a missed codepoint. */
export function nodesCarrying(tree: unknown, missing: readonly number[]): MissingGlyphNode[] {
  const wanted = new Set(missing);
  const out: MissingGlyphNode[] = [];
  const walk = (node: TreeNode | null | undefined, name: string | null): void => {
    if (!node || typeof node !== "object") return;
    const own = typeof node.n === "string" ? node.n : name;
    if (typeof node.x === "string") {
      const hit = new Set<number>();
      for (const ch of node.x) {
        const cp = ch.codePointAt(0)!;
        if (wanted.has(cp)) hit.add(cp);
      }
      if (hit.size > 0) {
        out.push({ name: own, text: node.x, codepoints: [...hit].sort((a, b) => a - b).map(codepointLabel) });
      }
    }
    for (const child of node.k ?? []) walk(child, own);
  };
  walk(tree as TreeNode, null);
  return out;
}

/** The lines a command prints for a non-empty set of missed codepoints. */
export function missingGlyphLines(missing: readonly number[], nodes: readonly MissingGlyphNode[]): string[] {
  const lines = [`  ${missing.map(codepointLabel).join(" ")}`];
  for (const n of nodes) {
    const where = n.name !== null ? `"${n.name}"` : "an unnamed text node";
    lines.push(`  ${where}: ${JSON.stringify(n.text)} (${n.codepoints.join(" ")})`);
  }
  return lines;
}
