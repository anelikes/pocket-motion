# The baked glyph atlas against a browser, 2026-08-18

Apple M4. Subject: the same font file, the same string, at 16/24/32/48/64 px,
white on black at 1920×1080, rendered by `pocket-motion` (baked bitmap cells)
and by HyperFrames 0.8.2 (Chrome/Skia, vector outlines).

Latin uses `assets/fonts/HarmonyOS_Sans_Regular.ttf`, CJK uses
`assets/fonts/NotoSansSC-Regular.otf` — a CFF face, so it also exercises the
outline format `patches/0006` is about.

Reproducers: `compositions/textcmp-latin` and `compositions/textcmp-cjk` (both
in the digest ledger), and [`hyperframes-scene.html`](glyph-fidelity/hyperframes-scene.html).

## The instrument was wrong first

The first run put both scripts in HarmonyOS Sans. **That font's cmap carries no
CJK** — 0 of the 13 characters — so Chrome silently fell back to a system face
and the CJK half compared a different font against `pocket-motion`'s HarmonyOS
bake. The scene now assigns a font per script and **declares no generic
fallback**, so a coverage gap renders tofu instead of passing as a rendering
difference.

## Advances match

Per size band, ink extent from leftmost to rightmost pixel:

| size | Latin motion / browser | ratio | CJK motion / browser | ratio |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 221 / 220 | 1.0045 | 212 / 211 | 1.0047 |
| 24 | 334 / 330 | 1.0121 | 316 / 317 | 0.9968 |
| 32 | 441 / 441 | **1.0000** | 421 / 421 | **1.0000** |
| 48 | 660 / 660 | **1.0000** | 632 / 631 | 1.0016 |
| 64 | 880 / 880 | **1.0000** | 841 / 841 | **1.0000** |

**Exact at 32 px and above**, sub-pixel below it. The atlas's advance table and
the browser's shaping put the same string in the same width. Metrics are not
where the baked path is behind.

## Coverage is quantised to 27 steps

Distinct non-zero luminances in the rendered glyphs, every size:

| | levels | share of ink that is a partial pixel |
| --- | ---: | --- |
| `pocket-motion` | **27** | 30.1% at 64 px → 82.9% at 16 px |
| browser | 249–255 | 34.5% at 64 px → 88.2% at 16 px |

27 is not a coincidence and not the atlas's depth, which is 8-bit. It is the
supersample grid in `framework/compiler/bake-font.ts`:

```ts
const SS_X = 9; // horizontal subpixel samples per pixel
const SS_Y = 3; // vertical samples per pixel
out[row * cellW + x] = Math.round((counts[x] * 255) / samplesPerPixel);
```

9 × 3 = 27 subsamples, so coverage takes 28 values and 27 of them are ink.

**Raising it is free at render time.** The cell stays one byte per pixel and the
rasteriser is unchanged; only the build-time bake gets slower. The knob is two
constants.

## Nothing asks for the knob to be turned

Zoomed 5× at 32 px and 11× at 16 px — the size where 83% of the ink is edge and
quantisation should show worst — the two renderings are close enough that
neither reads as the coarser one. `pocket-motion`'s stems are slightly lighter
and the browser's slightly softer, with no banding on either.

So the answer to "is the bitmap atlas the structural quality gap": **on these
two axes it is not one.** Do not spend the bake time until something points at a
defect it would fix.

## Pair kerning is not applied, and the cost is exactly the font's numbers

The advance table matching is not the same claim as kerning matching: the string
above, `Hamburgefonstiv 0123456789`, contains none of the classic pairs. Those
were measured separately — the fourteen pairs from
[`phase1_5-kerning-trigger.md`](phase1_5-kerning-trigger.md), one per line at
64 px, same font file on both sides, `font-kerning: normal` and ligatures off in
the browser so only pair adjustment separates them
([`hyperframes-kern.html`](glyph-fidelity/hyperframes-kern.html),
`compositions/textcmp-kern`).

`unitsPerEm` is 1000, so a pair's declared value in units is its predicted pixel
shift at 64 px divided by 15.6:

| pair | declared | predicted px | motion | browser | measured |
| --- | ---: | ---: | ---: | ---: | ---: |
| `P.` | −143 | −9.2 | 44 | 35 | **9** |
| `F,` | −131 | −8.4 | 44 | 35 | **9** |
| `LT` | −128 | −8.2 | 67 | 59 | **8** |
| `Ta` | −115 | −7.4 | 67 | 60 | **7** |
| `To` | −110 | −7.0 | 71 | 65 | **6** |
| `r.` | −103 | −6.6 | 31 | 25 | **6** |
| `Yo` | −100 | −6.4 | 74 | 68 | **6** |
| `AV` | −85 | −5.4 | 84 | 79 | **5** |
| `VA` | −85 | −5.4 | 84 | 79 | **5** |
| `W.` | −74 | −4.7 | 73 | 68 | **5** |
| `Wa` | −74 | −4.7 | 93 | 88 | **5** |
| `Av` | −37 | −2.4 | 75 | 73 | **2** |
| `av` | −9 | −0.6 | 64 | 64 | **0** |

**Every pair lands within a pixel of its prediction.** The baked path applies no
pair adjustment; the browser applies all of it from GPOS. This is the same
conclusion `phase1_5-kerning-trigger.md` reached from the font tables, now
confirmed in rendered pixels.

The fourteenth pair, `ry`, is clipped off the bottom of the motion frame —
its line spacing is wider than the browser's — and its declared value is 0, so
nothing rests on it. The 13 above are index-aligned, which the correlation
itself confirms: a misalignment anywhere in the middle would have destroyed it.

So Phase 1.5's decision is no longer an aesthetic one. The cost of shipping
HarmonyOS Sans without kerning is the font's own numbers, up to −14.3% em on a
pair and, per that record, −0.197 em across one line of the reel's own copy.

## Related, and not the same question

Upstream `e0b37e2` adds `TEXT_RUN` (opcode 9) for native text layout, but its
contract excludes this renderer by construction:

> Emitted ONLY when the host installed a native text measurer … every other run
> keeps GLYPH_RUN, so fixed-function backends (PSP GE, PPA, software raster)
> never see this op.

The video path keeps the baked atlas. What upstream did add is a **text provider
recorded per node**, which is a seam a different text path could attach to.

## Not measured

- **Motion.** Both samples are static. Sub-pixel motion is where a baked cell
  cannot follow a glyph between pixels, and `AUTHORING.md` already tells authors
  to raise `supersample` when text moves slowly. That advice has never been
  measured against a browser doing the same move.
- **`supersample: N` with `--density=N`.** Every figure here is 1×. The
  density-mismatch trap is documented and the advance tables are known not to
  agree across densities; neither is quantified.
