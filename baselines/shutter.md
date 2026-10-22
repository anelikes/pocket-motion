# Shutter prototype: measurements, 2026-10-22

The numbers behind [`docs/shutter.design.md`](../docs/shutter.design.md).
Reproducers are in [`shutter/`](shutter/):

- `prototype.diff`: the core and wasm change
- `harness/`: the scripts that measured
- `scene-blur/` and `scene-heavy/`: the two scratch scenes
- `results/`: every JSON quoted here
- `pictures/`: the images

Nothing here is a patch. The prototype lives in a scratch copy of the
vendored tree.

## Setup

- Apple M4 (10 cores), macOS. Bun 1.3.11. rustc 1.97.1 for
  `wasm32-unknown-unknown` with `+simd128` (the crate's own
  `.cargo/config.toml`).
- Vendored tree: pin `66caf4e5` plus `patches/0001`–`0022`, produced by
  `bun scripts/vendor.ts` at commit `47b79ea`. Copied out with
  `rsync --exclude node_modules --exclude target`, and `prototype.diff`
  applied to the copy: 418 added lines in `engine/core/src/{anim,lib,shutter}.rs`
  and `engine/wasm/src/lib.rs`. The prototype wasm's sha256 is `c4796243…`.
- The machine was shared with other sessions throughout. The load average was
  9–12 on 10 cores during every timing, so the timings are the fastest of 3
  repetitions per frame, reported as median and minimum over the frames.
  Digests do not depend on load.

### Reproduce

```sh
# S is any scratch directory; W is this checkout
rsync -a --exclude node_modules --exclude target "$W/vendor/pocketjs/" "$S/pj/"
ln -s "$W/vendor/pocketjs/node_modules" "$S/pj/node_modules"
git -C "$S/pj" apply "$W/baselines/shutter/prototype.diff"
(cd "$S/pj/engine/wasm" && PATH="$(dirname "$(rustup which cargo)"):$PATH" \
  cargo build --release --target wasm32-unknown-unknown)
cp "$S/pj/engine/wasm/target/wasm32-unknown-unknown/release/pocketjs_wasm.wasm" "$S/pj/hosts/web/pocketjs.wasm"

# The scenes build like any composition once they sit under a compositions/
# directory whose parent has vendor/ and assets/.
mkdir -p "$S/proto/compositions"
for s in blur heavy; do cp -R "$W/baselines/shutter/scene-$s" "$S/proto/compositions/$s"; done
ln -s "$W/vendor" "$S/proto/vendor"; ln -s "$W/assets" "$S/proto/assets"; ln -s "$W/node_modules" "$S/proto/node_modules"
bun "$W/src/cli/main.ts" build "$S/proto/compositions/blur"
bun "$W/src/cli/main.ts" build "$S/proto/compositions/heavy"

D="$S/proto/dist/compositions/blur"
POCKETJS_ROOT="$S/pj" bun "$W/baselines/shutter/harness/shutter.ts" --repo "$W" \
  --bundle "$D/main.js" --pak "$D/main.pak" --w 1920 --h 1080 --fps 30 --frames 90 \
  --angle 180 --n 1,4,8 --exempt label-crisp --reference --json out.json
```

`harness/bench-all.sh`, `harness/bakerate-all.sh` and
`harness/determinism.sh` run the tables below. Each script's header names
its arguments.

## 1. One sample is the unblurred frame

- **The prototype scene.** At N=1 the prototype's digest is `015b2653…`. The
  repository's `trace` gives the same digest for the same bundle with the
  pin's wasm.
- **The canonical state survives every exposure.** After each exposure, a
  plain `ui_render_scaled` equals the N=1 picture on every frame of every run
  (`restoreMismatch: 0` in every result file).
- **No composition without a shutter moves.** `trace` was run on 11
  compositions with the prototype's wasm and with the pin's: `alpha`,
  `curves`, `filters`, `glow`, `gradients`, `masked`, `reel`, `spanned`,
  `stroke`, `timeline` and `transitions`. Each gives the same digest under
  both. Four of them disagree with the ledger at this commit even with the
  pin's own wasm (section 9).

## 2. Pictures

- `pictures/scene-f015-n1-n4-n8.png`: frame 15 of the prototype scene at
  N=1, 4 and 8, 180°. The ring rotates 720°/s, so a form 400 px from the
  centre moves ~167 px per frame. Its blur is tangential and centred on the
  N=1 position.
- `pictures/ring-f015-n1-n4-n8-n16.png`: native-resolution crop of the ring
  at N = 1, 4, 8 and 16. Sample spacing is 21, 10.5 and 5.2 px. At N=16 the
  steps are still visible on the white form's edge.
- `pictures/labels-f007-n1-n8.png`: two identical labels on the same
  ease-in-out whip, at N=1 (top two) and N=8 (bottom two). `MOTION` blurs
  ~33 px. `CRISP` is held (the prototype's stand-in for `shutter-hold`) and
  is byte-identical to N=1.
- `pictures/jumps-360-n1-subtick-hz240.png`: the jump cases at 360°. Columns
  are N=1, sub-tick N=8, and 240 Hz bake N=8. Rows are frames 15 (teleport),
  24 (one-tick flick), 30 and 60 (gated dot). The 240 Hz column turns the
  one-tick flick into four ghost copies. The sub-tick column leaves it as a
  jump.

## 3. What each case does

Pixels in each region that differ from N=1, over all 90 frames, 180°
(`results/blur-reference-regions.json`):

| region | N=4 | N=8 | reading |
| --- | ---: | ---: | --- |
| static caption | 0 | 0 | a region no sample changes is byte-identical |
| ring (spin) | 93 342–101 839 | 106 543–116 284 | full blur on every frame, through every spin wrap |
| teleport (zero-length) | 492–892 | 492–892 | 492 on the frames before each jump and loop wrap: the samples ahead are clamped, giving half an exposure and no streak |
| flick (one-tick segment) | 0 | 0 | a one-tick segment is a jump, so there is no streak |
| gated dot | 0–1684 | 0–1952 | 0 while the gate is shut; the opacity is the frame's own |
| label, unheld | 3758–25 601 | 3754–27 223 | follows the whip's speed |
| label, held | 0 | 0 | byte-identical |
| sweep | 642–13 434 | 844–14 680 | follows the ease-in-out speed |

The core's exposure equals a JS reference with the same arithmetic on 180 of
180 frames (N=4 and N=8 over 90 frames).

## 4. A higher bake rate instead

### 4a. The unblurred film moves

Each composition is built once at `--hz=60` (the CLI's argv) and once at
`--hz=240` (the same argv from its `build.json`, with only the rate changed).
Both are read at the same instants: 240 Hz clock `4c` is 60 Hz clock `c`.
There is one sample, no shutter (`harness/bakerate.ts --n 1`):

| composition | frames that differ |
| --- | ---: |
| `transitions` | 175 / 756 |
| `shutter` | 29 / 150 |
| `rename-card` | 48 / 180 |
| `reel` | 655 / 1071 |
| `curves` | 290 / 420 |
| prototype scene | 0 / 90 |

Every delay, duration and keyframe stop in the prototype scene rounds to the
same instant at both rates, which is why it is the one that does not move. The 60 Hz digests through this harness
equal the ledger for `reel` and `curves`. `shutter` and `rename-card` are
supersample 2 and were read at scale 1 for both bakes alike.

### 4b. What whole-tick samples do to a jump

Pictured in `pictures/jumps-360-n1-subtick-hz240.png`. At 180° and 30 fps the
exposure, (c − ½, c + ½), never reaches the even ticks where the scene's jumps
sit, so the two approaches give the same pictures there. At 360° it does reach
them. At frame 24 the 240 Hz bake samples ticks 192–199 of its own clock,
and the flick's one-tick segment is the ramp 196–200 at that rate. Five
samples see the box at 0 px and three see it at 125, 250 and 375 px, so the
picture is three dim copies beside a box at 5/8 strength.

## 5. Holding opacity versus integrating it

On `compositions/rename-card` at supersample 2, 180°, N=8
(`results/rename-card-opacity.json`), with the prototype's measurement-only
`ui_shutter_integrate_opacity`:

- 17 of 180 frames differ from N=1 under the hold rule. That is transform
  motion.
- Integrating opacity as well changes 23 of 180 frames.
- The deltas are small. Frame 13: 3304 px, at most 8/255, and 1260 px lit
  where N=1 shows ground (a gate opening early). Frame 31: 2466 px, at most
  1. Frame 45: 40 991 px, at most 3.

## 6. Cost

Milliseconds per frame at 1920×1080, 180°, fastest of 3 per frame, over 12
frames (`results/bench-*.json`). `raster` is N plain samples without
accumulation; `averaging` is exposure minus raster.

| scene | frames | N | exposure median | exposure min | raster median | averaging median |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| prototype scene | 10–21 | 1 | 0.64 | 0.57 | 0.64 | 0 |
| | | 4 | 10.46 | 9.32 | 2.65 | 7.82 |
| | | 8 | 17.74 | 15.56 | 5.49 | 12.25 |
| | | 16 | 30.69 | 28.18 | 10.78 | 19.91 |
| heavy (400 translucent rounded boxes, 8 moving groups) | 10–21 | 1 | 54.81 | 41.87 | 56.25 | — |
| | | 4 | 238.00 | 195.17 | 236.36 | — |
| | | 8 | 457.43 | 379.99 | 489.51 | — |
| | | 16 | 970.77 | 725.94 | 941.44 | — |
| `reel` | 400–411 | 1 | 1.19 | 0.96 | 1.16 | 0.03 |
| | | 4 | 14.34 | 12.70 | 4.71 | 9.63 |
| | | 8 | 26.32 | 21.82 | 11.02 | 15.29 |
| | | 16 | 52.41 | 40.20 | 19.63 | 32.78 |
| `transitions` | 100–111 | 1 | 7.84 | 5.76 | 7.77 | 0.07 |
| | | 4 | 40.31 | 29.02 | 34.52 | 5.79 |
| | | 8 | 77.23 | 54.96 | 74.42 | 2.81 |
| | | 16 | 209.04 | 106.14 | 158.00 | 51.04 |

On the heavy scene the rasters are the cost, and load noise is larger than
the averaging, so that column is blank rather than negative. On sparse scenes
the averaging is about 1 ms per sample plus about 3.5 ms per frame to resolve.

Before the accumulate loop was rewritten for simd128, the prototype scene's
averaging was 18.6 / 36.8 / 44.2 ms at N = 4 / 8 / 16. The rewrite produced
the same digests.

The benches ran on the build before the measurement-only opacity switch was
added (wasm `02dd7a6f…`). Its digests equal those of the final build on every
subject in section 8.

### Core versus host

The same exposure was averaged in JS with the same arithmetic
(`bench.ts --host`), as the median ms per frame:

| scene | N | core | host |
| --- | ---: | ---: | ---: |
| prototype scene | 4 | 10.39 | 24.28 |
| | 8 | 17.25 | 40.56 |
| | 16 | 30.34 | 72.76 |
| `reel` 400–407 | 4 | 15.60 | 48.98 |
| | 8 | 31.43 | 82.06 |
| | 16 | 65.95 | 188.47 |

## 7. Memory

Wasm linear memory after one frame of the heavy scene (`harness/memory.ts`):

| scale | after boot | after a plain render | after an N=8 exposure |
| ---: | ---: | ---: | ---: |
| 1 (1920×1080) | 2.3 MiB | 10.2 MiB | 49.8 MiB |
| 2 (3840×2160) | 2.3 MiB | 33.9 MiB | 192.3 MiB |

The u32 accumulator is 16 bytes per physical pixel and the exposure buffer
is 4. Linear memory never shrinks. Every checkpoint copies all of it, and
preview's rebuild threshold is 4× the boot reading.

## 8. Determinism

Wasm `c4796243…` and Bun 1.3.11 throughout. linux/x86-64 is Docker Desktop
running `oven/bun` (amd64, image `38919894db4e`) under emulation on this
machine. That is a translated x86-64 run, not x86-64 hardware
(`results/{blur,heavy,reel}-{darwin-1,darwin-2,linux-amd64}.json`):

| subject | N | darwin/arm64 run 1 | darwin/arm64 run 2 | linux/x86-64 |
| --- | ---: | --- | --- | --- |
| prototype scene, 90 frames | 1 | `015b265357fe689c` | same | same |
| | 4 | `94b940d89335eb2f` | same | same |
| | 8 | `1c985200169db644` | same | same |
| | 16 | `ef3ac35479db025e` | same | same |
| heavy scene, 30 frames | 1 | `6094b84edfe7d3f9` | same | same |
| | 4 | `d0653f014e020d10` | same | same |
| | 8 | `c14355f2c62ae006` | same | same |
| `reel` frames 380–439 | 1 | `415f5c18e98a66ba` | same | same |
| | 8 | `07c083f196a1b13a` | same | same |

## 9. Observed, not part of this work

At commit `47b79ea`, four compositions trace to digests other than
`baselines/digests.json` with the pin's own wasm, so the cause is not this
prototype. The scalar and SIMD prototype builds agree with the pin's wasm on
every one of them:

| composition | traced | ledger |
| --- | --- | --- |
| `gradients` | `bcc4f390bca5bceb` | `c4509f225a0834b6` |
| `glow` | `52a48e2e3711f307` | `c8a74da628ccb0a5` |
| `timeline` | `b632622509e268f6` | `3f35d493ebccaada` |
| `transitions` | `66a8c5dcdee488e5` | `890cace729e050c4` |

The rest checked here (`alpha`, `curves`, `filters`, `masked`, `reel`,
`stroke`) match the ledger. The full ledger was not run.
