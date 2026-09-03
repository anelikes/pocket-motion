# timeline — what was measured, and what the measurement does not say

The motion and the proportions were taken off a 61s recording of a milestone
timeline (1920x1080, 60 fps). Only the motion and the proportions were taken:
the recording's cards are screenshots of posts and app screens, and none of
them, none of its captions and none of its counts are reproduced. The cards
here are rectangles standing in for pictures, and the captions are this
project's own milestones.

## The source, and its limits

3362 of the 3685 frames are distinct — the strip is in continuous motion or
holding, never cutting — so the measurement is of trajectories, not of states.
Three readings were taken, each from its own script, each at 60 fps:

1. **The ruler ticks on one row** (y=580): their per-frame displacement is the
   strip's velocity, and their spacing is the strip's scale.
2. **One card through its whole pass** (the white one centred at 3.5s, on a
   960x540 copy): its left and right edges from the columns that are mostly
   white over the card band, its top and bottom from the rows that are mostly
   white inside those columns, followed frame to frame by nearest centre.
3. **The same card's mean brightness**, over its box.

Where a card edge crosses the tick row the first reading is noisy for a frame
or two, which is why its segmentation shows a few one-frame "moves" of a
pixel; they are not motion. The second reading is clipped once the card
reaches the left edge of the frame, and its width there is not a size.

## Cadence

| | measured | here |
|---|---|---|
| hold | 46–79 frames, typically ~55 (0.9s) | 900ms |
| move | 36–65 frames, typically ~50 (0.85s) | 850ms |
| distance per move | 290–480px, one card pitch — the cards differ in width | pitch from the card widths plus a 190px gap |

Velocity inside the move starting at 4.58s, px per frame at 60 fps:

    4 9 12 · 6 8 12 15 19 23 24 · 24 21 19 16 15 14 12 11 10 10 9 9 9 9 8 7 8 7 7 6 6 4 1

It peaks about a fifth of the way in and decays for the remaining four fifths.
`cubic-bezier(0.45,0,0.1,1)` puts the peak early with the long tail after it;
it is a choice, not a fit. The recording also carries a short secondary
settle after some moves (a further 40–160px over 15–20 frames), not
reproduced: every move here is one segment.

## The zoom

Tick spacing, at rest 30.0px, through the move starting at 2.65s (every 3
frames):

    30.5 30.0 29.0 28.0 27.5 27.0 26.5 26.5 26.5 26.5 27.0 27.5 28.0 28.5 28.5 29.0 29.0 29.5 29.5 29.5 29.5 30.0

The whole strip scales to **0.883** about the canvas centre, reaching it
~300ms after the move starts, holding ~150ms, and back at 1 about 200ms after
the move ends. The same dip shows on the move at 4.55s. Here it is a `scale`
timeline on a wrapper round the strip with those four stops per move and
`cubic-bezier(0.4,0,0.2,1)`; the quarter labels behind sit in their own
wrapper at 0.94, a guess — the labels were not tracked.

## One card, start to finish

The white card centred at 3.5s, width in half-resolution px (double for the
canvas), with the strip's zoom divided out to leave the card's own scale
against its size as the right-hand neighbour (178px):

| t | x centre | width | own scale | what |
|---|---|---|---|---|
| 2.00–2.60 | 733 | 178 | 1.00 | holding as the right neighbour |
| 2.65 | 732 | 177 | 0.99 | the move in starts |
| 2.90 | 622 | 164 | 1.02 | smallest on screen: the zoom is at its bottom |
| 3.10 | 528 | 195 | 1.24 | growing while still moving |
| 3.30 | 499 | 240 | 1.42 | |
| 3.50 | 486 | 262 | 1.50 | position has landed |
| 3.70 | 481 | 272 | 1.53 | zoom is back at 1 |
| 4.10 | 480 | 281 | 1.58 | own scale finishes growing, 1.45s after the move began |
| 4.10–4.55 | 480 | 281 | 1.58 | holding at the centre |
| 4.65 | 471 | 263 | 1.56 | the move out has started; shrink lags it ~100ms |
| 4.85 | 365 | 212 | 1.35 | |
| 5.05 | 293 | 179 | 1.12 | |
| 5.25 | 254 | 170 | 1.00 | |
| 5.55 | 228 | 166 | 0.93 | settled as the left neighbour |
| 6.65 | 213 | 162 | — | the next move out begins |
| 6.70→ | | | — | width collapses as the card leaves the frame's left edge; not a size |

Two things this table decides. **The card's scale runs on its own clock**,
not on its position: at the same distance from the centre the card is 172px
wide on the way in and 225px on the way out. So the pop is not a function of
x — it is a `scale` animation that starts 250ms after the move in, reaches
1.5 by 800ms and 1.58 by 1450ms (`cubic-bezier(0.15,0.7,0.1,1)` over
1250ms), and a second one that starts 100ms after the move out and reaches
the left size by ~600ms with a soft tail (`cubic-bezier(0.5,0,0.2,1)` over
950ms). **The past is smaller than the future**: the right neighbour is 1.00,
the left neighbour 0.93. One slot further left is 0.87 here, a guess — the
card was clipped before it could be measured there.

Brightness stays at 246–247 of 255 from the right neighbour through the left
one and falls only from x≈370 on the canvas leftwards (243 at 6.70s, 212 at
7.10s), so the dimming is a vignette at the frame's edges and not a property
of the slot. Here it is a 380px gradient from black to transparent on each
edge, over everything.

## Layout

| | reference | here |
|---|---|---|
| centre card over the right neighbour | 281 / 178 = 1.58 | 1.58 |
| card centre line | ~y 614 | y 600 |
| ticks per gap | 5, 30px apart, ~40px tall | 5 at 30px, 40px tall |
| centre hairline | full height, 1px | full height, 1px |
| captions | date over title above the card, left-aligned at its left edge; a heart and a count below; larger at the centre | same, with a ring standing in for the heart |
| quarter labels | one large label per few cards, behind, moving slower | five labels, 200px, at 0.42 of the strip's speed |

The parallax factor of the labels is not measured. The recording's centre
card carries a soft shadow, not reproduced.

## Two things the vocabulary decided

**Every caption lives outside the scaled node.** A `scale` moves glyphs and
never resizes them (AUTHORING.md, "Text"), so the caption that grows with the
card cannot be the caption that was small: they are two `Text` nodes at two
sizes, one placed at the unscaled body's edges and one where the scaled body's
edges land, crossfaded over 500ms on the pop's own clock. The crossfade is the
one place this reads differently from the recording, whose captions scale as
pictures.

**Three nested wrappers, three clocks, no reads.** The zoom is a `scale` on
the outer wrapper, the strip's position a `translateX` on the middle one, and
each card's pop a `scale` on the card, all with delays computed from the same
constants. Nothing reads the strip's position; a change to `HOLD` or `MOVE`
moves all three together.

## The close

The recording ends on a logo revealed by a light sweep. Here a wordmark fades
in and an `overflow-hidden` window 180px wide crosses it in 1200ms while a
white copy of the wordmark inside the window travels the other way by the
same distance, so the copy stays put on screen and only the window moves. The
sweep in the recording is diagonal and soft; a diagonal window would be a
rotated clip, which the rasteriser does not have, so it is vertical and hard.

## Verification

`lint` and `check` exit 0; the digest and visibility ledgers carry it. That is
the composition's own contract — determinism and mount-only — and says
nothing about resemblance. Resemblance rests on the tables above, and one of
them was checked the other way: the same tracker run over this composition's
own frames (every third frame, 2.2–7.7s) puts the centre card at 1.57 of its
neighbour, at 97% of that 0.85s after the move in began where the recording
is at 93%, and back to the neighbour's size 0.6s after the move out began.
