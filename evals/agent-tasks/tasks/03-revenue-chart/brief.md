An animated line chart for a quarterly-results video, from the data in
`series.json` (two series, twelve months).

- Canvas 1920 × 1080, 30 fps, 150 frames (5 s), background `#0f172a`.
- The title from the data (`title`) is on screen from frame 0, with the
  axes, gridlines and the twelve month labels.
- Series A (the first in the file) draws on as a line from left to right
  over frames 10–60, in `#38bdf8`, 6 px wide. Series B draws on over frames
  30–80 in `#f472b6`, 6 px wide. The lines go through the data points
  (y = value on a linear axis that starts at 0); the curve between points
  is your choice.
- When each line finishes drawing, its last value appears as a label at the
  line's end: series A's at frame 60, series B's at frame 80, each holding
  to the end. The label is the value with a thousands separator and no
  decimals, e.g. `12,480`.
- Names (`debugName`s): `title`, `series-a`, `series-b`, `label-a`,
  `label-b`.
