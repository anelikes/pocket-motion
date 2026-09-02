const bytes = await Bun.file(
  `${import.meta.dir}/target/wasm32-unknown-unknown/release/affinewasm.wasm`,
).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const { bench, grid_cells, pixels } = instance.exports as {
  bench: (mode: number, iters: number, degX10: number, grid: number) => number;
  grid_cells: (degX10: number) => number;
  pixels: (degX10: number, grid: number) => number;
};

const ITERS = 200;
const REPS = 5;
const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];

function time(mode: number, deg: number, grid: number): number {
  bench(mode, 20, deg * 10, grid); // warm
  const runs: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const t0 = performance.now();
    bench(mode, ITERS, deg * 10, grid);
    runs.push((performance.now() - t0) / ITERS);
  }
  return median(runs);
}

console.log("wasm32-unknown-unknown under Bun, opt-level=\"s\" lto=true — the profile engine/wasm ships");
console.log("800x600 quad at 1920x1080, perspective distance 1000\n");
console.log(
  "deg  cells | " +
    ["A affine(2op)", "B grid(today)", "C per-px divide", "D seg-8", "D seg-16", "D seg-32"]
      .map((s) => s.padStart(16))
      .join(" "),
);
for (const deg of [20, 40, 60, 70]) {
  const cells = grid_cells(deg * 10);
  const pxA = pixels(deg * 10, 0);
  const pxB = pixels(deg * 10, 1);
  const a = time(0, deg, 0);
  const b = time(0, deg, 1);
  const c = time(1, deg, 0);
  const d8 = time(8, deg, 0);
  const d16 = time(16, deg, 0);
  const d32 = time(32, deg, 0);
  const cols = [a, b, c, d8, d16, d32]
    .map((v, i) => (i === 0 ? `${v.toFixed(3)}ms` : `${v.toFixed(3)}ms ${(v / a).toFixed(2)}x`).padStart(16))
    .join(" ");
  console.log(`${String(deg).padStart(3)}  ${String(cells).padStart(5)} | ${cols}   px A=${pxA} B=${pxB}`);
}
