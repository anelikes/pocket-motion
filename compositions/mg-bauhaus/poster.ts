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
  black: [1, -1],
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
 * Sixteen by eight modules. One dominant disc with the blue half under it,
 * the triangle beside it, a blue counterweight above and the module itself
 * in the corner it signs; the floor lies along the bottom row, eight modules
 * from column 6 to column 13. On b16 the floor stands up about its right
 * corner — the grid point (14, 8) — and becomes the band down column 14 that
 * BAUHAUS is knocked out of; the bottom row it leaves takes the tagline.
 */
export const POSTER: Form[] = [
  { id: "disc", kind: "disc", ink: "red", x: gx(3), y: gy(0), w: 6 * M, h: 6 * M },
  { id: "bar", kind: "box", ink: "black", x: gx(6), y: gy(7), w: 8 * M, h: M },
  { id: "tri", kind: "tri", ink: "yellow", x: gx(9), y: gy(2), w: 4 * M, h: 4 * M },
  { id: "bluesq", kind: "box", ink: "blue", x: gx(11), y: gy(0), w: 2 * M, h: 2 * M },
  { id: "half", kind: "half", ink: "blue", x: gx(4), y: gy(6), w: 2 * M, h: M },
  { id: "quarter", kind: "quarter", ink: "black", x: gx(1), y: gy(6), w: 2 * M, h: 2 * M, rot: 1 },
  { id: "module", kind: "box", ink: "red", x: gx(13), y: gy(0), w: M, h: M },
];

/** Where the floor ends up: the band down column 14, the full height of the grid. */
export const BAND = { x: gx(14), y: gy(0), w: M, h: 8 * M } as const;
/** The floor's pivot as it stands up: its bottom-right corner, the grid point (14, 8). */
export const FLOOR_PIVOT = { x: gx(14), y: gy(8) } as const;
