import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Criterion, Task } from "../../lib/task.ts";
import { bbox, dist, fmt, hex, px, type Rect, type Rgb } from "../../lib/pixels.ts";
import type { Rgba } from "../../lib/png.ts";

// What Figma writes for a 24 × 24 frame: explicit fill, `fill="none"` on the
// root, a rounded play triangle as one cubic path, the pause bars as rects.
const PLAY = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M7 5.1C7 4.3 7.9 3.8 8.6 4.2L19 10.9C19.6 11.3 19.6 12.7 19 13.1L8.6 19.8C7.9 20.2 7 19.7 7 18.9V5.1Z" fill="#F8FAFC"/>
</svg>
`;
const PAUSE = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="6" y="4" width="4" height="16" rx="1" fill="#F8FAFC"/>
<rect x="14" y="4" width="4" height="16" rx="1" fill="#F8FAFC"/>
</svg>
`;

const BG = hex("#111827");
const FG = hex("#f8fafc");
const FULL = dist(FG, BG);
const level = (c: Rgb) => dist(c, BG) / FULL;
const isOn = (c: Rgb) => level(c) > 0.5;
/** The 480 × 480 box the brief puts the icon in. */
const BOX: Rect = { x: 300, y: 300, w: 480, h: 480 };

/** Fraction of the centre column (±10 px, middle 40 % of the box) that is on. */
function centreFill(img: Rgba): number {
  let on = 0;
  let n = 0;
  for (let y = BOX.y + 0.3 * BOX.h; y < BOX.y + 0.7 * BOX.h; y++)
    for (let x = 530; x < 550; x++) {
      n++;
      if (isOn(px(img, x, Math.round(y)))) on++;
    }
  return on / n;
}

function onSet(img: Rgba): Set<number> {
  const s = new Set<number>();
  for (let y = BOX.y; y < BOX.y + BOX.h; y++)
    for (let x = BOX.x; x < BOX.x + BOX.w; x++) if (isOn(px(img, x, y))) s.add(y * img.w + x);
  return s;
}

function xorFrac(a: Set<number>, b: Set<number>): number {
  let x = 0;
  for (const v of a) if (!b.has(v)) x++;
  for (const v of b) if (!a.has(v)) x++;
  return x / Math.max(1, new Set([...a, ...b]).size);
}

/** Pixels at a partial level, as a fraction of the pixels that are on. */
function partial(img: Rgba): number {
  let mid = 0;
  let on = 0;
  for (let y = BOX.y; y < BOX.y + BOX.h; y++)
    for (let x = BOX.x; x < BOX.x + BOX.w; x++) {
      const l = level(px(img, x, y));
      if (l > 0.5) on++;
      if (l > 0.2 && l < 0.8) mid++;
    }
  return mid / Math.max(1, on);
}

export default {
  id: "icon-morph",
  ext: "mp4",
  canvas: { w: 1080, h: 1080, fps: 30, frames: 120 },
  async inputs(dir) {
    writeFileSync(join(dir, "play.svg"), PLAY);
    writeFileSync(join(dir, "pause.svg"), PAUSE);
  },
  assertions: () => [{ node: "icon", inPicture: [0, 119] }],
  async observe(ctx) {
    const out: Criterion[] = [];
    const [f15, f30, f37, f45, f60, f75, f82, f90, f110] = await Promise.all(
      [15, 30, 37, 45, 60, 75, 82, 90, 110].map((f) => ctx.frame(f)),
    );
    const play = bbox(f15!, BOX, isOn);
    const pause = bbox(f60!, BOX, isOn);
    // Play spans viewBox x 7–19.45, y 3.95–20.05; pause x 6–18, y 4–20; 20× from (300, 300).
    const near = (r: Rect | null, x0: number, y0: number, x1: number, y1: number) =>
      r !== null &&
      Math.abs(r.x - x0) <= 24 &&
      Math.abs(r.y - y0) <= 24 &&
      Math.abs(r.x + r.w - x1) <= 24 &&
      Math.abs(r.y + r.h - y1) <= 24;
    out.push({
      id: "play-placed",
      pass: near(play, 440, 379, 689, 701) && centreFill(f15!) > 0.8 && centreFill(f110!) > 0.8,
      detail: `play at frame 15 ${JSON.stringify(play)}; centre column filled ${fmt(centreFill(f15!))} at 15, ${fmt(centreFill(f110!))} at 110`,
    });
    out.push({
      id: "pause-placed",
      pass: near(pause, 420, 380, 660, 700) && centreFill(f60!) < 0.05,
      detail: `pause at frame 60 ${JSON.stringify(pause)}; centre column filled ${fmt(centreFill(f60!))}`,
    });
    const [s30, s37, s45, s75, s82, s90] = [f30, f37, f45, f75, f82, f90].map((f) => onSet(f!));
    const inBetween = (a: Set<number>, m: Set<number>, b: Set<number>) => Math.min(xorFrac(a, m), xorFrac(m, b));
    const go = inBetween(s30!, s37!, s45!);
    const back = inBetween(s75!, s82!, s90!);
    out.push({
      id: "morph-in-between",
      pass: go >= 0.03 && back >= 0.03,
      detail: `frame 37 differs from both ends by ≥ ${fmt(go)}, frame 82 by ≥ ${fmt(back)} (a cut at an end reads 0)`,
    });
    const p37 = partial(f37!);
    const p82 = partial(f82!);
    out.push({
      id: "morph-not-crossfade",
      pass: p37 <= 0.08 && p82 <= 0.08,
      detail: `partially covered pixels per solid pixel mid-morph: ${fmt(p37)} at 37, ${fmt(p82)} at 82 (a cross-fade is mostly partial)`,
    });
    return out;
  },
} satisfies Task;
