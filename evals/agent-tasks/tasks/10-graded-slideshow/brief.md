A colour-graded photo slideshow for the end of a travel film.

- Canvas 1920 × 1080, 30 fps, 300 frames (10 s).
- `photo-1.png` … `photo-4.png` (1920 × 1080) play in order, each with a slow
  Ken Burns zoom (1.0 → 1.08). Photo k comes in at frame 75·(k−1) with a
  15-frame cross-fade from the photo before it (photo 1 is on screen from
  frame 0).
- Every photo is graded: desaturated to 60 % of its original saturation (a
  CSS `saturate(0.6)`).
- Over frames 255–285 the last photo goes from that grade to full black and
  white, and the caption `Fin.` fades in over it from frame 270, holding to
  the end.
- Names (`debugName`s): `photo-1` … `photo-4`, `caption`.
