/**
 * Why a node is not on screen.
 *
 * `layout` has answered "is this node in the picture" since `patches/0007`:
 * hide it at draw time and see whether a pixel moves. That test is exact and
 * it is also, on its own, ambiguous — the answer "no" covers a node that is
 * faded out, one that is off screen, one that is zero-sized, one whose window
 * has not opened, and one that something else painted over. Only the last is a
 * defect, and the first four are common: 46 of 114 frames sampled across the
 * ledger hold at least one named node with a box and no pixel, in films that
 * reproduce.
 *
 * `layout`'s own header names what would separate them — "the node's effective
 * opacity at that frame, which the host has and does not expose". Here is what
 * separates them instead, and it needs no opacity and no new engine surface.
 *
 * ASK THE DRAW LIST, NOT THE FRAMEBUFFER
 *
 * Every frame is a pure function of one word stream, and `ui_draw_hash` (which
 * upstream already exports, as a browser host's dirty signal) hashes that
 * stream without rasterising. `debug_hide` is a draw-time skip, so hiding a
 * node removes exactly its subtree's words and nothing else. The same latch
 * therefore answers two different questions:
 *
 *     paints   = drawHash(hide=0) != drawHash(hide=X)   // X emitted geometry
 *     inPicture = frameHash(hide=0) != frameHash(hide=X) // and some survived
 *
 *   | paints | in picture | what it is                            |
 *   | ------ | ---------- | ------------------------------------- |
 *   | no     | no         | invisible by declaration — not a fault |
 *   | yes    | yes        | on screen                             |
 *   | yes    | **no**     | **covered**: it painted, nothing left  |
 *   | no     | yes        | impossible; see below                 |
 *
 * A node with effective opacity 0 anywhere in its ancestry emits nothing: the
 * walk returns at `op <= 0.0` before it reaches the node at all. Same for
 * `display: none`, and for geometry the CPU clip stage drops as off-screen.
 * So "paints" is inherited-context-correct without anyone reading opacity.
 *
 * WHAT WAS TRIED FIRST, AND WHY IT IS NOT THIS
 *
 * The first version of this file added an engine primitive — draw only the
 * node, its subtree and its ancestors — and compared two isolated renders. It
 * is wrong, and measurement is what said so rather than review: on
 * `compositions/impact` it called five plainly visible nodes invisible.
 * Isolating a node changes what it is composited against, and `2.4 MILLION
 * MEALS` is `#F6EFE0` text over a teal shot background that a sibling paints.
 * Remove the sibling and the same glyphs land on the root's cream, which is
 * `#F6EFE0`. The node painted; the difference was zero. A pixel test can only
 * see a node against some backdrop, and the isolated backdrop is not the one
 * the film has. The draw list has no backdrop.
 *
 * WHAT THIS DOES NOT CATCH
 *
 * Total occlusion only. A node 99% covered still changes a pixel, so it is
 * "in picture" and this says nothing about it. A caption under an opaque lid
 * is the total case; a caption half under a lower third is not, and no
 * predicate here will find it.
 *
 * `covered` also takes in a node overdrawn by something the same colour, which
 * is invisible in the delivered frame for a reason no one declared, and a node
 * whose emitted geometry rasterises to no coverage at all (a sub-pixel sliver).
 * Both are reported in that word. Neither has been seen on the ledger.
 *
 * The last row of the table cannot occur: the framebuffer is a function of the
 * word stream, so a hide that moves no word cannot move a pixel. It is in the
 * type because a caller that saw it would be looking at a broken host, and
 * silently folding it into one of the other three would hide that.
 *
 * UNDER A SHUTTER
 *
 * A composition that declares `shutter` delivers exposures, and both
 * questions are asked of the exposure. `inPicture` hides the node and
 * re-renders all N samples, so a node blurred into a region the frame's own
 * tick leaves empty is in the picture — the verdict is about the delivered
 * pixels. `paints` folds the N samples' draw-list hashes
 * (`ui_draw_hash_exposure`), so it is "emitted geometry in at least one
 * sample". Opacity is never integrated by the shutter, so a node its own or
 * an ancestor's opacity hides at the tick is hidden in every sample, and
 * invisible-by-declaration reads as it does without the shutter; a node off
 * the canvas at the tick and on it in some sample paints, because some of
 * the delivered picture is its. Rects and ink boxes are geometry and are read
 * at the frame's own tick, the centre of the exposure: a moving glyph run's
 * smear is not a run that overflows its box. Every probe costs N renders.
 *
 * `read: "tick"` asks both questions of the frame's own tick instead, at one
 * render a probe, and is never the default. It is a different picture, so it
 * is a different claim, and it misses in both directions: a node only the
 * blur shows — covered at the tick and smeared out from under its cover in
 * other samples — reads covered, and a node the average fades below one
 * level reads in picture although the delivered frame carries none of it.
 * `compositions/shutter-blur`'s `peek` is the first case, pinned: an opaque
 * blade turning half a revolution a tick lies over it at every frame's tick
 * and turns off it in every sample but the ones nearest the centre.
 *
 * A RECT IS A WALK, NOT A RASTER
 *
 * The inspector latch is filled by `Ui::draw`, the walk that builds the draw
 * list, and every render runs that walk before it rasterises. `ui_draw_hash`
 * runs the walk alone, so a rect read after it is the box a render would have
 * left, without the raster: on `compositions/mg-hud`, 11,510 nodes, one walk
 * is about 7 ms and one raster about 330 ms, and `layout` reads a rect for
 * every named or text node and every ancestor of one — 1,330 a frame there.
 */

import type { Exposure } from "../runtime/boot.ts";
import { hashFrame, type FrameHash } from "./hash.ts";

/**
 * Which picture `inPicture` and `paints` are asked of under a declared
 * shutter: the exposure the composition delivers, or the frame's own tick.
 * Without a shutter the two are one picture.
 */
export type Reading = "exposure" | "tick";

/** The exports this module drives, resolved once per world. */
export interface Prober {
  /** Highlight/rect latch. Cleared before every hash so no overlay leaks in. */
  readonly inspect: (id: number) => void;
  readonly rectXY: () => number;
  readonly rectWH: () => number;
  readonly hide: (id: number) => void;
  /** FNV-1a over the current DrawList words, without rasterising. `null` when
   *  the caller did not ask why a dark node is dark; see `InspectOptions` in
   *  `src/cli/commands/layout.ts` for why that is a scope choice and not a
   *  speed one — measured, the two cost the same. */
  readonly drawHash: (() => string) | null;
  /** The picture classified: the exposure under a shutter, unless the caller
   *  asked for the tick. */
  readonly render: () => Uint8Array;
  /** The frame's own tick. `render` when there is no shutter. */
  readonly renderTick: () => Uint8Array;
  /** One draw walk at the tick and no raster: what fills the rect latch. */
  readonly walk: () => void;
  /** The exposure `render` reads, or null when it reads the tick — no
   *  shutter, or `read: "tick"`. */
  readonly exposure: Exposure | null;
}

export interface ProbeOptions {
  /** Resolve `ui_draw_hash` and fill `paints` / `visibility`. */
  readonly classify: boolean;
  /** Absent means the exposure. Ignored without a shutter. */
  readonly read?: Reading;
}

export interface ProbeWorld {
  readonly render: () => Uint8Array;
  /** Absent on a world with no shutter, where `render` is the tick. */
  readonly renderTick?: () => Uint8Array;
  readonly exposure?: Exposure | null;
}

/** Both hashes of one frame with nothing hidden. Every probe reads against it. */
export interface Baseline {
  /** `null` when the prober was opened without classification. */
  readonly draw: string | null;
  readonly frame: FrameHash;
  /**
   * A COPY of the unhidden framebuffer, when the caller asked for ink boxes.
   *
   * A copy and not the view `render()` returns: that view is wasm memory the
   * next render overwrites, so comparing a later frame against it would compare
   * the frame with itself. `null` when nobody asked, because it is one full
   * framebuffer resident for the length of the pass.
   */
  readonly pixels: Uint8Array | null;
}

/**
 * Resolve the exports, or say which patch is missing.
 *
 * A fallback would answer the question wrongly rather than not at all, so
 * there is none. `ui_draw_hash` is upstream's own and needs no patch; it is
 * checked here anyway, because a host that lacks it would otherwise report
 * every node as painting nothing.
 */
export function openProber(
  world: ProbeWorld,
  options: ProbeOptions = { classify: true },
): Prober {
  const ex = (world as unknown as { exports: Record<string, unknown> }).exports;
  const need = <T>(name: string, from: string): T => {
    const fn = ex?.[name];
    if (typeof fn !== "function") {
      throw new Error(
        `PocketJS Motion: the host has no ${name} export (${from}).\nRebuild the wasm ` +
          "rasteriser with `bun scripts/vendor.ts`.",
      );
    }
    return fn as T;
  };
  const exposure = options.read === "tick" ? null : (world.exposure ?? null);
  const renderTick = world.renderTick ?? world.render;
  const tickHash = need<() => bigint | number>("ui_draw_hash", "upstream");
  let rawDrawHash: (() => bigint | number) | null = null;
  if (options.classify) {
    if (exposure) {
      const folded = need<(n: number, d: number, s: number) => bigint | number>(
        "ui_draw_hash_exposure",
        "patches/0034",
      );
      rawDrawHash = () => folded(exposure.spanNum, exposure.spanDen, exposure.samples);
    } else {
      rawDrawHash = tickHash;
    }
  }
  const hashOf = rawDrawHash;
  return {
    inspect: need<(id: number) => void>("ui_debug_inspect", "patches/0007"),
    rectXY: need<() => number>("ui_debug_rect_xy", "patches/0007"),
    rectWH: need<() => number>("ui_debug_rect_wh", "patches/0007"),
    hide: need<(id: number) => void>("ui_debug_hide", "patches/0007"),
    // The wasm signature is i64, so this arrives as a BigInt on Bun and a
    // Number on hosts that lower it. Compared as a string either way.
    drawHash: hashOf === null ? null : () => String(hashOf()),
    render: exposure ? world.render : renderTick,
    renderTick,
    walk: () => void tickHash(),
    exposure,
  };
}

/**
 * Latches clear, then both hashes.
 *
 * The frame hash is `"fast"`: what it feeds is a bool that never hits disk,
 * and sha256 here was hashing the whole framebuffer once per node — 414 nodes
 * × 8.3 MB at `reel` frame 600. `src/render/hash.ts` has the measurement and
 * the cross-platform check.
 */
export function baseline(p: Prober, keepPixels = false): Baseline {
  p.inspect(0);
  p.hide(0);
  const draw = p.drawHash ? p.drawHash() : null;
  // render() returns a view into wasm memory that the next render overwrites,
  // so the hash is taken before anything else touches it.
  const rgba = p.render();
  const frame = hashFrame(rgba, "fast");
  // Ink is read at the tick (see the header); with no shutter that is `rgba`.
  const pixels = keepPixels ? new Uint8Array(p.exposure ? p.renderTick() : rgba) : null;
  return { draw, frame, pixels };
}

/**
 * Where a frame and its baseline differ, as a box in the frame's own pixels.
 *
 * `null` when nothing differs. Exported because it is the whole of what an ink
 * box is: the region a node is responsible for, found by taking the node away.
 */
export function changedBox(
  base: Uint8Array,
  after: Uint8Array,
  width: number,
): { x: number; y: number; w: number; h: number } | null {
  if (base.length !== after.length) {
    throw new Error(
      `changedBox: frames differ in size (${base.length} vs ${after.length}); ` +
        "the render scale moved between the baseline and the probe",
    );
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // One pass over the whole buffer, comparing 4 bytes at a time. The row is
  // recomputed from the index rather than nested loops so the common case —
  // most rows identical — costs one compare per pixel and nothing else.
  for (let i = 0; i < base.length; i += 4) {
    if (
      base[i] === after[i] &&
      base[i + 1] === after[i + 1] &&
      base[i + 2] === after[i + 2] &&
      base[i + 3] === after[i + 3]
    ) {
      continue;
    }
    const px = (i >> 2) % width;
    const py = ((i >> 2) - px) / width;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (maxX < minX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The node's border-box world AABB, packed as layout reports it, or -1. */
export function rect(p: Prober, id: number): { xy: number; wh: number } {
  // The inspector latch is filled during the draw pass, so the walk between
  // asking and reading is required. hide must be clear: hiding a parent would
  // skip the child's walk and the rect would come back -1.
  p.hide(0);
  p.inspect(id);
  // The tick, not the exposure: a rect is the box at the centre of the
  // exposure. And a walk, not a render: the walk is what fills the latch,
  // and the raster after it never reads it (see the header).
  p.walk();
  return { xy: p.rectXY(), wh: p.rectWH() };
}

/** What the two tests say together. */
export type Visibility = "on-screen" | "covered" | "declared-invisible" | "impossible";

export interface Probe {
  /** Hiding this node changes a pixel of the frame. Always measured. */
  readonly inPicture: boolean;
  /** Hiding this node removes at least one word from the draw list. Absent
   *  when the prober was opened without classification. */
  readonly paints?: boolean;
  /** Absent for the same reason as `paints`. */
  readonly visibility?: Visibility;
  /**
   * Bounding box of the pixels this node contributes, in LOGICAL units.
   *
   * Present only when the caller passed `ink`. `null` inside that means the
   * node contributes no pixel, which is the same statement as
   * `inPicture: false` and is kept distinct from "nobody asked".
   */
  readonly ink?: { x: number; y: number; w: number; h: number } | null;
}

export interface InkRequest {
  /** Physical width of the framebuffer — logical width times the density. */
  readonly width: number;
  /** Render scale, so the box comes back in the units rects are in. */
  readonly density: number;
}

/**
 * One node, both questions, one hide — and the ink box out of the same render.
 *
 * The inspector is cleared first: its highlight overlay is emitted after the
 * walk and would land in both the draw list and the framebuffer.
 *
 * The ink box costs no extra render. `inPicture` already hides the node and
 * rasterises; asking WHERE the pixels moved is one more pass over the buffer
 * that pass already produced, taken before the next `render()` overwrites it.
 */
export function probe(
  p: Prober,
  id: number,
  base: Baseline,
  ink?: InkRequest,
): Probe {
  p.inspect(0);
  p.hide(id);
  // Both reads happen under the same hide, and the draw hash goes first: it
  // is what `render()` would rebuild anyway, so asking after would pay for the
  // walk twice.
  const draw = p.drawHash ? p.drawHash() : null;
  const hidden = p.render();
  const inPicture = hashFrame(hidden, "fast") !== base.frame;
  let inkBox: { x: number; y: number; w: number; h: number } | null | undefined;
  if (ink !== undefined) {
    if (base.pixels === null) {
      throw new Error(
        "probe: an ink box was asked for against a baseline taken without pixels — " +
          "call baseline(prober, true)",
      );
    }
    // Under a shutter the ink is the node's pixels at the tick, read under
    // the same hide. `hidden` is the exposure's buffer and has been hashed;
    // the tick renders into the framebuffer, not into it.
    const raw = changedBox(base.pixels, p.exposure ? p.renderTick() : hidden, ink.width);
    inkBox =
      raw === null
        ? null
        : {
            x: raw.x / ink.density,
            y: raw.y / ink.density,
            w: raw.w / ink.density,
            h: raw.h / ink.density,
          };
  }
  p.hide(0);
  const withInk = ink === undefined ? {} : { ink: inkBox ?? null };
  if (draw === null || base.draw === null) return { inPicture, ...withInk };
  const paints = draw !== base.draw;
  return { inPicture, paints, visibility: classify(paints, inPicture), ...withInk };
}

export function classify(paints: boolean, inPicture: boolean): Visibility {
  if (inPicture) return paints ? "on-screen" : "impossible";
  return paints ? "covered" : "declared-invisible";
}
