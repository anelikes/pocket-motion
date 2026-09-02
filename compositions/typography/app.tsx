// Phase 1 pressure composition — arbitrary font sizes.
//
// Every size here is OUTSIDE the pinned FONT_PX scale [12,14,16,18,20,24,36].
// Slots are allocated by the build from what this file actually uses
// (patches/0001-dynamic-font-slots.patch).

import { Text, View } from "@pocketjs/framework/components";

export default function Typography() {
  return (
    <View class="w-full h-full flex-col justify-center gap-6 bg-slate-950 p-16">
      <Text class="text-[112px] font-bold text-slate-50">Ninety six.</Text>
      <Text class="text-[47px] text-cyan-400">Forty-seven pixels, not a slot.</Text>
      <Text class="text-[29px] text-slate-300">Twenty-nine. Also not a slot.</Text>
      <Text class="text-[17px] text-slate-500">Seventeen — between 16 and 18.</Text>
      <View class="w-full h-1 rounded bg-blue-500" />
      <Text class="text-base text-slate-500">And 16px from the pinned scale, unchanged.</Text>
    </View>
  );
}
