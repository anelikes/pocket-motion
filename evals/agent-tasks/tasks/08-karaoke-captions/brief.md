Karaoke-style captions for a vertical social clip, from the word-level
transcript `words.json` (WhisperX output, English).

- Canvas 1080 × 1920, 30 fps, long enough to cover the transcript plus
  half a second.
- The captions are an overlay the editor will put over the footage
  themselves: a transparent background, delivered as a MOV with an alpha
  channel.
- Every word is on screen at least while it is spoken, and the word being
  spoken is highlighted.
- Name every word's node `w<i>` (as a `debugName`), `i` counting the words
  from 0 in transcript order.
