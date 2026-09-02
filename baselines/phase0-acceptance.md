# Phase 0 acceptance — 2026-08-11

The three acceptance criteria for the first milestone — determinism has a
mechanism, it is reproducible and portable, and it is faster head to head —
measured on Apple M4 (10 cores),
Bun 1.3.11, ffmpeg 8.0, upstream pocketjs at `272b1a9`.

## ① Determinism has a mechanism

A composition that calls the forbidden APIs must be **rejected**, with a message
naming the API and pointing at the alternative.

Fixture: `compositions/malicious/main.tsx` — calls `Date.now()`, `Math.random()`
and `(1234.5).toLocaleString()` at module scope.

```
✅ 被拒绝 · DeterminismViolation
   PocketJS Motion: `Date` is non-deterministic and is blocked.
   Use the virtual clock instead — time is the frame index.
```

The harness carries 70 tests including the full escape matrix; the three that
matter most were found by adversarial probing rather than by the spec:
sentinel prototype chains, thrown host errors, and values returned or thrown by
contract-slot methods.

## ② Reproducible, and portable

### 2a — same machine, independent processes

Two runs of the smoke composition from different working directories:

```
run1 digest 3af02400c34832a7719e71cb8a74f8aade42c0859dc3295f50196e6d788a6e0e
run2 digest 3af02400c34832a7719e71cb8a74f8aade42c0859dc3295f50196e6d788a6e0e   ✅ identical
```

### 2b — across platforms

The same composition, 120 frames at 1920×1080, on the macOS host and in a Linux
container. Note the architectures differ too — this is not just a different OS:

| | platform | arch | digest |
| --- | --- | --- | --- |
| host | darwin | **arm64** | `a202fab2d036cbe192d7082345c1827e…` |
| container | linux | **x64** | `a202fab2d036cbe192d7082345c1827e…` |

**Every frame hash identical.** Different OS, different architecture, different
Bun build, same pixels.

This is the claim the project rests on, and it is now measured rather than argued.

## ③ Head to head

Target was ≥3× faster than HyperFrames, single thread.

| | ms/frame | parallelism | content |
| --- | ---: | --- | --- |
| HyperFrames `nyt-graph` | 38.19 | 1 worker | GSAP data-viz, 1080p |
| HyperFrames `nyt-graph` | 32.20 | 10 workers | same |
| **Motion, smoke composition** | **5.75** | **1 thread** | baked timelines + arc, 1080p |
| **Motion, footage composition** | **22.49** | **1 thread** | 1080p video underlay + text overlay |

- Motion graphics: **6.6×** faster than HyperFrames on one worker, **5.6×** faster
  than HyperFrames across all ten. ✅
- With full-frame footage: **1.7×**. The gap narrows because a 1080p RGBA upload
  per frame is memory-bandwidth work both systems must pay.

Both Motion figures include frame hashing **and** H.264 encoding.

> ⚠️口径: the content is comparable in class (1080p motion graphics) but not
> identical. A true same-content head-to-head needs the smoke composition ported
> to HyperFrames, which is not done. The numbers are honest about what they are.

## What Phase 0 shipped

| # | item | state |
| --- | --- | --- |
| 1 | repo scaffold | ✅ |
| 2 | dynamic viewport spike | ✅ — and corrected the Phase 1 supersampling plan |
| 3 | determinism harness | ✅ 70 tests |
| 4 | mount-only lint + runtime oracle | ✅ |
| 4b | `pocket-motion.json` sidecar | ✅ 42 tests |
| 4c | framework diagnostics | ⚠️ partial — ops counting works; module-private timer/effect counters still need the build-time alias |
| 5 | `FrameSource` (forward-only) | ✅ |
| 6 | render pipeline → MP4 | ✅ |
| 7 | frame hashing + input identity | ✅ |
| 8 | footage ingest + host layer | ✅ |
| 9 | smoke composition | ✅ |

145 tests, typecheck clean.

## Facts worth carrying into Phase 1

- **Mount-only is real, not aspirational.** The smoke composition: 97 ops to
  mount, then **0 guest ops across 450 frames**. The footage composition: 77 then
  **0 across 120**. All motion came from the core playing baked timelines.
- **Texture accounting balances**: 12 live handles for 12 tiles, no leak — the
  check a synthetic composition cannot exercise.
- **Supersampling needs `--density=N` as well as `renderScale=N`.** Geometry is
  evaluated per physical pixel, glyphs are duplicated from the atlas, so
  renderScale alone makes text *worse*. Cost: pak 464 KB → 7.09 MB at density 4.
- **Uncompressed ingest is large**: 120 frames of 1080p RGBA is 949 MiB. A lossless
  intermediate is needed before this scales to real clip lengths.
