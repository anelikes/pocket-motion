import type { Assertion, Criterion, Task } from "../../lib/task.ts";
import { bbox, dist, fmt, full, hex, median, px, quantile } from "../../lib/pixels.ts";

const BG = hex("#0a0a0a");
const FG = hex("#fafafa");
const FULL = dist(FG, BG);

export default {
  id: "kinetic-hero",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 150 },
  async inputs() {},
  assertions: () => {
    const out: Assertion[] = [{ node: "word-1", entersBy: 3 }];
    for (let k = 1; k < 4; k++) out.push({ node: `word-${k}`, before: `word-${k + 1}` });
    out.push({ node: "word-4", before: "hero" });
    for (let k = 1; k <= 4; k++) out.push({ node: `word-${k}`, exitsBy: 74 });
    out.push({ node: "hero", inPicture: [90, 149] });
    return out;
  },
  async observe(ctx) {
    const out: Criterion[] = [];
    const f = await ctx.frame(120);
    const ink = bbox(f, full(f), (c) => dist(c, BG) > FULL * 0.5);
    if (!ink) return [{ id: "hero-size", pass: false, detail: "nothing on screen at frame 120" }];
    out.push({
      id: "hero-size",
      pass: ink.h >= 340 && ink.x >= 8 && ink.y >= 8 && ink.x + ink.w <= f.w - 8 && ink.y + ink.h <= f.h - 8,
      detail: `ink at frame 120: ${ink.w}×${ink.h} at ${ink.x},${ink.y} (want ≥ 340 tall, inside the frame)`,
    });
    // Crispness: along the row through the middle of the caps, every edge
    // crossing a vertical stroke. Type rasterised at its size goes from ground
    // to ink in one or two pixels; a baked size scaled up ramps over about
    // the scale factor.
    const runs: number[] = [];
    for (const t of [0.45, 0.5, 0.55]) {
      const y = Math.round(ink.y + ink.h * t);
      let run = 0;
      for (let x = ink.x - 4; x < ink.x + ink.w + 4; x++) {
        const l = dist(px(f, x, y), BG) / FULL;
        if (l > 0.1 && l < 0.9) run++;
        else if (run > 0) {
          runs.push(run);
          run = 0;
        }
      }
    }
    const m = median(runs);
    const p90 = quantile(runs, 0.9);
    out.push({
      id: "hero-crisp",
      pass: runs.length >= 12 && m <= 2 && p90 <= 3,
      detail: `${runs.length} edge ramps across the caps: median ${fmt(m, 1)} px, 90th percentile ${fmt(p90, 1)} px (want ≤ 2, ≤ 3)`,
    });
    const hero = await ctx.node(120, "hero");
    out.push({
      id: "hero-text",
      pass: hero !== undefined && (hero.text === undefined || hero.text.trim() === "BUILD"),
      detail: hero ? `hero ${hero.kind} ${JSON.stringify(hero.text ?? null)}` : "no node named hero at frame 120",
    });
    return out;
  },
  unchecked: ["the slam (scale-down) of the four words; only their order and exits are read"],
} satisfies Task;
