import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "../../lib/task.ts";
import { bbox, centre, count, dist, fmt, hex, px, type Rgb } from "../../lib/pixels.ts";

/**
 * The SVG is shaped like an Illustrator "Export As" with its default
 * styling, Internal CSS: classes in a `<style>` block rather than
 * presentation attributes. That is what a design team hands over.
 */
const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 28.3.0, SVG Export Plug-In . SVG Version: 1.2.0 Build 182)  -->
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <style>
      .cls-1 {
        fill: none;
        stroke: #e2e8f0;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 8px;
      }

      .cls-2 {
        fill: #38bdf8;
      }

      .cls-3 {
        fill: #f59e0b;
      }
    </style>
  </defs>
  <g id="mark">
    <path id="star-fill" class="cls-2" d="M150,40l22,88-22,22Zm110,110-88,22-22-22Zm-110,110-22-88,22-22ZM40,150l88-22,22,22Z"/>
    <circle id="hub" class="cls-3" cx="150" cy="150" r="12"/>
    <circle id="ring" class="cls-1" cx="150" cy="150" r="120"/>
    <polygon id="star" class="cls-1" points="150 40 172 128 260 150 172 172 150 260 128 172 40 150 128 128 150 40"/>
  </g>
  <g id="wind">
    <path id="gust-1" class="cls-1" d="M290,112h56a20,20,0,1,0-20-20"/>
    <line id="gust-2" class="cls-1" x1="290" y1="150" x2="372" y2="150"/>
    <path id="gust-3" class="cls-1" d="M290,188h48a18,18,0,1,1-18,18"/>
  </g>
</svg>
`;

const BG = hex("#0b1020");
const STROKE = hex("#e2e8f0");
const FILL = hex("#38bdf8");
const on = (c: Rgb) => dist(c, BG) > 90 && dist(c, STROKE) < 70;
const filled = (c: Rgb) => dist(c, FILL) < 60;

export default {
  id: "logo-draw-on",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 120 },
  async inputs(dir) {
    writeFileSync(join(dir, "logo.svg"), LOGO_SVG);
  },
  assertions: () => [
    { node: "logo", entersBy: 6 },
    { node: "logo", inPicture: [45, 119] },
    { node: "logo", before: "wordmark" },
    { node: "wordmark", inPicture: [90, 119] },
  ],
  async observe(ctx) {
    const out = [];
    const logo = await ctx.node(100, "logo");
    const word = await ctx.node(100, "wordmark");
    if (!logo) return [{ id: "logo-found", pass: false, detail: "no node named logo at frame 100" }];
    // The logo as drawn: what differs from the ground inside `logo`, above
    // the wordmark. The node itself may be any container.
    const [f30, f100] = await Promise.all([ctx.frame(30), ctx.frame(100)]);
    const above = word?.ink ? Math.min(logo.y + logo.h, word.ink.y) - logo.y : logo.h;
    const drawn = bbox(f100, { x: logo.x, y: logo.y, w: logo.w, h: above }, (c) => dist(c, BG) > 60);
    if (!drawn) return [{ id: "logo-size", pass: false, detail: "nothing drawn inside logo at frame 100" }];
    out.push({
      id: "logo-size",
      pass: drawn.w >= 360 && drawn.w <= 520 && Math.abs(centre(drawn)[0] - 960) <= 40,
      detail: `logo drawn ${drawn.w}×${drawn.h} at x ${drawn.x}, centre x ${fmt(centre(drawn)[0], 0)} (viewBox content ≈ 425 wide at 480 px)`,
    });
    // The draw-on: the outline pixels of frame 44 appear progressively, at
    // full strength, rather than all at once at partial strength.
    const box = { x: drawn.x - 8, y: drawn.y - 8, w: drawn.w + 16, h: drawn.h + 16 };
    const [f2, f22, f44] = await Promise.all([ctx.frame(2), ctx.frame(22), ctx.frame(44)]);
    let total = 0;
    let at22 = 0;
    let at2 = 0;
    for (let y = Math.max(0, box.y); y < Math.min(f44.h, box.y + box.h); y++) {
      for (let x = Math.max(0, box.x); x < Math.min(f44.w, box.x + box.w); x++) {
        if (!on(px(f44, x, y))) continue;
        total++;
        if (on(px(f22, x, y))) at22++;
        if (on(px(f2, x, y))) at2++;
      }
    }
    const r22 = at22 / total;
    const r2 = at2 / total;
    out.push({
      id: "draw-on-progressive",
      pass: total > 3000 && r22 >= 0.1 && r22 <= 0.9 && r2 <= 0.35,
      detail: `outline pixels at frame 44: ${total}; at full strength by frame 2: ${fmt(r2)}, by frame 22: ${fmt(r22)} (want ≤0.35, 0.1–0.9)`,
    });
    const fill30 = count(f30, box, filled);
    const fill100 = count(f100, box, filled);
    out.push({
      id: "fill-after-draw",
      pass: fill100 > 3000 && fill30 <= fill100 * 0.02,
      detail: `#38bdf8 fill pixels at frame 30: ${fill30}, at frame 100: ${fill100}`,
    });
    if (!word) {
      out.push({ id: "wordmark-placed", pass: false, detail: "no node named wordmark at frame 100" });
    } else {
      const ink = word.ink ?? word;
      out.push({
        id: "wordmark-placed",
        pass:
          (word.text === undefined || word.text.trim() === "NORTHWIND") &&
          ink.y >= drawn.y + drawn.h - 10 &&
          Math.abs(centre(ink)[0] - 960) <= 40,
        detail: `wordmark ${JSON.stringify(word.text ?? null)} ink y ${ink.y} (logo drawn to ${drawn.y + drawn.h}), centre x ${fmt(centre(ink)[0], 0)}`,
      });
    }
    return out;
  },
  unchecked: ["that the wordmark rises (only its final place is read)"],
} satisfies Task;
