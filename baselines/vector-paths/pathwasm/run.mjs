// Bun: load the wasm, print digests, time the three dense frames.
const bytes = await Bun.file(process.argv[2]).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const x = instance.exports;
const hex = (v) => BigInt.asUintN(64, v).toString(16).padStart(16, "0");
for (let i = 0; i < x.scene_count(); i++) {
  console.log(`digest ${String(i).padStart(2)} ${hex(x.scene_words_digest(i))} ${hex(x.scene_fb_digest(i))}`);
}
if (process.argv[3] !== "--digests-only") {
  // [min, median] in ms: the minimum is what the code costs, the median what
  // a loaded machine charged for it.
  const time = (n, f) => {
    const t = [];
    for (let k = 0; k < n; k++) {
      const s = performance.now();
      f();
      t.push(performance.now() - s);
    }
    t.sort((p, q) => p - q);
    return [t[0], t[t.length >> 1]];
  };
  const ms = ([lo, mid]) => `${lo.toFixed(2)} (${mid.toFixed(2)})`;
  const kinds = ["Spiky", "Smooth", "LineArt"];
  for (let k = 0; k < 3; k++) {
    x.dense_load(k);
    for (const [frame, label] of [[0, "static"], [17, "animated"]]) {
      const emit = time(25, () => x.dense_emit(frame));
      const hash = time(15, () => x.dense_hash());
      const r1 = time(25, () => x.dense_raster(1));
      const r2 = time(15, () => x.dense_raster(2));
      console.log(`${kinds[k]} ${label}: min (median) ms: emit ${ms(emit)} | raster x1 ${ms(r1)} | raster x2 ${ms(r2)} | draw hash ${ms(hash)} | words ${x.dense_emit(frame)} | flattened points ${x.dense_chords()} | contour vertices ${x.dense_vertices()}`);
    }
  }
}
console.log(`bun ${Bun.version} ${process.platform}/${process.arch}`);
