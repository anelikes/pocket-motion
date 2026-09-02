# Phase 4 defect 2 — blend modes, 2026-08-13

The second of the two raster defects asserted from a survey: *"only alpha
blending — no screen / multiply / overlay"*. It was the last assertion in the plan nobody had checked, and the two
checked before it both came back different from the survey: defect 1 was not "no
mipmap" but no filtering at all, and Phase 5's premise that 93% of the time was
rasterisation was simply wrong.

This one is true as written. What it does not say is where the line actually
falls, which turns out to be the useful part.

## The assertion holds, by reading

| | |
| --- | --- |
| `RenderTarget::blend(offset, r, g, b, a)` | one signature, no mode parameter |
| DrawList ops | no mode word — `TEX_QUAD` carries a modulate colour, which multiplies the *source* by a constant, not by the destination |
| `contracts/spec/spec.ts` | no blend-mode concept at all |
| Tailwind compiler | zero references to blend |
| PSP backend | `sceGuBlendFunc(Add, SrcAlpha, OneMinusSrcAlpha)` set **once per pass** (`ge.rs:473`, `veil.rs:131`) |

That last row is the cost the plan does not mention. Blend state on PSP is
per-pass, and `ge.rs` batches consecutive `TEX_QUAD`s sharing a texture into one
primitive run. A per-node blend mode would either break that batching or require
splitting the frame into passes — so "add a mode word to the op" understates it
on the backend that the whole `no_std` constraint exists for.

## There is nothing here to measure as quality

Defect 1 was a quality question with a reference to compare against: how far from
a correct downscale, and does the error crawl frame to frame. This is not that.
`screen` is not a worse `src-over`; it is a different operation. "How wrong is
it" has no meaning, and a number would only look like evidence.

So the question worth measuring is the one that decided defect 1: **does the
pipeline already have a place where this is free?** For half the cases, it does.

## Host-to-host is already reachable

Footage layers are host-owned — `src/footage/layer.ts` holds the pixels and
uploads them. Two footage layers blended *with each other* can be composited by
the host before upload, in a plain loop, with **no core change at all**.

Measured at 1920×1080, per frame ([`scripts/blend-probe.ts`](../scripts/blend-probe.ts)):

| mode | ms/frame | vs the rasteriser's 1.19 |
| --- | ---: | ---: |
| src-over (a pure copy — the floor) | 1.69 | 1.4× |
| multiply | 4.11 | 3.5× |
| screen | 4.24 | 3.6× |
| overlay | 7.04 | 5.9× |

**The floor matters more than the modes.** A pure copy of two 7.9 MB layers costs
1.69 ms, so that is memory bandwidth and no host-side per-pixel pass in
TypeScript beats it. Against it, multiply and screen cost about 2.4 ms of actual
arithmetic and overlay about 5.3 ms — and screen costing the same as multiply is
the expected shape, since they are the same operation with the operands inverted.

Whether 4–7 ms is affordable depends on the shot: it is the same order as the
whole current per-frame cost (`trace` on the reel is 2.85 ms/frame with
`--hash fast`), but it is paid only on frames that actually blend.

### A caveat about how these were measured

The first version of this probe dispatched through a
`Record<string, (s, d) => number>` and reported **overlay at 154 ms against
multiply's 6.7** — for arithmetic differing by one comparison. That was the call
site going megamorphic as the loop worked down the table: the benchmark measuring
itself, wrong by up to 22×. The numbers above come from one monomorphic loop per
mode with the arithmetic written inline. A blend benchmark that degrades
monotonically in table order is measuring dispatch, not blending.

## Guest-in-the-blend is not reachable, and that is the real gap

Blending footage against something the *composition* draws — text, a gradient, a
rounded rect — cannot be done host-side. The host does not have those pixels
until the core has already composited them, by which time the src-over it would
need to undo has happened.

That is the case a video tool actually wants: a title screened over footage, a
gradient multiplied into it. It needs the core, and on PSP it needs the per-pass
blend state question answered.

## Where this leaves Phase 4

- **Footage × footage:** available now, host-side, 4–7 ms/frame at 1080p.
- **Footage × composition:** needs core work, and the PSP batching cost makes it
  larger than "a mode word on the op".
- Nothing shipped uses either. As with the mip chain, the trigger is a product
  decision that has not been made — and this one shares that decision with the
  deferred blur/mask question, since all three are the same request: *let a layer
  interact with what is under it*.
