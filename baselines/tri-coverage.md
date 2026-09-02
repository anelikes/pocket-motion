# Rotated geometry has no coverage — what a fix costs, 2026-08-18

Apple M4 (4 P-cores + 6 E-cores), rustc 1.93.1, `opt-level=3 lto=true
codegen-units=1`, native aarch64. Subject: 1920×1080, black, eight white
120×800 bars, centres at `(300 + 180i, 540)`, rotated `4 + i` degrees.

Reproducers in [`tri-coverage/`](tri-coverage/): `bench.rs` + `Cargo.toml`
(the rasteriser variants, lifted from `raster.rs` so the inner loops match),
and `hyperframes-scene.html` (the same scene as an HTML composition).

## The defect

`draw.rs` computes fractional coverage for **axis-aligned** content only —
`scale_alpha_coverage` / `pixel_interval_coverage` on RECT spans, rounded
corners and shadows, 2×2 supersampled. Rotated solid and gradient boxes take
the other path: `emit_box` → Sutherland-Hodgman → `emit_tri`, which **rounds
every vertex to an integer pixel** and emits a 7-word TRI op — opcode, three
positions, three vertex colours. **The op has no coverage field.** A rotated
white rectangle on black therefore has strictly binary edges.

This is recorded at `draw.rs:10-18` as a v1 degradation, so it is not a
regression. What was never recorded is the price of removing it.

## What the variants cost

Five repetitions of the same process, `sweep()` in `bench.rs`:

| | grey levels | ms/frame (median) | spread | vs today |
| --- | ---: | ---: | --- | ---: |
| today — binary TRI | **2** | 0.865 | 0.773–0.919 | 1.00× |
| POLY, 4×4 samples | **17** | 0.858 | 0.805–0.882 | **0.99×** |
| POLY, 8×8 samples | **65** | 3.156 | 2.969–3.310 | 3.65× |
| POLY, 16×16 samples | **256** | 11.882 | 11.798–11.980 | 13.7× |

**17 levels costs nothing measurable.** 4×4 coverage lands inside the
run-to-run spread of the code it replaces. It pays for itself because the
current `tri` evaluates three `orient()` calls — six i64 multiplies — for every
pixel in the bounding box, with no incremental stepping and no run fill. Solving
each scanline for the fully-interior x-range, filling that as one run, and
sampling only the pixels at either end saves more arithmetic than the coverage
test adds.

For scale: 4× MSAA, the games-industry default, resolves each edge to 5 levels.

**Absolute times drifted up to 1.8× between processes** on this machine — an
earlier session measured the binary variant at 1.48–1.66 ms for the same scene.
Only ratios measured inside one process run are quoted here.

## Per-triangle coverage is the wrong fix

A rotated rectangle is two triangles sharing a diagonal, and two sequential
alpha blends are not one blend: 0.5 over 0.5 leaves 0.75, not 1. Same rectangle
(240×160 at 20°), counting pixels that are neither 0 nor 255 while all eight
neighbours are non-zero:

| | grey levels | interior partial px |
| --- | ---: | ---: |
| binary | 2 | 0 |
| coverage per TRI | 21 | **68** |
| coverage per POLY | 17 | **0** |

Those 68 pixels are a seam down the shared diagonal of every rotated box. The
21 levels are the artefact, not the improvement — sixteen samples can only
produce seventeen, and the extra four are double-blended pixels.

Computing coverage over the whole Sutherland-Hodgman polygon instead removes
the interior edges, so there is nothing to double-blend.

## Cross-check against a browser

The same scene as an HTML composition, rendered by HyperFrames 0.8.2
(Chrome/Skia via Puppeteer), 150 frames at 1920×1080:

| | grey levels | edge profile, row y=300 |
| --- | ---: | --- |
| today | 2 | `0 0 0 0 0 0 0 255 255` |
| POLY 4×4 | 17 | `0 0 0 0 0 0 127 255 255` |
| HyperFrames | 256 | `0 0 0 0 0 0 102 255 255` |

127 against 102 is the 4×4 quantisation: sixteen samples resolve that pixel to
8/16 where exact coverage puts it near 6.4/16.

Its render pipeline, from the CLI's own trace:

| stage | 150 frames | per frame |
| --- | ---: | ---: |
| capture, 5 workers | 2294 ms | 15.3 ms |
| capture, 1 worker | 3717 ms | 24.8 ms |
| encode | 866 ms | 5.8 ms |
| **pipeline** | **5183 ms** | **34.6 ms** |

4K, five workers: capture 4721 ms, encode 2740 ms.

That cost is Chrome layout/paint/composite plus screenshot serialisation, IPC
and disk — not rasterisation. Against `phase5-throughput.md`'s measured 5.32
ms/frame at 1080p, 16×16 coverage would put a frame near 20 ms and still finish
ahead of the browser's 34.6 ms on five cores.

## The exact-coverage reference failed

An analytic reference — clip the polygon to each pixel square, take the
shoelace area — was written to measure how far each sample count sits from
exact. **It disagreed with every sampler by up to a full 255**, which is a
geometry-scale disagreement, not quantisation, so no accuracy figure from it is
quoted.

The cause is in the reference: at these angles a 120×800 bar spans
`120·cos11° + 800·sin11° ≈ 270 px` horizontally against a 180 px pitch, so
**the bars overlap**, and the reference accumulates coverage additively where
opaque overlapping shapes compose. Coverage adds only for disjoint geometry.

Sample counts and seam counts above are read directly off the rendered buffers
and do not depend on this reference.

## What a fix has to touch

The op is shared, so the blocker is format, not speed:

- **TRI is fixed at 7 words.** A convex-polygon op is variable length, which is
  a DrawList v1 → v2 change; every backend's decode loop takes a new case, and
  the op set is closed per version (`raster.rs` returns on an unknown opcode
  rather than guessing).
- **`esp32p4-ppa` delegates TRI to `software_op`** (`src/lib.rs:600`) — the same
  `raster.rs` the wasm host uses. One change covers the video renderer and that
  backend together.
- **PSP draws TRI in hardware**, batching consecutive ops into one
  `GuPrimitive::Triangles` (`hosts/psp/src/ge.rs:535`). The GE has no per-pixel
  coverage, so a polygon op degrades there to a triangle fan — today's output,
  unchanged.
- **No test asserts geometry byte-identity across backends.** `strip_parity.rs`
  compares strip against full render within one backend; the exactness
  requirement at `raster.rs:941` is written for glyph masks.

**Determinism is unaffected.** The variants are integer throughout — edge
functions in 4·w fixed point, quarter-pixel sample offsets as ±1/±3, `div_euclid`
for the span solve. No float enters the inner loop, so the frame-hash contract
carries over.

## What supersampling does instead

`supersample: N` already reaches 256 levels with no engine change, by rasterising
N× and box-averaging on the encode. It costs 16× rasterisation at N=4 because it
resamples **every** pixel. A polygon op spends its samples on boundary pixels
only, which is O(perimeter) against O(area) — the reason 17 levels comes out free.

The two are not alternatives at the same price point.
