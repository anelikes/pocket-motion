import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Criterion, Task } from "../../lib/task.ts";
import { encodePng, type Rgba } from "../../lib/png.ts";
import { photo } from "../../lib/photos.ts";
import { chroma, dist, fmt, full, inset, mean, meanChroma, pixelsIn, px, type Rgb } from "../../lib/pixels.ts";

const PHOTOS = [
  { w: 1920, h: 1080, seed: 1001, hue: 20 },
  { w: 1920, h: 1080, seed: 1002, hue: 110 },
  { w: 1920, h: 1080, seed: 1003, hue: 200 },
  { w: 1920, h: 1080, seed: 1004, hue: 290 },
];

/** CSS `saturate(s)`: each channel pulled toward Rec. 709 luma. */
function saturate(c: Rgb, s: number): Rgb {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [l + s * (c[0] - l), l + s * (c[1] - l), l + s * (c[2] - l)];
}

/** The scale about a centre near the frame's under which `a` best becomes `b`. */
function bestZoom(a: Rgba, b: Rgba): number {
  let best = NaN;
  let bestErr = Infinity;
  for (let z = 0.98; z <= 1.15 + 1e-9; z += 0.005)
    for (let ox = -40; ox <= 40; ox += 20)
      for (let oy = -40; oy <= 40; oy += 20) {
        const [cx, cy] = [a.w / 2 + ox, a.h / 2 + oy];
        let err = 0;
        let n = 0;
        for (let y = Math.round(a.h * 0.25); y < a.h * 0.75; y += 8)
          for (let x = Math.round(a.w * 0.25); x < a.w * 0.75; x += 8) {
            const sx = Math.round(cx + (x - cx) / z);
            const sy = Math.round(cy + (y - cy) / z);
            err += dist(px(b, x, y), px(a, sx, sy));
            n++;
          }
        if (err / n < bestErr) [best, bestErr] = [z, err / n];
      }
  return best;
}

/** The frame each photo is alone and fully in at, before any grade change. */
const ALONE = [40, 115, 190, 245];

export default {
  id: "graded-slideshow",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 300 },
  async inputs(dir) {
    PHOTOS.forEach((p, i) => writeFileSync(join(dir, `photo-${i + 1}.png`), encodePng(photo(p))));
  },
  assertions: () => [
    { node: "photo-1", inPicture: [0, 74] },
    { node: "photo-2", inPicture: [90, 149] },
    { node: "photo-3", inPicture: [165, 224] },
    { node: "photo-4", inPicture: [240, 299] },
    { node: "photo-1", before: "photo-2" },
    { node: "photo-2", before: "photo-3" },
    { node: "photo-3", before: "photo-4" },
    { node: "caption", entersBy: 285 },
    { node: "caption", inPicture: [285, 299] },
  ],
  async observe(ctx) {
    const out: Criterion[] = [];
    const sources: Rgba[] = PHOTOS.map((_, i) => ctx.input(`photo-${i + 1}.png`));
    const centreBox = (img: Rgba) => inset(full(img), 0.2);
    const graded = sources.map((s) => {
      const m = mean(s, centreBox(s));
      return saturate(m, 0.6);
    });
    const ratios: string[] = [];
    let gradeOk = true;
    let orderOk = true;
    for (let k = 0; k < 4; k++) {
      const f = await ctx.frame(ALONE[k]!);
      const r = meanChroma(f, centreBox(f)) / meanChroma(sources[k]!, centreBox(sources[k]!));
      ratios.push(`photo-${k + 1} ${fmt(r)}`);
      if (!(r >= 0.45 && r <= 0.75)) gradeOk = false;
      const m = mean(f, centreBox(f));
      const best = graded.map((g, i) => [dist(g, m), i] as const).sort((a, b) => a[0] - b[0])[0]![1];
      if (best !== k) orderOk = false;
    }
    out.push({
      id: "graded-60",
      pass: gradeOk,
      detail: `mean chroma against the source's, centre 60 %: ${ratios.join(", ")} (saturate(0.6) reads 0.6; want 0.45–0.75)`,
    });
    out.push({ id: "photos-in-order", pass: orderOk, detail: "each photo's frame matches its own source by mean colour" });
    const end = await ctx.frame(296);
    let grey = 0;
    let n = 0;
    for (const [, , c] of pixelsIn(end, full(end))) {
      n++;
      if (chroma(c) <= 12) grey++;
    }
    out.push({
      id: "ends-black-and-white",
      pass: grey / n >= 0.97,
      detail: `${fmt((100 * grey) / n, 1)} % of frame 296 has chroma ≤ 12 (want ≥ 97 %)`,
    });
    // The zoom, from pixels: `layout` clamps a box to the canvas, so a
    // full-frame photo zoomed past it reads 1920 × 1080 at every scale, and
    // the zoom may sit on a node nobody named. The scale (about a centre
    // within 40 px of the frame's) that best maps frame 5 onto frame 70.
    const zoom = bestZoom(await ctx.frame(5), await ctx.frame(70));
    out.push({
      id: "ken-burns",
      pass: zoom >= 1.02 && zoom <= 1.12,
      detail: `photo 1 is ×${fmt(zoom, 3)} larger at frame 70 than at frame 5 (1.0 → 1.08 over its time on screen)`,
    });
    const cap = await ctx.node(296, "caption");
    out.push({
      id: "caption-text",
      pass: cap !== undefined && (cap.text === undefined || cap.text.trim() === "Fin."),
      detail: `caption ${JSON.stringify(cap?.text ?? null)}`,
    });
    return out;
  },
} satisfies Task;
