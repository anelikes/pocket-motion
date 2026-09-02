# Phase 5 — throughput

Apple M4 (4 P-cores + 6 E-cores), Bun 1.3.11, ffmpeg 8.0.
Subject: the 64 s introduction reel, 1920 frames at 1920×1080.

## Where the time actually goes

Per frame, 1080p, measured in isolation:

| stage | ms |
| --- | ---: |
| rasterise `render()` | 1.19 |
| **SHA-256 frame hash** | **2.72** |
| copy the framebuffer | 0.27 |
| fold `tick` + `draw` | 0.035 |
| boot + eval + mount | 81 (once) |

**Phase 0's "93% of the time is rasterisation" does not hold for real content.**
That figure came from a synthetic scene of 400 overlapping rounded translucent
boxes — deliberately heavy on fill rate. A composition made of text and rules
rasterises far less, and there the determinism oracle costs more than twice the
renderer.

## Hash algorithm

Same 8.3 MB frame:

| | ms |
| --- | ---: |
| SHA-256 | 2.71 |
| BLAKE2b-256 | 5.67 |
| **wyhash (`Bun.hash`)** | **0.24** |
| xxHash64 | 0.36 |

End to end this takes the render from **5.32 → 3.54 ms/frame (1.50×)** — more
than parallelism achieved, from one line.

**It stays opt-in, and `sha256` stays the default.** wyhash is integer-only and
ought to be platform-independent; it is stable across processes here. But only
SHA-256 has actually been through the darwin/arm64 vs linux/x64 container check,
and this project does not ship "ought to" as verification. Pending.

> **Resolved 2026-08-13** — [`hash-portability.md`](hash-portability.md). Equal
> across darwin/arm64 and linux/x64, and across Bun 1.1/1.2/1.3 (the axis that
> actually mattered, since `Bun.hash` is not a standard). Now reachable as
> `--hash fast`, measured at **1.87x** end to end on the reel rather than the
> 1.50x predicted here. The default stays `sha256` because every digest in
> `baselines/` is one.

## Frame-parallel across processes

No core change needed. A worker folds from frame 0 to its range start at
0.035 ms/frame against 1.19 ms of rasterisation, so the redundant folding is
under 1% and nothing is shared between processes.

1920 frames, digest identical to the sequential run in **every** configuration:

| configuration | ms/frame | speedup |
| --- | ---: | ---: |
| sha256 + libx264, 1 thread | 5.32 | — (Phase 0 baseline) |
| fast hash + libx264, 1 thread | 3.54 | 1.50× |
| fast hash, **no encode**, 4 workers | **0.76** | **2.56×** |
| fast hash, no encode, 10 workers | 0.77 | 2.52× |
| fast hash + libx264, 4 workers | 2.97 | 1.19× |
| fast hash + h264_videotoolbox, 1 thread | 4.25 | 0.83× |

Two things fall out:

1. **Rendering plateaus at 4 workers** — the P-core count. The six efficiency
   cores add essentially nothing.
2. **With libx264 in the loop, parallelism is wasted**: every worker runs its own
   encoder and they contend for the same cores. Hardware encoding does not rescue
   it either — VideoToolbox's per-frame submission overhead exceeds the CPU it
   saves at 1080p30.

So parallelism pays when encoding is out of the loop — verification runs, or raw
frames feeding a single downstream encode — and not otherwise.

## What this means for the plan

**Band-parallel rasterisation is not worth building.** The plan proposed adding an
RGBA window target to the Rust core and rasterising bands across threads. The
renderer is not the constraint; that work would have bought nothing measurable
and would have touched a format every upstream backend consumes.

The remaining lever, if throughput ever matters more than it does now, is the
encoder — one encode process fed by many render workers, rather than one each.
