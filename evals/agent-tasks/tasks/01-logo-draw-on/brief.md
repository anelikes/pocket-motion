A logo sting for the Northwind brand: the logo draws itself on, fills in,
and the wordmark appears under it.

- Canvas 1920 × 1080, 30 fps, 120 frames (4 s), background `#0b1020`.
- `logo.svg` is the logo as the design team exported it from Illustrator.
  Show it centred horizontally, about 480 px wide, its aspect kept.
- Frames 0–45: the logo's outlines draw on, the way GSAP's DrawSVG does
  (`drawSVG: "0%"` → `"100%"`), starting at frame 0. Nothing of the logo is
  filled yet.
- Frames 45–70: the logo's filled shapes fade in.
- Frames 70–90: the wordmark `NORTHWIND`, set as text (it is not in the SVG),
  rises a little and fades in centred under the logo, then everything holds
  to the end.
- Name the node that holds the whole logo `logo` and the wordmark
  `wordmark` (as `debugName`s), so the review tooling can find them.
