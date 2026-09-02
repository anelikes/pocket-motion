# HyperFrames port of PocketJS Motion reel v7

Faithful **content** recreation of `/tmp/pocketjs-motion-reel-v7.mp4` for a
head-to-head render-time comparison — not a pixel-identical port.

| | PocketJS Motion v7 | This HyperFrames port |
| --- | --- | --- |
| Duration | 28.2 s / 846 frames / 30 fps | same |
| Resolution | 1920×1080 | same |
| Shots | title · remove browser · numbers · trade · lockup | same structure |
| Motion | baked DRIVE timelines | GSAP with the same cubic-bezier |
| 3D room turns | yes (gated walls) | **skipped** — flash cuts only (HF can do 3D; omitted to keep the port fair on content density) |
| Audio | Mixkit Cat Walk (post-mux) | none in this run (picture-only timing) |

## Dependencies not in the repository

`gsap.min.js` is **GSAP 3.15.0**, fetched from
`https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js`. It is gitignored —
a third-party minified library carried for one benchmark does not belong in a
repository about a rasteriser, and it has its own licence to respect. Fetch it
into this directory before rendering.

`render.mjs` also needs a local `../../../hyperframes-main` checkout with
`packages/producer` buildable, so this benchmark is reproducible with that
checkout and not from this repository alone. The measured result is in
[`TIMING.md`](./TIMING.md) and stands on its own.

## Render

```bash
# 1 worker (honest single-thread compare with Motion)
WORKERS=1 bun baselines/hyperframes-reel-v7/render.mjs

# auto-ish multi-worker
WORKERS=10 bun baselines/hyperframes-reel-v7/render.mjs
```

Requires local checkout `../hyperframes-main` with `packages/producer` buildable
via Bun (uses `we-render`-style `executeRenderJob`).

## Motion timing (recorded)

See the parent conversation / this directory after render for wall-clock numbers.
Motion v7 picture render was **~6.1–6.5 s** (7.3–7.7 ms/frame) on the same M4.
