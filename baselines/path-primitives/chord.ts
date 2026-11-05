#!/usr/bin/env bun
/**
 * The chord error of `motionPath`'s keys, for the design note's table:
 * the fixture's three movers and a ladder of circles.
 *
 *   bun baselines/path-primitives/chord.ts
 *
 * For each: the fastest the node moves (px a tick, over its keyed ticks),
 * and `chordError` with keys every second tick (the default) and every tick:
 * the largest distance from the node's interpolated position to the curve at
 * any tick, and at eight instants inside each tick (what a shutter samples).
 */
import { motionPath, type MotionPathOptions } from "../../src/anim/path-motion.ts";
import { bezier } from "../../src/anim/sampled.ts";

const ROUTE = "M70 430 C230 430 250 150 410 150 C570 150 600 360 480 360 C360 360 420 150 590 150 C750 150 770 430 890 430";
const ORBIT = "M200 20 A180 160 0 1 1 200 340 A180 160 0 1 1 200 20 Z";
const circle = (r: number) => `M${r} 0 A${r} ${r} 0 1 1 ${r} ${2 * r} A${r} ${r} 0 1 1 ${r} 0 Z`;
const swoop = bezier(0.65, 0, 0.35, 1);

const cases: [string, MotionPathOptions][] = [
  ["fixture fly / trail: the route, 3600 ms, swoop", { d: ROUTE, durationMs: 3600, ease: swoop }],
  ["fixture orbit: the ellipse, 2400 ms, linear", { d: ORBIT, durationMs: 2400 }],
  ["circle r 200, 2000 ms", { d: circle(200), durationMs: 2000 }],
  ["circle r 100, 1000 ms", { d: circle(100), durationMs: 1000 }],
  ["circle r 100, 500 ms", { d: circle(100), durationMs: 500 }],
  ["circle r 50, 500 ms", { d: circle(50), durationMs: 500 }],
];
console.log("| motion | fastest, px a tick | every 2: at ticks | every 2: between | every 1: at ticks | every 1: between |");
console.log("|---|---:|---:|---:|---:|---:|");
for (const [name, o] of cases) {
  const two = motionPath(o);
  const one = motionPath({ ...o, every: 1 });
  const xs = Object.values(one.keyframes).map((v) => [parseFloat(v.translateX!), parseFloat(v.translateY!)]);
  let v = 0;
  for (let i = 1; i < xs.length; i++) v = Math.max(v, Math.hypot(xs[i]![0]! - xs[i - 1]![0]!, xs[i]![1]! - xs[i - 1]![1]!));
  const f = (n: number) => n.toFixed(3);
  console.log(`| ${name} | ${v.toFixed(1)} | ${f(two.chordError.atTicks)} | ${f(two.chordError.betweenTicks)} | ${f(one.chordError.atTicks)} | ${f(one.chordError.betweenTicks)} |`);
}
