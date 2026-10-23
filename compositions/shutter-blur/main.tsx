// @title PocketJS Motion — shutter fixture
//
// The sidecar declares `shutter: { angle: 180, samples: 8 }`, so every frame
// is an exposure: eight renders across half a frame centred on its tick, the
// transform timelines evaluated between ticks (patches/0034). Each node is
// here for one case (pocket.config.ts says which):
//
//   static       no timeline, so the same bytes at any sample count
//   ring, hub    a spin through its wraps; a scale overshoot
//   sweep        an eased move
//   tele, flick  declared jumps the samples never cross: no streak
//   gated        opacity gates, which the shutter holds at the tick
//   label-blur   the whip, blurred
//   label-crisp  the same whip under `shutter-hold`: sharp in every frame
//   known        a white square at 4 px a tick, whose 2-sample exposure
//                `tests/shutter.test.ts` computes by hand
//   peek         a still bar under an opaque blade that turns half a
//                revolution a tick: covered at every frame's tick, in the
//                picture of every exposure — the node `--read tick` misses
//
// Mount-only. In both ledgers; `tests/shutter.test.ts` reads it.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#0b0f14]">
    <View debugName="static" class="absolute left-[80px] top-[40px]"><Text class="text-[36px] font-bold text-[#e6e6e6]">{"static caption: same bytes at every N"}</Text></View>
    <View debugName="ring" class="absolute left-[160px] top-[150px] w-[800px] h-[800px] animate-spin2">
      <View class="absolute left-[690px] top-[372px] w-[140px] h-[56px] rounded-[14px] bg-[#f43f5e]" />
      <View class="absolute left-[585px] top-[627px] w-[140px] h-[56px] rounded-[14px] bg-[#f59e0b]" />
      <View class="absolute left-[330px] top-[732px] w-[140px] h-[56px] rounded-[14px] bg-[#84cc16]" />
      <View class="absolute left-[75px] top-[627px] w-[140px] h-[56px] rounded-[14px] bg-[#22d3ee]" />
      <View class="absolute left-[-30px] top-[372px] w-[140px] h-[56px] rounded-[14px] bg-[#6366f1]" />
      <View class="absolute left-[75px] top-[117px] w-[140px] h-[56px] rounded-[14px] bg-[#d946ef]" />
      <View class="absolute left-[330px] top-[12px] w-[140px] h-[56px] rounded-[14px] bg-[#ffffff]" />
      <View class="absolute left-[585px] top-[117px] w-[140px] h-[56px] rounded-[14px] bg-[#14b8a6]" />
    </View>
    <View debugName="hub" class="absolute left-[510px] top-[500px] w-[100px] h-[100px] rounded-[50px] bg-[#334155] animate-pop" />
    <View debugName="peek" class="absolute left-[500px] top-[355px] w-[120px] h-[10px] bg-[#f8fafc]" />
    <View class="absolute left-[485px] top-[345px] w-[150px] h-[30px] bg-[#1e293b] origin-center animate-blade" />
    <View debugName="sweep" class="absolute left-[200px] top-[960px] w-[48px] h-[100px] rounded-[8px] bg-[#f59e0b] animate-sweep" />
    <View debugName="tele" class="absolute left-[1080px] top-[150px] w-[100px] h-[100px] rounded-[16px] bg-[#22d3ee] animate-tele" />
    <View debugName="flick" class="absolute left-[1080px] top-[290px] w-[100px] h-[60px] rounded-[12px] bg-[#e879f9] animate-flick" />
    <View debugName="gated" class="absolute left-[1080px] top-[390px] w-[100px] h-[100px] rounded-[50px] bg-[#a3e635] animate-gated" />
    <View debugName="label-blur" class="absolute left-[1080px] top-[540px] animate-whip"><Text class="text-[96px] font-bold text-[#ffffff]">{"MOTION"}</Text></View>
    <View debugName="label-crisp" class="absolute left-[1080px] top-[700px] animate-whip shutter-hold"><Text class="text-[96px] font-bold text-[#fde047]">{"CRISP"}</Text></View>
    <View debugName="known" class="absolute left-[1200px] top-[860px] w-[40px] h-[40px] bg-[#ffffff] animate-known" />
  </View>
));
