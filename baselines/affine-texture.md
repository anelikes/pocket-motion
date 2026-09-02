# Affine texture sampling — what the grid workaround is worth, 2026-08-18

Apple M4, rustc 1.93.1, `opt-level=3 lto=true codegen-units=1`, native aarch64.
Subject: an 800×600 textured quad at 1920×1080, rotated about Y, perspective
distance 1000 — the `fz` factor `draw.rs` itself uses. Error is UV displacement
in texels of a 256×256 texture, against exact per-pixel perspective correction.

Reproducer in [`affine-texture/`](affine-texture/). Its inner loop mirrors
`raster.rs` `tex_tri`: integer edge functions, `inv_area` hoisted, f32
barycentric weights, f32 UVs.

## What ships today

`TEX_TRI` interpolates UV affinely in screen space — `spec.ts` calls this
"PSP-authentic; no perspective-correct divide". A foreshortened quad's interior
texture lines kink along the triangle diagonal, so `draw.rs:1284` subdivides the
quad into an `nx × ny` grid sized by the per-axis perspective variation, capped
at 8×8, and gives each cell's corners projectively correct UVs.

## What each approach is worth

| rot-y | grid | affine, 2 ops | grid, today | per-pixel divide, 2 ops | segmented /16, 2 ops |
| ---: | :---: | ---: | ---: | ---: | ---: |
| | | mean / max | mean / max | | mean / max |
| 20° | 6×1 | 13.40 / 24.88 | 1.08 / 3.34 | **exact** | 0.005 / 0.012 |
| 40° | 8×1 | 25.18 / 47.32 | 1.57 / 5.35 | **exact** | 0.013 / 0.044 |
| 60° | 8×1 | 33.93 / 64.71 | 2.29 / 8.02 | **exact** | 0.037 / 0.163 |
| 70° | 8×1 | 36.81 / 70.62 | 2.56 / 9.04 | **exact** | 0.082 / 0.394 |

The grid comes out `8×1` rather than `8×8` because a Y-rotation varies the
projection along one axis only — `vvar` is 1, so `seg` returns 1 for it.

Cost at 40°, median of five runs of 200 iterations:

| | ms/quad | ops | vs affine |
| --- | ---: | ---: | ---: |
| affine (today, per triangle) | 0.961 | 2 | 1.00× |
| **grid 8×1 (today, per image)** | **1.047** | **16** | 1.09× |
| **perspective-correct per pixel** | **1.043** | **2** | 1.09× |
| segmented, exact every 8 px | 1.322 | 2 | 1.38× |
| segmented, exact every 16 px | 1.249 | 2 | 1.30× |
| segmented, exact every 32 px | 1.231 | 2 | 1.28× |

Natively the divide costs what the workaround costs. **That does not survive the
move to wasm** — see below, and read the wasm table as the operative one.

**Segmented correction loses on both targets.** Recomputing the edge functions at
each segment boundary costs more than the divide it avoids, so every segment
length measured is slower than simply dividing.

## In the profile that actually ships

`engine/wasm` builds `opt-level = "s"`, lto, to `wasm32-unknown-unknown`. The
same benchmark compiled that way and run under Bun
([`bench-wasm.rs`](affine-texture/bench-wasm.rs), [`run-wasm.ts`](affine-texture/run-wasm.ts)),
median of five runs of 200 iterations, accepted-pixel counts within 0.1% across
variants:

| rot-y | cells | affine | grid (today) | per-pixel divide | segmented /16 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20° | 6 | 0.985 ms | 1.065 (1.08×) | 1.194 (**1.21×**) | 1.443 (1.46×) |
| 40° | 8 | 0.929 | 0.989 (1.06×) | 1.094 (**1.18×**) | 1.229 (1.32×) |
| 60° | 8 | 0.705 | 0.701 (0.99×) | 0.832 (**1.18×**) | 0.993 (1.41×) |
| 70° | 8 | 0.514 | 0.519 (1.01×) | 0.605 (**1.18×**) | 0.731 (1.42×) |

**The ordering of the divide and the workaround inverts here.** Natively they
tie; in wasm the grid runs at 0.99–1.08× affine and the per-pixel divide at
1.18–1.21×, so **correction costs roughly 12–19% more than the workaround it
would replace**, on textured quads.

Segmented correction does not invert — it stays the slowest option on both
targets, which was the specific risk worth checking.

Two things the wasm numbers show that the native ones hid. Above 60° the grid is
**free**, running at 0.99–1.01× plain affine despite emitting 16 ops instead of
2: subdividing tightens each triangle's bounding box, so fewer pixels are tested
and rejected, and that repays the per-triangle setup. And wasm's f32 divide is
expensive enough relative to its multiplies to be visible at all, which on
aarch64 it is not.

So the case for perspective correction is **not** a free win. It is exactness
(up to 9 texels of residual error goes to zero), 2 ops in place of 16, and the
deletion described below — bought at 12–19% on textured-quad rasterisation.

## The constraint that was assumed and is not there

Perspective correction was set aside on the belief that the rasteriser is
integer-only and a per-pixel divide would break the frame-hash contract. **That
is true of the geometry path and false of the textured one.** `tex_tri` already
runs f32 in its inner loop — `inv_area` is a hoisted f32 divide, UVs arrive as
`f32::from_bits` out of the op words, and each pixel already costs six f32
multiplies and four adds:

```rust
let (f0, f1, f2) = (w0 as f32 * inv_area, w1 as f32 * inv_area, w2 as f32 * inv_area);
let u = u0 * f0 + u1 * f1 + u2 * f2;
let v = v0 * f0 + v1 * f1 + v2 * f2;
```

Perspective correction interpolates one more quantity the same way and divides
once. It is the arithmetic already there, not a new kind, and IEEE-754 division
is exactly rounded — the same basis on which the existing `inv_area` reproduces
across platforms.

The integer discipline that does bind is `tri` and `poly`, the coverage path.
See [`tri-coverage.md`](tri-coverage.md).

## The cap is doing more of the work than the divide would

`seg` caps the subdivision at 8 segments per axis. Nothing measured that
number. Sweeping it in wasm ([`cap-wasm.ts`](affine-texture/cap-wasm.ts)):

| rot-y | cap | cells | ms | mean err | max err |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 40° | **8 (today)** | 8 | 0.989 | 1.574 | **5.347** |
| 40° | 16 | 12 | 0.982 | 1.025 | 3.596 |
| 40° | 32 | 12 | 0.987 | 1.025 | 3.596 |
| 40° | per-pixel divide | — | 1.102 | exact | exact |
| 70° | **8 (today)** | 8 | 0.494 | 2.558 | **9.037** |
| 70° | 16 | 16 | 0.521 | 1.241 | 4.648 |
| 70° | 32 | 20 | 0.530 | **0.988** | **3.742** |
| 70° | 64 | 20 | 0.528 | 0.988 | 3.742 |
| 70° | per-pixel divide | — | 0.610 | exact | exact |

**Raising the cap to 32 takes the worst case from 9.0 texels to 3.7 for about
7%** — a one-line change to `min(8.0)`. The per-pixel divide buys the remaining
3.7 for 16–36%.

The cell count saturates before the cap does: `seg` is `1 + (v - 1) · 16`, which
reaches 20 at 70° and stops, so 64 measures the same as 32. Raising the cap
past 32 changes nothing without also changing that slope.

**Run-to-run spread is wide enough to matter here.** The affine baseline this
sweep divides by measured ~13% below the one in the table above, so read the
ratios within a row and the absolute ms across rows, not the ratios across
tables.

## Nothing in this repository paints it

Every figure above is a synthetic quad. Walking the real DrawList per frame
([`mesh-probe.ts`](affine-texture/mesh-probe.ts), which needs two temporary wasm
exports the file documents) gives the load that actually occurs:

| composition | frames | frames with a subdivided mesh | max cells | TEX_TRI ops |
| --- | ---: | ---: | ---: | ---: |
| `probe` | 2 | 2 (100%) | **3** | 12 |
| `reel` | 1071 | **0** | 0 | **0** |
| `smoke` | 450 | 0 | 0 | 0 |

Five further compositions were walked at the same time — every one then in the
ledger at film length, 450 to 1440 frames each — and every one of them reported
zero frames with a subdivided mesh and zero `TEX_TRI`. They are no longer in
the tree; the three rows above are the ones a reader can reproduce, and they
carry the finding on their own.

**Only `probe`, a two-frame diagnostic, emits a textured mesh at all, and it
subdivides to 3 cells** — against the 8 the synthetic 800×600 quad reaches at
the same 40°, because subdivision is sized by the perspective variation across
the quad and `probe`'s image is smaller.

`reel` is the surprise. Its room turns through `rotateY` 0 → −90 → −180, so it
sweeps every angle the error table covers, and it emits **389 POLY and 21170
TEX_QUAD across 1071 frames and not one TEX_TRI**: its images stay axis-aligned
and only the solid walls enter perspective.

The table was taken at pin `272b1a9`, where POLY was opcode 9. Upstream then
took 9 for `TEXT_RUN` and POLY moved to 10, so the walker read POLY as a
`TEXT_RUN` header and skipped by that op's length instead — a silent desync,
not a failure. `mesh-probe.ts` now reads both from `engine/core/src/spec.rs`.
The counts above stand: they were correct at the pin they were taken at, and
`reel`'s 389 POLY is the same figure the ledger reproduces today.

So the 12–19% the divide would cost, and the 7% the higher cap would cost, are
both charged against a case that does not occur here. Neither is worth building
until a composition paints a foreshortened image — and the instrument to notice
when one does is the probe above.

## What a fix would change

It **removes** code rather than adding it: the grid subdivision at
`draw.rs:1284`, its `seg` / `hvar` / `vvar` sizing, and the `TexCell` machinery
that carries cells to the emit stage all exist to approximate what one divide
computes exactly. `TEX_TRI` grows a per-vertex perspective factor — three f32
words, 12 → 15 — and the depth-sorted cell mesh collapses back to one quad.

Backends that cannot divide per pixel keep the affine path they have; the
polygon op in `patches/0008` set the precedent that a weaker backend degrades
rather than capping the op set.

## Not measured

- **A whole frame.** Both tables time one textured quad in isolation. What a
  12–19% figure on that stage is worth depends on how much of a composition is
  foreshortened image, which no composition here has been measured for.
- The segmented variant recomputes edge functions at segment boundaries instead
  of stepping them incrementally. A tighter version would narrow the gap to the
  per-pixel divide; it cannot beat it on accuracy.
- Whether tightening bounding boxes alone — subdividing without the projective
  corner UVs — would recover most of the grid's speed is untested, and it is the
  cheapest thing to try next.
