# The encode leg: what `--encoder` and `--preset` cost and deliver

Measured 2026-11-05 for `render --encoder` and `render --preset`
(`src/render/encode.ts`). The question: how much of a render's CPU the
H.264 encode is, how much a hardware encoder or a faster x264 preset takes
off it, and what each gives up in bytes and picture.

Apple M4 (4 performance, 6 efficiency cores), 32 GB, macOS 26.5.1, Bun
1.3.11, ffmpeg 8.0 (Homebrew) with x264 0.165.3222. Load average 14–25 from
other sessions throughout; CPU seconds are the figure to read, wall times
moved with the load.

Two compositions, the ones the render-cost benchmark and the hajibang port
measured:

- **title** — `baselines/render-cost/pocket-motion/bench-title`, 10 s of
  1920×1080 at 30 fps: full-frame gradients and moving type, every frame
  different.
- **hajibang** — the hajibang ranking template's full sample
  (`compositions/hajibang-top-reveal/out/sample-full` on branch
  `claude/angry-carson-0abed5`, generated from `samples/sample-full.json`):
  55.5 s of 1080×1920 at 30 fps, 1,665 frames, photographs and type over a
  drifting dot grid.

Reproducers: `encode-cost/bench.ts` (the encode leg alone) and
`encode-cost/end-to-end.ts` (the `render` command). Every row below is in
`encode-cost/results/`.

## The encode leg alone

`bench.ts` renders a composition's frames once to raw RGBA and then runs each
configuration as the argv `ffmpegArgs` builds for it, reading that file where
`render` writes a pipe. CPU is ffmpeg's user + system time from wait4,
median of 3 runs for title and of 2 (1 for the `-q:v` rows) for hajibang.
PSNR and SSIM are of the decoded file against the source frames, both taken
to yuv420p through the default conversion the leg itself uses, so what is
measured is the codec's loss and not the chroma subsampling. `vs x264` is
PSNR against the default encode's own decode.

**title**, 300 frames:

| configuration | CPU s | Mb/s | PSNR dB | SSIM | vs x264 dB |
|---|---:|---:|---:|---:|---:|
| libx264 `medium` CRF 16 (default) | 13.04 | 1.18 | 56.83 | 0.99920 | — |
| libx264 `faster` CRF 16 | 9.61 | 1.22 | 55.37 | 0.99884 | 55.19 |
| libx264 `veryfast` CRF 16 | 6.41 | 1.01 | 53.80 | 0.99853 | 53.83 |
| VideoToolbox `-b:v` = x264's rate (1.18 Mb/s) | 1.91 | 1.23 | 50.08 | 0.99798 | 49.86 |
| VideoToolbox `-b:v` 2× | 1.85 | 1.90 | 52.66 | 0.99856 | 52.00 |
| VideoToolbox `-b:v` 3× | 2.10 | 2.48 | 54.07 | 0.99884 | 53.03 |
| VideoToolbox `-b:v` 15.55 Mb/s (0.25 bit/px) | 1.96 | 4.58 | 58.52 | 0.99939 | 55.40 |
| VideoToolbox `-q:v` 80 | 2.50 | 1.89 | 55.92 | 0.99883 | 54.38 |
| VideoToolbox `-q:v` 85 | 2.34 | 3.00 | 58.65 | 0.99925 | 55.62 |
| **VideoToolbox `-q:v` 87 (`--encoder h264_videotoolbox`)** | **2.22** | **3.27** | **59.99** | **0.99938** | 56.05 |
| VideoToolbox `-q:v` 90 | 2.25 | 4.33 | 61.21 | 0.99948 | 56.31 |

**hajibang**, 1,665 frames:

| configuration | CPU s | Mb/s | PSNR dB | SSIM | vs x264 dB |
|---|---:|---:|---:|---:|---:|
| libx264 `medium` CRF 16 (default) | 50.58 | 1.21 | 55.30 | 0.99909 | — |
| libx264 `faster` CRF 16 | 40.86 | 1.05 | 53.65 | 0.99862 | 52.90 |
| libx264 `veryfast` CRF 16 | 29.64 | 1.06 | 52.17 | 0.99821 | 51.81 |
| VideoToolbox `-b:v` = x264's rate (1.21 Mb/s) | 9.87 | 1.20 | 40.16 | 0.98700 | 40.22 |
| VideoToolbox `-b:v` 2× | 11.15 | 2.28 | 45.93 | 0.99577 | 45.90 |
| VideoToolbox `-b:v` 3× | 10.96 | 3.21 | 50.34 | 0.99804 | 49.82 |
| VideoToolbox `-b:v` 15.55 Mb/s (0.25 bit/px) | 10.60 | 5.50 | 55.38 | 0.99924 | 53.05 |
| VideoToolbox `-q:v` 80 | 10.82 | 3.21 | 52.31 | 0.99806 | 51.47 |
| VideoToolbox `-q:v` 85 | 11.28 | 4.14 | 55.50 | 0.99879 | 53.21 |
| **VideoToolbox `-q:v` 87 (`--encoder h264_videotoolbox`)** | **11.65** | **4.72** | **57.11** | **0.99912** | 53.91 |
| VideoToolbox `-q:v` 90 | 11.02 | 6.07 | 59.08 | 0.99940 | 54.53 |

What the hardware rows' CPU is: VideoToolbox's own work is on the media
engine, so what is left is ffmpeg reading the frames and converting RGBA to
yuv420p on the CPU, which every row pays. That is why the VideoToolbox CPU
does not move with its rate.

## Why `-q:v 87` and not a bitrate

**At a matched bitrate VideoToolbox does not deliver a matched picture.**
Given libx264's own rate it lost 6.7 dB PSNR on title and 15.1 dB on
hajibang; at twice the rate it was still 4.2 and 9.4 dB short. How many bits
it needs depends on the content: about 3× on title and about 4.5× on
hajibang to reach libx264's PSNR through `-b:v`.

**Its `-b:v` is not a rate it holds.** It follows the target up to about
3.5 Mb/s and then stops: asked for 15.55 Mb/s, it delivered 4.58 on title and
5.50 on hajibang, so a large target behaves as "as much as it chooses" and a
small one as a cap that costs picture.

**`-q:v` is VideoToolbox's constant-quality mode, CRF's counterpart**, and
per bit it is the better of the two: at 1.89 Mb/s on title `-q:v 80` gave
55.92 dB where `-b:v` 2× gave 52.66. **87 is the lowest value measured that
matches the default encode — libx264 `medium`, CRF 16 — in both PSNR and
SSIM on both compositions** (85 matched PSNR on hajibang and fell short in
SSIM, 0.99879 against 0.99909). It came out at **3.27 Mb/s on title and 4.72
on hajibang, 2.8× and 3.9× libx264's bytes**, and 29% and 14% below the
saturated `-b:v` that also matched. So the hardware encoder buys its CPU with
bytes: about a fifth of the encode CPU for three to four times the file.

`-q:v` needs Apple silicon; VideoToolbox on an Intel Mac has no
constant-quality mode, and none was measured. Three encodes of title at
`-q:v 87` on this M4 decoded to the same frames (`ffmpeg -f framemd5`); no
second Mac was available, so whether another machine's encode is the same
bytes is not measured here — the code and the docs treat it as not.

## Presets: the lever without hardware

Linux, and every serverless host this project deploys to, has no hardware
encoder; `--preset` is what moves the encode there. At CRF 16:

| | title CPU | hajibang CPU | title PSNR | hajibang PSNR |
|---|---:|---:|---:|---:|
| `medium` | 13.04 | 50.58 | 56.83 | 55.30 |
| `faster` | 9.61 (−26%) | 40.86 (−19%) | 55.37 | 53.65 |
| `veryfast` | 6.41 (−51%) | 29.64 (−41%) | 53.80 | 52.17 |

The faster presets give up 1.5–3.1 dB at the same CRF, at about the same
bytes (`veryfast` was 14% smaller on title and 12% on hajibang). Whether that
loss shows on the device a film is watched on is not measured here, so the
default stays `medium` and the preset is a choice the delivery makes.

## End to end

`end-to-end.ts` runs `render <dir> --out … --json` per configuration, three
times each and round-robin, and reads the child's rusage at exit: Bun and its
ffmpeg together (wait4 on macOS includes the descendants a process waited
for; checked with a `sh -c` whose background child spun for the run). The
digest must be the same in every run.

CPU seconds per rendered video, median of 3 with the spread in brackets:

| configuration | title, 300 frames | hajibang, 1,665 frames, sound muxed | `compositions/transitions`, 756 frames, 403 held |
|---|---:|---:|---:|
| default: libx264 `medium`, reuse on | 24.7 [22.1–28.7] | 84.9 [78.8–86.0] | 31.1 [30.3–35.3] |
| `--no-reuse` | 24.2 [24.0–27.2] | 80.7 [77.1–86.0] | 35.6 (+14%) [33.8–35.7] |
| `--preset faster` | 22.4 (−9%) [19.6–24.5] | 75.5 (−11%) [70.3–79.8] | 31.3 [26.7–31.5] |
| `--preset veryfast` | 18.8 (−24%) [15.8–20.0] | 59.0 (−30%) [58.3–65.6] | 22.8 (−27%) [20.4–27.4] |
| `--encoder h264_videotoolbox` | 15.5 (−37%) [12.4–16.6] | 41.0 (−52%) [40.6–42.9] | 15.4 (−50%) [15.2–16.8] |

Wall seconds and the file, for the same runs:

| configuration | title | hajibang | `transitions` |
|---|---:|---:|---:|
| default | 14.4 s, 1.47 MB | 45.8 s, 9.04 MB | 15.3 s, 1.44 MB |
| `--no-reuse` | 13.6 s, 1.47 MB | 41.5 s, 9.04 MB | 21.2 s, 1.44 MB |
| `--preset faster` | 16.7 s, 1.53 MB | 51.5 s, 7.96 MB | 16.8 s, 1.42 MB |
| `--preset veryfast` | 14.1 s, 1.27 MB | 40.0 s, 8.03 MB | 10.9 s, 1.46 MB |
| `--encoder h264_videotoolbox` | 19.3 s, 4.08 MB | 34.1 s, 33.39 MB | 15.7 s, 2.53 MB |

Read against each other:

- **The hardware encoder takes 37–52% off a video's CPU**, and more the more
  of the video's CPU was the encode: title's renderer is heavy (51 ms a
  frame of gradients), hajibang's and `transitions`' are not. Its files are
  2.8×, 3.7× and 1.8× the default's.
- **`veryfast` takes 24–30% off** with no hardware and files about the
  default's size.
- **Where a film holds, the reuse is the third lever and it stacks with the
  other two.** `transitions` reuses 403 of 756 frames: 13% of its CPU and
  28% of its wall, since the encoder runs beside the renderer and the
  renderer is what the wall waits for. Title and hajibang reuse nothing (see
  `raster-reuse.md` for why hajibang does not), and there `--no-reuse` is
  within the spread of the default: the key's own cost is 0.05–0.09 ms a
  frame, under 0.2 s a film.
- Wall time is set by the slowest of renderer and encoder, which run in two
  processes: VideoToolbox's wall on title is longer than libx264's here and
  shorter on hajibang. The CPU columns are the figure for a host billed by
  CPU.

## Reproduce

```bash
# not run: needs a built composition; the two above are staged as described in baselines/render-cost/harness/stage-pm.sh and on the hajibang branch
bun baselines/encode-cost/bench.ts <composition-dir> --work <scratch dir> --runs 3
bun baselines/encode-cost/bench.ts <composition-dir> --work <scratch dir> --q 85,87,90
bun baselines/encode-cost/end-to-end.ts <composition-dir> --work <scratch dir> --runs 3
```

## What this does not say

- One machine, one ffmpeg (8.0), one x264 build. The x264 presets'
  ratios should carry to the Linux hosts; their absolute seconds will not.
- The delivery-encode change in anelikes/pocket-motion#13 (BT.709 named in
  the conversion and tagged) was not in the tree when this was measured, and
  is now. It moves the conversion every row pays, not the comparison between
  encoders; the rows were not re-run after it.
- PSNR and SSIM are averages over the film. A codec that spends its bits
  unevenly can match an average and still show a worse frame.
