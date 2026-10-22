/**
 * The poster this film builds, as data: the path one module rolls, and what
 * each roll leaves behind. The choreography in gen.ts walks this path; the
 * drop's cells show slices of the same forms.
 *
 * The module is two grid modules square (240 px) and rolls on a 7 × 3 grid
 * of its own size laid over columns 1–14 and rows 0–5 of the 16 × 8 grid. A
 * roll turns it a quarter clockwise about the corner it rolls over — right
 * about its bottom-right, up about its top-right, down about its bottom-left
 * — and the quarter disc that corner sweeps is stamped into the cell it lifts
 * off. So the poster is the trace of the module's own motion.
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

/** Per-ink plate offset: a press never registers four plates perfectly. Visible where two inks meet. */
export const MISREG: Record<Ink, [number, number]> = {
  paper: [0, 0],
  red: [3, -1],
  yellow: [1, 2],
  blue: [-2, 2],
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

/** The module's size, and the 7 × 3 grid it rolls on. */
export const MOD = 2 * M;
export const cellX = (i: number) => gx(1 + 2 * i);
export const cellY = (j: number) => gy(2 * j);

export type Roll = "R" | "U" | "D";
/** Where the module lands on b1, and the rolls it makes, one per beat, b2 to b12. */
export const START: [number, number] = [0, 1];
export const ROLLS: Roll[] = ["R", "R", "U", "R", "R", "D", "D", "R", "R", "U", "U"];
/** The corner each roll turns about, as a fraction of the cell: right about BR, up about TR, down about BL. */
export const PIVOT: Record<Roll, [number, number]> = { R: [1, 1], U: [1, 0], D: [0, 1] };
/** The quarter disc a roll sweeps, as the `quarter` form's turn: its corner on the pivot (BL 0, TL 1, TR 2, BR 3). */
export const SWEEP: Record<Roll, number> = { R: 3, U: 2, D: 0 };
const STEP: Record<Roll, [number, number]> = { R: [1, 0], U: [0, -1], D: [0, 1] };
const CYCLE: Ink[] = ["black", "red", "yellow", "blue"];

/** The module's cell before each roll, and after the last. */
export const PATH: [number, number][] = ROLLS.reduce<[number, number][]>(
  (acc, r) => {
    const [i, j] = acc[acc.length - 1]!;
    acc.push([i + STEP[r][0], j + STEP[r][1]]);
    return acc;
  },
  [START],
);

/** What each roll leaves behind: a quarter disc in the cell the module lifts off. */
export const TRAIL: Form[] = ROLLS.map((r, k) => {
  const [i, j] = PATH[k]!;
  return { id: `stamp-${k}`, kind: "quarter", ink: CYCLE[k % CYCLE.length]!, x: cellX(i), y: cellY(j), w: MOD, h: MOD, rot: SWEEP[r] };
});

/** The module itself, where its path ends. */
export const MODULE: Form = (() => {
  const [i, j] = PATH[PATH.length - 1]!;
  return { id: "module", kind: "box", ink: "red", x: cellX(i), y: cellY(j), w: MOD, h: MOD };
})();

/** Everything printed on the poster before the type. */
export const POSTER: Form[] = [...TRAIL, MODULE];
