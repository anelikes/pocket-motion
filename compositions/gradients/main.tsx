// @title PocketJS Motion — gradient paint
//
// patches/0019: multi-stop gradients at any angle, radial, and gradient text.
//   row 1  three stops to the right inside a rounded border; four stops at
//          30deg from an arbitrary linear-gradient(); a radial glow fading to
//          transparent; a rotated card whose 135deg paint turns with it
//   row 2  bg-clip-text headline whose angle turns (keyframed gradAngle)
//   row 3  bg-clip-text on the CJK face, and a bar whose bright via stop
//          sweeps across it (keyframed gradVia1Pos)

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

function Gradients() {
  return (
    <View class="w-full h-full flex-col bg-[#0b1020] px-[120px] py-[80px] gap-[56px]">
      <View class="flex-row gap-[60px] items-center">
        <View class="w-[360px] h-[220px] rounded-[20px] border-[#f8fafc] border-[6px] bg-gradient-to-r from-[#f43f5e] via-[#facc15] to-[#22d3ee]" />
        <View class="w-[360px] h-[220px] rounded-[20px] bg-[linear-gradient(30deg,#1e3a8a,#7c3aed_35%,#ec4899_70%,#fde68a)]" />
        <View class="w-[360px] h-[220px] bg-[radial-gradient(#fef08a,#f97316_45%,#f9731600)]" />
        <View class="w-[300px] h-[180px] rotate-12 bg-linear-[135deg] from-[#10b981] to-[#1d4ed8]" />
      </View>
      <Text debugName="headline" class="text-[150px] font-bold bg-clip-text text-transparent bg-linear-90 from-[#fb7185] via-[#fde047] to-[#38bdf8] animate-turn">Gradient text</Text>
      <View class="flex-row gap-[80px] items-center">
        <Text debugName="cjk-line" class="text-[96px] font-[cjk] font-bold bg-clip-text text-transparent bg-gradient-to-b from-[#fef3c7] to-[#f59e0b]">渐变的歌词</Text>
        <View debugName="sweep" class="w-[760px] h-[48px] rounded-[24px] bg-linear-to-r from-[#1e293b] via-[#e0f2fe] to-[#1e293b] animate-sweep" />
      </View>
    </View>
  );
}

mount(() => <Gradients />);
