# Head-to-head: reel v7 content on HyperFrames vs PocketJS Motion

**Machine:** Apple M4 (10 cores), macOS, 2026-08-12  
**Content:** 28.2 s · 1920×1080 · 30 fps · **846 frames** (same structure as Motion reel v7)  
**HF project:** `baselines/hyperframes-reel-v7/`  
**Motion reference:** Claude’s `/tmp/pocketjs-motion-reel-v7.mp4` (`7.27–7.71 ms/frame` picture render)

## Results

| pipeline | workers | wall | ms/frame (wall/846) | vs Motion ~6.15 s |
| --- | ---: | ---: | ---: | ---: |
| **PocketJS Motion** `build-reel` render step | 1 | **~6.15 s** (6149–6518 ms) | **7.27–7.71** | 1× |
| HyperFrames port | **1** | **41.18 s** | **48.68** | **~6.7× slower** |
| HyperFrames port | **10** | **25.12 s** | **29.69** | **~4.1× slower** |

Motion still wins **~4×** against HF with all 10 workers, and **~6.7×** single-thread.

### HyperFrames 1-worker stage breakdown (cold-ish)

| stage | ms | notes |
| --- | ---: | --- |
| compile | 10647 | first run fetched Google Fonts for Inter/Helvetica |
| capture_streaming | 30461 | screenshot mode on macOS; 51% static-frame dedup |
| assemble | 50 | |
| **pipeline total** | **41179** | |

### HyperFrames 10-worker stage breakdown (fonts already cached)

| stage | ms | notes |
| --- | ---: | --- |
| capture_disk | 20419 | parallel Chrome workers |
| encode | 2942 | separate encode pass (non-streaming path) |
| assemble | 49 | |
| **pipeline total** | **25074** | ~1.64× vs 1-worker wall |

## Outputs

| file | size |
| --- | --- |
| `/tmp/pocketjs-motion-reel-v7.mp4` | Motion original (with Mixkit audio) |
| `/tmp/pocketjs-motion-reel-v7-hf-w1.mp4` | HF 1 worker, picture only |
| `/tmp/pocketjs-motion-reel-v7-hf-w10.mp4` | HF 10 workers, picture only |

## Fairness caveats

1. **Not pixel-identical.** HF port uses GSAP + full CSS; Motion uses baked timelines + soft raster. Same shots/copy/numbers, no 3D room turns in HF port (flash cuts instead).
2. **Motion number is the `render` step only** (seek → raster → hash → H.264). Full `build-reel` also runs gen + Pocket build + check + audio mix (~few more seconds).
3. **HF number is full producer pipeline** (compile + capture + encode). Cold compile paid Google Fonts once (~10 s); warm runs are faster at compile.
4. **macOS forces screenshot capture** for HyperFrames (not Linux beginFrame).
5. HF got a free win from **static-frame dedup** (~51% of frames reused) — holds in title/lockup are cheap on HF; Motion still rasterises every frame.

## Reproduce

```bash
# Motion (from repo root)
bun scripts/build-reel.ts --silent --out /tmp/verify-motion.mp4
# look for: N ms/frame (XXXX ms total)

# HyperFrames
WORKERS=1 bun baselines/hyperframes-reel-v7/render.mjs
WORKERS=10 bun baselines/hyperframes-reel-v7/render.mjs
```
