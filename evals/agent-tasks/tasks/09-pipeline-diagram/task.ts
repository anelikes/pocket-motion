import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Criterion, Task } from "../../lib/task.ts";
import { centre, clip, dist, fmt, median, px, type Rect, type Rgb } from "../../lib/pixels.ts";

const DIAGRAM = {
  stages: [
    { id: "ingest", label: "Ingest" },
    { id: "process", label: "Process" },
    { id: "deliver", label: "Deliver" },
  ],
  links: [
    { from: "ingest", to: "process" },
    { from: "process", to: "deliver" },
  ],
};

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

const median3 = (cs: readonly Rgb[]): Rgb => [0, 1, 2].map((k) => median(cs.map((c) => c[k]!))) as unknown as Rgb;

/** The principal axis of a set of points, in degrees, and how much longer it is than the other. */
function principalAxis(pts: readonly (readonly [number, number, ...unknown[]])[]): { axis: number; elong: number } {
  const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  let [m20, m02, m11] = [0, 0, 0];
  for (const [x, y] of pts) {
    m20 += (x - cx) ** 2;
    m02 += (y - cy) ** 2;
    m11 += (x - cx) * (y - cy);
  }
  const half = (m20 + m02) / 2;
  const root = Math.sqrt(Math.max(0, half * half - (m20 * m02 - m11 * m11)));
  return { axis: (0.5 * Math.atan2(2 * m11, m20 - m02) * 180) / Math.PI, elong: (half + root) / Math.max(1e-9, half - root) };
}

/** The smallest arc, in degrees, that holds every angle. */
function circularSpread(deg: readonly number[]): number {
  if (deg.length < 2) return 0;
  const s = deg.map((d) => ((d % 360) + 360) % 360).sort((a, b) => a - b);
  let gap = 360 - s[s.length - 1]! + s[0]!;
  for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i]! - s[i - 1]!);
  return 360 - gap;
}

/** Distance from a point to a rect, 0 inside it. */
function gap(p: [number, number], r: Rect): number {
  const dx = Math.max(r.x - p[0], 0, p[0] - (r.x + r.w));
  const dy = Math.max(r.y - p[1], 0, p[1] - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export default {
  id: "pipeline-diagram",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 180 },
  async inputs(dir) {
    writeFileSync(join(dir, "diagram.json"), `${JSON.stringify(DIAGRAM, null, 2)}\n`);
  },
  assertions: () => [
    { node: "box-ingest", entersBy: 3 },
    { node: "box-ingest", before: "box-process" },
    { node: "box-process", before: "box-deliver" },
    { node: "box-deliver", entersBy: 25 },
    { node: "link-1", inPicture: [35, 179] },
    { node: "link-2", inPicture: [35, 179] },
    // On each link. The brief says the packet travels through Process, not
    // that it stays in sight inside the box: one run drew it over the box,
    // one under it, and both read the brief.
    { node: "packet", inPicture: [62, 90] },
    { node: "packet", inPicture: [120, 145] },
  ],
  async observe(ctx) {
    const out: Criterion[] = [];
    const at100 = await ctx.layout(100);
    const box = (n: string) => at100.find((x) => x.name === `box-${n}`);
    const [bi, bp, bd] = [box("ingest"), box("process"), box("deliver")];
    if (!bi || !bp || !bd) return [{ id: "boxes", pass: false, detail: "a box is missing at frame 100" }];
    out.push({
      id: "boxes-left-to-right",
      pass: centre(bi)[0] < centre(bp)[0] && centre(bp)[0] < centre(bd)[0],
      detail: `box centres x ${[bi, bp, bd].map((b) => fmt(centre(b)[0], 0)).join(", ")}`,
    });
    const frames = Array.from({ length: 16 }, (_, i) => 60 + i * 6);
    const packets = await Promise.all(frames.map(async (f) => (await ctx.node(f, "packet")) ?? null));
    const seen = packets.filter((p): p is NonNullable<typeof p> => p !== null && p.inPicture);
    const xs = seen.map((p) => centre(p)[0]);
    const ys = seen.map((p) => centre(p)[1]);
    const forward = xs.every((x, i) => i === 0 || x >= xs[i - 1]! - 2);
    const first = seen[0];
    const last = seen[seen.length - 1];
    out.push({
      id: "packet-travels",
      pass:
        seen.length >= 12 &&
        forward &&
        first !== undefined &&
        last !== undefined &&
        gap(centre(first), bi) <= 80 &&
        gap(centre(last), bd) <= 80 &&
        Math.max(...ys) - Math.min(...ys) >= 30,
      detail: `packet in picture at ${seen.length} of 16 frames from 60 to 150; x ${xs.map((x) => fmt(x, 0)).join(" ")}; y span ${fmt(Math.max(...ys) - Math.min(...ys), 0)}`,
    });
    // Turning: the arrowhead's body — the pixels that differ strongly from a
    // sampled frame where the packet is elsewhere, near their median colour,
    // so neither its glow nor a box lighting up under it — and the principal
    // axis of that body. An arrowhead is longer one way than the other, so
    // the axis follows its heading (modulo a half turn). Neither the node's
    // box (a square box's bounding box is square at every angle) nor the
    // farthest pixel (a notched chevron's back corners outreach its point)
    // says this. A frame whose body is small or round is no reading.
    const bodies: { axis: number; elong: number; n: number }[] = [];
    for (const [i, p] of packets.entries()) {
      if (!p?.inPicture) continue;
      const other = packets.findIndex((q) => q !== null && !overlaps(grow(q, 8), grow(p, 8)));
      if (other < 0) continue;
      const [img, ref] = [await ctx.frame(frames[i]!), await ctx.frame(frames[other]!)];
      const r = clip(img, grow(p, 4));
      if (!r) continue;
      const strong: [number, number, Rgb][] = [];
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const c = px(img, x, y);
          if (dist(c, px(ref, x, y)) > 100) strong.push([x, y, c]);
        }
      if (strong.length < 30) continue;
      const fill = median3(strong.map((q) => q[2]));
      const pts = strong.filter((q) => dist(q[2], fill) < 50);
      if (pts.length < 30) continue;
      bodies.push({ ...principalAxis(pts), n: pts.length });
    }
    const typical = median(bodies.map((b) => b.n));
    const readings = bodies.filter((b) => b.elong >= 1.1 && b.n >= typical / 2).map((b) => b.axis);
    // Axes are directions modulo 180°: double them onto the full circle.
    const spread = circularSpread(readings.map((a) => 2 * a)) / 2;
    out.push({
      id: "packet-turns",
      pass: readings.length >= 6 && spread >= 15,
      detail: `the packet's long axis spans ${fmt(spread, 0)}° over ${readings.length} readable frames (${readings.map((a) => fmt(a, 0)).join(" ")}; a packet that does not turn keeps one axis)`,
    });
    // Marching: the link's own pixels move while its box stays put.
    const [l40, l43] = [(await ctx.layout(40)).find((n) => n.name === "link-1"), (await ctx.layout(43)).find((n) => n.name === "link-1")];
    if (!l40 || !l43) {
      out.push({ id: "dashes-march", pass: false, detail: "link-1 not laid out at 40 or 43" });
    } else {
      const [a, b] = [await ctx.frame(40), await ctx.frame(43)];
      const r = clip(a, l40);
      let moved = 0;
      if (r)
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++) if (dist(px(a, x, y), px(b, x, y)) > 40) moved++;
      out.push({
        id: "dashes-march",
        pass: moved >= 50 && Math.abs(l40.x - l43.x) <= 1 && Math.abs(l40.w - l43.w) <= 1,
        detail: `${moved} pixels of link-1 change between frames 40 and 43, its box ${l40.x},${l40.y} ${l40.w}×${l40.h}`,
      });
      out.push({
        id: "links-curved",
        pass: l40.h >= 30,
        detail: `link-1 box ${l40.w}×${l40.h} (an S-curve between two boxes spans some height)`,
      });
    }
    return out;
  },
  unchecked: ["that the links are dashed rather than another moving pattern", "the box pop (scale) itself"],
} satisfies Task;
