A leaderboard reveal for an esports recap, from `leaderboard.json` (eight
players, unsorted).

- Canvas 1920 × 1080, 30 fps, 240 frames (8 s), background of your choice.
- Rank the players by score, highest first. The title `Season Leaderboard`
  is on screen from frame 0.
- The rows are revealed from the bottom of the ranking up: rank 8 enters at
  frame 15, rank 7 at frame 30, and so on, one every 15 frames, rank 1 at
  frame 120. Each row slides in and shows the rank, the player's name and the
  score with a thousands separator (`12,480`). All eight rows hold to the
  end, rank 1 at the top.
- Rank 1's row is highlighted in gold.
- Names (`debugName`s): `title`; for rank k (1–8), the row `row-k`, the
  player's name text `name-k` and the score text `score-k`.
