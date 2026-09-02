const bytes = await Bun.file(`${import.meta.dir}/target/wasm32-unknown-unknown/release/affinewasm.wasm`).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports as any;
const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
const time = (mode: number, deg: number, grid: number) => {
  e.bench(mode, 20, deg * 10, grid);
  return median([...Array(5)].map(() => { const t = performance.now(); e.bench(mode, 200, deg * 10, grid); return (performance.now() - t) / 200; }));
};
console.log("grid cap sweep — wasm, opt-level=\"s\"\n");
console.log("deg |  cap | cells |    ms   vs affine |  mean err  max err (texels)");
for (const deg of [40, 70]) {
  e.set_cap(8); const a = time(0, deg, 0);
  for (const cap of [8, 16, 32, 64]) {
    e.set_cap(cap);
    const cells = e.grid_cells(deg * 10);
    const ms = time(0, deg, 1);
    const mean = e.grid_err(deg * 10, 0) / 1000, max = e.grid_err(deg * 10, 1) / 1000;
    console.log(`${String(deg).padStart(3)} | ${String(cap).padStart(4)} | ${String(cells).padStart(5)} | ${ms.toFixed(3)}ms  ${(ms / a).toFixed(2)}x | ${mean.toFixed(3).padStart(9)} ${max.toFixed(3).padStart(8)}`);
  }
  e.set_cap(8);
  const c = time(1, deg, 0);
  console.log(`${String(deg).padStart(3)} |  per-pixel divide | ${c.toFixed(3)}ms  ${(c / a).toFixed(2)}x |     exact    exact`);
}
