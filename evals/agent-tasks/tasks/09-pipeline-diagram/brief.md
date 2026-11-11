An explainer diagram of a data pipeline, from `diagram.json` (three
stages, two links).

- Canvas 1920 × 1080, 30 fps, 180 frames (6 s), background of your choice.
- Three boxes, left to right — `Ingest`, `Process`, `Deliver` — pop in at
  frames 0, 10 and 20.
- Two links connect them (Ingest → Process → Deliver). Each is a curved
  line (an S-curve, not straight), dashed, and its dashes march in the
  direction of flow continuously from frame 30 to the end.
- A packet — a small arrowhead — travels along the links from Ingest
  through Process to Deliver between frames 60 and 150, pointing along its
  direction of travel as the curve turns.
- Names (`debugName`s): `box-ingest`, `box-process`, `box-deliver`,
  `link-1`, `link-2`, `packet`.
