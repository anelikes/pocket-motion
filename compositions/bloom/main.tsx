// @title PocketJS Motion — bloom
//
// patches/0033: a glow made from the bright pixels (`glow-mode-luma`) beside
// the glow it is not. Two identical panels: an 85 % dark plate carrying a
// white 2 px rule and a cyan bar, over a slate ground.
//
//   left   glow-[24px] glow-white — CSS's drop shadow at offset 0, made from
//          the layer's ALPHA: a white halo under the whole plate, 15 % of it
//          showing through, so the plate reads lighter than the ground.
//   right  the same with glow-mode-luma — made from the pixels' own colour
//          where their brightest channel is above glowThreshold (0.5) and
//          added over them: the plate is the plate, and only the rule and the
//          bar emit, the bar in its own cyan.
//
// Two frames at 640x360; nothing animates. A change to the luma halo, its
// threshold ramp, its tint or the add moves this digest and no other.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#1e293b]">
    <View debugName="alpha-glow" class="absolute left-[40px] top-[60px] w-[260px] h-[240px] glow-[24px] glow-white">
      <View class="absolute left-0 top-0 w-[260px] h-[240px] bg-[#0b0b0bd9]" />
      <View debugName="alpha-rule" class="absolute left-[30px] top-[80px] w-[200px] h-[2px] bg-white" />
      <View debugName="alpha-bar" class="absolute left-[30px] top-[150px] w-[200px] h-[12px] bg-[#22d3ee]" />
    </View>
    <View debugName="luma-glow" class="absolute left-[340px] top-[60px] w-[260px] h-[240px] glow-[24px] glow-white glow-mode-luma">
      <View class="absolute left-0 top-0 w-[260px] h-[240px] bg-[#0b0b0bd9]" />
      <View debugName="luma-rule" class="absolute left-[30px] top-[80px] w-[200px] h-[2px] bg-white" />
      <View debugName="luma-bar" class="absolute left-[30px] top-[150px] w-[200px] h-[12px] bg-[#22d3ee]" />
    </View>
  </View>
));
