# captions — five caption styles, ported from their sources

Five of the sixteen caption presets in the HyperFrames catalog
(hyperframes.dev, `registry/components/caption-*`), each re-expressed as
baked keyframe timelines. Their sources are HTML with a GSAP timeline, so
nothing here was measured off a picture: the sizes, colours, paddings,
durations and easings below were read off the source and are stated next to
what they became. The sentence is this project's own; the word timestamps
have the same shape as the catalog's demo transcript.

All five share `src/captions/transcript.ts`: the 28 words, the phrase split,
the measurer, and the GSAP eases as beziers (`power2.out` →
`cubic-bezier(0.33,1,0.68,1)`, `expo.out` → `(0.16,1,0.3,1)`, `back.out(1.7)`
→ `(0.34,1.56,0.64,1)`).

## Why every word is placed at a measured x

The catalog lays words out with flex and lets the browser wrap; three of the
five styles then animate something that has to know the word's width — a
box behind it, a clip window over it, a window closing across it. The
renderer here never wraps and there is no measuring without a build, so each
generator opens `openMeasurer` against the faces the pak will carry and lays
the row out itself.

**The face has to be the one the build bakes.** The first cut measured
against `InterDisplay-*.ttf` because AUTHORING.md said that was the default;
the compiler's `DEFAULT_REGULAR` is `Inter-Regular.ttf`, and Inter Display is
about 7% narrower, so every word rendered 7% wider than its slot: karaoke
words touched, and the clip window cut the last glyph off every word. `layout
--at 20` on pill-karaoke is what showed it — "every" 201px wide in a slot
sized for 187. AUTHORING.md was corrected in the same commit.

## What each style became

| style | in the catalog | here | not reproduced |
|---|---|---|---|
| highlight | red box `scaleX` 0→1 from the left edge over 150ms `power2.out`, opacity out over 100ms at the word's end; group fades in 120ms and out 100ms; Montserrat 800 at 80px, padding 12/6/8, gap 8, 140px from the bottom | the box is an absolute node whose `width` bakes 0 → word width + 24, so no transform origin is needed; same times, same eases; Inter Bold | the text shadow and a `brightness(1.05)` flash; the box's drop shadow, which `shadow-lg` could draw (three stacked alpha boxes under an axis-aligned node with a background) and this port does not |
| kinetic-slam | one word centred, Anton at 220px fitted to 1720px; entrances cycle: from above with `back.out(1.7)` 220ms, from the left `expo.out` 200ms, from the right, then `scale` 0.4→1 `back.out(2.2)` 240ms; out over 100ms; keywords `#ffd700` | a ladder 200/180/…/100 measured against 1720px (the atlas cell is a byte tall, so 200 is the ceiling); the fourth entrance rises 120px from below with the harder overshoot, because a `scale` moves baked glyphs and never resizes them | the scale entrance; Anton's condensed proportions |
| pill-karaoke | a `#e7e5e7` pill, radius 22, padding 60/18/20; Poppins 700 at 72px, lowercase, gap 16; groups of at most four words broken at punctuation or a 100ms pause, shown until the next group or 300ms after the last word; each word `#a6a6a6` → `#1c1e1d` over 100ms linear, 50ms early | the same, with a `color` timeline per word and the pill's width from the measured row | the pill's soft shadow, which `shadow-lg` could stand in for and this port does not; the two-line split for long groups (no group here needs it) |
| clip-wipe | `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` over 300ms `power2.out`; keywords to `#ffd700` 50ms in; spoken words to 40% white over 200ms; the group wipes out with `inset(0 0 0 100%)` over 250ms `power2.in`, 40ms stagger; Poppins 800 at 88px, gap 24 | an `overflow-hidden` window whose `width` bakes 0 → word width; the exit is the window's left edge moving right (translateX up, width down) while the text inside moves left by the same amount, so the glyphs stay put and only the window closes | letter-spacing 0.04em |
| matrix-decode | two 4-character scrambles at 100ms each, then the word; group in over 100ms, out over 120ms; Space Grotesk 700 at 96px in `#00ff41`; scrambles from mulberry32 seeded by word index | three Text nodes per word behind one-tick step gates; the same generator and seeds, run at build time | the scrambles reflow the line in the catalog (inline spans); here they sit at the real word's x, so a wide scramble can overlap its neighbour for 200ms |

## What the vocabulary decided, across all five

- **A caption is a set of delays.** Every word's start and end is a number
  in the transcript; a generator turns it into `delay` on a baked timeline
  and nothing reads a clock. This is the case AUTHORING.md's "mount-only is
  not 'no data-driven timing'" describes.
- **Colour is a timeline.** `color` and `backgroundColor` bake, so karaoke
  and the keyword flashes are keyframes, not swapped nodes.
- **A reveal is a window, a box is a width.** There is no `clip-path`;
  `overflow-hidden` on a node whose width animates is the clip. `origin-left`
  and `scale-x` exist and would grow a box from its left edge too; a `width`
  was chosen because it bakes to the measured pixel, so the box's edge is a
  number `layout --at` reads back, where a scale is a factor over a rect.
- **Scale never resized glyphs** when these were ported, so the one entrance
  that scales text in the catalog is a translation here, and every fitted
  size is a real atlas slot from a ladder rather than a scaled glyph. Since
  the pin moved to 66caf4e5 an axis-aligned scale resamples glyphs
  (AUTHORING.md, "Text"); a resampled glyph is softer than a baked one, so
  the ladder is still the sharper choice.

## The same five, for any transcript

`src/captions/styles.ts` is these five treatments again, written for the
`captions` job template (`src/captions/template.ts`, AUTHORING.md "Captions
from a transcript") rather than for one sentence on one row. The ports above
stay as they are, as the record of what each source did; the template is what
a job runs. What changed on the way, and why:

- **Every word is a node of its own with a name**, `w<i>`, and the generated
  sidecar asserts it is in the picture at every frame of its window. The
  ports name nothing, so no gate is about their words.
- **Entrances start on a tick chosen from the frame, not from the word's
  ms.** Frame `f` samples clock `(f + 1) · 60 / fps − 1`, and a timeline is
  still at its first keyframe on the tick its delay names, so a word's
  entrance has to start at least one tick before the clock its first frame
  samples. The template starts every entrance exactly there (`gateInTick`).
  The ports write the word's time in ms, which bakes to `round(start · 60)`:
  at 30 fps that is one tick too late whenever `start · 30` falls in about
  `[k + ¼, k + ½)`, and at 60 fps nearly always — 25.6% and 99.8% of start
  times, counted over 0–10 s in 0.1 ms steps. Their own transcript puts every
  time on a 50 ms grid and never lands in that band, so their first frames are
  not empty; a transcript from speech recognition would be.
- **A page's entrance and exit are two nested wrappers.** The ports put
  `gin` and `gout` in one comma list on one node, where the later one wins
  opacity while it writes.
- **Pages have lines.** Highlight boxes and clip windows are per word on any
  line; the pill grows to the whole block; lines are balanced to even slack.
  The ports' "no group here needs two lines" is now a rule the layout keeps
  rather than a fact about one transcript.
- **clip-wipe's exit closes left to right and ends when the page does**, but a
  window never closes before its own word's window has ended, so overlapping
  speech is still drawn. A closed window needs no gate of its own: zero width
  emits no geometry and `visibility` never reads it as covered — measured on
  `compositions/captions/burn-zh` at every frame with the windows ungated.
- **matrix-decode shortens its two scrambles for a short word**, to a third of
  the word's window each, so the word itself always lands inside its window.
  In a spaceless language the scrambles draw from the transcript's own
  characters, the way the ports draw from A–Z and 0–9.
- **kinetic-slam is 160 px at a 1080 px short side**, not 200: Noto Sans SC
  bakes up to 176, and a default one language cannot render is not a default.
  It sizes each page on its own, and its entrance distances scale with the
  viewport.

## What the engine would need for the other eleven

Stated so the list can be worked rather than remembered. Each is a caption
style in the catalog that cannot be built from this vocabulary today, and the
one primitive that would unlock it:

| catalog style | what it needs | primitive missing here |
|---|---|---|
| Neon Glow, Neon Accent | a blurred copy of the glyphs behind the text | a blur, or a `text-shadow` baked as a second atlas pass per slot |
| Gradient Fill, Texture | the glyphs as a mask over a gradient or an image | a mask (any clip that is not an axis-aligned rectangle) |
| Glitch RGB | three colour-separated copies added together, plus scanlines | an additive or screen blend; alpha is the only blend |
| Particle Burst | ~40 particles per keyword | nothing missing — it is rectangles on keyframes, and was left out only for size |
| Emoji Pop | colour emoji glyphs | a colour-bitmap font path; the atlas is coverage only |
| Parallax Layers | text behind a subject with a vertical stretch | a subject cut-out needs a mask; `scaleY` on text stretches it since the pin moved to 66caf4e5 (it resized nothing before) |
| Camera Follow Captions | a camera pulling back at a steady rate over text growing geometrically | nothing since the pin moved to 66caf4e5: an axis-aligned scale resamples glyphs, softer than a baked size when magnified; before, a zoom on text was a step through a ladder of baked slots |
| Editorial Emphasis, Weight Shift | italic and light faces; a weight that tweens | more faces in the sidecar (two are allowed); a variable-font axis is out of reach |
| Kinetic Slam's fourth entrance | `scale` 0.4 → 1 on a word | nothing since the pin moved to 66caf4e5, for the same reason; it was ported as a rise and still is |

Three of those rows are one change — a mask primitive — and two more are
one change — a blur. A `text-shadow` baked into the atlas as a second
coverage layer would cover both neon styles without a runtime blur.

## Verification

`lint` and `check` exit 0 on each; the digest and visibility ledgers carry
all five, and the template's two samples, `alpha-en` and `burn-zh`, beside
them. Each was looked at on eight frames spanning the first two phrases;
`layout --at` is what catches a slot narrower than its word, which is the
defect this family is most likely to grow.
