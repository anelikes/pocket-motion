# Path primitives — dashes, a morph between unlike keys, motion along a path

The design of two `motion`-class patches and one module of this repository:
`0045-path-dashes.patch` (the core and the tokens), `0046-morph-equalisation.patch`
(the compiler) and `src/anim/path-motion.ts` (the generator kit). It builds on
`0042`/`0043`, whose design is `patches/0042-vector-paths.design.md`; every
number below is in [`baselines/path-primitives.md`](../baselines/path-primitives.md)
with the command that produced it.

## What it is for

An agent working on another project declined this repository for vector
animation, comparing it with HyperFrames and GSAP's DrawSVG, MorphSVG and
MotionPathPlugin. DrawSVG is `trimEnd` (0042). The other two, and SVG's dash
pattern, were the gap:

- **dashes** — `stroke-dasharray`, and marching ants by animating
  `stroke-dashoffset`. `docs/arknights-port-ab.md` (on its own branch) drew a
  region's dashed border as about 2,000 rectangles in 12 filled paths because
  there was no pattern;
- **a morph between keys drawn separately** — an icon into another icon.
  0043 refused keys whose commands differed;
- **motion along a path** — a node following an outline, turned to its
  direction of travel.

## Dashes (0045)

### The declaration

| prop | id | kind | animatable | default |
|---|---:|---|---|---|
| `dashCount` | 187 | int 0..4 | no | 0 (solid) |
| `dash0` … `dash3` | 188-191 | f32, path units | no | 0 |
| `dashOffset` | 192 | f32, path units | bit 65 | 0 |

Six of the eleven ids 187-197 the path block left free. A pattern is style,
not geometry: no op, no table and no `styles.bin` field changes, and a
composition with no pattern writes the bytes it wrote.

| token | sets |
|---|---|
| `stroke-dash-[a_b...]` (`_` or `,`) | `dashCount` and `dash0`..: 1 to 4 lengths, each >= 0, not all 0 |
| `stroke-dash-none` | `dashCount` 0 |
| `stroke-dash-offset-[N]` | `dashOffset`, any sign |

A pattern the core would draw solid — more than four lengths, a negative one,
all zero, a length that is not a number — does not parse, and a class=
attribute refuses a token that does not parse (`0041`): a class that says
dashed and draws solid would be a picture nobody declared. Keyframe names for
the offset are `dashOffset`, `strokeDashoffset` and CSS's `stroke-dashoffset`.
0043 refused `stroke-dashoffset` as a spelling of trim; it is now SVG's
offset, a length, and trim stays the fraction.

Four lengths is a choice. SVG allows any count; the props are scalars, so a
longer pattern would take more ids or a table. Dash-gap and dash-gap-dot-gap
are two and four; an odd count is repeated as SVG repeats it, so three
lengths make a pattern of six.

### What the core does

`emit_stroke` calls `dash()` where it called `trim()`. With no pattern
`dash()` IS `trim()` — the same call — so every stroke without one is the
bytes it was (`a_solid_pattern_is_the_trim_byte_for_byte`, and every recorded
digest of the ledger).

With a pattern, per subpath of the flattened local outline:

1. **The trim window as spans** of arc length, placed as 0042 places them
   (`each` per subpath, `whole` over the sequence, a wrapping offset).
2. **The dashes.** The offset is the distance into the pattern at the
   subpath's start (SVG's `stroke-dashoffset`), so the phase is
   `offset mod period` and running the offset back by one period marches
   the dashes forward and lands on the same picture (`a_dash_offset_of_one_period_draws_the_same_dashes`).
   The dashes of period k start at `k * period + c - phase`, computed from k,
   never accumulated, so a long outline's dashes do not drift. A dash after
   a zero-length gap continues the one before it: `[7, 0]` is one dash the
   length of the subpath, the solid stroke again.
3. **Their intersection.** The pattern is measured on the subpath from its
   own start, independent of the trim, so a trim reveals or hides dashes
   without moving them. Measuring from the window's start instead slides
   every dash as `trimStart` moves; `trim_start_only_removes_samples_from_a_dashed_stroke`
   is red under that edit.

The pattern restarts on every subpath, as SVG's does. On a closed subpath a
dash on at both its end and its start is **one piece through the start
point**, a join rather than two caps, as trim's wrapped window already was;
two butt ends meeting there would be two blends and a hairline seam. A dash
over the whole of a subpath keeps it as it was, so a closed one keeps its
joins all the way round.

**A zero-length dash is a dot**: its two caps facing along the outline — a
disc of the stroke's width under `stroke-cap-round`, a square of its width
turned to the outline under `stroke-cap-square`, nothing under `butt`, which
is SVG's rule for a zero-length subpath. `stroke-dash-[0_14] stroke-cap-round`
is a dotted line. The dot is wound as an open polyline's outline is (side A,
end cap, side B, start cap), so it joins the stroke's nonzero union instead
of cancelling a dash it overlaps (`a_zero_length_dash_is_a_dot_of_its_caps`
checks every contour's sign). A zero-length subpath outside a pattern still
draws nothing, as before.

**A budget.** At most 65,536 dashes a stroke a frame (`DASH_MAX_PIECES`),
counting every dash the pattern places whether or not the trim keeps it. A
dash of 0.25 units along a line of a million stops there instead of costing
the frame without bound; the rest of the stroke is not drawn. A 1080p frame
does not come near it: a dash and gap of 2 px each along a 20,000 px spiral
is 5,000.

The fill is never dashed. Everything is f32 `+ - * /` and comparisons, like
the rest of `path.rs`.

### Under a shutter, and to the gates

The shutter integrates transform tracks only (`0034`), so the offset holds
the frame's tick in every sample: marching ants do not smear, and a dashed
path that moves blurs like any path. `ui_draw_hash` hashes the stroke words,
so every frame of a march is a new hash; `visibility` and `layout` read a
dashed path as any path; a stroke whose window holds no dash emits nothing
and is invisible by declaration.

## A morph between keys drawn separately (0046)

0043 aligned morph keys command for command and refused the rest: "resampling
chooses a point correspondence, and the correspondence it chooses is a
picture nobody declared." The answer here is to declare the correspondence:
a rule, written down, that makes it a function of the keys and nothing else.

**Keys whose commands line up are untouched.** `compilePathEntry` aligns
them as 0043 did — a line against a cubic is promoted — and only when that
fails calls `equalizeKeys`. So a morph whose author drew matching keys moves
point for point as drawn, the bytes 0043 baked: three such key sets are pinned
by hash in `tests/path-primitives.test.ts`, among them both of
`compositions/vector-paths`, which holds every multi-key `<Path>` the digest
ledger had before this fixture. A single key never reaches the new code.

**Every key keeps its outline.** Equalisation only splits cubics, by de
Casteljau, which leaves a curve where it was, and a line is a cubic with
controls at 1/3 and 2/3. At `morph = k` the node draws key k as it was
written, up to f32 rounding of the split points
(`every key keeps its outline` samples every equalised cubic against the
written outline).

The rule, in order:

1. **Subpaths.** Key 0 keeps its subpaths' order, start points and
   directions, so a trim or a dash on key 0 is what was written. Each later
   key is paired with the one before it: closed subpaths with closed ones by
   area, open ones with open ones by length, largest with largest, ties in
   written order. A subpath with no partner pairs with a point at the centre
   of its own bounding box, so it grows out of or shrinks into itself — a
   ring's hole closes to its centre, a pause icon's second bar grows from
   its own middle. A later key's subpaths take the order of the slots they
   pair with.
2. **Winding.** If the largest closed pair winds opposite ways, every
   subpath of the later key is reversed; with no closed pair, the largest
   open pair decides by which way round its ends sit closer. A whole key or
   none of it, because reversing one subpath can change what a nonzero fill
   covers, and reversing all of them cannot.
3. **Start points.** On each closed pair the later key's start moves to the
   point that minimises the summed squared distance between the two outlines
   at 64 equal fractions of arc length. The candidates are its own vertices
   and 64 equal fractions; the first of equal scores wins. Open subpaths
   keep their ends.
4. **Points.** On each slot every key is cut at every vertex any key has,
   by fraction of arc length, so a corner of one key meets a point at the
   same fraction of the other and every key has the same number of cubics.
   Fractions within 1e-9 of each other are one vertex, and a key that
   repeats a point there gets as many.

Arc length is measured on 16 chords a cubic, and a fraction becomes a cubic's
parameter by interpolating along those chords: that decides where a cut lands
on the curve, never whether a point is on it. All of it is `+ - * /` and
`Math.sqrt` in f64, which IEEE 754 rounds alike on every host;
`tests/path-primitives.test.ts` stubs `Math.sin`, `cos`, `tan`, `atan2`,
`hypot`, `pow`, `exp` and `log` to throw while it bakes the fixture's morphs,
and pins their bytes, and the determinism workflow runs it on Linux/x86-64.

The rules are tested where they can fail. One outline written three other
ways — started at another corner with an edge split, wound the other way,
its subpaths in the other order — equalises to the same points key for key,
so every frame of the morph is the same picture; each of rules 1-3 removed
turns that red, and so does a cut that lands inside a cubic emitted as a
nowhere-cubic at its end.

What the rule does not choose well, stated: it pairs by size, not by
position, so two keys whose largest shapes sit far apart cross the frame;
it reverses a whole key, so a pair whose windings still differ after that —
a hole against a separate shape — morphs through a figure-eight; and a
correspondence by arc length moves a corner of one key along the other's
edge rather than to its nearest corner. An author who wants a different
correspondence draws keys whose commands line up, which bypasses all of it.

The one morph refusal left is the table's: more than eight keys.

## Motion along a path (`src/anim/path-motion.ts`)

### The form

Baked, not an engine property. `motionPath({ d, node, durationMs, ease, rotate })`
returns a keyframe set of `translateX`, `translateY` and, with `rotate`, the
direction of travel in degrees, plus the `linear` animation value that plays
it; `pocket.config.ts` calls it at build time. `El.along` writes the same
motion into a generator's element. `PathFollower` is the measured outline.

- **The outline a `<Path>` draws.** The `d` goes through 0043's
  `normalizePathData`, arcs included, and through the same viewBox mapping
  (xMidYMid meet onto the `<Path>`'s box), so a node follows exactly the
  cubics a `<Path>` with that `d` draws. A transform on the `<Path>` node
  itself is not followed.
- **Position** is a fraction of arc length (64 chords a cubic, the point
  then evaluated on the cubic, so it is on the curve whatever the chord
  count), eased in time by the caller's easing — progress along the path,
  as GSAP's `ease` is.
- **The node.** Given its box, its centre is put on the path and it turns
  about its centre, the default transform origin; without one, the path's
  coordinates are its translation, GSAP's default without `align`.
- **The angle** comes from the cubic's derivative through `atan2Deg`, an
  arctangent built from `+ - * /` and `Math.sqrt` (two half-angle steps and
  a 12-term series after an exact octant reduction), never the host's
  `Math.atan2`, whose last bits are implementation-defined and would reach
  the pak. It is exact on the axes and diagonals and within 1e-12 degrees
  of the host's elsewhere. Successive angles are unwrapped to differ by at
  most 180 degrees, so a loop does not turn the long way between two keys.

### Where the keys go, and what the shutter sees

Keys sit on tick 0, every odd tick, and the last tick. A 30 fps frame f
shows the clock `(f + 1) * 60 / fps - 1 = 2f + 1` (measured by the
long-track and arknights sessions), so with a delay that is a whole number of
30 fps frames every frame's position is a key, on the curve. Between keys the
core interpolates linearly, so a node is on the chord, and three things see
between keys:

- **a 60 fps film**, which shows every tick, half of them mid-chord;
- **a shutter**, which samples between ticks along each segment's own curve
  — a straight line here;
- nothing else: without a shutter a 30 fps film never shows a chord.

A chord's sagitta is `(v k)^2 / (8 R)` for keys k ticks apart at v px a tick
on a radius R. `motionPath` reports it as `chordError`, measured at every
tick and at eight instants inside each, so the price is visible before a
render. Measured (`baselines/path-primitives.md`):

| motion | fastest, px a tick | keys every 2: at ticks | between ticks | every 1: at ticks | between ticks |
|---|---:|---:|---:|---:|---:|
| the fixture's dart: the route, 3600 ms, eased | 20.9 | 3.750 | 3.729 | 0 | 1.048 |
| the fixture's orbiter: the ellipse, 2400 ms | 7.4 | 0.194 | 0.190 | 0 | 0.048 |
| a circle of radius 200 in 2000 ms | 10.5 | 0.274 | 0.270 | 0 | 0.069 |
| a circle of radius 100 in 1000 ms | 10.5 | 0.548 | 0.539 | 0 | 0.137 |
| a circle of radius 100 in 500 ms | 20.9 | 2.186 | 2.151 | 0 | 0.548 |

px off the curve, the largest over the move. "At ticks" is what a 60 fps
film shows (half its frames are between keys); "between ticks" is what a
shutter can sample. A 30 fps film without a shutter shows neither: every
frame is a key.

`every: 1` keys every tick: exact at every tick, so exact at 60 fps — and
sharp under a shutter, which reads a one-tick segment as a cut and never
samples across it (`0034`). That is the trade the kit exposes rather than
hides: keys two ticks apart blur along chords, keys one tick apart do not blur.

### Why not an engine property

The brief allowed one if the baked form measured wrong under the shutter. An
engine `offset-path` — a path index, an animatable distance the shutter
integrates like a transform track, and the core evaluating position and
angle per sample — would put every shutter sample on the curve.

What the measurement says. The baked form is exact at every frame a 30 fps
film shows, under a shutter or not: the shutter's exposure is centred on the
frame's tick, which is a key. Inside the exposure the node is on chords, and
the streak straightens the curve by up to the chord's sagitta. On a gentle
curve at a steady pace that is under 0.3 px; on the fixture's own dart, eased
to 21 px a tick through a loop of about 58 px radius, it is 3.75 px between
keys, and a 180° exposure at 30 fps (half a tick either side of the key)
reaches three quarters of that, 2.8 px, at the ends of a streak about 21 px
long. So under a shutter the baked form is a polyline approximation of the
declared curve, by an amount the kit computes and reports before any render.
The repository's other curved generator motion, `El.orbit` and `El.path` in
`src/anim/sampled.ts`, has always been keyed the same way and blurs the same
way.

The engine property is not added here. It is a second evaluation of the same
outline in the core, a new animated-prop class for the shutter, and a new
transform term that every reader of a node's box — layout, damage,
hit-testing, `visibility` — must learn, to remove an error that is zero at
every frame without a shutter and reported with one. A film that needs exact
blur on a tight fast curve is the case for it, and the numbers above say
where that starts: about 1 px of sagitta at keys 2 ticks apart, which is
`v^2 / (2R) = 1`, 14 px a tick on a 100 px radius.

## The fixture

`compositions/path-primitives`, 1920x1080, 150 frames at 30 fps, in both
ledgers, one quadrant per primitive: dashed, dotted and marching connectors
between three boxes and marching ants round the third; play into pause,
heart into star, ring into square; a dashed route drawn on by `trimEnd` with
a dart flying along it, turned to its direction of travel, and a dot
trailing it; a dashed ring drawn on and a dot circling a dotted ellipse.
`pocket.config.ts` calls the kit at build time with the outlines `main.tsx`
draws (written twice, held equal by the test). Its sidecar asserts what each
node is for, including that the dart, the dot and the orbiter stay inside
their quadrants; `tests/path-primitives.test.ts` reads the movers' centres
off `layout` and holds them to the outline within the box's 1 px rounding,
and reads the dashed connector's pixels against its pattern.

## What it does not do, stated

- **Dash lengths do not animate**, only the offset; the count is the class's.
- **A pattern on a fill**, gradient strokes, and dashes that follow a
  `pathLength` other than the measured one.
- **More than four dash lengths.**
- **Per-subpath reversal** in equalisation, and a correspondence by
  position rather than size (above).
- **Motion along a transformed `<Path>`**: the follower maps through the
  viewBox and the box, not through a transform on the path node; and only
  the node's centre rides the path, because the core has no arbitrary
  transform origin.
- **An engine motion path**: why, above.
