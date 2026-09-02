// A curved push over tiled footage — the fixture `scripts/push-probe.ts` drives.
//
// One `scale` animation on the CONTAINER, not one per tile. Transforms compose
// down the walk as 2D affines (`engine/core/src/draw.rs`), so the whole grid
// moves as a unit and the tiles cannot drift apart from each other. The curve is
// `cubic-bezier(0.7,0,0.3,1)` in pocket.config.ts — the "ease-in-out · strong"
// row of `compositions/curves`.
//
// This stays mount-only. A baked keyframe timeline is a table the core walks by
// frame index; the guest declares it once and issues nothing afterwards, which
// is why an animated push does not cost the checkpoint contract anything.
//
// Rotation is deliberately absent: rotate == 0 keeps exact axis alignment and
// the tiles draw through TEX_QUAD, the integer-rect path. A non-zero rotate
// demotes them to the triangle path, which is a different measurement.

import { Image, View } from "@pocketjs/framework/components";

export default function KenBurns() {
  return (
    <View class="w-full h-full bg-black">
      <View class="absolute left-[450] top-[285] w-[1020] h-[510] animate-push">
        <Image debugName="footage:kb/tile:0:0" class="absolute w-[510] h-[510] left-[0] top-[0]" />
        <Image debugName="footage:kb/tile:1:0" class="absolute w-[510] h-[510] left-[510] top-[0]" />
      </View>
    </View>
  );
}
