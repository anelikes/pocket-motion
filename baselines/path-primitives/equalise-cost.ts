#!/usr/bin/env bun
/**
 * What equalisation costs at build time, and how many cubics it bakes.
 *
 *   bun baselines/path-primitives/equalise-cost.ts
 *
 * The fixture's three morphs, and two larger pairs written here: a 96-cubic
 * blob into a 120-point star, and a 300-cubic wave line into a 200-segment
 * zigzag with two extra subpaths. Times are the fastest of 5 runs.
 */
const VENDOR = new URL("../../vendor/pocketjs/", import.meta.url).pathname;
const { compilePathEntry } = (await import(`${VENDOR}framework/compiler/path-data.ts`)) as {
  compilePathEntry(keys: readonly string[]): { verbs: number[] };
};

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();
function blob(n: number, r: number, wob: number): string {
  // n cubics round a wobbly circle, written as smooth `C` segments.
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const rr = r * (1 + wob * Math.sin(5 * a));
    pts.push([200 + rr * Math.cos(a), 200 + rr * Math.sin(a)]);
  }
  let d = `M${fmt(pts[0]![0])} ${fmt(pts[0]![1])}`;
  for (let i = 1; i <= n; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    d += ` C${fmt(x0 + (x1 - x0) / 3)} ${fmt(y0 + (y1 - y0) / 3)} ${fmt(x0 + (2 * (x1 - x0)) / 3)} ${fmt(y0 + (2 * (y1 - y0)) / 3)} ${fmt(x1)} ${fmt(y1)}`;
  }
  return d + " Z";
}
function star(points: number): string {
  let d = "";
  for (let i = 0; i < 2 * points; i++) {
    const a = (i / (2 * points)) * 2 * Math.PI - Math.PI / 2;
    const r = i % 2 ? 90 : 180;
    d += `${i ? " L" : "M"}${fmt(200 + r * Math.cos(a))} ${fmt(200 + r * Math.sin(a))}`;
  }
  return d + " Z";
}
const PLAY = "M30 20 L80 50 L30 80 Z";
const PAUSE = "M25 20 H43 V80 H25 Z M57 20 H75 V80 H57 Z";
const HEART = "M50 85 C50 85 12 60 12 35 C12 20 24 12 36 12 C44 12 50 18 50 24 C50 18 56 12 64 12 C76 12 88 20 88 35 C88 60 50 85 50 85 Z";
const STAR = "M50 12 L59.99 40.25 L89.94 41.02 L66.17 59.25 L74.69 87.98 L50 71 L25.31 87.98 L33.83 59.25 L10.06 41.02 L40.01 40.25 Z";
const RING = "M50 10 A40 40 0 1 1 50 90 A40 40 0 1 1 50 10 Z M50 30 A20 20 0 1 1 50 70 A20 20 0 1 1 50 30 Z";
const SQUARE = "M14 14 H86 V86 H14 Z";
let wave = "M0 200";
for (let i = 0; i < 300; i++) wave += ` C${i * 4 + 1} ${200 + 40 * Math.sin(i / 7)} ${i * 4 + 3} ${200 + 40 * Math.sin((i + 1) / 7)} ${i * 4 + 4} 200`;
let zig = "M0 200";
for (let i = 1; i <= 200; i++) zig += ` L${i * 6} ${i % 2 ? 150 : 250}`;
zig += " M20 20 L60 20 L40 60 Z M1100 20 L1160 20 L1130 70 Z";

const cases: [string, string[]][] = [
  ["play -> pause (3 lines; 2 x 4 lines)", [PLAY, PAUSE]],
  ["heart -> star (6 cubics; 10 lines)", [HEART, STAR]],
  ["ring -> square (2 x 8 arc cubics; 4 lines)", [RING, SQUARE]],
  ["blob -> star (96 cubics; 240 lines)", [blob(96, 150, 0.08), star(120)]],
  ["wave -> zigzag + 2 (300 cubics; 200 lines + 2 x 3)", [wave, zig]],
];
console.log("| keys | cubics a key, baked | ms (fastest of 5) |");
console.log("|---|---:|---:|");
for (const [name, keys] of cases) {
  let best = Infinity;
  let cubics = 0;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    const e = compilePathEntry(keys);
    best = Math.min(best, performance.now() - t0);
    cubics = e.verbs.filter((v) => v === 2).length;
  }
  console.log(`| ${name} | ${cubics} | ${best.toFixed(2)} |`);
}
