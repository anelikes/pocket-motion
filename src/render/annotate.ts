/**
 * Draw boxes and labels ON TOP OF a rendered frame, host-side.
 *
 * The rule this file exists to keep: **the composition is never asked to draw
 * the overlay.** A debug layer inside the guest would be geometry in the draw
 * list, which would move `ui_draw_hash`, move the frame hash, and make every
 * reading `layout` and `visibility` take a reading of a different picture.
 * Upstream's own inspector overlay is exactly that and is why
 * `src/render/visibility.ts` clears the inspect latch before every hash.
 *
 * So the input here is the RGBA buffer a render already produced and the
 * output is a copy of it with pixels written over the top. The frame the
 * annotation was taken from is written out untouched beside it, and
 * `tests/snapshot.test.ts` holds those bytes equal to what `frame --at N`
 * writes — an overlay that could change the delivered pixels would be a
 * debugging tool that lies about the thing it is debugging.
 *
 * THE FONT IS 5×7 AND UPPERCASE, and that is a size choice rather than a
 * limitation accepted quietly. Labels here are node names and finding codes —
 * `[a-z0-9:/_-]` — so folding to uppercase loses nothing an author wrote, and a
 * 45-glyph table is small enough to read and check in place. It is scaled by an
 * integer factor, so every glyph edge lands on a pixel boundary and the overlay
 * is as reproducible as the frame under it.
 */

/** Rows of a glyph, top to bottom, `#` set and `.` clear. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "×": ["00000", "10001", "01010", "00100", "01010", "10001", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** A glyph nothing in the table covers, so an unexpected character is visible
 *  rather than a hole the reader takes for a space. */
const UNKNOWN = ["11111", "10001", "10001", "10001", "10001", "10001", "11111"];

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** One clear column between glyphs, at scale 1. */
const ADVANCE = GLYPH_W + 1;

export type RGBA = readonly [number, number, number, number];

export interface Surface {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Width in pixels of `text` drawn at `scale`. */
export function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : (text.length * ADVANCE - 1) * scale;
}

function blend(s: Surface, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
  const i = (y * s.width + x) * 4;
  const a = color[3] / 255;
  if (a >= 1) {
    s.pixels[i] = color[0]!;
    s.pixels[i + 1] = color[1]!;
    s.pixels[i + 2] = color[2]!;
    s.pixels[i + 3] = 255;
    return;
  }
  for (let c = 0; c < 3; c++) {
    s.pixels[i + c] = Math.round(color[c]! * a + s.pixels[i + c]! * (1 - a));
  }
  s.pixels[i + 3] = Math.max(s.pixels[i + 3]!, color[3]!);
}

export function fillRect(
  s: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGBA,
): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) blend(s, px, py, color);
  }
}

/** A hollow rectangle, `thickness` px thick, drawn INSIDE the box. */
export function strokeRect(
  s: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGBA,
  thickness = 2,
): void {
  if (w <= 0 || h <= 0) {
    // A box the canvas collapsed to nothing still has a position worth seeing,
    // so it is drawn as a tick on that edge rather than skipped.
    fillRect(s, x - thickness, y, thickness * 2, Math.max(h, thickness * 2), color);
    return;
  }
  fillRect(s, x, y, w, Math.min(thickness, h), color);
  fillRect(s, x, y + h - thickness, w, Math.min(thickness, h), color);
  fillRect(s, x, y, Math.min(thickness, w), h, color);
  fillRect(s, x + w - thickness, y, Math.min(thickness, w), h, color);
}

export function drawText(
  s: Surface,
  x: number,
  y: number,
  text: string,
  color: RGBA,
  scale = 2,
): void {
  let cursor = x;
  for (const raw of text) {
    const glyph = GLYPHS[raw.toUpperCase()] ?? UNKNOWN;
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < GLYPH_W; col++) {
        if (bits[col] !== "1") continue;
        fillRect(s, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += ADVANCE * scale;
  }
}

/** A label with a ground behind it, so it reads over any picture. */
export function drawLabel(
  s: Surface,
  x: number,
  y: number,
  text: string,
  fg: RGBA,
  bg: RGBA,
  scale = 2,
): void {
  const pad = scale;
  const w = textWidth(text, scale) + pad * 2;
  const h = GLYPH_H * scale + pad * 2;
  // Nudged back inside the frame rather than clipped: a label that ran off the
  // right edge is the one on the node most likely to be the problem.
  const px = Math.max(0, Math.min(x, s.width - w));
  const py = Math.max(0, Math.min(y, s.height - h));
  fillRect(s, px, py, w, h, bg);
  drawText(s, px + pad, py + pad, text, fg, scale);
}

/** Copy a rectangle out of a frame. The box is clamped to the frame first, so
 *  a crop that starts outside it comes back as the part that exists. */
export function cropFrame(
  s: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
): Surface {
  const x0 = Math.max(0, Math.min(Math.round(x), s.width - 1));
  const y0 = Math.max(0, Math.min(Math.round(y), s.height - 1));
  const x1 = Math.max(x0 + 1, Math.min(Math.round(x + w), s.width));
  const y1 = Math.max(y0 + 1, Math.min(Math.round(y + h), s.height));
  const cw = x1 - x0;
  const ch = y1 - y0;
  const out = new Uint8Array(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const from = ((y0 + row) * s.width + x0) * 4;
    out.set(s.pixels.subarray(from, from + cw * 4), row * cw * 4);
  }
  return { pixels: out, width: cw, height: ch };
}

/**
 * Colours, by what the box means.
 *
 * A finding's colour is decided by its code so a sheet of frames reads at a
 * glance; the palette is fixed rather than themed, because the overlay is
 * evidence and two runs of it have to be the same bytes.
 */
export const OVERLAY_COLORS: Readonly<Record<string, RGBA>> = {
  plain: [90, 160, 255, 200],
  text_not_painted: [140, 140, 140, 220],
  text_occluded: [255, 64, 64, 235],
  panel_out_of_canvas: [255, 128, 0, 235],
  escaped_container: [255, 200, 0, 235],
  content_overlap: [255, 0, 200, 235],
  text_box_overflow: [0, 220, 180, 235],
  clipped_text: [160, 100, 255, 235],
  allowed: [70, 70, 70, 200],
  ink: [255, 255, 255, 160],
};

const LABEL_FG: RGBA = [0, 0, 0, 255];

/** What the overlay needs to know about one node. Structural on purpose: this
 *  file must not import a command, and a command may pass more than this. */
export interface AnnotatableNode {
  readonly id: number;
  readonly name?: string;
  readonly text?: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ink?: { x: number; y: number; w: number; h: number } | null;
  readonly findings?: readonly {
    readonly code: string;
    readonly allowedBy?: string;
  }[];
}

export interface AnnotateOptions {
  /** The frame, at physical size. Not modified — a copy is returned. */
  readonly frame: Surface;
  /** Logical-to-physical factor, so logical rects land on the right pixels. */
  readonly density: number;
  readonly nodes: readonly AnnotatableNode[];
  /** Draw a box for every node, not only the ones carrying a finding. */
  readonly all?: boolean;
  /** Glyph scale. Default 2 at density 1, so a 1920-wide frame carries a
   *  readable 10×14 label. */
  readonly scale?: number;
}

/**
 * A copy of the frame with a box round every node that carries a finding, its
 * name above it, and the codes beside the name.
 *
 * Findings an allowance excuses are drawn too, in grey and with the code
 * prefixed — the sidecar said the geometry is intended, not that nobody should
 * be able to see it. A node whose ink was measured gets a second, thinner box
 * for the ink, which is the whole of what `text_box_overflow` and
 * `clipped_text` are about and is invisible in the rect alone.
 */
export function annotateFrame(options: AnnotateOptions): Surface {
  const { frame, density } = options;
  const scale = options.scale ?? Math.max(2, 2 * density);
  const out: Surface = {
    pixels: new Uint8Array(frame.pixels),
    width: frame.width,
    height: frame.height,
  };

  for (const node of options.nodes) {
    const findings = node.findings ?? [];
    const live = findings.filter((f) => f.allowedBy === undefined);
    if (live.length === 0 && findings.length === 0 && options.all !== true) continue;

    const codes = findings.map((f) =>
      f.allowedBy === undefined ? f.code : `allowed:${f.code}`,
    );
    const color =
      live.length > 0
        ? (OVERLAY_COLORS[live[0]!.code] ?? OVERLAY_COLORS.plain!)
        : findings.length > 0
          ? OVERLAY_COLORS.allowed!
          : OVERLAY_COLORS.plain!;

    const x = Math.round(node.x * density);
    const y = Math.round(node.y * density);
    const w = Math.round(node.w * density);
    const h = Math.round(node.h * density);
    strokeRect(out, x, y, w, h, color, Math.max(1, Math.round(density)));

    if (node.ink) {
      strokeRect(
        out,
        Math.round(node.ink.x * density),
        Math.round(node.ink.y * density),
        Math.round(node.ink.w * density),
        Math.round(node.ink.h * density),
        OVERLAY_COLORS.ink!,
        1,
      );
    }

    const label = [node.name ?? `#${node.id}`, ...codes].join(" ");
    // Above the box when there is room, inside its top edge otherwise.
    const labelH = GLYPH_H * scale + scale * 2;
    drawLabel(out, x, y - labelH >= 0 ? y - labelH : y, label, LABEL_FG, color, scale);
  }
  return out;
}
