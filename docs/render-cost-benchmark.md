# Render cost: pocket-motion, Remotion and HyperFrames, and the Workers path

Measured 2026-10-23 for a planned video SaaS that would use pocket-motion as
its renderer, beside image and video generation (即梦 / Seedream / Seedance),
an LLM that designs the composition, TTS, ASR and HeyGen avatars. The
proposition under test: pocket-motion needs no browser, so it renders faster
and far cheaper than Remotion or HyperFrames, and can render on a Cloudflare
Worker. This document measures the first half on one machine, prototypes the
second in workerd, and prices both against the AI calls the same video would
make.

Reproducers are in [`baselines/render-cost/`](../baselines/render-cost/): the
scene in all three renderers, the harness, the Worker prototype, and the
results every table below was printed from
([`results/`](../baselines/render-cost/results/); `summarize.ts` and `cost.ts`
over `results/quiet` give the tables as they stand).

## Answer

**Render cost is not a meaningful share of what a video costs, and it is not
a moat.** Per 10 s 1080p video, rendering in a container costs about
$0.001–0.002 with pocket-motion, Remotion or HyperFrames alike ($0.006–0.011
with a 12-sample shutter). Remotion Lambda costs about the same in compute,
plus a $0.01 licence per render for companies of more than three people. The
AI calls the same video makes cost $0.57 (an LLM designing it twice, TTS,
ASR) to $3.42 (adding one generated 1080p shot). pocket-motion's render is
0.03–0.33 % of the total; the most any renderer reaches is about 2 %. All of
these are estimates from measured CPU and published prices.

**The Workers path is real for rendering frames, and is not a cheaper way
to make videos.** Measured in workerd, where memory and timing do not depend
on load:

- The render core runs in a Worker and gives the Bun CLI's bytes exactly:
  the same 300-frame digest without a shutter and with 4 and 12 samples, in
  every run.
- A platform Worker can render a composition it has never seen, with no
  deploy per composition, through the Worker Loader binding (open beta).
- 1080p fits a 128 MB isolate with or without a shutter (13.9 and 53.5 MiB
  of wasm memory). Supersample 2 fits without a shutter (46.7 MiB) and not
  with one (204.9 MiB); supersample 4 does not fit (182.8 MiB).
- A frame costs 48 ms of Worker CPU on this scene. 300 frames take 14.5 s,
  inside the default 30 s limit; 12 samples take 175.5 s, which needs the
  limit raised toward its 5-minute maximum. Longer films split by frame range
  at almost no cost.
- A video still needs a container: the build, H.264 encoding, audio mux and
  footage cannot run in a Worker. Frames leave deflated (64 MiB per 10 s, 9 s
  more CPU), and Worker plus container costs the same as rendering in the
  container. Use the Worker for single frames and previews — 0.09 s for a
  frame on a loaded Worker — not for whole videos.

**On speed, pocket-motion is ahead where a person waits, not where money is
spent.** Quiet machine, one Apple M4, median of 3:

- First frame from built artefacts: **0.27 s** against 1.41 s for Remotion
  and 2.47 s for HyperFrames, in a 121 MiB process against 554–590 MiB.
- A 10 s video with one worker: 13.6 s wall against 22.9 s and 20.2 s.
- CPU for that video: 26.7 s against 32.3 s and 43.7–45.4 s — 0.83× and
  0.6×, not an order of magnitude. Half of every renderer's CPU is the same
  x264 encode. This scene's full-frame gradients cost a CPU rasteriser
  29 ms a frame; the repository's earlier 9× lead over Remotion was measured
  on a sparse scene.

So the case for pocket-motion in this product is time to first frame (live
preview, scrubbing, a still per edit), a small footprint, and pixels that
are the same on every host. A cost saving is not part of that case.
Re-running the core set on a quiet machine is one command (`run-all.sh …
--no-extras`, about 30 minutes; "Reproduce").

## Machine and versions

| | |
|---|---|
| CPU | Apple M4, 10 cores (4 performance, 6 efficiency) |
| Memory | 32 GiB |
| OS | macOS 26.5.1 (25F80) |
| pocket-motion | this branch, upstream pocketjs `66caf4e5` + `patches/0001`–`0041` (34 patches), core `pocketjs.wasm` 914,393 bytes, sha256 `ebba75a4…`, rustc 1.97.1 |
| Bun | 1.3.11 |
| ffmpeg (pocket-motion, HyperFrames) | 8.0, Homebrew |
| Remotion | 4.0.482 (`@remotion/cli`, `@remotion/renderer`), React 18.3.1, Node 22.22.2, Chrome for Testing headless shell 149.0.7790.0, its bundled ffmpeg n7.1 |
| HyperFrames | 0.8.185, Node 22.22.2, Chrome for Testing headless shell 152.0.7977.30, GSAP 3.15.0 |
| workerd | 2026-10-19 (the build wrangler 4.152.0 depends on) |

Nothing was downloaded for this benchmark. Remotion is an existing install
in another project on this machine, linked into a scratch project
(`stage-rm.sh`); HyperFrames and wrangler/workerd are the copies already in
the npm cache; GSAP 3.15.0 is a copy already on disk. Their versions are the
ones these copies are, not a choice.

**The machine was not quiet.** Other sessions were rendering a full-length
HyperFrames film, building a batch of compositions and running test suites
and two digest ledgers. The timed core set therefore ran twice: a loaded pass
at a one-minute load average of 8–131 on 10 cores, the machine swapping, and
a quiet pass an hour later at 10–24 (one spike to 74). The tables report the
quiet pass and give the load of every run. CPU time moves far less with load
than wall time does — pocket-motion's 300 frames cost 26.7 s of CPU quiet and
30.8 s loaded, while its wall time went from 13.6 s to 39.3 s — so CPU-seconds
are the column the cost estimate uses. Efficiency-core placement still moves
CPU time somewhat (the same work costs more CPU-seconds on an E-core), and
that is not separable here.

## The scene

One 10 s title card with a lower third, 1920×1080 at 30 fps, 300 frames, no
footage, no audio, built three times:

| renderer | source | how motion is written |
|---|---|---|
| pocket-motion | [`pocket-motion/bench-title/`](../baselines/render-cost/pocket-motion/bench-title/) | 16 baked keyframe animations in `pocket.config.ts`, mount-only |
| Remotion | [`remotion/src/BenchTitle.tsx`](../baselines/render-cost/remotion/src/BenchTitle.tsx) | every value from `useCurrentFrame()` through `interpolate` and `Easing.bezier` |
| HyperFrames | [`hyperframes/bench-title/index.html`](../baselines/render-cost/hyperframes/bench-title/index.html) | one paused GSAP timeline, CSS's `infinite` loops unrolled into segments |

What is on screen: a full-frame 135° linear gradient; a 1000 px radial glow
breathing in scale; three translucent rounded squares turning and drifting; a
kicker, a two-line 120 px title, an accent rule and a subtitle entering on
expo-out curves, with the whole title block pushing in 4 % over the 10 s and
fading out at 9.3 s; a name plate sliding in at 4.5 s and out at 8.6 s with
its two lines rising in; and a progress rule growing across the bottom. Two
weights of HarmonyOS Sans, the repository's own faces, loaded as files in all
three. Every timing is a multiple of 100 ms, which is a whole frame at 30 fps
and a whole tick at 60 Hz, so no renderer's rounding moves an instant. The
progress rule and the turning squares change every frame, so no renderer can
skip a frame as a duplicate of the last one.

The scene sits outside `compositions/` on purpose: it is a benchmark, not a
composition this repository verifies, and neither ledger reads it.
`stage-pm.sh` copies it into a scratch tree, the way `baselines/shutter.md`
stages its scenes.

How close the three pictures are (PSNR over RGB, higher is closer; 30 dB
and up reads as the same picture, the differences are glyph rasterisation,
anti-aliasing and sub-pixel placement):

| frame | pocket-motion / HyperFrames | pocket-motion / Remotion | Remotion / HyperFrames |
|---|---:|---:|---:|
| 30 (1.0 s) | 35.2 dB | — | — |
| 200 (6.67 s) | 28.9 dB | 27.6 dB | 31.5 dB |

The two Chrome renderers are no closer to each other than either is to
pocket-motion. Remotion's software GL path (`--gl=swangle`) gives frame 200
at 50.8 dB from its default. Part of pocket-motion's gap is time, not
pixels: its frame f shows the clock at (2f + 1)/60 s (`docs/shutter.design.md`,
"Frame f of a 30 fps film reads clock c = (f + 1) · 2 − 1"), half a frame
after the browsers' f/30, and the ports were not shifted to match, so
whatever moves is half a frame further along. For what a frame costs to
render, that offset is irrelevant.

## Method

`baselines/render-cost/harness/measure.ts` runs each command and samples the
whole process tree every 100 ms with `ps`: Chrome's helpers, ffmpeg and
anything else the renderer spawns are counted. It records:

- **wall** — spawn to exit;
- **CPU** — the larger of two readings: the sum, over every process seen in
  the tree, of the largest cumulative CPU time `ps` reported for it, and
  `wait4`'s user + system for the spawned process (which includes every
  descendant it reaped). Neither is complete alone: `wait4` misses Chrome
  helpers that are not reaped up the chain (3.0 s against the tree's 28.3 s
  on the `swangle` run), and the sampler misses a process that lives less
  than one sample;
- **peak tree RSS** — the largest sum of RSS over the tree at one sample. It
  counts shared pages once per process, so it overstates what the tree needs;
  it is what a container memory limit is tested against far more closely than
  any one process's peak, which is recorded beside it;
- **load average** before and after.

`run-all.sh` runs every configuration once per repetition, the renderers
interleaved inside a repetition so that load drift falls on all three, three
repetitions. Each table gives the median and, in brackets, the range.

Three things changed during the session, and each is why a number is what it
is. A first attempt ran at a load average of 300–400 with 28.8 of 29.7 GB
of swap in use; it was stopped and its runs are not used. Remotion's and
HyperFrames' readiness timeouts were raised (Remotion `--timeout=180000`,
HyperFrames `--player-ready-timeout=180000 --browser-timeout=180`) after
Remotion's 30 s default expired under that load; they change how long a
renderer waits for its page, not what it renders. And the sampler first kept
each process's **last** CPU reading, which `ps` reports as 0 for a process it
catches exiting — Chrome's whole render read as 0.11 s. It now keeps the
largest; the loaded pass's first repetition of the Remotion and HyperFrames
runs was taken before the fix, so those five runs were taken again after it
and the earlier records are ignored by `summarize.ts` and `cost.ts`.
pocket-motion's runs stand: its CPU comes from `wait4`, which covers Bun and
its ffmpeg. The fix mattered most for `swangle`, where `wait4` saw 3.0 s of a
render the tree measured at 28.3 s.

Configurations, all encoding H.264 with libx264 `medium` at CRF 16 (the
default of pocket-motion and of HyperFrames' default `looks` quality;
Remotion passed `--crf=16`):

| label | command |
|---|---|
| `pm.build.cold` | `main.ts build`, after emptying the build's transform cache |
| `pm.build.warm` | the same build again |
| `pm.first-frame` | `main.ts frame --at 0 --out f.png`, from the built bundle and pak |
| `pm.render.none` / `.s4` / `.s12` | `main.ts render --out x.mp4`; the sidecar declares no shutter, `180° × 4`, `180° × 12` |
| `rm.bundle` | `remotion bundle --bundle-cache=false` |
| `rm.first-frame` | `remotion still <bundle> --frame=0`, from the bundle |
| `rm.render.c1` / `.c5` | `remotion render <bundle> --crf=16`, concurrency 1 and the default (5 on this machine) |
| `rm.render.c1.swangle.30f` | concurrency 1, `--gl=swangle` (software GL, what Remotion Lambda uses), frames 0–29 only |
| `hf.first-frame` | `hyperframes snapshot --at 0 --no-end` |
| `hf.render.w1` / `.auto` | `hyperframes render`, 1 worker and `--workers auto` |
| `hf.render.w1.sw` | 1 worker, `--no-browser-gpu` (SwiftShader, what a server without a GPU runs) |

"First frame from nothing" is a fresh process producing frame 0 as a file
from the renderer's built artefact: pocket-motion's bundle and pak, Remotion's
webpack bundle, HyperFrames' project directory (it has no build step). The
build is reported separately, because a SaaS builds a composition once and
may render it many times. **Per frame** is given two ways: amortised, the
whole render's wall or CPU over 300; and marginal, the render minus the first
frame, over the 299 frames after it — the cost of one more frame once the
renderer is up.

## Results

The core set ran twice, three repetitions each: the **quiet pass**, at a
one-minute load average of 10–24 (one spike to 74 during the second
repetition's 12-sample render and the workerd requests after it), which the
tables below report; and the **loaded pass** an hour earlier, at 8–131 with
the machine swapping, kept for what it says about load. Configurations run
once are marked so.

### One 10 s video, three renderers (quiet pass, median of 3)

| | pocket-motion | Remotion | HyperFrames (GPU) | HyperFrames (software) |
|---|---:|---:|---:|---:|
| **first frame**, wall | **0.27 s** (0.21–0.27) | 1.41 s (1.38–1.86) | 2.47 s (2.17–3.07) | — |
| first frame, CPU | 0.32 s (0.30–0.32) | 1.33 s (1.32–1.79) | 3.45 s (3.19–3.75) | — |
| first frame, peak tree RSS | 121 MiB | 554 MiB | 590 MiB | — |
| **300 frames**, wall | **13.6 s** (12.8–21.1) | 22.9 s (22.1–26.7) | 20.2 s (18.7–21.0) | 20.8 s (19.2–27.1) |
| 300 frames, **CPU** | **26.7 s** (25.8–30.3) | 32.3 s (32.0–35.5) | 45.4 s (44.6–45.7) | 43.7 s (40.6–47.1) |
| of which ffmpeg (x264) | 13.7 s | 12.3 s | 22.6 s | 21.4 s |
| of which the renderer | 12.8 s (Bun) | 21.0 s (Chrome 18.4, Node 2.6) | 19.5 s | 18.3 s |
| peak tree RSS | 793 MiB | 1,093 MiB | 1,539 MiB | 1,295 MiB |
| largest process | ffmpeg, 705 MiB | ffmpeg, 728 MiB | ffmpeg, 652 MiB | ffmpeg, 639 MiB |
| wall per frame, amortised / marginal | 45 / 44 ms | 76 / 72 ms | 67 / 59 ms | 69 / 61 ms |
| CPU per frame, amortised / marginal | 89 / 88 ms | 108 / 104 ms | 151 / 140 ms | 146 / 135 ms |

The split by process is the median of each process's CPU, so its parts need
not add to the total exactly. "Remotion" is concurrency 1 at its default GL,
which on this Mac lets Chrome raster on the GPU: that work is not CPU time
and is not in the column. HyperFrames' GPU path is its macOS default
(`drawelement` capture, hardware GPU); its software path is
`--no-browser-gpu`. All three wrote 1920×1080, 30 fps, 300 frames, checked
with ffprobe (Remotion tags its output full-range `yuvj420p`, the other two
`yuv420p`).

Read plainly:

- **On CPU, pocket-motion is 0.83× Remotion and 0.6× HyperFrames for this
  scene — not an order of magnitude.** Half of each total is ffmpeg running
  the same x264 settings; the renderers themselves differ by 12.8 s against
  18–21 s.
- **On wall time with one worker it is the fastest, 1.5–1.7×**, because its
  raster and ffmpeg overlap and there is no browser to drive. The browsers
  parallelise further when allowed (below); pocket-motion's `render` does not.
- **To the first frame it is 5× faster than Remotion and 9× faster than
  HyperFrames, at a fifth of the memory.** That is the largest difference
  measured here.
- The repository's earlier 9× against Remotion (`baselines/remotion-m4.md`)
  was `compositions/smoke`, a sparse scene. This one paints a full-frame
  linear gradient, a 1000 px radial gradient and three translucent rounded
  boxes turning, which a CPU rasteriser pays for per pixel (29 ms a frame,
  below) and Chrome hands to the GPU or to raster threads. How the ratio
  moves with density is not measured beyond these two scenes.

### pocket-motion with a shutter (quiet pass, median of 3)

| | no shutter | 180° × 4 | 180° × 12 |
|---|---:|---:|---:|
| 300 frames, CPU | 26.7 s | 67.6 s (62.5–74.0) | 157.4 s (156.4–163.6) |
| 300 frames, wall | 13.6 s | 64.0 s (50.2–72.0) | 174.9 s (164.0–226.8) |
| CPU against no shutter | 1× | 2.5× | 5.9× |
| raster per frame (`core-bench.ts`, median) | 29.3 ms | 129.8 ms | 386.7 ms |
| ffmpeg | 13.7 s | 15.6 s | 16.0 s |
| digest | `856cc83a…` | `d3983f4c…` | `31e1f672…` |

A sample costs about one raster plus 3 ms of accumulation here (129.8 ms =
4 × 29.3 + 12.6; 386.7 ms = 12 × 29.3 + 35.1), more than the 1 ms
`baselines/shutter.md` measured on sparser scenes. ffmpeg's share barely
grows (13.7 → 16.0 s), so the shutter multiplies the renderer's half only.
The 1.2 s and 4 s a frame observed on the dense HUD film overnight are that
film's density under that night's load, not this scene's.

### Where a pocket-motion frame's time goes (`core-bench.ts`, once each, load 9–22)

| | per frame |
|---|---:|
| fold: one guest turn and two core ticks | 0.08 ms |
| raster, no shutter | 29.3 ms |
| SHA-256 of the frame (`render` and `trace` hash every frame) | 3.1 ms |
| boot: wasm, guest, mount | 48 ms once |

The Bun process spends 12.8 s on 300 frames, 43 ms a frame; past raster and
hash, the rest is copying 7.9 MiB a frame into ffmpeg's pipe and the CLI
around it. ffmpeg spends 46 ms a frame converting RGBA to yuv420p and
encoding at `medium`. A faster preset was not measured.

### Run once (load 14–22)

| | wall | CPU | peak tree RSS |
|---|---:|---:|---:|
| pocket-motion build, transform cache emptied | 2.80 s | 3.52 s | 445 MiB |
| pocket-motion build, warm | 0.93 s | 1.28 s | 360 MiB |
| Remotion bundle (`--bundle-cache=false`) | 3.53 s | 6.32 s | 534 MiB |
| Remotion, concurrency 5 | 9.61 s | 34.03 s | 1,386 MiB |
| HyperFrames, `--workers auto` | 14.04 s | 38.84 s | 2,289 MiB |
| Remotion, `--gl=swangle`, frames 0–29 only | 8.86 s | 28.26 s | 828 MiB |

HyperFrames has no build step. Parallel workers cut the browsers' wall time
to 9.6 s and 14.0 s for about the same CPU. pocket-motion's `render` runs one
raster thread; `src/render/parallel.ts` splits a render across processes but
no command uses it (`baselines/phase5-throughput.md` measured it plateauing
at four workers, and losing its gain once each worker runs its own encoder).
`swangle` is Remotion's Lambda default: on this Mac it cost 942 ms of CPU a
frame, about 9× Remotion's default path. That is macOS's SwiftShader, not
Linux's, and it is not used for the Lambda estimate below. Its 300-frame render, run
in the loaded pass, overran a 180 s timeout.

### What load does to these numbers

CPU moved far less than wall time between the two passes, and pocket-motion's
wall time moved the most of the three:

| median of 3 | CPU, quiet → loaded | wall, quiet → loaded |
|---|---|---|
| pocket-motion, 300 frames | 26.7 → 30.8 s | 13.6 → 39.3 s |
| pocket-motion, shutter × 12 | 157.4 → 175.2 s | 174.9 → 243.8 s |
| Remotion, 300 frames | 32.3 → 34.7 s | 22.9 → 27.5 s |
| HyperFrames, software, 300 frames | 43.7 → 44.7 s | 20.8 → 23.4 s |
| pocket-motion, first frame | 0.32 → 0.42 s | 0.27 → 0.53 s |

pocket-motion is one raster thread waiting on one encoder; a browser
renderer spreads over many threads and processes and keeps more of a busy
machine. CPU rose 2–15 % under load for the renders and 31 % for the 0.3 s
first frame, which is the margin to read on every CPU figure here.

## The Workers path

### What was built

[`baselines/render-cost/workers/`](../baselines/render-cost/workers/) holds
the smallest thing that answers whether the render core runs in a Worker:

- `worker.js` does what `src/runtime/boot.ts` and `frame-source.ts` do,
  without the `node:vm` sandbox: instantiate the core from a wasm module
  compiled at load, put the guest's contract slots on `globalThis` (`ui`,
  `__pak`, `__simHz`, …), run the guest bundle, then per frame one guest turn,
  `60/fps` core ticks and a raster (`renderExposure` under a shutter). Each
  frame's RGBA is hashed with SHA-256 through `crypto.subtle`, and the
  sequence digest is `sha256(hashes.join("\n"))`, the same as
  `src/render/hash.ts`, so a response is comparable byte for byte with the
  Bun CLI.
- `build.ts` turns a pocket-motion build into a workerd project: the core as
  a `wasm` module, upstream's `hosts/web/wasm-ops.js` unchanged, the pak as a
  `data` module, and the bundle wrapped as `export default function` — module
  code, because a Worker may not `eval` (the bundle is an IIFE classic script;
  its only `eval` is in the devtools message handler, which rendering never
  calls).
- `loader.js` is the shape a SaaS needs: one platform Worker that carries the
  core and the shim, receives a composition's bundle and pak in the request
  body, and builds a Worker from them at run time through the Worker Loader
  binding (`env.LOADER`), cached by a hash of the composition. No deploy per
  composition.

Both ran in workerd 2026-10-19 locally (`workerd serve`, nothing deployed).

### Same pixels

The Worker reproduces the Bun CLI exactly. Under V8 in workerd and
JavaScriptCore in Bun, the same wasm core gives the same bytes:

| variant | frames | Bun CLI digest (`trace` / `render`) | workerd digest |
|---|---|---|---|
| no shutter | 0–299 | `856cc83a…` (`trace`, every `render`) | `856cc83a…` in every run; per frame, all 300 equal |
| shutter 180° × 4 | 0–299 | `d3983f4c…` (`trace`, every `render`) | `d3983f4c…` |
| shutter 180° × 12 | 0–299 | `31e1f672…` (every `render`) | `31e1f672…` in every run |
| no shutter, Worker Loader | 0 | `8c7c21e6…` (frame 0) | `8c7c21e6…` |

Wherever the Bun CLI and workerd were both asked for a sequence, they gave
the same digest. The core is integer arithmetic over a wasm module that
neither engine compiles differently, and that is what this shows; it is not
a claim about any other host.

### Limits, one by one

**Memory: 128 MB per isolate, "including the JavaScript heap and
WebAssembly allocations"** (Workers limits page, updated 2026-10-12). The
core's linear memory, as the core reports it:

| render | wasm memory | pak | fits 128 MB? |
|---|---:|---:|---|
| 1080p, no shutter | 12.6 MiB after 2 frames, 13.9 MiB after 300 | 2.4 MiB | yes |
| 1080p, shutter × 4 or × 12 | 52.2 MiB after 2 frames, 53.5 MiB after 300 | 2.4 MiB | yes |
| supersample 2 (3840×2160 internal), no shutter | 46.7 MiB | 9.4 MiB | yes |
| supersample 2, shutter × 4 or × 12 | **204.9 MiB** | 9.4 MiB | **no** |
| supersample 4 (7680×4320 internal), no shutter | **182.8 MiB** | 37.4 MiB | **no** |

Read with `core-bench.ts --frames 2` (`--frames 1` at supersample 4; the
300-frame figure from workerd and `core-bench.ts` alike); memory does not
depend on load. The sample count does not move it: a declared shutter
reserves the exposure scratch once, five framebuffers (39.6 MiB at 1080p,
158.2 MiB at 4K), before the first frame. The pak grows with the density its
atlases are baked at, fourfold per doubling.

Beside it the isolate holds the pak (2.4 MiB as a data module), the
compiled core, the guest's JavaScript heap and the frame's copy for hashing or
compressing (7.9 MiB at 1080p). 1080p fits with room, with or without a
shutter, and so does supersample 2 without one. **Supersample 2 with a
shutter, and supersample 4 at all, do not fit**, so a film that needs either
renders somewhere else. workerd does not enforce the limit locally, so this is
the core's own reading compared against the published number. The workerd
process's RSS, runtime included, was 58–59 MiB after start and 51–95 MiB
after a render request in the quiet pass — but 143–200 MiB after a deflate
request, which copies every frame twice (once out of wasm memory, once into a `Blob`)
and leaves the garbage to the collector. RSS is not the isolate's heap and
nothing here measures that directly; the deflate path is the one to watch.

**CPU: 30 s per request by default, configurable to 5 minutes**
(`limits.cpu_ms` up to 300,000, Workers Paid). The workerd process's CPU
per request, from `ps` before and after (median of 3, range in brackets;
quiet pass, load 10–74, the top of that range the spike noted under
"Results"):

| request | CPU | wall | fits |
|---|---:|---:|---|
| start workerd and load the Worker (no render) | — | 0.19 s (0.16–0.27) | — |
| frame 0 on a loaded Worker: new wasm instance, guest mounted, one frame, SHA-256 | 0.10 s (0.09–0.12) | 0.09 s | 30 s default: yes; 10 ms Free: no |
| frame 0 through the Worker Loader, dynamic Worker cached (twice, loaded pass) | 0.04–0.08 s | 0.04–0.07 s | yes |
| 300 frames, no shutter | 14.5 s (13.7–19.7) | 15.4 s | 30 s default: yes |
| 300 frames, no shutter, every frame deflated | 23.6 s (20.1–28.5) | 25.7 s | 30 s default: yes, narrowly |
| 300 frames, shutter × 4 (once, loaded pass) | 53.8 s | 55.4 s | needs `cpu_ms` raised |
| 300 frames, shutter × 12 | 175.5 s (174.9–176.3) | 203.6 s | needs `cpu_ms` raised toward its 300 s maximum |

That is 48 ms of Worker CPU a frame without a shutter, hashing included,
against 43 ms for the Bun process inside `render` on the same 300 frames:
V8 and JavaScriptCore run this core at about the same speed. A 12-sample
film longer than about 17 s does not fit one request and has to be split
across requests by frame range. The core makes that cheap: folding to a
frame costs 0.08 ms of CPU a frame (`core-bench.ts`), so a request for
frames 9,000–9,299 spends under a second getting there, and nothing else is
carried between frames.

**Size: 64 MiB uncompressed** per Worker on both plans, by the Workers limits
page (the Workflows limits page still says 3 MB / 10 MB). The whole render
Worker is 3.6 MB raw and 487 KB gzipped:

| module | raw | gzip |
|---|---:|---:|
| `core.wasm` | 914,393 B | 319,049 B |
| `scene.pak` (this scene's fonts and styles) | 2,488,608 B | 115,714 B |
| `guest.js` (this scene's bundle) | 192,908 B | 44,025 B |
| `wasm-ops.js` | 20,620 B | 6,441 B |
| `worker.js` | 5,159 B | 2,210 B |

A pak grows with the faces and sizes a composition bakes; a CJK face at
several sizes is tens of MB (AGENTS.md, on the metrics-only atlas: one 72 px
bold slot over ASCII, CJK punctuation and the 3,755 level-1 GB2312
characters is 30.1 MB with coverage). That is still under 64 MiB, but it is
memory the isolate holds too.

**No code from strings, no wasm compiled at run time.** `eval`, `new
Function` and `WebAssembly.compile`/`instantiate` on bytes are refused in a
Worker (Workers web-standards page). The core compiles as an uploaded module;
the guest runs as module code. A composition that arrives at run time needs
the Worker Loader, which is open beta (since 2026-03-24) and bills
$0.002 per Dynamic Worker per day past 1,000 a month — on one render of one
composition, more than the render's CPU.

**Clocks do not advance while code runs** (`Date.now()`, `performance.now()`),
so a Worker cannot time itself; the timings here are the caller's. The render
path does not read a clock, so this costs nothing but observability.

### What the render path uses that a Worker does not have

| where | what | in the Worker |
|---|---|---|
| `src/runtime/boot.ts` | `Bun.file` for the wasm, the bundle and the pak | module imports, or R2 |
| `src/harness/sandbox.ts` | `node:vm` contexts, the realm hardening and the poisoned `Date`/`Math.random` | not available; the guest runs unsandboxed as module code. Its determinism rests on the build-time `lint` and on the Worker's own frozen clock |
| `src/render/hash.ts` | `Bun.CryptoHasher`, `Bun.hash` | `crypto.subtle.digest`; same SHA-256, asynchronous |
| `src/render/encode.ts` | `Bun.spawn` of ffmpeg | no processes |
| `src/cli/footage.ts`, `src/sound/` | ffmpeg and ffprobe; raw RGBA tracks on disk | no processes, no disk |
| the build (`src/cli/build.ts` → upstream `tools/build.ts`) | Bun's bundler, the font baker, the filesystem | not in a Worker |

### What has to live elsewhere, and with what

- **The build.** Compiling a composition (TSX to bundle, fonts to atlases,
  classes to the style table, the pak) needs Bun and a filesystem: a
  container (Cloudflare Containers, or any). It runs once per composition.
- **Encoding.** No ffmpeg, no WebCodecs encoder in a Worker. A Worker can
  only hand frames on. Raw RGBA is 7.9 MiB a frame, 2.3 GiB for these 10 s;
  compressed in the Worker with `CompressionStream("deflate-raw")` the 300
  frames come to 64.0 MiB (2.7 %, 218 KiB a frame) for 9.2 s more Worker
CPU. The encoder is ffmpeg in a container.
- **Audio mux** (ffmpeg) and **footage** (ffmpeg decode, then raw RGBA
  tracks: 688 MiB for this repository's 1.5 MB of clips, more than five times
  the isolate) are container work outright.

So a Worker can render frames — exactly the frames the CLI renders — and for
anything that ends as a video file, the container is in the path anyway.
What a Worker adds is a place to render **single frames and short ranges
close to the user with no container start**: a scrub preview, a thumbnail,
an editor's still of frame N, a hash check. For whole videos,
rendering in the same container that encodes skips moving every frame
between the two.

## Cost per video

Everything in this section is an **estimate**: no render here ran on Lambda,
on Cloudflare or in a container. What is measured is the CPU a render took
on the M4 above; [`harness/cost.ts`](../baselines/render-cost/harness/cost.ts)
turns it into what each platform would bill, from prices read on 2026-10-23
and cited beside each constant there. It prints the tables below from the
same medians as the results above.

### Render

| path | low | high | basis |
|---|---:|---:|---|
| Remotion Lambda, Remotion's published examples | $0.00100 | $0.00283 | HelloWorld template $0.001; one-minute video $0.017, prorated to 10 s = $0.0028 (remotion.dev/docs/lambda/cost-example) |
| Remotion Lambda, compute (estimate) | $0.00086 | $0.00301 | 32.3 CPU-s measured; 16 functions of 20 frames; 32–113 function-seconds x 2 GB x 0.0000133334/GB-s; S3 not counted |
| Remotion Lambda, compute + company licence (estimate) | $0.011 | $0.013 | + $0.01 per render (Remotion for Automators; free for companies of up to 3) |
| pocket-motion in a container (estimate) | $0.00096 | $0.00191 | 26.7 CPU-s measured, standard-2 (1 vCPU, 6 GiB) for 27 s; high = x2 for a slower core |
| pocket-motion, shutter 12, in a container (estimate) | $0.00564 | $0.011 | 157.4 CPU-s measured, standard-2 (1 vCPU, 6 GiB) for 157 s; high = x2 for a slower core |
| Remotion in a container (estimate) | $0.00116 | $0.00231 | 32.3 CPU-s measured, standard-2 (1 vCPU, 6 GiB) for 32 s; high = x2 for a slower core |
| HyperFrames in a container (estimate) | $0.00157 | $0.00313 | 43.7 CPU-s measured, standard-2 (1 vCPU, 6 GiB) for 44 s; high = x2 for a slower core |
| pocket-motion in a Worker + encode in a container (estimate) | $0.00096 | $0.00193 | Worker 23.6 CPU-s (render + deflate) + ffmpeg 13.7 CPU-s on standard-2 |
|   + one Dynamic Worker per composition | $0.00296 | $0.00393 | + $0.002 per Dynamic Worker per day past 1,000 a month |

How each line is built:

- **Remotion Lambda, published examples**: Remotion's own cost page
  (remotion.dev/docs/lambda/cost-example, 2048 MB, warm, us-east-1) gives
  $0.001 for its HelloWorld template and $0.017 for a one-minute video; the
  second, prorated to 10 s, is $0.0028.
- **Remotion Lambda, compute**: Remotion fans 300 frames out to 15 functions
  of 20 frames plus the main one (its `framesPerLambda` default,
  remotion.dev/docs/lambda/concurrency); Lambda bills wall time × 2 GB ×
  $0.0000133334/GB-s (arm64, us-east-1, AWS price list of 2026-10-22). The
  function-seconds are bracketed from the measured CPU: low, that CPU over the
  2 vCPU a 2048 MB function has, plus 1 s of Chrome start per function;
  high, at half an M4 core's speed on one vCPU, plus 3 s each. The measured
  CPU is Remotion's default GL on this Mac, which does part of the raster on
  the GPU; Lambda runs `swangle`, whose cost on this Mac (942 ms of CPU a
  frame) is not taken as Lambda's. The published examples agree with the
  bracket. S3 is not counted.
- **Remotion's licence**: companies of more than three people pay $0.01 per
  render (Remotion for Automators, $100 a month minimum;
  remotion.dev/docs/license/faq). On a 10 s video it is three to eleven
  times the compute.
- **Containers**: Cloudflare Containers `standard-2` (1 vCPU, 6 GiB, 12 GB
  disk): $0.000020 per vCPU-second used, $0.0000025 per GiB-second and
  $0.00000007 per GB-second provisioned, for at least as long as the CPU time
  on one vCPU. "High" doubles it for a server core slower than an M4's.
- **Worker + container**: the Worker's CPU for render and deflate at $0.02 per
  million CPU-ms, plus ffmpeg's measured CPU on `standard-2`. A composition
  loaded at run time adds $0.002 per Dynamic Worker per day past 1,000 a
  month — more than the rest of the line.

### The AI calls the same video makes

Assumptions for one 10 s video, stated so they can be argued with: the design
is two Opus 5.5 calls (one to write the composition, one to repair it after
`lint`/`check`) of 30k input and 8k output tokens each; narration is 150
characters (10 s at about 15 a second) through ElevenLabs; captions are ASR
over the 10 s. Prices: Claude Opus 5.5 $4 / $20 per million tokens
(platform.claude.com pricing); Seedream 4.0 $0.03 and 5.0 pro $0.045 an
image, Seedance 1.0 pro fast $0.24, 2.0 $1.87 and 2.5 $2.84 for a 5 s 1080p
shot (BytePlus ModelArk price list, 2026-10-23; Volcano Engine lists them
at ¥0.20/¥0.30 an image and ¥18.71 for the 2.5 shot); ElevenLabs v4 $0.08
per 1,000 characters; whisper-1 $0.006 a minute; HeyGen Avatar IV $0.05 a
second (its enterprise rate of 0.1 credit a second at $0.50; the self-serve
table is behind a sign-in and was not read).

| line | cost |
|---|---:|
| design, Opus 5.5, 2 x (30k in + 8k out) | $0.560 |
| narration, ElevenLabs v4, 150 characters | $0.012 |
| captions, whisper-1, 10 s | $0.00100 |

| scenario | low | high |
|---|---:|---:|
| motion graphics only: design x2 + TTS + ASR | $0.573 | $0.573 |
| + 3 generated stills (Seedream 4.0 .. 5.0 pro) | $0.663 | $0.708 |
| + one 5 s 1080p generated shot (Seedance 1.0 pro fast .. 2.5) | $0.813 | $3.416 |
| + 10 s HeyGen avatar (Avatar IV) | $1.073 | $1.073 |

### Render as a share of the video's cost

The smallest share is the cheapest render beside the dearest AI calls, the
largest the reverse:

| scenario | pocket-motion, container | pocket-motion shutter 12, container | Remotion Lambda, compute | Remotion Lambda + licence |
|---|---:|---:|---:|---:|
| motion graphics only: design x2 + TTS + ASR | 0.17–0.33 % | 0.97–1.93 % | 0.15–0.52 % | 1.86–2.22 % |
| + 3 generated stills (Seedream 4.0 .. 5.0 pro) | 0.13–0.29 % | 0.79–1.67 % | 0.12–0.45 % | 1.51–1.92 % |
| + one 5 s 1080p generated shot (Seedance 1.0 pro fast .. 2.5) | 0.03–0.23 % | 0.16–1.37 % | 0.03–0.37 % | 0.32–1.57 % |
| + 10 s HeyGen avatar (Avatar IV) | 0.09–0.18 % | 0.52–1.04 % | 0.08–0.28 % | 1.00–1.20 % |

Per video, the renderers differ by about a cent, and almost all of that cent
is Remotion's licence. At 100,000 videos a month that is about $1,100
against $57,000–$342,000 of AI calls.

## What was not measured

- **Any machine but this one.** One Apple M4, shared with other work (the
  quiet pass at a load average of 10–24). No Linux, no x86, no server.
  HyperFrames' `beginframe` capture runs only on Linux x86-64
  (`baselines/hyperframes-m4.md`), so its best path was not measured; its
  macOS default captures through the GPU.
- **Remotion Lambda, Cloudflare and any container** were not run. Every cost
  on those platforms in this document is an estimate from the measured CPU
  and the vendors' price sheets, and is marked so.
- **A Worker's real limits.** workerd enforces neither the 128 MB isolate
  limit nor the CPU limit locally. Memory is compared against 128 MB from the
  wasm memory the core reports and the process RSS; CPU from the workerd
  process's CPU time. Neither is a production reading.
- **Encoding H.264 inside a Worker.** No encoder was tried in wasm.
- **Footage and audio.** The scene has neither, by design: footage is
  decoded by ffmpeg and ingested as raw RGBA (688 MiB from 1.5 MB of clips in
  this repository's ledger), and audio is a separate ffmpeg mux. Both are
  container work in every design here.
- **Scenes of other densities.** One scene. Raster cost scales with what is
  painted: `baselines/shutter.md` measured 0.64 ms to 55 ms per frame across
  four scenes, and the dense 1080p HUD film that motivated this question was
  observed at about 1.2 s per frame during a busy overnight run. Nothing here
  says how Remotion or HyperFrames scale on those.
- **The pocket-motion build inside anything but Bun**, and the cost of an LLM
  writing a composition that builds and passes `lint`/`check` on the first
  attempt.
- **How long the AI calls take.** Only their prices were read. Nothing here
  says what share of a user's wait for a finished video the render is.
- **Motion blur in the browser renderers.** Neither port has an equivalent of
  the shutter, so the 2.5× and 5.9× above have nothing to be compared with.
- **A faster encoder.** Every render used x264 `medium` at CRF 16; a faster
  preset or a hardware encoder would cut the half of every total that is
  ffmpeg, for all three renderers alike.
- **Quality as a viewer judges it.** PSNR says the pictures agree; nothing
  here says which one looks better.

## Reproduce

```sh
# W is this checkout (vendored and with its fetched assets); S is any scratch
# directory. HF is a hyperframes 0.8.185 binary, WD a workerd binary, NM a
# node_modules holding remotion 4.0.482 with its chrome-headless-shell, and
# GSAP a copy of gsap.min.js 3.15.0. None of the four is in this repository.
B=$W/baselines/render-cost
$B/harness/stage-pm.sh "$W" "$S"                 # scratch tree, six builds
$B/harness/stage-rm.sh "$W" "$S" "$NM"
$B/harness/stage-hf.sh "$W" "$S" "$GSAP"
bun $B/workers/build.ts --dist "$S/proto/dist/compositions/bench-title" --out "$S/wk"
$B/harness/run-all.sh "$W" "$S" 3 "$HF" "$WD"      # core set x3, then the extras once
bun $B/harness/summarize.ts "$S/results"           # the result tables
bun $B/harness/cost.ts "$S/results"                # the cost tables
```

**To re-run on a quiet machine**, the core set alone — every number the
answer rests on, about 30 minutes at a load average near 12:

```sh
$B/harness/run-all.sh "$W" "$S" 3 "$HF" "$WD" --no-extras
```

The memory table, which does not depend on load:

```sh
D=$S/proto/dist/compositions
bun $B/harness/core-bench.ts --dist $D/bench-title --frames 2
bun $B/harness/core-bench.ts --dist $D/bench-title-s12 --samples 12 --frames 2
bun $B/harness/core-bench.ts --dist $D/bench-title-ss2 --scale 2 --frames 2
bun $B/harness/core-bench.ts --dist $D/bench-title-ss2-s12 --samples 12 --scale 2 --frames 2
bun $B/harness/core-bench.ts --dist $D/bench-title-ss4 --scale 4 --frames 1
```

The committed results reproduce every table here without running anything:

```sh
bun $B/harness/summarize.ts $B/results/quiet    # results, and the workerd CPU table
bun $B/harness/cost.ts $B/results/quiet         # cost tables
bun $B/harness/summarize.ts $B/results/loaded   # the loaded pass, the run-once rows, core-bench
```

`results/` holds the JSONL exactly as `measure.ts`, `workerd.sh` and
`core-bench.ts` wrote it, with the scratch and checkout paths replaced by `$S`
and `$W` and the per-frame hash lists dropped (the sequence digest stays).
`results/loaded/runs.jsonl` keeps the five browser runs taken before the
sampler fix; the scripts skip them.

The Worker prototype on its own, after the build step above:

```sh
cd "$S/wk" && "$WD" serve config.capnp --experimental &
curl 'http://127.0.0.1:18787/?from=0&to=300'                 # digest 856cc83a…
curl 'http://127.0.0.1:18787/?from=0&to=300&samples=12'      # digest 31e1f672…
cd "$S/wk/loader" && "$WD" serve config.capnp --experimental &
curl --data-binary @request.bin 'http://127.0.0.1:18788/render?at=0'
```
