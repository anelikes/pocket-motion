# Raster reuse: which frames hold, and what skipping them saves

Measured 2026-11-05 for `src/render/reuse.ts`: `render()` skips the raster of
a frame whose draw-list hash and raster revision (`patches/0055`) both equal
the previous frame's, delivers the previous frame's pixels, and hashes them
again. Apple M4, 32 GB, Bun 1.3.11, the core at `66caf4e5` + 38 patches.
Load average 10–60 from other sessions while the sweep ran; the counts are
exact, the milliseconds are not quiet-machine numbers.

Reproducer: `raster-reuse/probe.ts`. Every row is in
`raster-reuse/results/`. The sweep (`sweep-2026-11-05.jsonl`, one timing run
per composition) is where the counts come from; its timing fields were taken
before the probe left frame 0 out of them, and the timings to read are
`careful-2026-11-05.jsonl`'s, three runs each.

## It is right

The ledger is the check, because its digests were recorded with no reuse and
every frame is still hashed. **All 42 compositions in `digests.json` matched
with the reuse on** (`bun scripts/digests.ts`, after the raster-revision patch,
4 min 23 s), and all 45 after the branch took the merge train in.
The probe asks the same thing frame by frame: over every composition below,
**no frame had its key hold while its pixels moved**, and the digest with the
reuse on equals the digest with it off for every one.

## Where frames hold

`key holds` are the frames reused. `pixel holds` are the frames
byte-identical to the frame before — the most any reuse could skip. The
hajibang samples and `bench-title` (the render-cost benchmark's 10 s 1080p
scene, and its 180° × 4 shutter variant) are not ledger compositions; they
were staged as `encode-cost.md` describes.

| composition | frames | raster size | key holds (reused) | pixel holds |
|---|---:|---|---:|---:|
| `captions/alpha-en` | 180 | 1920×1080 | 92 | 92 |
| `captions/burn-zh` | 101 | 720×1280 | 0 | 0 |
| `captions/clip-wipe` | 240 | 1920×1080 | 11 | 33 |
| `captions/highlight` | 240 | 1920×1080 | 84 | 84 |
| `captions/kinetic-slam` | 240 | 1920×1080 | 70 | 70 |
| `captions/matrix-decode` | 240 | 1920×1080 | 116 | 116 |
| `captions/pill-karaoke` | 240 | 1920×1080 | 165 | 165 |
| `curves` | 420 | 1920×1080 | 120 | 120 |
| `curves-race` | 342 | 1920×1080 | 129 | 129 |
| `filters` | 30 | 1920×1080 | 0 | 0 |
| `footage-tracks` | 150 | 1280×720 | 0 | 2 |
| `glow` | 30 | 1920×1080 | 29 | 29 |
| `gradients` | 30 | 1920×1080 | 0 | 0 |
| `late-timer` | 900 | 1920×1080 | 898 | 898 |
| `long-track` | 2100 | 320×180 | 0 | 0 |
| `masked` | 90 | 1920×1080 | 29 | 35 |
| `nested/a/9x16` | 30 | 1080×1920 | 29 | 29 |
| `nested/b/9x16` | 30 | 1080×1920 | 29 | 29 |
| `open` | 90 | 1920×1080 | 89 | 89 |
| `reel` | 1071 | 1920×1080 | 262 | 273 |
| `rename-card` | 180 | 3840×2160 | 106 | 106 |
| `shutter` | 150 | 7680×4320 | 115 | 115 |
| `shutter-blur` (shutter) | 90 | 1920×1080 | 0 | 0 |
| `smoke` | 450 | 1920×1080 | 0 | 0 |
| `sound-roles` | 180 | 1280×720 | 59 | 83 |
| `stroke` | 45 | 1920×1080 | 2 | 2 |
| `timeline` | 854 | 3840×2160 | 183 | 190 |
| `transitions` | 756 | 1920×1080 | 403 | 410 |
| `typography` | 30 | 1920×1080 | 29 | 29 |
| `vector-paths` | 120 | 1920×1080 | 0 | 0 |
| `hajibang sample-sparse` | 621 | 1080×1920 | 0 | 200 |
| `hajibang sample-full` | 1665 | 1080×1920 | 0 | 980 |
| `bench-title` | 300 | 1920×1080 | 0 | 0 |
| `bench-title-s4` (shutter) | 300 | 1920×1080 | 0 | 0 |

Over the 42 ledger compositions: **3,052 of 9,664 frames reused, of 3,131
whose pixels held** (97.5%). Twelve of the 42 are one or two frames long and
are not in the table (3 of their 15 frames hold).

Three shapes account for every hold the key does not see:

- **Sub-texel motion.** The hajibang ranking film draws a full-frame dot grid
  that drifts 256 px over the film, 0.15 px a frame. The clipped UV of its
  TEX_QUAD moves every frame, so no two draw lists are equal, while nearest
  sampling moves the dots about every sixth frame: **980 of its 1,665
  frames are byte-identical to the one before and none is reused.** The
  sparse sample is the same at 200 of 621. A key that saw these would need
  the raster's quantisation in it; a generator that moved the grid in whole
  pixels would make them holds, and would change the picture.
- **Footage.** A present frees and re-binds every tile, which moves the
  handles in the draw list and the raster revision, so a footage composition
  never holds: `footage-tracks` has 2 pixel holds and 0 reused.
- **Motion below a pixel elsewhere**: `clip-wipe` (22), `masked` (6),
  `sound-roles` (24), `reel` (11), `timeline` (7), `transitions` (7).

And nothing under a declared shutter holds in this tree: `shutter-blur` and
the 4-sample title move on every frame. `tests/reuse.test.ts` stages a
24-frame fixture to exercise the exposure key, because the shape that makes
the exposure key necessary — an animation ending on a frame's tick, which
leaves the next tick's draw list equal while the exposure before it was
blurred — is absent from the tree too, except as four frames of
`transitions` with a shutter added (frames 294, 320, 401 and 483).

## What it saves

`render()` without an output — what `trace` runs, so the frame hash and
no encode — with the reuse on and off, ABBA, three runs each; median CPU
seconds of the process. Load was 10–45 throughout. `skipped` is reused
frames × the raster time of a frame that changed, the work the reuse did not
do; the CPU columns are what the process measured. Key and raster are
milliseconds per changed frame, frame 0 left out.

| composition | frames | reused | key ms | raster ms | skipped s | CPU s, off | CPU s, on |
|---|---:|---:|---:|---:|---:|---:|---:|
| `captions/pill-karaoke` | 240 | 165 | 0.039 | 1.0 | 0.2 | 1.38 | 1.23 (−11%) |
| `captions/highlight` | 240 | 84 | 0.122 | 1.5 | 0.1 | 1.61 | 1.56 (−3%) |
| `late-timer` | 900 | 898 | 0.016 | 1.5 | 1.3 | 3.97 | 3.45 (−13%) |
| `masked` | 90 | 29 | 0.670 | 65.1 | 1.9 | 2.13 | 1.65 (−23%) |
| `shutter` | 150 | 115 | 0.199 | 31.0 | 3.6 | 11.89 | 9.59 (−19%) |
| `transitions` | 756 | 403 | 0.785 | 20.9 | 8.4 | 13.05 | 8.05 (−38%) |
| `reel` | 1071 | 262 | 0.402 | 3.0 | 0.8 | 5.90 | 6.04 (+2%) |
| `timeline` | 854 | 183 | 0.326 | 86.3 | 15.8 | 43.65 | 39.05 (−11%) |
| `hajibang sample-full` | 1665 | 0 | 0.047 | 19.5 | 0.0 | 27.00 | 27.98 (+4%) |
| `bench-title` | 300 | 0 | 0.102 | 73.8 | 0.0 | 13.00 | 11.05 (−15%) |
| `bench-title-s4` (shutter) | 300 | 0 | 0.199 | 272.9 | 0.0 | 48.77 | 48.77 (+0%) |

**The three rows that reuse nothing are the noise band**: −15%, +4% and 0%
between two configurations that do the same work. So the measurement
resolves `transitions` (−38%: 403 of 756 frames at 21 ms each), `masked`
(−23%) and `shutter` (−19%, a supersampled 8K raster), and does not resolve
the rest, where `skipped` is the better estimate: on the caption templates a
held frame's raster is about a millisecond, so even `pill-karaoke`'s 165
reused frames are under 0.2 s, and `reel`'s 262 are 0.8 s of its 6.

In a delivered render the encoder runs beside the renderer: `transitions`
end to end, three runs each, was 35.6 CPU s without the reuse and 31.1 with
it, and 21.2 s of wall against 15.3 (`encode-cost.md`, "End to end").

## What a frame that changes pays

The key walks the tree, and the raster walks it again: `ui_render_scaled`
rasterises the list a walk it runs itself builds, and there is no export
that rasterises the list the last walk left. On the frames whose key moved,
the walk costs the `key ms` column against the `raster ms` column above:
from 0.07% of the raster (`bench-title-s4`, four rasters a frame) to 13%
(`reel`, whose frames are light text over flat ground), 4–8% on
`transitions` and the caption templates. Where nothing holds it is the
whole cost of the reuse: 0.08 s over hajibang's 1,665 frames. Frame 0 is
left out of both means: its walk is the first and lays the tree out, which
the raster's walk would do if the key's had not, so it moves cost rather
than adding it — `open`, whose only changing frame is frame 0, read 1.56 ms
of key against 3.36 ms of raster in the sweep, which counted it.

The per-frame hash stays. SHA-256 of a 1080p frame is 2.71 ms in
`src/render/hash.ts` (5.6–9.3 ms under this sweep's load); a caption
template's raster is 0.3–0.8 ms. So on caption tracks the hash, not the
raster, is most of what a held frame costs, and reuse saves little there
until the hash is `--hash fast` (0.24 ms in `hash.ts`).

## Reproduce

```bash
# not run: every composition must be built first, as the ledger builds them
bun baselines/raster-reuse/probe.ts compositions/transitions compositions/reel --runs 3
```
