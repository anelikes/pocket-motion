# Vector paths: the prototype, measured, 2026-10-22; the landing, 2026-10-23

These are the measurements behind
[`patches/0042-vector-paths.design.md`](../patches/0042-vector-paths.design.md).
Everything down to "Found along the way" is stage 1, the prototype, as it was
recorded; [the landing](#the-landing-2026-10-23) at the end is what the
patches `0042` and `0043` measured on the pin they apply to. The prototype
is [`vector-paths/prototype.diff`](vector-paths/prototype.diff): a PATH op
(71), a path table in `styles.bin`, thirteen style props, and the geometry
(morph, flatten, trim, stroke) in a new `engine/core/src/path.rs`, with 24
tests and 16 pinned scenes. It applies to the tree `scripts/vendor.ts` builds
at this revision (upstream e0b37e2 plus `patches/0001`-`0022`); this was
checked with `git apply --check` on a fresh clone. It was built in a scratch
copy, never in `vendor/`, because the pin is being moved by another branch
and `patches/` is not to be touched until that lands.

Machine: Apple M4, rustc 1.97.1 (rustup), Bun 1.3.11. The machine was shared
during the timing runs (load average 12-14 from other work); see "Cost" for
how that is handled.

## Reproducing

```
git clone https://github.com/pocket-stack/pocketjs.git pocketjs
git -C pocketjs checkout e0b37e2
for p in patches/*.patch; do git -C pocketjs apply "$PWD/$p"; done
git -C pocketjs apply "$PWD/baselines/vector-paths/prototype.diff"
cp -R baselines/vector-paths/pathwasm .      # the harness expects ../pocketjs
```

Use rustup's toolchain (1.97.1), not a Homebrew `cargo`; `scripts/vendor.ts`
explains why.

| what | command | output here |
|---|---|---|
| the core suite, with the pinned digests | `cd pocketjs/engine/core && cargo test --release` | `runs/core-tests-darwin-arm64.txt` |
| the printed measurements | `cargo test --release path_tests -- --nocapture --test-threads=1` | `runs/core-test-prints.txt` |
| native digests and costs | `cd pathwasm && cargo run --release --bin bench` | `runs/bench-native-darwin-arm64.txt` |
| wasm digests and costs | `cargo build --release --target wasm32-unknown-unknown --lib && bun run.mjs target/wasm32-unknown-unknown/release/pathwasm.wasm` | `runs/bench-wasm-darwin-arm64.txt` |
| linux/x86-64, native | `docker run --rm --platform linux/amd64 -v "$PWD/pocketjs:/src" rust:1.97.1-slim-bookworm sh -c 'cd /src/engine/core && cargo test --release'` | `runs/core-tests-linux-amd64.txt` |
| linux/x86-64, wasm | `docker run --rm --platform linux/amd64 -v "$PWD/pathwasm:/w:ro" oven/bun:1.3.11 bun /w/run.mjs /w/target/wasm32-unknown-unknown/release/pathwasm.wasm --digests-only` | `runs/wasm-linux-amd64.txt` |
| the guards | `python3 -I baselines/vector-paths/redcheck.py pocketjs/engine/core` | `runs/redcheck.txt` |

`redcheck.py` edits the core it is given one defect at a time and restores
each file after its run. Nothing else may build that tree while it runs.

The wasm harness is built the way patch 0022 builds the shipping core:
opt-level 3, lto, `+simd128`. The wasm used here has sha256 `92d03c94352e8e98…`
(`runs/wasm-sha256.txt`).

## Determinism

There are sixteen scenes, each with an FNV-1a 64 digest of its draw-list
words and one of its framebuffer. They were recorded on darwin/arm64 and are
pinned in `path_tests.rs`:

| # | scene | words | framebuffer |
|---:|---|---|---|
| 0 | fill-nonzero-star | `d03a0c3226e20ff9` | `2b13ba2c0869791d` |
| 1 | fill-evenodd-star | `00bb3a9823157fa0` | `feba9c5429f168f1` |
| 2 | fill-donut-rules | `77bc3337ec94df9b` | `d831a592ad4e4e0d` |
| 3 | stroke-joins-caps | `274a11eaed142578` | `9865aa5da5da96f9` |
| 4 | stroke-closed-round | `52604bf90d7b694e` | `c9702e8bf9178b4d` |
| 5 | stroke-tight-curvature | `329c490bf21551a0` | `2f1eedf8b975f2f2` |
| 6 | trim-each-sweep | `2bbe1a1ffab7be43` | `d323c06082d52f09` |
| 7 | trim-whole-offset-wrap | `f60ffa5d0fab5c45` | `536d786522c3af2f` |
| 8 | morph-circle-flower | `7443890eb10b693f` | `f2d0282db4b78595` |
| 9 | transform-rotate-skew | `40b41642889c6ad9` | `2cca2c314654cb32` |
| 10 | under-mask-paint-layer | `552d4f0333178c57` | `bb5836a02e7cc858` |
| 11 | abutting-tiles | `ff569918a3ff7c02` | `496ee364eac1c599` |
| 12 | dense-300-fill-stroke-x1 (stress, 1920×1080) | `0a439fe13bc1addc` | `6fa8f71daddca5b5` |
| 13 | dense-300-animated-x2 (stress, 3840×2160) | `6f61516deb6573e1` | `ca638f349590b4af` |
| 14 | flat-300-smooth-x1 | `cb3ec3d685960abe` | `b8682e1558ad2bc1` |
| 15 | lineart-300-animated-x1 | `5c988ac343fd07db` | `4b3ef5c12af3e9ea` |

All 32 are equal on all four targets:

| target | evidence |
|---|---|
| darwin/arm64, native | `cargo test --release`: 195 passed, `path_scene_digests_are_pinned` among them |
| darwin/arm64, wasm32 in Bun 1.3.11 | `runs/bench-wasm-darwin-arm64.txt` |
| linux/x86-64, native, `rust:1.97.1-slim-bookworm` | `runs/core-tests-linux-amd64.txt`: 195 passed |
| linux/x86-64, wasm32, `oven/bun:1.3.11` (linux/x64) | `runs/wasm-linux-amd64.txt` |

**What the x86-64 rows prove, and what they do not.** They ran under Docker
Desktop on Apple silicon, which translates x86-64 instructions rather than
executing them on x86 hardware. They show that the x86-64 code rustc and
JavaScriptCore generate gives the same bytes, under translation. The run on
real x86-64 hardware belongs to the landing: the fixture composition goes
into `baselines/digests.json`, and `.github/workflows/determinism.yml`
reproduces it on ubuntu x86-64 on every push, as it does for every other op.

The pictures are not tracked (`*.png` is ignored here). Every scene dumps as
raw RGBA with `PATH_DUMP=<dir> cargo test --release dump_scenes`, and
`ffmpeg -f rawvideo -pix_fmt rgba -s <W>x<H> -i <file> <file>.png` turns one
into a picture; the size is in each file's name.

## Cost

1920×1080, 300 paths × 67 cubics = 20,100 segments, each path a two-key
morph. Each cell gives the minimum over 25 runs (15 for ×2 and the hash),
then the median in brackets, in ms. The minimum is what the code costs; the
median is what a loaded machine charged for it.

wasm32 (shipping configuration), Bun 1.3.11, `runs/bench-wasm-darwin-arm64.txt`:

| frame | geometry | raster ×1 | raster ×2 | `ui_draw_hash` | words | flattened points | contour vertices |
|---|---:|---:|---:|---:|---:|---:|---:|
| stress, static | 12.00 (14.45) | 70.94 (87.65) | 127.30 (141.02) | 8.19 | 1,946,008 | 268,787 | 1,032,728 |
| stress, animated | 7.39 (7.62) | 41.71 (43.39) | 81.86 (95.52) | 4.71 | 1,158,310 | 250,832 | 612,788 |
| flat vector, static | 4.39 (4.64) | 21.46 (22.99) | 41.47 (43.06) | 2.79 | 686,776 | 94,616 | 352,366 |
| flat vector, animated | 3.16 (3.30) | 14.60 (16.89) | 32.24 (41.50) | 1.72 | 421,066 | 90,419 | 215,305 |
| line art, static | 5.34 (5.70) | 26.62 (31.39) | 53.83 (62.19) | 2.00 | 493,912 | 136,582 | 323,386 |
| line art, mid draw-on | 3.40 (3.71) | 12.78 (13.79) | 26.84 (29.00) | 1.06 | 264,226 | 128,984 | 157,708 |

Native aarch64, `runs/bench-native-darwin-arm64.txt`:

| frame | geometry | raster ×1 | raster ×2 | `ui_draw_hash` |
|---|---:|---:|---:|---:|
| stress, static | 8.45 (8.90) | 61.62 (64.91) | 111.21 (123.88) | 8.02 |
| flat vector, static | 3.82 (5.42) | 23.23 (34.05) | 52.80 (77.13) | 3.08 |
| line art, static | 4.10 (4.38) | 26.60 (30.67) | 53.40 (63.79) | 2.05 |

The three illustrations:

- **stress**: closed blobs of radius 20-160 px whose radius jumps by up to
  40% between neighbouring cubics, so they are spiky. Filled and stroked
  (1.5-6 px, round joins and caps). Their summed area is about 4.4 frames.
- **flat vector**: the same construction with radius 10-90 px and ±3% wobble.
  Smooth, about 1.4 frames by summed area.
- **line art**: open meandering curves, stroked only.

"Animated" is frame 17: every path at its own morph value, rotated, with a
trim window and offset moving.

### How the stress frame got from 117 ms to 62

These are native ×1 medians taken during development under the same shared
load, so read them as steps, not as precise values.

| change | raster | coverage only | what moved |
|---|---:|---:|---|
| first prototype: sort edges per op, divide per crossing, per-pixel difference arrays | 116.8 | 102.7 | 1.30 M edges, 5.72 M crossings, 16.0 M edge checks, 16.7 M pixel visits |
| bucket edges by first row; drop edges spanning no sample row; step crossings exactly (quotient and remainder) | 82.7 | 67.1 | 0.94 M edges |
| emit runs from a sweep of interval ends instead of per-pixel arrays | 80.1 | 68.2 | 9.2 M pixel visits; time unchanged |
| branchless interval walk, 32-byte edge records | 78.8 | 70.7 | unchanged: the guessed cause was wrong |
| merge the four sample rows' sorted runs in linear time (the insertion sort alone cost 28 ms) | 64.5 | 55.6 | |
| meet the offset lines at gentle joins (stroke geometry; digests re-pinned) | 58.7 | 50.3 | contour vertices 1.41 M → 1.03 M, words 2.66 M → 1.95 M |

Every step up to and including the merge left all 14 then-pinned digests
unchanged; the brute-force reference held each of them hit for hit. The last
step changes stroke outlines by design. For miter joins the pixels are
unchanged too (scene 3's framebuffer digest did not move); elsewhere the
change is under 1/256 px. Two profiling tools were used along the way. One
was `sample` on a looping binary. The other was variants with one stage
removed: coverage alone took 33 ms without the walk and 40 ms without the event sort.

## Correctness, as printed by the tests

`runs/core-test-prints.txt`:

- POLY vs PATH over 300 convex integer polygons: 3,429 of 960,934 covered
  pixels differ, by 4,664 on-edge samples. The test asserts that every
  differing sample lies exactly on an edge.
- Stroke union: 24,473,600 samples, 119 differ, the farthest 0.737/256 px
  from a piece edge.
- Trim growth: 1 pixel loses a sample over a 40-step draw-on.
- Chords over 360 angles: {537}. With a row-norm scale bound instead, 11
  distinct counts, from 457 to 537.

## Guards

`runs/redcheck.txt`: 33 defects, each introduced, run against the test named
beside it, and reverted. Every one is red:

    first crossing rounded down              path_coverage_equals_the_brute_force_reference
    DDA carry on zero remainder              path_coverage_equals_the_brute_force_reference
    closed y range (Y <= ybot)               path_coverage_equals_the_brute_force_reference
    closed y range vs partition              abutting_paths_partition
    sweep: partial head miscounted           path_coverage_equals_the_brute_force_reference
    sweep: full run one pixel short          path_coverage_equals_the_brute_force_reference
    merge drops a tail                       path_coverage_equals_the_brute_force_reference
    sample lattice offset 32 -> 16           convex_path_counts_what_poly_counts
    scale ignored                            convex_path_counts_what_poly_counts
    partial opaque pixel filled as opaque    path_blends_each_pixel
    outer join on the inner side             stroke_outline_fills_to_exactly_the_union
    inner meet regardless of length          stroke_outline_fills_to_exactly_the_union
    inner meet without the length margin     stroke_outline_fills_to_exactly_the_union
    round join merged too eagerly            stroke_outline_fills_to_exactly_the_union
    miter merged past its limit              miter_tip_sits
    round arcs: no bisection                 round_stroke_is_the_true_offset
    round cap faces backward                 round_stroke_is_the_true_offset
    bevelled miter drawn as a miter          miter_tip_sits
    full trim window not short-circuited     a_trim_window_of_the_whole_length
    wrapped closed piece split in two        trimmed_length_is_the_window
    trim cut not interpolated                trimmed_length_is_the_window
    morph lerp inexact at its end            morph_at_a_key
    morph key off by one                     morph_at_a_key
    scale bound by row norm                  chord_count_does_not_follow_rotation
    Wang bound quartered                     flattened_curve_stays_within_tolerance
    no guard clip                            emitted_coordinates_stay_inside_the_guard
    damage does not know PATH                damage_tracking_decodes_path
    damage bounds short by a pixel           damage_tracking_decodes_path
    table: first verb not checked            path_table_round_trips
    table: shape count not bounded           path_table_round_trips
    walk ignores the trim                    trim_end_animates_through
    bg-clip-path paints the box too          bg_clip_path_paints
    hidden node still draws its path         debug_hide_removes_both

Two of these were not red the first time round, and both were fixed before
this record:

- "morph lerp inexact at its end" left the test green, because it compared
  emitted words, and 1/256 px quantisation hides an ulp. The test now
  compares the points bit for bit.
- "hidden node still draws its path" could not run at first: its anchor
  matched both of `draw.rs`'s hide checks.

## Found along the way, outside this design

Upstream's `framework/compiler/bake-svg.ts` applies an SVG `transform` list
leftmost-first, the reverse of SVG's order. Under `translate(10,0)
rotate(90)`, a 2×2 square on a 16×16 canvas draws no pixel, where SVG places
it at x 8-10; under `rotate(90) translate(10,0)` it lands at x 8-9, y 0-1.
That is SVG's position for the other order. The reproduction is
`vector-paths/bake-svg-transform-order.ts`. The same function calls
`Math.cos`/`Math.sin` for `rotate()`, whose results JavaScriptCore does not
guarantee across hosts. Neither is in this repository's path, unless a
composition bakes an SVG image with a rotate. A path importer must not reuse
either.

## The landing, 2026-10-23

`patches/0042-vector-path-op.patch` (the core) and
`patches/0043-path-component.patch` (the declaration), applied after
`0001`-`0041` to 66caf4e5. Machine as above; the timing below was not re-run.
During this work the machine carried other sessions' builds at load averages
of 70 to over 300, which is why nothing here is a time.

### Reproducing

```
bun scripts/vendor.ts                                     # 66caf4e5 + every patch, wasm built
cd vendor/pocketjs/engine/core && cargo test --release    # the core suite, the path tests among it
python3 -I baselines/vector-paths/redcheck.py <a scratch copy of vendor/pocketjs>/engine/core
bun baselines/vector-paths/redcheck-ts.ts                 # rebuilds vendor/ from edited patches, restores it
bun test tests/vector-paths.test.ts tests/catalog.test.ts
bun scripts/digests.ts --only vector-paths && bun scripts/visibility.ts --only vector-paths
```

`redcheck.py` edits the tree it is given, so give it a copy, never `vendor/`.

### What the rebase moved

Measured, each by running it rather than by reading the diff:

- **Ids.** PROP 183-186 and 198 were taken by `0027`, `0029`, `0033` and
  `0034`; the props are 199-211. Main's `skewX` (anim bit 38) moved the
  paint bits by one, so the seven animatable ones are bits 58-64. The op is
  still 71; `styles.bin`'s offset 10 was still reserved.
- **Scene 10 and the masked-path test** wrote MASK_PUSH in the format `0024`
  replaced (`N` packed whole-pixel words, now `2 + 2N` f32 words). On the
  rebased core the stream stopped at the mask: scene 10's framebuffer digest
  moved, and `path_under_a_mask_is_the_rect_under_that_mask_where_it_covers`
  stayed green while comparing two grounds. Both now write the mask through
  `path_scenes::mask_push`, and the test asserts the mask let paint through
  (red with the old format, below).
- **Scene 10's pixels, attributed.** With the mask written correctly, the
  scene's framebuffer is `0x0462be5553bf994d`, not stage 1's
  `0xbb5836a02e7cc858`. With `0032`'s exact divisor reverted in both of its
  places (`RgbaTarget::blend` and `composite_layer`), it is
  `0xbb5836a02e7cc858` byte for byte: the move is `0032`'s, in the layer's
  content-over-shadow composite. The words digest moved with the mask's
  words, `0x552d4f0333178c57` to `0xc460f9c5923e4dab`. Re-pinned; the other
  fifteen scenes reproduce stage 1's thirty digests unchanged.
- **Two more draw-list walkers.** Upstream added `compositor::draw_op_len`
  and `Ui::compositor_surface_frames`, each with its own op-length table and
  each ending its walk at an op it does not know. Both learn PATH, and
  `every_draw_list_walker_steps_over_a_path` holds them.
- **`fmath::sqrtf`** is on the pin; `path.rs` calls it behind a NaN guard.
- **Arcs** are 45-degree cubics, not stage 1's 90: a quarter-turn cubic
  through `M100 50 A50 50 0 1 1 0 50 …` is 0.0136 px off its circle at
  r = 50 (2.7e-4 r), an eighth 0.00021 px (4.2e-6 r), measured by sampling
  each cubic at 101 points against the circle.

### The core suite and the scenes

`cargo test --release` in `engine/core` of 66caf4e5 + 0001-0043: **291
tests pass**, the 25 path tests among them — stage 1's 24 and
`every_draw_list_walker_steps_over_a_path`. The four printed measurements
(`runs/core-test-prints-0042.txt`) are stage 1's to the digit: POLY against
PATH, 3,429 of 960,934 covered pixels differing by 4,664 on-edge samples;
the stroke union, 119 of 24,473,600 samples within 0.737/256 px of a piece
edge; one pixel losing a sample over a 40-step draw-on; one chord count,
537, over 360 angles.

The sixteen pinned scenes: fifteen reproduce stage 1's thirty digests;
scene 10 is re-pinned at `(0xc460f9c5923e4dab, 0x0462be5553bf994d)` for the
two reasons above. The darwin/arm64 wasm row was re-run with stage 1's
harness (`pathwasm`, unchanged, built against the landed core with the
shipping flags): **16 of 16 scenes equal the pinned native digests**
(`runs/wasm-darwin-arm64-0042.txt`). The two x86-64 rows, which stage 1 ran
under translation, were not re-run; the fixture below is what the
determinism workflow reproduces on x86-64 hardware.

### Guards

Both harnesses run each defect's test on the unedited tree first and stop
if it is red, so a RED below cannot be a test that fails anyway.

- **The core**, `redcheck.py` (`runs/redcheck-0042.txt`): stage 1's 33
  defects with their anchors moved to the rebased code, and five added at
  the landing — the compositor's op table and the surface-frame walk each
  not knowing PATH, the table's count read and its entries skipped, the
  scenes' mask written in the format 0024 replaced, and a gradient fill
  painted without its PAINT_PUSH. **38 of 38 red.**
- **The host**, `redcheck-ts.ts` (`runs/redcheck-0043.txt`): an edit to one
  `+` line of `0043`, the vendored tree rebuilt from the edited patch and
  restored afterwards, or an edit to `src/vendor/draw-ops.ts`. **15 of 15
  red**, against `tests/catalog.test.ts` (G6, G9), `tests/vector-paths.test.ts`
  and `tests/patches.test.ts`. Two things the first pass found are in the
  record rather than smoothed over: the reverse-order promotion branch had
  no probe (its edit stayed green until the catalogue gained one), and
  `tan(alpha/4)` through `Math.tan` stays green on this host — the same bits
  — so the pinned arcs are a cross-host check and not a one-host guard.
- **A baseline that was red for a reason outside the code.** The host
  harness's first baseline found the control test red: the harness was
  started with `POCKETJS_ROOT` naming the main checkout's vendored tree (for
  `vendor.ts`'s clone), and `src/runtime/boot.ts` takes its core from that
  variable, so the test booted a core with no PATH op and drew nothing. The
  test now pins it, as `tests/shutter.test.ts` does, and the harness keeps it
  out of every test it runs.

### The fixture

`compositions/vector-paths`, 1920×1080, 120 frames at 30 fps: a signature
drawn on by `trimEnd`, a blob morphing between a circle and a star under a
gradient fill, six wedges sharing their edges, a wireframe turning in a
viewBox with a trimmed ring orbiting it, and a wave morphing under an
`overflow-mask` window (its `NOTES.md` says what each took). Eleven outlines
baked. Recorded in `baselines/digests.json` as
`2039a98fdcc6679572c599626c5c589badd942bd96ed4a1cb2f1b7e030601015` and
reproduced by a fresh build and trace; in `baselines/visibility.json` with 17
named nodes, none never shown, none buried. `verify`: 0 errors, 0 warnings,
nine assertions holding; `check`: 0 ops after mount over 30 frames.
