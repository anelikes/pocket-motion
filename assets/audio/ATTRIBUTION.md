# Audio provenance

**The bytes are not in the repository.** They are ~4 MB of third-party media
that no test and no golden reads — rendering and the frame hash never open an
audio file, because audio is muxed in a separate pass. `scripts/assets.ts`
fetches them from the URLs below and verifies each against the SHA-256 in
[`manifest.json`](./manifest.json), which pins the exact bytes the reel was cut
against: a re-encode would move the measured beat grid and with it every cut.

```bash
bun scripts/assets.ts           # fetch what is missing, verify all
bun scripts/assets.ts --check   # verify only, no network
```

Every file here carries a resolvable source URL. That is the whole selection
rule: a track whose origin cannot be shown is not usable, however good it
sounds — the previous cut shipped with an unlicensed commercial track and had
to be replaced.

Collected via [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)
(Apache-2.0), whose `assets/audio/ATTRIBUTION.md` records the original Mixkit
entry for each file. Files that repository lists as **无法反查 / untraceable**
were deliberately **not** taken — `sfx/riser/riser-cine.mp3` was picked first
and then dropped for exactly that reason, and the reel has no riser as a result.
`silent-descent.mp3` (below) is the one exception: it was not in video-shotcraft's
list and was instead sourced directly from Mixkit's own catalogue page, whose
embedded JSON-LD (`schema.org` `MusicRecording`) gives the same
`assets.mixkit.co/music/<id>/<id>.mp3` URL shape and the same free-commercial
licence — the selection rule above (a resolvable source URL) is what actually
matters, not which upstream list a file passed through first.

## Licence

[Mixkit Free License](https://mixkit.co/license/) — free for commercial use,
no attribution required. This file exists so the claim is checkable, not
because the licence demands it.

## Music

| file | title | artist | BPM | source |
| --- | --- | --- | ---: | --- |
| `cat-walk.mp3` | Cat Walk | Arulo | 127.7 | https://assets.mixkit.co/music/371/371.mp3 |
| `silent-descent.mp3` | Silent Descent | Eugenio Mininni | — (rubato) | https://assets.mixkit.co/music/614/614.mp3 |

BPM measured here rather than taken on trust — energy-envelope onset detection
plus autocorrelation over 60–190 BPM (`scripts/beatgrid.ts`). The library
states ~129; the beat grid this reel is pinned to is the measured 127.7, phase
421 ms, giving a 469.9 ms beat and a 1879.4 ms bar.

`silent-descent.mp3` carries no beat grid, on purpose: it is rubato, so there
is nothing steady for a cut to be pinned to. Its measured statistics are
1.34 onsets/s, inter-onset CV 1.23, loudness range 17.6 LU, −23.7 LUFS
integrated over the first 45 seconds at a −7.6 dBFS peak, and mean RMS
−18.0 dBFS.

**Neither track here has been listened to by anyone.** Every number above came
from `scripts/beatgrid.ts` and `ffmpeg -af astats`, and a measurement is not
an audition — this is the one decision in the repository the verification loop
cannot close. Audition before either track ships anywhere real.

## Sound effects

| file | Mixkit source |
| --- | --- |
| `sfx/sweep-fast-small.mp3` | https://assets.mixkit.co/active_storage/sfx/166/166-preview.mp3 |
| `sfx/air-woosh-quick.mp3` | https://assets.mixkit.co/active_storage/sfx/2605/2605-preview.mp3 |
| `sfx/bass-hit-short.mp3` | https://assets.mixkit.co/active_storage/sfx/2299/2299-preview.mp3 |
| `sfx/hit-fast-exciting.mp3` | https://assets.mixkit.co/active_storage/sfx/2180/2180-preview.mp3 |
| `sfx/switch-click-quick.mp3` | https://assets.mixkit.co/active_storage/sfx/2582/2582-preview.mp3 |
| `sfx/hitech-touch-magnet.mp3` | https://assets.mixkit.co/active_storage/sfx/3171/3171-preview.mp3 |
| `sfx/clock-tick-single.mp3` | https://assets.mixkit.co/active_storage/sfx/1061/1061-preview.mp3 |
| `sfx/lock-digital.mp3` | https://assets.mixkit.co/active_storage/sfx/2859/2859-preview.mp3 |
| `sfx/shimmer-sparkle-sweep.mp3` | https://assets.mixkit.co/active_storage/sfx/2633/2633-preview.mp3 |
