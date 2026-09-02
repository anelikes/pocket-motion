/**
 * What is wrong with a frame's geometry, as codes rather than as adjectives.
 *
 * `layout` already answered two questions: where every node landed, and whether
 * hiding it changes a pixel. Both are readings a person interprets. This module
 * turns the interpretations that can be stated exactly into named codes, so a
 * caller can branch on one and a sidecar can excuse one.
 *
 * SEVEN CODES, AND WHAT EACH ONE ACTUALLY EXAMINED
 *
 *   text_not_painted     the node emitted no geometry at all — faded out, off
 *                        screen, zero-sized, or under a parent at opacity 0.
 *                        `visibility === "declared-invisible"`, renamed.
 *   text_occluded        it emitted geometry and no pixel of it survived.
 *                        `visibility === "covered"`, renamed.
 *   panel_out_of_canvas  the canvas clamped its border box to nothing: it is
 *                        wholly off screen. Layout clips every rect to the
 *                        viewport before anyone can read it, so a PARTIAL
 *                        overhang leaves no trace and this does not claim one —
 *                        `collapsedAtEdge` below has the measurement.
 *   escaped_container    its border box is not inside the box of its nearest
 *                        ancestor that has one.
 *   content_overlap      two NAMED nodes on screen, boxes overlapping with
 *                        positive area, neither an ancestor of the other and
 *                        neither containing the other.
 *   text_box_overflow    the node's INK reaches outside its own border box:
 *                        the glyph run is wider or taller than the box layout
 *                        gave it.
 *   clipped_text         its box crosses its container's edge, and its ink
 *                        stops AT that edge — the overflow was scissored away.
 *
 * The last two are measured in pixels, not from a build-time advance table.
 * `Prober.ink` hides the node and takes the bounding box of the pixels that
 * changed, which is the same `debug_hide` `inPicture` rides on and needs no
 * second render: the ink box is read out of the frame the probe was already
 * going to draw. An advance table would have to be joined to the node through
 * its font slot, and nothing in the DevTools tree carries one — the tree gives
 * a class string, and resolving that to a style record means recompiling the
 * literals in an order the build chose. The pixels are the shorter route and
 * the stronger claim: they are what the delivery contains.
 *
 * WHAT INK CANNOT SEE. A glyph drawn in the colour of what is under it changes
 * no pixel and contributes no ink, so `text_box_overflow` under-reports there —
 * the same blind spot `covered` has, and for the same reason (`visibility.ts`
 * has the measurement that found it).
 *
 * NONE OF THESE IS A FAILURE, and `layout` exits 0 carrying all of them.
 * `notInPicture` is normal at any cut boundary, an intended lower third does
 * overlap the shot under it, and a marquee starts off canvas on purpose. What
 * turns a finding into an exit code is `verify --strict`, and what turns one
 * off is a `layoutAllow` entry in the sidecar with a written reason.
 *
 * TWO CARVE-OUTS, both measured rather than assumed, both in `overlaps()` and
 * `boxContains()` below:
 *
 *   - containment is not a collision. A full-bleed background CONTAINS the
 *     caption over it, which is the ordinary stacking relation and not
 *     something anyone wants reported. Without this, every named background in
 *     the tree produced one finding per named thing drawn on it.
 *   - touching is not overlapping. A tile grid's neighbours share an edge, and
 *     `footage:<track>/tile:<col>:<row>` is the most common `debugName` in any
 *     tree with footage in it. Overlap is positive area.
 */

import type { LayoutAllowance, LayoutAllowScope } from "../manifest/sidecar.ts";

export const FINDING_CODES = [
  "text_not_painted",
  "text_occluded",
  "panel_out_of_canvas",
  "escaped_container",
  "content_overlap",
  "text_box_overflow",
  "clipped_text",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/**
 * Which allowance scope covers which code.
 *
 * Four scopes rather than seven, because an author excusing one of these is
 * excusing a KIND of geometry — "this may sit over that", "this may leave its
 * box" — and asking for the code name would make the sidecar a mirror of this
 * file's identifiers.
 */
export const ALLOW_SCOPE_OF: Readonly<Record<FindingCode, LayoutAllowScope>> = {
  text_not_painted: "occlusion",
  text_occluded: "occlusion",
  panel_out_of_canvas: "canvas",
  escaped_container: "overflow",
  content_overlap: "overlap",
  text_box_overflow: "overflow",
  clipped_text: "overflow",
};

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Finding {
  readonly code: FindingCode;
  /** The node this is reported against — the DevTools tree id. */
  readonly id: number;
  /** Its `debugName`, when it has one. Only a named node can be excused. */
  readonly name?: string;
  /** One line naming the numbers the code was decided from. */
  readonly detail: string;
  /** The other node, for `content_overlap`. */
  readonly with?: number;
  /**
   * The `reason` from the `layoutAllow` entry that covers this, when one does.
   * The finding stays in the list: a suppressed reading that vanishes is a
   * reading nobody can audit, and the reason is the thing worth reading.
   */
  readonly allowedBy?: string;
}

/** What `findingsFor` needs to know about one node. */
export interface FindingNode {
  readonly id: number;
  readonly name?: string;
  readonly text?: string;
  readonly box: Box;
  readonly inPicture: boolean;
  readonly visibility?: "on-screen" | "covered" | "declared-invisible" | "impossible";
  /** Bounding box of the pixels this node contributes, in logical units.
   *  Absent when the caller did not measure it (see `Prober.ink`). */
  readonly ink?: Box | null;
  /** Nearest ancestor that has a box, or null for the root. */
  readonly container?: FindingNode | null;
}

export interface FindingInputs {
  readonly nodes: readonly FindingNode[];
  readonly viewport: Box;
  readonly allow: readonly LayoutAllowance[];
  /**
   * How far a box may cross an edge before it counts, in logical px.
   *
   * Not a fudge factor for taste: the ink box is read off a rasterised frame,
   * so an antialiased glyph edge lands a pixel outside the box that produced
   * it, and a supersampled render divides by the density and lands on a
   * fraction. One px is what separates those from an overflow anyone would
   * call one.
   */
  readonly tolerance?: number;
}

const DEFAULT_TOLERANCE = 1;

const right = (b: Box): number => b.x + b.w;
const bottom = (b: Box): number => b.y + b.h;

/** `inner` is inside `outer`, allowing `t` px of slack on every edge. */
export function boxContains(outer: Box, inner: Box, t = 0): boolean {
  return (
    inner.x >= outer.x - t &&
    inner.y >= outer.y - t &&
    right(inner) <= right(outer) + t &&
    bottom(inner) <= bottom(outer) + t
  );
}

/**
 * A box the canvas clamped to nothing, and which edge did it.
 *
 * **The layout rect can never leave the canvas in this engine**, which is why
 * this is not the "is the box outside the viewport" test it reads like.
 * Measured against the core: a node declared at `left-[2000px] w-[300px]` on a
 * 1920-wide canvas comes back `1920,100 0x80`, one at `left-[-300px]` comes
 * back `0,220 0x80`, and one 200 px tall starting at y=1040 comes back
 * `100,1040 200x40`. The box is clipped to the viewport before anyone can read
 * it, and nothing records what was asked for — so a PARTIAL overhang is
 * indistinguishable from a panel that ends at the edge on purpose, and this
 * says nothing about it.
 *
 * What survives the clamp is the degenerate case, and it is exact: a node
 * placed wholly outside collapses to zero extent on that axis and sits ON the
 * edge it went off. Zero width at x = 0 or x = canvas width; zero height at
 * y = 0 or y = canvas height. The other axis must be positive, so a genuinely
 * empty node is not reported for being empty.
 *
 * The one false positive left is a zero-extent node deliberately placed on an
 * edge — a zero-width spacer at x = 0. It has never been seen in this tree, and
 * `layoutAllow` with `canvas` is what an author would write if it were.
 */
function collapsedAtEdge(
  box: Box,
  viewport: Box,
): { axis: "width" | "height"; edge: "left" | "right" | "top" | "bottom" } | null {
  if (box.w === 0 && box.h > 0) {
    if (box.x === viewport.x) return { axis: "width", edge: "left" };
    if (box.x === right(viewport)) return { axis: "width", edge: "right" };
  }
  if (box.h === 0 && box.w > 0) {
    if (box.y === viewport.y) return { axis: "height", edge: "top" };
    if (box.y === bottom(viewport)) return { axis: "height", edge: "bottom" };
  }
  return null;
}

const sameBox = (a: Box, b: Box): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Positive-area intersection. Sharing an edge is not overlapping. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    Math.min(right(a), right(b)) - Math.max(a.x, b.x) > 0 &&
    Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > 0
  );
}

/** How far `inner` sticks out of `outer` on each side, 0 where it does not. */
function escape(outer: Box, inner: Box): { left: number; top: number; rightBy: number; bottomBy: number } {
  return {
    left: Math.max(0, outer.x - inner.x),
    top: Math.max(0, outer.y - inner.y),
    rightBy: Math.max(0, right(inner) - right(outer)),
    bottomBy: Math.max(0, bottom(inner) - bottom(outer)),
  };
}

const anyEscape = (e: ReturnType<typeof escape>, t: number): boolean =>
  e.left > t || e.top > t || e.rightBy > t || e.bottomBy > t;

const describeEscape = (e: ReturnType<typeof escape>): string =>
  [
    e.left > 0 ? `${e.left.toFixed(0)}px past the left` : "",
    e.top > 0 ? `${e.top.toFixed(0)}px past the top` : "",
    e.rightBy > 0 ? `${e.rightBy.toFixed(0)}px past the right` : "",
    e.bottomBy > 0 ? `${e.bottomBy.toFixed(0)}px past the bottom` : "",
  ]
    .filter(Boolean)
    .join(", ");

const boxText = (b: Box): string => `${b.x},${b.y} ${b.w}x${b.h}`;

/**
 * Every finding over one frame, in code order then node order.
 *
 * Deterministic on purpose: this is emitted into `--json`, compared between
 * runs, and read back by `assert`. Sorting by (code, id) means a reordered
 * tree walk cannot move the output.
 */
export function findingsFor(inputs: FindingInputs): Finding[] {
  const t = inputs.tolerance ?? DEFAULT_TOLERANCE;
  const out: Finding[] = [];
  const nodes = inputs.nodes;

  // Reportable at all: the node was named, or it carries text. Same rule
  // `isNotInPicture` uses, so the counts here and the header line agree.
  const reportable = (n: FindingNode): boolean => Boolean(n.name || n.text);

  for (const n of nodes) {
    if (!reportable(n)) continue;

    if (!n.inPicture && n.visibility === "declared-invisible") {
      out.push({
        code: "text_not_painted",
        id: n.id,
        ...(n.name ? { name: n.name } : {}),
        detail: `box ${boxText(n.box)} and no geometry emitted at this frame`,
      });
    }
    if (!n.inPicture && n.visibility === "covered") {
      out.push({
        code: "text_occluded",
        id: n.id,
        ...(n.name ? { name: n.name } : {}),
        detail: `box ${boxText(n.box)} painted and no pixel of it survived`,
      });
    }

    const offCanvas = collapsedAtEdge(n.box, inputs.viewport);
    if (offCanvas !== null) {
      out.push({
        code: "panel_out_of_canvas",
        id: n.id,
        ...(n.name ? { name: n.name } : {}),
        detail:
          `box ${boxText(n.box)} collapsed to zero ${offCanvas.axis} against the ` +
          `${offCanvas.edge} edge of the ${inputs.viewport.w}×${inputs.viewport.h} canvas`,
      });
    }

    const container = n.container;
    if (container) {
      const past = escape(container.box, n.box);
      // A root filling the canvas is not a container worth naming: leaving it
      // is leaving the viewport, and `panel_out_of_canvas` has already said so
      // in the words a reader wants. Reporting both put two lines on every
      // off-canvas node with the same two numbers in them.
      const isCanvas = sameBox(container.box, inputs.viewport);
      if (anyEscape(past, t) && !isCanvas) {
        out.push({
          code: "escaped_container",
          id: n.id,
          ...(n.name ? { name: n.name } : {}),
          detail:
            `box ${boxText(n.box)} leaves its container ` +
            `${container.name ?? `#${container.id}`} ${boxText(container.box)} — ${describeEscape(past)}`,
        });
      }
      // Ink that stops at the container's edge, on an edge the box crosses,
      // is the scissor doing its job — the run is longer than what is shown.
      if (n.ink && anyEscape(past, t) && boxContains(container.box, n.ink, t)) {
        out.push({
          code: "clipped_text",
          id: n.id,
          ...(n.name ? { name: n.name } : {}),
          detail:
            `box ${boxText(n.box)} crosses ${container.name ?? `#${container.id}`} ` +
            `${boxText(container.box)} and its ink stops at that edge (${boxText(n.ink)})`,
        });
      }
    }

    if (n.ink) {
      const spill = escape(n.box, n.ink);
      if (anyEscape(spill, t)) {
        out.push({
          code: "text_box_overflow",
          id: n.id,
          ...(n.name ? { name: n.name } : {}),
          detail:
            `ink ${boxText(n.ink)} reaches outside its own box ${boxText(n.box)} — ` +
            describeEscape(spill),
        });
      }
    }
  }

  // content_overlap — pairs, so it is not in the per-node loop above.
  const painted = nodes.filter((n) => n.name && n.inPicture && n.box.w > 0 && n.box.h > 0);
  for (let i = 0; i < painted.length; i++) {
    for (let j = i + 1; j < painted.length; j++) {
      const a = painted[i]!;
      const b = painted[j]!;
      if (isAncestor(a, b) || isAncestor(b, a)) continue;
      if (!overlaps(a.box, b.box)) continue;
      if (boxContains(a.box, b.box) || boxContains(b.box, a.box)) continue;
      out.push({
        code: "content_overlap",
        id: a.id,
        name: a.name,
        with: b.id,
        detail: `box ${boxText(a.box)} overlaps ${b.name} ${boxText(b.box)}`,
      });
      out.push({
        code: "content_overlap",
        id: b.id,
        name: b.name,
        with: a.id,
        detail: `box ${boxText(b.box)} overlaps ${a.name} ${boxText(a.box)}`,
      });
    }
  }

  const order = new Map(FINDING_CODES.map((c, i) => [c, i]));
  out.sort((p, q) => order.get(p.code)! - order.get(q.code)! || p.id - q.id || (p.with ?? 0) - (q.with ?? 0));
  return applyAllowances(out, inputs.allow);
}

/** `a` is `b`'s container, or its container's container, and so on. */
function isAncestor(a: FindingNode, b: FindingNode): boolean {
  for (let up = b.container; up; up = up.container) {
    if (up.id === a.id) return true;
  }
  return false;
}

/**
 * Stamp `allowedBy` on every finding a `layoutAllow` entry covers.
 *
 * An entry names a node and a scope. For `content_overlap` an entry on EITHER
 * participant excuses the pair — the intent an author writes down is about two
 * things sitting on each other, and making them write it twice would mean a
 * half-excused pair whenever they wrote it once.
 */
export function applyAllowances(
  findings: readonly Finding[],
  allow: readonly LayoutAllowance[],
): Finding[] {
  if (allow.length === 0) return [...findings];
  const byName = new Map<string, Map<LayoutAllowScope, string>>();
  for (const entry of allow) {
    const scopes = byName.get(entry.node) ?? new Map<LayoutAllowScope, string>();
    scopes.set(entry.allow, entry.reason);
    byName.set(entry.node, scopes);
  }
  const nameOf = new Map(findings.filter((f) => f.name).map((f) => [f.id, f.name!]));
  return findings.map((f) => {
    const scope = ALLOW_SCOPE_OF[f.code];
    const own = f.name === undefined ? undefined : byName.get(f.name)?.get(scope);
    const partner =
      f.code === "content_overlap" && f.with !== undefined
        ? byName.get(nameOf.get(f.with) ?? "")?.get(scope)
        : undefined;
    const reason = own ?? partner;
    return reason === undefined ? f : { ...f, allowedBy: reason };
  });
}

/** The findings that still count — the ones no allowance covers. */
export function active(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.allowedBy === undefined);
}

/** How many active findings there are of each code, codes with none omitted. */
export function countByCode(findings: readonly Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of active(findings)) out[f.code] = (out[f.code] ?? 0) + 1;
  return out;
}

/**
 * Allowances that excused nothing in this run.
 *
 * A stale allowance is the same defect an `EXEMPT` entry with no composition
 * behind it is: a written reason for a thing that stopped happening, which
 * nothing re-reads. Reported rather than failed — a frame where a finding did
 * not fire is not evidence that it never fires, and `layout --at N` is one
 * frame.
 */
export function unusedAllowances(
  findings: readonly Finding[],
  allow: readonly LayoutAllowance[],
): LayoutAllowance[] {
  const nameOf = new Map(findings.filter((f) => f.name).map((f) => [f.id, f.name!]));
  const used = new Set<string>();
  for (const f of findings) {
    if (f.allowedBy === undefined) continue;
    const scope = ALLOW_SCOPE_OF[f.code];
    // Either end of an overlap may be the entry that excused it, so both are
    // marked used — otherwise the entry the author DID write would be reported
    // as excusing nothing.
    if (f.name !== undefined) used.add(`${f.name} ${scope}`);
    const partner = f.with === undefined ? undefined : nameOf.get(f.with);
    if (partner !== undefined) used.add(`${partner} ${scope}`);
  }
  return allow.filter((a) => !used.has(`${a.node} ${a.allow}`));
}
