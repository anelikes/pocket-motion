# transitions — nine ports, and what each one lost

Nine transitions from the HyperFrames catalog (`registry/components/*` and
`registry/blocks/*`), each re-expressed as baked timelines between two
placeholder scenes: A, a slate dashboard with three rows; B, a teal-to-green
analytics layout. The sources are HTML with a GSAP or CSS timeline, so the
numbers below were read, not measured. Every segment is 2.8s: A holds for
400ms, the transition plays, B holds, the next segment cuts in.

| segment | in the catalog | here | lost |
|---|---|---|---|
| cut-the-curve | outgoing to −34% of the width over the first third with `power4.in`, blur 12px and opacity 0.72 at the seam; hard swap; incoming from the far side over the remaining two thirds with `power4.out`, entry distance scaled by the time ratio so the velocities match | the same numbers; opacity carried, blur not; B waits behind a gate on a wrapper (see below) | the seam blur |
| directional-wipe | B clipped by `inset()` from the left over the push with `power3.inOut`, sliding 60px→0 and settling 1.04→1; A to 0.96 with blur; a light band crosses in 580ms; a one-frame RGB split at the seam | an `overflow-hidden` window whose width bakes 0→1920; B and A scale as written; the band is two gradients back to back | A's blur; the RGB split (a blend) |
| fade-through | A out into a `#f8f5ec` wash, wash out over B | A 350ms out, wash 350ms in / 450ms out, B 450ms in from the wash's peak | the `bloom` variant (a radial gradient) |
| grid-pixelate-wipe | 16×9 cells `scale(0)`→1 with a stagger, then out | cells pop 220ms `power2.out` on a diagonal stagger of 28ms per row+column; A cuts to B under full cover; cells pop out in the same order | nothing |
| match-cut | circle 0.54→0.64 over 450ms `power3.out`, →1 over 950ms `power4.in`; hard cut at 1400ms; B's circle 1→0.74 over 650ms `power4.out`; copy rises with `power3.out` | the same, with `rounded-full` boxes scaled about their centre | the 0.08s stagger between B's kicker and label (one copy line here) |
| rubber-band-bumper | five equal pulls to 5, 8.5, 10.5, 11.75, 12.25% each `power2.out`, then a snap to −112% with `back.out(1.7)` over 84% of the release; B from −5%, 0.985, 0.82 with the same overshoot; accent bands stretch and let go | the pulls are one keyframe set with five stops, the snap a second animation starting where the first ends; three bands on the right edge grow with the pull | the cross-axis arc (a `yoyo` the shorthand cannot say) |
| whip-pan-cut | A and B on one strip, −100% over 550ms `power3.inOut`, a directional blur capped at the peak, cut at the midpoint | the strip plus three echoes of it one, two and three ticks behind at 0.45, 0.28 and 0.18 opacity | the blur, which the echoes stand in for |
| iris-reveal | a circle `clip-path` opens from an authored origin over 1100ms `power2.inOut` revealing B; a rim ring tracks the edge | **flat port**: B's ground colour grows as a `rounded-full` box to a radius clearing the far corner, a ring on the arc primitive rides its edge, B's content fades in once covered | the reveal of B's content through the clip |
| halftone-dissolve | ink dots on a fixed grid grow smallest-first, each opening a window onto B through a `clip-path` | **flat port**: dots of B's ground colour grow left to right with a seeded jitter until they merge; B's content fades in over the field | the same |

## What the vocabulary decided

- **The later animation in a comma list wins a shared property.** The first
  cut of cut-the-curve put `gin … both` before B's translate tween, whose
  `from` carried opacity 0.72 with `both` fill, and B showed at 0.72 before
  the cut. The gate that hides B until the cut is on a wrapper now, where
  opacities multiply instead of contending.
- **A shrinking scene shows what is behind it.** A scaled to 0.96 exposes
  the root at its edges, so the root is `#0b0f14` rather than black; the
  catalog stages every demo on a card over a dark page and never meets
  this.
- **Two gradient stops, four directions.** The light band is two
  back-to-back gradients; a diagonal gradient (`to-br`) is not in the
  compiler, which has `to-t`, `to-b`, `to-l` and `to-r` only. A rotated
  gradient box fans into gouraud triangles, though, so a diagonal band is an
  oversized `bg-gradient-to-r` box under `rotate-45` inside an
  `overflow-hidden` window; not tried here.
- **No mask, so two reveals are flat.** The iris and the halftone reveal B
  *through* a growing clip in the catalog. Without a mask the growing shape
  can only be B's ground; when B is a flat card the pictures agree, and when
  B is a photograph they do not. A mask primitive — any clip that is not an
  axis-aligned rectangle — would turn both flat ports into the real thing,
  and is the single change on the engine that this family most needs.
- **No blur.** Three of the nine blur at the seam. The whip pan's echoes are
  the one substitute that reads; the others simply drop it.

## What the engine would need for the rest of the catalog

Of the catalog's 66 transition entries, 17 are shader blocks (glitch, light
leak, ripple, swirl, thermal, gravitational lens, SDF iris, ridged burn,
domain warp, cross warp, chromatic radial split, cinematic zoom, whip pan,
flash through white, and the 3D, blur and distortion showcases) — a fragment
shader over the framebuffer, which is outside this rasteriser by design.
The rest divide by the primitive they lack: a mask (iris, halftone, the
radial and mechanical showcases, before/after and comparison wipes), a blur
(text state swap, icon swap, number pop-in, the destruction showcase), or a
perspective rotation of a whole scene (the 3D showcase). That last one is a
claim this port did not test and the code does not support: `perspective-[N]`
and `rotate-y-[N]` compile, and a rotated or perspective-projected image is
fanned into textured triangles (`emit_tex_quad` and `paint_3d` in
`engine/core/src/draw.rs`; the header comment there saying rotated images are
culled is older than the code under it, and the engine's own tests
`rotated_3d_face_emits_poly_textured_still_tex_tri` and
`perspective_subdivided_images_form_one_texture_run_per_image` pass). What
stays outside the 3D contract is glyphs, which draw upright and unscaled, and
radius, border and shadow. So the 3D showcase wants nothing the engine lacks
and was left out with the rest. Push, cover, scale, dissolve and grid
showcases, page slide, panel reveal, tabs indicator, card resize and the
transitions.dev micro-transitions need nothing the vocabulary lacks and were
left out only for size.

## Verification

`lint` and `check` exit 0; the digest and visibility ledgers carry it. Each
segment was looked at on six frames across its span.
