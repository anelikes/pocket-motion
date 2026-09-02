# PocketJS Motion — introduction reel

**35.71 s · 1920×1080 · 30 fps · 1071 frames · 19 bars**

Digest `82f2361f885b529b…`. The previous cut was `9afd9bf701ca97d8…` at 846
frames; it changed because two shots landed, not because anything drifted.

```bash
bun scripts/build-reel.ts --out reel.mp4      # picture + sound
bun scripts/build-reel.ts --silent            # picture only
```

The previous cut is frozen at the `reel-v5` tag (25.9 s, digest `60d78149…`).

---

## What changed, and why

Shot vocabulary adapted from
[video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) (Apache-2.0),
a Remotion shot library of 152 recipe cards. **Nothing is ported.** That library
targets a renderer where a shot can reach for blur, glow, clip paths, filters
and per-frame JS; none of those exist here. What transfers is the *reasoning* in
the cards — why a device reads, what its parameter is for, what breaks it — and
three devices were rebuilt from this renderer's primitives.

The music and every sound effect are now Mixkit-licensed with a recorded source
URL. The previous cut shipped with a commercial track it had no licence for.

---

## Sound

Everything is pinned to a beat grid measured from the track, not read off its
metadata — energy-envelope onset detection, autocorrelation over 60–190 BPM,
then a phase search (`scripts/beatgrid.ts`).

| | |
| --- | --- |
| Track | **Cat Walk** · Arulo · [Mixkit](https://assets.mixkit.co/music/371/371.mp3) |
| Measured | **127.7 BPM**, phase 421 ms → beat **469.9 ms**, bar **1879.4 ms** |
| Library states | ~129 BPM. A 1.3 BPM error accumulates to most of a beat across 34 s, so the difference is not academic |
| Entry | **15.46 s** into the track — bar 8, where the groove is fully in |

That entry is chosen for one reason: it puts the track's **drop at 28.61 s onto
video 13.16 s**, which is bar 7 of the reel — where the room turns and the act
changes. The energy curve of the track and the energy curve of the cut are the
same curve.

**No sound effects.** There were 18, pinned to picture actions and mixed at
measured levels, and they were still wrong: whooshes and hits on a piece whose
motion is already carried by a driving house track read as an *impression* of
sound design rather than sound design. The bed marks the cuts by itself — the
reel's beats and the track's beats are the same grid — and a cue that only
tells you a thing moved, when you can already see it move, is padding with a
volume control.

The mixer still takes cues ([`sound.ts`](sound.ts) is a table
`{at, src, gain, note}[]`), so this is a decision rather than a missing
feature. Anything added back needs a picture action the music does not already
mark.

Sound stays a timeline asset regardless: no shot contains an audio reference,
so a shot can be re-cut without invalidating the mix.

---

## Motion

**`DRIVE` = `cubic-bezier(.9,0,.1,1)` — hold, sprint, brake.** Unchanged, and it
survives every recut. Roughly the middle half of each duration carries nearly
all of the travel; both ends are near-stationary. Measured on a headline entry:
40 px from rest at 133 ms (it has not moved), 17 px at 300 ms (14 px in a single
frame), landed at 700 ms. Peak speed about **7× the average**.

| name | curve | used for |
| --- | --- | --- |
| `DRIVE` | `cubic-bezier(.9,0,.1,1)` | every entry, growth, roll and turn |
| `GATHER` | `cubic-bezier(.7,0,1,.35)` | every exit |
| `DEPART` | `cubic-bezier(.5,0,.85,.2)` | slabs leaving frame |

Every entry is three animations: a 620 ms transform on `DRIVE`, a 200 ms linear
fade (a fade dragged across the full transform reads slow), and a 1600 ms
residual drift that starts where the attack ends.

---

## The three borrowed devices

### 1 · Scramble → lock

Characters churn through a 49-glyph pool and lock left to right. The original
rewrites the string every two frames. **A mount-only composition cannot rewrite
anything**, so every candidate glyph is placed at build time and gated to a
single 80 ms window by a pair of 1 ms opacity steps — 174 gate layers for a
15-character title. The pool is walked by a seeded hash (`sin(seed·127.3)`
fract), never a random: the same frame index must always produce the same
picture.

Each slot is a fixed-width box. Glyphs have different advances, so without it
the row would jitter horizontally on every churn step.

Unlocked glyphs sit at `zinc-700`, near the ground, and only brighten on lock —
**the brightness front is the progress indicator.** The original's glow on lock
is not reproducible and is not missed; the colour step carries it.

### 2 · Smear-multiples

The headline slams up 420 px with four lagged copies of itself at falling
opacity — countable ghosts, not blur, which is what the technique actually is:
the same interpolation sampled at earlier times.

**Two bugs, both worth recording, because both produced something that looked
like a renderer fault rather than a mistake in the shot.**

*The device has an operating range and the first attempt was outside it.* Its
card gates ghosts on velocity — render them only above 25 px/frame, because
below that they never pull far enough apart to be read as separate. The
headline was given the standard 38 px entry, which peaks at **13.9 px/frame**,
so four copies landed within a few pixels of each other and the title read as
embossed. A smeared element now gets its own travel: 420 px, peaking at
**153 px/frame**. The ghosts are also gated to the sprint — they fade in at
140 ms and are gone by 550 ms — because `DRIVE` spends its first and last ~28 %
near-stationary, and during those the copies stack up into the same emboss at a
different moment.

*The opacity ladder was not doing anything.* The ghosts were marked
`opacity-40/30/20/10`, and an animated property overrides the static style
record for as long as it is filling — which, for these elements, is their whole
life. All four drew at full opacity. The tell was that editing those numbers
did not move the frame digest by a single byte. The ladder now lives in
per-ghost keyframes.

### 3 · Odometer digit roll

Each benchmark digit is an `overflow-hidden` window over a 0–9–0–9 strip
translated upward past two full turns. The original decelerates with a half-row
overshoot and a bounce; `DRIVE` already ends in a hard brake, so the landing is
the curve rather than a separate easing.

---

## Shots

| bar | time | shot |
| ---: | ---: | --- |
| 0–2 | 0.0–3.8 s | **Title** — `PocketJS Motion` assembles out of noise; rule; subtitle |
| 2–7 | 3.8–13.2 s | **remove the browser**, in three acts — headline slams in on four ghosts and the deck lands (bar 2); the three layers leave **one per beat** and the core arrives alone with DETERMINISM / SPEED (bar 3–4); **`0` guest ops per frame** (bar 5), building into the drop |
| **7** | **13.16 s** | **the drop** — the room turns to the light act |
| 7–11 | 13.2–20.7 s | **The numbers** — odometer digits roll to 52.36 / 38.19 / 5.75 over shared-duration bars; the ring sweeps to 6.6×; the run conditions |
| 11 | 20.7 s | the room turns back |
| 11–13 | 21.6–24.2 s | **Different machine. Same bytes.** — the digest, on two platforms |
| 13–15 | 24.6–28.0 s | **A caption at 0.3 px/frame** — 1× against 4×, one bar per frame |
| 15–17 | 28.4–31.8 s | **It does less.** — the trade, before anyone can discover it |
| 17–19 | 31.9–35.5 s | **Lockup** — wordmark, rule, one line |

**Pacing.** The first cut of this shot ran five bars for about four seconds of
event: the deck sat untouched for **3.1 s** before the first layer went, the
three then left **1.88 s apart** (one per bar), and the payoff was crammed into
the last 0.4 s. It read as the picture having stalled. The layers now leave one
per **beat**, so the departures overlap into the cascade the wave was always
meant to be, and the freed time became a third act instead of a hold. The reel
went from 18 bars to 15 for the same reason — 18 was more room than the content
could fill.

**What is removed is never on screen beside what replaces it.** `CDP round trip`
/ `CSS engine` / `vsync` are struck through, carry a dash rather than a bullet,
and the core does not arrive until the last of them is clear of frame — shown
together they read as a feature list.

**The bars share one duration.** Making duration proportional to value as well
as length is what forbids a curve with a slow start: length is `k·d·E(t/d)`, so
ordering holds only where `E(x)/x` is non-increasing, and an ease-in-out under
that coupling put HyperFrames' bar ahead of Remotion's for 1.36 s.
[`compositions/curves-race`](../curves-race/) renders the proof. Shared duration
admits any curve and holds exact proportion at every instant; the cost is that
finishing times stop being data.

Every figure was measured on one machine —
[`hyperframes-m4.md`](../../baselines/hyperframes-m4.md) ·
[`remotion-m4.md`](../../baselines/remotion-m4.md) — and the conditions are on
screen, because a benchmark without its environment is an anecdote.

The lockup carries **no URL and no licence badge**. The project is not public
and holds no endorsement from PocketJS; a repository path that resolves to
nothing — or worse, to somebody else's — is a claim the reel cannot support.
The wordmark and one line are the whole card.

---

## The two proof shots

Both were on this list for four cuts. They go **after bar 7** — the track's drop
is pinned there, so anything inserted ahead of it would have pulled the drop off
the turn it was chosen to land on. Speed, then proof, then cost.

**Different machine. Same bytes.** The digest is the one in
[`hash-portability.md`](../../baselines/hash-portability.md) — the smoke
composition, 450 frames, this machine and a linux/x64 container, every frame hash
equal. Truncated to 16 characters, because a 64-character hex string read off a
screen is not read, it is skipped.

**A caption at 0.3 px/frame.** The storyboard had wanted two renders hstacked at
encode time. That is not what this does, and the reason is a measurement: this
reel renders at supersample 1, and 0.3 px/frame is invisible at 1:1 anyway — a
side-by-side would have shown two captions that both look still. So it plots the
measurement instead of miming it, one bar per frame, height = that frame's
travel. The reel already treats data this way: the odometer shot displays
benchmark numbers rather than re-running benchmarks.

The two rows are regenerated from the measured parameters in
[`phase1-2-acceptance.md`](../../baselines/phase1-2-acceptance.md) — mean speed
0.304 and 0.293 px/frame, quantum 1.000 and 0.250 — rather than being 36 recorded
values, since the baseline records five. Both measured invariants come back out
of the reconstruction: the 1× row is stationary on 70 % of frames, the 4× row on
none. The **70 % on screen is the measured figure, not a count of the 36 bars**,
which would say 69 %; the row illustrates the pattern, it is not the sample the
number came from.

Closed since the last cut: the HarmonyOS Sans licence is now vendored beside the
faces, which are byte-identical to the official distribution — see
[`assets/fonts/README.md`](../../assets/fonts/README.md).
