// Where does bakeSvg put a 2x2 square at (0,0) under transform="translate(10,0) rotate(90)"?
// SVG applies the list right to left: rotate first, then translate, so the
// square (0..2, 0..2) rotates to (-2..0, 0..2) and lands at (8..10, 0..2).
// Left to right would translate to (10..12, 0..2) and rotate to (-2..0, 10..12) — off canvas.
// Run from a directory holding the prototype tree as ./pocketjs: bun bake-svg-transform-order.ts
import { bakeSvg } from "./pocketjs/framework/compiler/bake-svg.ts";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <path d="M0 0 H2 V2 H0 Z" fill="#ffffff" transform="translate(10,0) rotate(90)"/>
</svg>`;
const img = bakeSvg(svg);
const lit: string[] = [];
for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.rgba[(y * img.width + x) * 4 + 3] > 128) lit.push(`${x},${y}`);
console.log(`${img.width}x${img.height} opaque pixels: ${lit.join(" ") || "none"}`);
