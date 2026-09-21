// @title PocketJS Motion — no declared ground
//
// The one composition in this tree whose root View carries no `bg-*`. It is
// the fixture for the alpha-capable output formats, and what it pins is that
// the channel carries the picture: the rasteriser clears the framebuffer to
// TRANSPARENT black (`patches/0014-transparent-clear.patch`), so every pixel
// the panel does not cover has alpha 0. `render --alpha` reports the smallest
// alpha byte it saw, and `tests/format.test.ts` asserts it is 0 here.
//
// Before 0014 the clear was opaque black, every frame's alpha was 255, and
// this same fixture pinned THAT — its digest in the ledger is the one entry
// that moved when the clear changed, which is what it is in the ledger for.
//
// Two frames at 320x180: the claim is about the encode leg, not about motion
// or size. Nothing animates, so the two frames are identical.
//
// The panel is off-centre so a flip or a channel swap in the encode leg shows
// up rather than cancelling out.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full">
    <View
      debugName="panel"
      class="absolute left-[40px] top-[30px] w-[160px] h-[80px] bg-[#22d3ee]"
    />
  </View>
));
