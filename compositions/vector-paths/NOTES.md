# vector-paths — five outlines, two patches, what each one is for

`<Path>` (`patches/0042` and `0043`, the design in
`patches/0042-vector-paths.design.md`) is a View that also draws a baked vector
outline: filled, stroked, trimmed by arc length and morphed between keys. This
fixture is one quadrant per thing the op and the declaration have to get right,
each 960×540, 120 frames at 30 fps. Every path carries a `debugName`, and
`pocket-motion.json` asserts what each is for against the picture.

| path | what it shows | what it took |
|---|---|---|
| signature | an open curve stroked 7 px with round caps and joins, drawn on by `trimEnd` 0 → 1 from frame 9 to 54 | nothing it emits before frame 9: a path trimmed to nothing is invisible by declaration, which `layout` names `text_not_painted` — the sidecar's `layoutAllow` says why that is the point. `signature-caption before signature` is the assertion a draw-on that ignored its trim would fail; `entersBy` and `dwellFrames` alone would pass it |
| blob | eight cubics morphing from a circle to a star and back, filled with a 135° gradient through `bg-clip-path`, stroked 3 px | the two keys written with the same eight `C` commands — keys are aligned, never resampled. `alternate` is not in the animation vocabulary, so the keyframe goes 0% → 50% → 100% explicitly |
| wedge-0 … wedge-5 | a hexagon cut into six triangles that share every edge | nothing: the seams are partitioned, each sample on a shared edge counted by one wedge. A pixel the seam crosses is still two blends, so a trace of the ground shows through it (the design's conflation note); no gate here measures that |
| globe, orbit | a wireframe of two ellipses and four lines in a `0 0 100 100` viewBox, stroked `stroke-[1px]` — 3.6 px on screen, the width is in viewBox units — and turning; a fifth of a ring orbiting it, its trim window wrapping past the ring's start every turn | the turn is its own `turn` keyframe rather than `animate-spin`, so the fixture says what it plays |
| wave | two keys of one wave, crest and trough exchanged, each 250 px past its `rounded-[48px] overflow-mask` window on both sides, morphing; gradient fill | the box is the window's: an earlier cut slid a 900 px box inside the window, and `layout` reported it escaping the window and overlapping the globe — true of the box, not of the picture. Morphing the geometry inside a box that stays put says the same thing about the mask with nothing to excuse |

Both ledgers carry it. `check` passes with no op after mount: every moving
thing is a baked timeline on a path prop or a transform.
