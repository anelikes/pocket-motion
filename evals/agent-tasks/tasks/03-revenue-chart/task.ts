import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Criterion, Task } from "../../lib/task.ts";
import { correlation, count, dist, fmt, full, hex, median, pixelsIn, px, type Rect, type Rgb } from "../../lib/pixels.ts";
import type { Rgba } from "../../lib/png.ts";

const SERIES = {
  title: "Monthly recurring revenue, $k",
  months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  series: [
    { name: "2025", values: [8120, 8460, 9010, 8740, 7980, 8650, 9480, 10120, 10890, 11430, 12760, 13640] },
    { name: "2026 plan", values: [9050, 9620, 10340, 11080, 11720, 12410, 13050, 13690, 14320, 15010, 15580, 16205] },
  ],
};

const A = hex("#38bdf8");
const B = hex("#f472b6");
const isA = (c: Rgb) => dist(c, A) < 70;
const isB = (c: Rgb) => dist(c, B) < 70;

/**
 * The y of a series' pixels in each of twelve columns spaced over its extent,
 * read inside the series' own node and outside the labels — a legend or a
 * label in the series colour is not the line.
 */
function profile(img: Rgba, pred: (c: Rgb) => boolean, inside: Rect, outside: Rect[]): (number | null)[] {
  const out = (x: number, y: number) => outside.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const line = (c: Rgb, x: number, y: number) => pred(c) && !out(x, y);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const [x, y, c] of pixelsIn(img, inside)) if (line(c, x, y)) [x0, x1] = [Math.min(x0, x), Math.max(x1, x)];
  if (x1 < x0) return [];
  return SERIES.months.map((_, i) => {
    const x = Math.round(x0 + 4 + ((x1 - x0 - 8) * i) / 11);
    const ys: number[] = [];
    for (let dx = -2; dx <= 2; dx++)
      for (let y = Math.max(0, inside.y); y < Math.min(img.h, inside.y + inside.h); y++)
        if (line(px(img, x + dx, y), x + dx, y)) ys.push(y);
    return ys.length ? median(ys) : null;
  });
}

export default {
  id: "revenue-chart",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 150 },
  async inputs(dir) {
    writeFileSync(join(dir, "series.json"), `${JSON.stringify(SERIES, null, 2)}\n`);
  },
  assertions: () => [
    { node: "title", inPicture: [0, 149] },
    { node: "series-a", entersBy: 15 },
    { node: "series-a", before: "series-b" },
    { node: "label-a", inPicture: [62, 149] },
    { node: "label-b", inPicture: [82, 149] },
    { node: "label-a", before: "label-b" },
  ],
  async observe(ctx) {
    const out: Criterion[] = [];
    const [f9, f29, f35, f55, f70, f100] = await Promise.all([9, 29, 35, 55, 70, 100].map((f) => ctx.frame(f)));
    const a = (f: Rgba) => count(f, full(f), isA);
    const b = (f: Rgba) => count(f, full(f), isB);
    const aEnd = a(f70!);
    const bEnd = b(f100!);
    out.push({
      id: "a-draws-on",
      pass: aEnd > 2000 && a(f9!) <= aEnd * 0.05 && a(f35!) / aEnd >= 0.2 && a(f35!) / aEnd <= 0.85,
      detail: `#38bdf8 pixels: ${a(f9!)} at 9, ${a(f35!)} at 35, ${aEnd} at 70`,
    });
    out.push({
      id: "b-draws-on",
      pass: bEnd > 2000 && b(f29!) <= bEnd * 0.05 && b(f55!) / bEnd >= 0.2 && b(f55!) / bEnd <= 0.85,
      detail: `#f472b6 pixels: ${b(f29!)} at 29, ${b(f55!)} at 55, ${bEnd} at 100`,
    });
    // One linear axis for both: every column's y against every value.
    const ys: number[] = [];
    const vs: number[] = [];
    const at100 = await ctx.layout(100);
    const rectOf = (n: string) => at100.find((x) => x.name === n);
    const labels = ["label-a", "label-b"].map(rectOf).filter((r): r is NonNullable<typeof r> => r !== undefined);
    const sa = rectOf("series-a");
    const sb = rectOf("series-b");
    const pa = sa ? profile(f100!, isA, sa, labels) : [];
    const pb = sb ? profile(f100!, isB, sb, labels) : [];
    pa.forEach((y, i) => y !== null && (ys.push(y), vs.push(SERIES.series[0]!.values[i]!)));
    pb.forEach((y, i) => y !== null && (ys.push(y), vs.push(SERIES.series[1]!.values[i]!)));
    const r = ys.length >= 18 ? correlation(vs, ys) : NaN;
    out.push({
      id: "lines-follow-data",
      pass: r <= -0.98,
      detail: `correlation of value and line y over ${ys.length} of 24 month columns: ${fmt(r, 3)} (want ≤ −0.98)`,
    });
    const nodes = at100;
    const text = (name: string) => nodes.find((n) => n.name === name)?.text?.trim();
    out.push({
      id: "labels-text",
      pass: text("label-a") === "13,640" && text("label-b") === "16,205",
      detail: `label-a ${JSON.stringify(text("label-a"))}, label-b ${JSON.stringify(text("label-b"))} (want "13,640", "16,205")`,
    });
    out.push({
      id: "title-text",
      pass: text("title") === SERIES.title,
      detail: `title ${JSON.stringify(text("title"))}`,
    });
    return out;
  },
  unchecked: ["axes, gridlines and month labels (no name is asked for)", "that each label sits at its line's end"],
} satisfies Task;
