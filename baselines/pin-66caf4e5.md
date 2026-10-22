# The pin bump to 66caf4e5: what moved and why

Measured 2026-10-22, moving `UPSTREAM.commit` from `e0b37e2` to `66caf4e5`
(pocket-nexus/pocketjs main), Bun 1.3.11, macOS arm64.

## Digest ledger

36 compositions; 31 reproduce byte for byte, and every generator's output
came back byte-identical. Five moved, and each was attributed by reverting
the upstream change in a copy of the vendored core, rebuilding the wasm and
re-tracing against the same bundle: a composition is accounted for when the
reverts together give back its old digest exactly.

| composition | frames that moved | cause | revert that restores the old digest |
|---|---|---|---|
| `probe` | 2 of 2 | scaled glyph pages (119297b3): the `scale-150` row's text is drawn from resampled cells, ink 385x48 -> 431x72 | scaled-text path off |
| `transitions` | 40 of 756 (96-120, 466-481) | scaled glyph pages: exactly the spans of its two 800 ms scale animations (a6, a7) | scaled-text path off |
| `rename-card` | 71 of 180 (43-113) | disc sampling (3e9278a4, #341): disc textures sample bilinearly with white RGB padding; a 6 px `rounded-full` dot on a half pixel at render scale 2 | disc texture back to nearest, unpadded |
| `timeline` | 736 of 854 | disc sampling, scaled glyph pages, and rounded-border textures (41dc68df, #452) on its 16 px and 12 px bordered circles | all three: disc, scaled text, border-texture path off |
| `gradients` | 30 of 30 | `via-*` under `bg-gradient-to-r` compiles to upstream's middle stop (99af2166) and draws as two GRAD_RECTs, where 0019 drew it through the paint (`patches/README.md`, 0019) | building with 0019's old rule, a via always taking the paint |

Two expected causes moved nothing: the ToTop/ToLeft lerp of 99af2166
(reverting it changed no frame of any of the five), and the bundle root
(`root: process.cwd()` in `tools/build.ts`; bundle bytes are not in the
frame digest).

## Visibility ledger

One row moved: `timeline`'s `buriedAfterShown`, 0 -> 2, both unnamed text
runs ("Sep. 9 ’25" at sampled frame 148, "Layout finding codes" at 556).
On the old pin those frames read them as invisible by declaration (no
geometry); now they read as covered (geometry, no pixel). The scaled-text
path tests each cell against the clip with unrounded edges, so a cell
overlapping an `overflow-hidden` edge by under a pixel is emitted and then
scissored away, where the old path's rounded anchors dropped it. With the
scaled-text path off the count is 0 again. No named node moved, so the gate
is unchanged.

## 0006

Dropped on a byte comparison, `patches/README.md` has the numbers: 252
atlases, nine faces, 14 sizes, two densities, 0 bytes different between
0006's rasteriser and upstream 8188d16a's.
