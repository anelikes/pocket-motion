# timeline — what was measured, and what the measurement does not say

The cadence and the layout were taken off a 61s recording of a milestone
timeline (1920x1080, 60 fps). Only the motion and the proportions were taken:
the recording's cards are screenshots of posts and app screens, and none of
them, none of its captions and none of its counts are reproduced. The cards
here are rectangles standing in for pictures, and the captions are this
project's own milestones.

## The source, and its limits

3362 of the 3685 frames are distinct — the strip is in continuous motion or
holding, never cutting — so the measurement is of a trajectory, not of states.
Everything below is from one row of pixels, y=580, read at 60 fps: the ruler
ticks between the cards are the only thing on that row that moves with the
strip and is neither a card nor a caption, and their per-frame displacement
(median over the ticks visible, nearest neighbour within 40px) is the strip's
velocity. Where a card edge crosses the row the reading is noisy for a frame
or two, which is why the segmentation below shows a few one-frame "moves" of a
pixel; they are not motion.

## Cadence

| | measured | here |
|---|---|---|
| hold | 46–79 frames, typically ~55 (0.9s) | 900ms |
| move | 36–65 frames, typically ~50 (0.85s) | 850ms |
| distance per move | 290–480px, one card pitch — the cards differ in width | pitch from the card widths plus a 190px gap |

The velocity inside a move, from the one starting at 4.58s (px per frame at
60 fps):

    4 9 12 · 6 8 12 15 19 23 24 · 24 21 19 16 15 14 12 11 10 10 9 9 9 9 8 7 8 7 7 6 6 4 1

It peaks about a fifth of the way in and decays for the remaining four fifths.
That is not a symmetric ease-in-out: `cubic-bezier(0.45,0,0.1,1)` was chosen
to put the peak early and the long tail after it, and is a choice rather than
a fit. The recording also carries a short secondary settle after some moves
(a further 40–160px over 15–20 frames); that is not reproduced, every move
here is one segment.

## Layout

Proportions, read off frames at 3.5s and 6.0s where the same card is seen at
the centre and then as a neighbour:

| | reference | here |
|---|---|---|
| centre card scale over a neighbour | 519px / 375px = 1.38 | 1.38 |
| card centre line | ~y 614 | y 600 |
| neighbour brightness | dimmed, and darker further out | opacity 0.55 for every non-centre card |
| ticks per gap | 5, ~30px apart, ~40px tall | 5 at 30px, 40px tall |
| centre hairline | full height, 1px | full height, 1px |
| captions | date over title above the card, left-aligned at its left edge; a heart and a count below | same, with a ring standing in for the heart |
| quarter labels | one large label per few cards, behind, moving slower than the strip | five labels, 200px, at 0.42 of the strip's speed |

The parallax factor is not measured; the label displacement between frames
was not tracked. The recording's neighbours also darken progressively with
distance from the centre, and its centre card carries a soft shadow; neither
is reproduced.

## Two things the vocabulary decided

**Every caption lives outside the scaled node.** A `scale` moves glyphs and
never resizes them (AUTHORING.md, "Text"), so the caption that grows with the
card cannot be the caption that was small: they are two `Text` nodes at two
sizes, one placed at the unscaled body's edges and one where the scaled body's
edges land, crossfaded on the same clock the pop uses. The crossfade is
visible for the length of a move and is the one place this reads differently
from the recording, whose captions scale as pictures.

**The strip is one timeline.** The hold/move boundaries are percentages of the
film — 29 stops — and the easing is applied per segment by the baker, so a
hold is a flat segment and every move is the same snap. Each card's pop and
crossfade are their own animations with a delay computed from the same
constants; nothing reads the strip's position.

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
nothing about resemblance, which rests on the two tables above.
