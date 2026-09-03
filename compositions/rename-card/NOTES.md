# rename-card — what was measured, and what the measurement does not say

The motion here was taken off a screen recording rather than invented. This
file records how each number was obtained, so that a number can be re-derived
or disputed instead of trusted. Only geometry and cadence were taken; none of
the recording's artwork or text is reproduced, and the name typed into the box
is this project's.

## The source, and its limits

The same 35s recording `compositions/shutter/NOTES.md` describes, read here
from a 1152x720 copy at 29.5 fps. The stretch is 10.000s–16.000s: shutter's
panel assembling (10.30–11.45s), a rename dialog holding, and the dialog
collapsing (13.80–15.80s). Frames were extracted with ffmpeg's `mpdecimate`
so that a held frame is kept once; 177 source frames became 90 distinct ones,
each with its presentation timestamp. **Every duration below is quantised to
33.9ms**, and where the source shows one transition frame the 60 fps original
may have held two.

The opening is shutter's geometry unchanged, including its `T` constants. One
reading was added to it, and one was deliberately not followed:

| reference | this composition | what |
|---|---|---|
| 11.017s | — | the dialog appears at ~0.4 opacity over the settled hairlines and holds 12 frames |
| 11.424s | 1424ms | hairlines and both walls cut out |
| — | 1424–1684ms | the dialog rises 14px and fades in, ease-out, starting at the cut |

The reference overlaps the dim dialog with the hairlines for those 12 frames.
Reproduced, that overlap read as a defect — text and a caret behind a comb of
lines — so here the dialog enters after the cut and the two never share a
frame. The cut is the reason this is not simply shutter with a longer clock:
shutter holds its hairlines at 0.36 under the title because its measured
stretch ends at 11.45s, one frame after the cut.

## The dialog

Read off the frame at 11.6s and held as proportions of the 1152x720 frame
(x by 1920/1152, y by 1080/720 — the mapping shutter already uses, so a circle
in the reference is drawn here at the mean of the two scales):

| element | reference (px) |
|---|---|
| top rail | x 190–991, y 175 at centre, sagging ~17 toward the ends |
| bottom rail | x 190–991, y 521 at centre, rising ~17 toward the ends |
| mark / title / dots | y 257 / 288 / 311, centred |
| input box | x 403–747, y 341–366 |
| hint line | y 397 |
| buttons | y 435–463; x 415–561 filled, x 590–735 outlined |

The rails are 48 rotated segments each, the same construction as shutter's
slats, since there is no curve primitive. The corner ornaments and the small
scale under the bottom rail in the reference are not reproduced. The button
hover state the recording shows is not reproduced either.

## Typing

The reference holds the empty box; the typed name is this composition's own
addition and the mechanism is the point. Every prefix of the name is its own
`Text` node, gated in when its character lands and out when the next one does,
and the caret is a separate node per prefix placed at that prefix's width as
`openMeasurer` reports it — the renderer's advance table for the face and size
the pak will carry, at the density the sidecar declares. A codepoint the
measurement build did not bake is refused, so the caret cannot sit at a
guessed width. The generator also refuses a name wider than the box.

90ms per character from 1900ms; the caret blinks at a 1s period before and
after, and is solid while typing.

## The close

Per-frame white runs, thresholded at 140/255 on a grey copy, with the top-left
watermark, the bottom overlay and the cursor masked. Each row is one distinct
frame; a state holds until the next one.

| source | state |
|---|---|
| 13.797s | two thick arcs: circle r=139 centred (366,349) and its mirror about x=576, stroke 17, 186°→354° |
| 13.831s | two thin arcs: r=72 centred (437,347) and mirror, stroke 3, 189°→351° |
| 14.000s | thin arcs plus a bar x 419–732, rows 340–358, with dark slots x 424–462 and 689–726 on rows 347–351 |
| 14.034s | the bar alone |
| 14.169s | runs 437–450, 474–486, 493–682, 697–715 |
| 14.271s | runs 438–439, 445–468, 479–483, 493–611, 635–666, 680–692, 704–712 |
| 14.441s | runs 429–439, 448–513, 529–540, 547–602, 613–616, 630–694, 709–721 |
| 14.508s | runs 526–534, 560–570, 578–590, 597–606, 620–625 |
| 14.542s | runs 558–559, 566–576, 589–593 |
| 14.610s | one run 566–584 — a square |
| 14.644s | nothing |
| 14.678s | the square again, held to 14.85s |
| 14.881s | a smaller square, x 571–580, rows 345–352 |
| 15.119s / 15.220s / 15.288s / 15.390s | off / on / off / on |
| 15.525s → 15.80s | the square fades below the threshold and out |

Circle radii and centres were fitted from a run's leftmost column and the
column of its top end; the fit is to three points and the second digit of the
radius is not solid. The arc primitive draws round caps and the reference's
are flat; the reference also shows a grey gradient across the 14.441s bar and
a faint rounded rectangle inside the thick arcs, neither reproduced.

## Gates

Every state above is a cut. A cut is an opacity step, and the step's length
matters more than it looks: shutter's 34ms gates are two ticks at 60Hz, so a
30fps sample can land on the tick where the node is at 0.5 — every state of
the close arrived one frame late and grey when this composition used them. A
17ms gate is one tick, completes before the next rendered frame, and is what
the close and the typing use. Shutter's own opening keeps its 34ms gates, since
those are the cadence its NOTES.md measured.

## Verification

`lint` and `check` exit 0; the digest and visibility ledgers carry it. That is
the composition's own contract — determinism and mount-only — and says
nothing about resemblance. The claim that it resembles the reference rests on
the tables above, checked by putting the rendered frame beside the reference
frame at each of the fourteen source times listed.
