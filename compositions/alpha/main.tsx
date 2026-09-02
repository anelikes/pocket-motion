// @title PocketJS Motion — no declared ground
//
// The one composition in this tree whose root View carries no `bg-*`. It is
// the fixture for the alpha-capable output formats, and what it actually
// pins is that THEY CARRY NOTHING YET.
//
// The rasteriser clears the framebuffer to OPAQUE black —
// `clear_black` in `engine/core/src/raster.rs` calls `fill_opaque` — so a
// composition that declares no ground still produces frames whose alpha
// channel is uniformly 255, exactly like one that declares a black one. A
// document sentence saying so would go stale silently the day that clear
// changes; `render --alpha` reports the smallest alpha byte it saw, and
// `tests/format.test.ts` asserts it is 255 here. The day the core clears
// transparent, this fixture's alpha floor drops and the test says so.
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
