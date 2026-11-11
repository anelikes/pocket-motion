import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Assertion, Criterion, Task } from "../../lib/task.ts";
import { encodePng, type Rgba } from "../../lib/png.ts";
import { WALL_FABRIC, photo } from "../../lib/photos.ts";
import { clip, dist, fmt, inset, lumaStd, mean, median, type Rect } from "../../lib/pixels.ts";

const PHOTOS = Array.from({ length: 12 }, (_, i) => ({
  file: `photo-${String(i + 1).padStart(2, "0")}.png`,
  opts: { w: 800, h: 600, seed: 701 + i, hue: i * 30, fabric: WALL_FABRIC },
}));

/** Where photo k's fabric panel lands when the photo is drawn whole into `r`. */
function fabricOnScreen(r: Rect): Rect {
  return inset(
    {
      x: r.x + (WALL_FABRIC.x0 / 800) * r.w,
      y: r.y + (WALL_FABRIC.y0 / 600) * r.h,
      w: ((WALL_FABRIC.x1 - WALL_FABRIC.x0) / 800) * r.w,
      h: ((WALL_FABRIC.y1 - WALL_FABRIC.y0) / 600) * r.h,
    },
    0.2,
  );
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export default {
  id: "photo-wall",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 180 },
  async inputs(dir) {
    for (const p of PHOTOS) writeFileSync(join(dir, p.file), encodePng(photo(p.opts)));
  },
  assertions: () => {
    const out: Assertion[] = [
      { node: "wall", inPicture: [0, 179] },
      { node: "title", entersBy: 45 },
      { node: "title", inPicture: [45, 179] },
    ];
    for (let k = 1; k <= 12; k++) out.push({ node: `photo-${k}`, inPicture: [0, 179] });
    return out;
  },
  async observe(ctx) {
    const out: Criterion[] = [];
    const at0 = await ctx.layout(0);
    const at179 = await ctx.layout(179);
    const rect0 = (k: number) => at0.find((n) => n.name === `photo-${k}`);
    const misplaced: string[] = [];
    for (let k = 1; k <= 12; k++) {
      const r = rect0(k);
      const ex = ((k - 1) % 4) * 480;
      const ey = Math.floor((k - 1) / 4) * 360;
      if (!r || Math.abs(r.x - ex) > 3 || Math.abs(r.y - ey) > 3 || Math.abs(r.w - 480) > 3 || Math.abs(r.h - 360) > 3)
        misplaced.push(`photo-${k} ${r ? `${r.x},${r.y} ${r.w}×${r.h}` : "absent"}`);
    }
    out.push({
      id: "grid-at-0",
      pass: misplaced.length === 0,
      detail: misplaced.length ? `not on the 480 × 360 grid: ${misplaced.join("; ")}` : "all twelve on the grid",
    });
    const p6 = at179.find((n) => n.name === "photo-6");
    // Scale 1.6 about (960, 540) takes photo 6 (480, 360, 480 × 360) to (192, 252, 768 × 576).
    out.push({
      id: "push-in",
      pass: p6 !== undefined && Math.abs(p6.w - 768) <= 10 && Math.abs(p6.x - 192) <= 8 && Math.abs(p6.y - 252) <= 8,
      detail: p6 ? `photo-6 at frame 179: ${p6.x},${p6.y} ${p6.w}×${p6.h} (want 192,252 768×576)` : "photo-6 not laid out at 179",
    });
    const f0 = await ctx.frame(0);
    const sources: Rgba[] = PHOTOS.map((p) => ctx.input(p.file));
    const means = sources.map((s) => mean(s, { x: 0, y: 0, w: 800, h: 450 }));
    const wrong: string[] = [];
    for (let k = 1; k <= 12; k++) {
      const r = rect0(k);
      if (!r) continue;
      const m = mean(f0, { x: r.x, y: r.y, w: r.w, h: r.h * 0.75 });
      const best = means.map((s, i) => [dist(s, m), i] as const).sort((a, b) => a[0] - b[0])[0]![1];
      if (best !== k - 1) wrong.push(`photo-${k} shows ${PHOTOS[best]!.file}`);
    }
    out.push({
      id: "photos-in-order",
      pass: wrong.length === 0 && misplaced.length < 12,
      detail: wrong.length ? wrong.join("; ") : "each tile's colour matches its photo",
    });
    // Moiré: the fabric panel is a one-pixel checkerboard. Drawn smaller than
    // its pixels with filtering it is a flat tone; without, it aliases into
    // a pattern whose spread is many levels.
    for (const frame of [0, 90]) {
      const img = await ctx.frame(frame);
      const nodes = await ctx.layout(frame);
      const title = nodes.find((n) => n.name === "title" && n.inPicture);
      const stds: number[] = [];
      for (let k = 1; k <= 12; k++) {
        const r = nodes.find((n) => n.name === `photo-${k}`);
        if (!r) continue;
        const patch = clip(img, fabricOnScreen(r));
        if (!patch || patch.w < 24 || patch.h < 24 || (title && overlaps(patch, title))) continue;
        stds.push(lumaStd(img, patch));
      }
      const m = median(stds);
      out.push({
        id: `no-moire-${frame}`,
        pass: stds.length >= 3 && m < 20,
        detail: `fabric panel luma spread at frame ${frame}: median ${fmt(m, 1)} over ${stds.length} panels (a filtered panel is near 0; want < 20)`,
      });
    }
    const title = (await ctx.layout(120)).find((n) => n.name === "title");
    out.push({
      id: "title",
      pass: title?.text === undefined ? title !== undefined : title.text.trim() === "Summer 2026",
      detail: `title ${JSON.stringify(title?.text ?? null)}`,
    });
    return out;
  },
  unchecked: ["the easing of the push"],
} satisfies Task;
