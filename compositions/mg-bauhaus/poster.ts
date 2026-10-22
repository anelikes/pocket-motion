/**
 * The poster this film builds, as data: every form, its box on the grid, its
 * ink. The choreography in gen.ts ends on exactly these boxes, and the drop's
 * cells each show their 120 px slice of this same list.
 */

export const M = 120;
export const GY = 60; // the grid is offset half a module so the frame centre is a grid point
export const gx = (c: number) => c * M;
export const gy = (r: number) => GY + r * M;

export const INK = {
  paper: "#F1E9DA",
  red: "#E03C31",
  yellow: "#F2B705",
  blue: "#1E4FA3",
  black: "#111111",
} as const;
export type Ink = keyof typeof INK;

/** Per-ink plate offset: a press never registers four plates perfectly. */
export const MISREG: Record<Ink, [number, number]> = {
  paper: [0, 0],
  red: [2, -1],
  yellow: [1, 1],
  blue: [-1, 2],
  black: [0, 0],
};

export interface Form {
  id: string;
  kind: "box" | "disc" | "quarter" | "half" | "tri";
  ink: Ink;
  x: number;
  y: number;
  w: number;
  h: number;
  /** clockwise quarter turns of the drawn form inside its box */
  rot?: number;
}

/**
 * Sixteen by eight modules. One dominant disc, one heavy horizontal, one
 * diagonal, a blue counterweight above and below, the module itself in the
 * corner it signs. BAUHAUS stands on the right edge.
 */
export const POSTER: Form[] = [
  { id: "disc", kind: "disc", ink: "red", x: gx(3), y: gy(0), w: 6 * M, h: 6 * M },
  { id: "bar", kind: "box", ink: "black", x: gx(3), y: gy(6), w: 10 * M, h: M },
  { id: "tri", kind: "tri", ink: "yellow", x: gx(9), y: gy(2), w: 4 * M, h: 4 * M },
  { id: "bluesq", kind: "box", ink: "blue", x: gx(11), y: gy(0), w: 2 * M, h: 2 * M },
  { id: "half", kind: "half", ink: "blue", x: gx(10), y: gy(7), w: 2 * M, h: M },
  { id: "quarter", kind: "quarter", ink: "black", x: gx(1), y: gy(6), w: 2 * M, h: 2 * M, rot: 1 },
  { id: "module", kind: "box", ink: "red", x: gx(13), y: gy(0), w: M, h: M },
];
