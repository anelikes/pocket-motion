// Linear memory before and after one exposure: a checkpoint snapshots all of it.
const [repo, bundle, pak, scale] = process.argv.slice(2);
const { hardenedBootWorld } = await import(`${repo}/src/runtime/boot.ts`);
const sc = Number(scale ?? 1);
const w = await hardenedBootWorld({ bundlePath: bundle, pakPath: pak, width: 1920, height: 1080, hz: 30, renderScale: sc });
const ex = w.exports as any;
w.frame(0); for (let t = 0; t < w.ticksPerFrame; t++) w.tick();
const mb = () => +(ex.memory.buffer.byteLength / 2 ** 20).toFixed(1);
const boot = mb();
ex.ui_render_scaled(sc); const plain = mb();
ex.ui_render_exposure(sc, 180 * 2, 360, 8); const expo = mb();
console.log(JSON.stringify({ scale: sc, bootMiB: boot, afterPlainRenderMiB: plain, afterExposureMiB: expo }));
