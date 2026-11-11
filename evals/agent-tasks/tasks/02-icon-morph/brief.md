A play/pause button animation for a product video: the play icon morphs
into the pause icon and back, the way GSAP's MorphSVG would do it.

- Canvas 1080 × 1080, 30 fps, 120 frames (4 s), flat background `#111827`.
- `play.svg` and `pause.svg` are the two icons as exported from Figma. Draw
  the icon in solid `#f8fafc`, centred, 480 × 480 px (the 24-unit viewBox
  scaled 20×).
- Frames 0–30: play. Frames 30–45: play morphs into pause — the outline
  itself changes shape; a cross-fade between the two icons is not a morph.
  Frames 45–75: pause. Frames 75–90: pause morphs back into play. Frames
  90–119: play.
- Name the node that draws the icon `icon` (as a `debugName`).
