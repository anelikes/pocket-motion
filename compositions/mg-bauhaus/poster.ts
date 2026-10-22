/**
 * The poster this film builds, as data: the path one module takes, what each
 * of its moves leaves behind, and the word, constructed from the same parts.
 *
 * The module is two grid modules square (240 px) and moves on a 6 × 4 grid of
 * its own size over columns 4–15 of the 16 × 8 grid, one move a beat. A roll
 * turns it a quarter about the corner it rolls over — right about its
 * bottom-right, up about its top-right, down and left about its bottom-left —
 * and the quarter disc that corner sweeps is left in the cell it lifts off. A
 * spin turns it a quarter about its own centre, and leaves the disc its edges
 * sweep. A fold turns it over its own diagonal, and leaves the half it lifted. So the poster is the trace of the module's own motion; the drop adds
 * the one form the module cannot make, a circle four modules across.
 *
 * BAUHAUS stands in columns 1–2, reading upward, every letter cut from
 * squares and quarter discs in a 120 × 240 box with 40 px strokes.
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
  paper: [1, -1],
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

/** The module's size, and the grid it moves on: columns 4–15, rows 0–7. */
export const MOD = 2 * M;
export const cellX = (i: number) => gx(4 + 2 * i);
export const cellY = (j: number) => gy(2 * j);
export const COLS = 6;
export const ROWS = 4;

/** R, U, D, L roll about a corner; S spins about the module's own centre; F folds it over its diagonal; C swings it a quarter about the frame centre. */
export type Act = "R" | "U" | "D" | "L" | "S" | "F" | "C";
/** Where the module lands on b1, and its moves, one per beat, b2 to b12. */
export const START: [number, number] = [0, 1];
/**
 * The swing is from cell (1, 0): a cell whose own corners are all clear of the
 * frame centre, so the move is a 380 px arc about the centre and cannot be
 * read as a roll about a corner (from (2, 1) it could, the centre being that
 * cell's own bottom-left corner).
 */
export const ACTS: Act[] = ["R", "U", "S", "C", "R", "D", "F", "L", "L", "U", "U"];
/**
 * What each move leaves, in its ink; null where the cell already holds what a spin or a fold left. The inks are
 * chosen so that nothing the module passes, and nothing in the finished poster, sits beside its own ink.
 */
const LEAVES: (Ink | null)[] = ["black", "blue", "black", null, "yellow", "blue", "yellow", null, "red", "yellow", "black"];
/** The corner each roll turns about, as a fraction of the cell, and which way. */
export type Roll = Exclude<Act, "S" | "F" | "C">;
export const PIVOT: Record<Roll, [number, number]> = { R: [1, 1], U: [1, 0], D: [0, 1], L: [0, 1] };
export const TURN: Record<Roll, number> = { R: 90, U: 90, D: 90, L: -90 };
/** The quarter disc a roll sweeps, as the `quarter` form's turn: its corner on the pivot (BL 0, TL 1, TR 2, BR 3). */
export const SWEEP: Record<Roll, number> = { R: 3, U: 2, D: 0, L: 0 };
const STEP: Record<Exclude<Act, "C">, [number, number]> = { R: [1, 0], U: [0, -1], D: [0, 1], L: [-1, 0], S: [0, 0], F: [0, 0] };
/**
 * A quarter turn clockwise about the frame centre maps the module's grid onto
 * itself: the frame centre sits a cell and a half from the grid's top-left
 * cell centre on both axes, so cell (i, j) goes to (3 - j, i).
 */
export const swing = ([i, j]: [number, number]): [number, number] => [3 - j, i];

/** The module's cell before each move, and after the last. */
export const PATH: [number, number][] = ACTS.reduce<[number, number][]>(
  (acc, a) => {
    const [i, j] = acc[acc.length - 1]!;
    acc.push(a === "C" ? swing([i, j]) : [i + STEP[a][0], j + STEP[a][1]]);
    return acc;
  },
  [START],
);

/** What each move leaves behind, indexed by move: a quarter in the cell a roll lifts off, a disc where a spin turned. */
export const LEFT: (Form | null)[] = ACTS.map((a, k) => {
  const ink = LEAVES[k];
  if (!ink) return null;
  const [i, j] = PATH[k]!;
  const box = { x: cellX(i), y: cellY(j), w: MOD, h: MOD };
  // a fold over the bottom-left/top-right diagonal leaves the half whose right angle is the bottom-right corner
  if (a === "F") return { id: `tri-${k}`, kind: "tri", ink, ...box };
  return a === "S" ? { id: `disc-${k}`, kind: "disc", ink, ...box } : { id: `stamp-${k}`, kind: "quarter", ink, ...box, rot: SWEEP[a] };
});
export const TRAIL: Form[] = LEFT.filter((f): f is Form => f !== null);

/** The module itself, where its path ends. */
export const MODULE: Form = (() => {
  const [i, j] = PATH[PATH.length - 1]!;
  return { id: "module", kind: "box", ink: "red", x: cellX(i), y: cellY(j), w: MOD, h: MOD };
})();

/** The circle the drop leaves: the one empty 2 × 2 block of the module's grid, four modules across. */
export const CIRCLE_BLOCK: [number, number] = [0, 2];
export const CIRCLE: Form = { id: "circle", kind: "disc", ink: "blue", x: cellX(CIRCLE_BLOCK[0]), y: cellY(CIRCLE_BLOCK[1]), w: 2 * MOD, h: 2 * MOD };

/** Everything printed on the poster before the word. */
export const POSTER: Form[] = [...TRAIL, MODULE, CIRCLE];

// ── the word ────────────────────────────────────────────────────────────────

type Part = [kind: "box" | "quarter", x: number, y: number, w: number, h: number, rot: number, ink: "black" | "paper"];
const box = (x: number, y: number, w: number, h: number, ink: "black" | "paper" = "black"): Part => ["box", x, y, w, h, 0, ink];
const q = (x: number, y: number, s: number, rot: number, ink: "black" | "paper" = "black"): Part => ["quarter", x, y, s, s, rot, ink];

/**
 * Each letter upright in a 120 × 240 box: black parts, then paper counters
 * cut into them. Strokes are 40; a bowl or arch is a half disc of radius 60,
 * its counter radius 20.
 */
export const GLYPHS: Record<string, Part[]> = {
  B: [box(0, 0, 60, 240), q(60, 0, 60, 0), q(60, 60, 60, 1), q(60, 120, 60, 0), q(60, 180, 60, 1)],
  A: [box(0, 60, 120, 180), q(0, 0, 60, 3), q(60, 0, 60, 0), q(40, 40, 20, 3, "paper"), q(60, 40, 20, 0, "paper"), box(40, 60, 40, 60, "paper"), box(40, 160, 40, 80, "paper")],
  U: [box(0, 0, 120, 180), q(0, 180, 60, 2), q(60, 180, 60, 1), box(40, 0, 40, 180, "paper"), q(40, 180, 20, 2, "paper"), q(60, 180, 20, 1, "paper")],
  H: [box(0, 0, 40, 240), box(80, 0, 40, 240), box(40, 100, 40, 40)],
  S: [
    box(60, 0, 60, 40),
    q(0, 0, 60, 3),
    box(0, 60, 40, 20),
    q(0, 80, 60, 2),
    q(60, 100, 60, 0),
    box(80, 160, 40, 20),
    q(60, 180, 60, 1),
    box(0, 200, 60, 40),
    q(40, 40, 20, 3, "paper"),
    q(40, 80, 20, 2, "paper"),
    q(60, 140, 20, 0, "paper"),
    q(60, 180, 20, 1, "paper"),
  ],
};

/** The word's column: columns 1–2, its letters reading upward with 20 px between them, B at the foot. */
export const WORD = "BAUHAUS";
export const WORD_X = gx(1);
export const letterFoot = (k: number) => gy(8) - k * (M + 20);

/**
 * Letter k as frame forms, turned a quarter anticlockwise to read upward: its
 * top on the column's left edge, its foot on the right, its left side down.
 */
export function letterForms(k: number): Form[] {
  const foot = letterFoot(k);
  return GLYPHS[WORD[k]!]!.map(([kind, x, y, w, h, rot, ink], n) => ({
    id: `letter-${k}-${n}`,
    kind,
    ink,
    x: WORD_X + y,
    y: foot - x - w,
    w: h,
    h: w,
    // a quarter's corner turns with the letter; a box is already re-boxed, and turning a box that is not square
    // inside its own box would swap its sides
    rot: kind === "quarter" ? (rot + 3) % 4 : 0,
  }));
}
