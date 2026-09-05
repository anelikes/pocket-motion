# masked — four windows, one op, what each one is for

`overflow-mask` (`patches/0013`, the design in
`patches/0013-mask-op.design.md`) clips a node's children and its own ground
to the node's outline — its rounded rectangle under its transform — where
`overflow-hidden` clips to the axis-aligned box. This fixture is one window
per thing the op has to get right, each in a 960×540 quadrant, 90 frames at
30 fps. Every window and everything inside one carries a `debugName`, and
`pocket-motion.json` asserts what each is for against the picture.

| window | what it shows | what it took |
|---|---|---|
| iris | a circle growing about a fixed centre reveals scene B over A; B does not move | `rounded-[350px]`, not `rounded-full`: the compiler resolves `rounded-full` from the size written in the literal, 0px here, while a px radius is clamped to half the box at draw time and follows the growing box. The window's `width`/`height`/`left`/`top` and the child's `left`/`top` are one keyframe pair on one easing — all six numbers are affine in the box size, so they stay consistent at every frame |
| wipe | a diagonal edge sweeps the quadrant; the scene behind it never moves | the window is rotated 20° about its left edge (`origin-left`) and only its `width` animates, 0 → 2400 px, so the left edge stays put and the right one sweeps. The scene inside is `rotate-340 origin-left`, its origin placed on the same point as the window's, so the two rotations cancel exactly and the scene needs no animation at all. There is no spelling for a negative angle; 340 is −20 |
| card | a `rounded-[40px]` window holds text that overflows it | nothing: `layout` reports `clipped_text` on `card-text`, on purpose — the mask is a clip, and the finding is the evidence |
| nested | a circle window inside a rotated window | nothing: nested masks multiply, and the outline is clipped to the viewport rather than to the scissor so that the inner polygon does not depend on the outer one (`tests.rs`, `nested_masks_multiply_their_coverage`) |

Both ledgers carry it. `check` passes: a mask is baked geometry, like a
scissor, and no JavaScript runs per frame. What `visibility` says about a
node behind a mask is in the sidecar's assertions and in
`baselines/visibility.json`.
