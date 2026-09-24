// @title PocketJS Motion — named font faces
//
// Four faces in one composition: the sidecar's default pair (HarmonyOS Sans)
// and three named faces from `fonts.faces`, each selected per node with
// `font-[name]`. Every (size, weight, face) triple is its own baked slot.
// The same 64 px line is set in each face so the advances can be compared.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

function Faces() {
  return (
    <View class="w-full h-full flex-col justify-center gap-8 bg-[#0b0d12] px-[120px]">
      <Text debugName="display" class="text-[120px] font-[display] font-bold text-[#f8fafc]">Display, bold 120</Text>
      <Text debugName="cjk" class="text-[72px] font-[cjk] font-bold text-[#fbbf24]">中文字体 · 思源黑体 Bold</Text>
      <Text debugName="code" class="text-[48px] font-[code] text-[#67e8f9]">{"const face = \"code\"; // mono"}</Text>
      <View class="w-full h-[2px] bg-[#334155]" />
      <Text class="text-[64px] font-[display] text-[#e2e8f0]">Hamburgefonstiv — display</Text>
      <Text debugName="body" class="text-[64px] text-[#e2e8f0]">Hamburgefonstiv — default pair</Text>
    </View>
  );
}

mount(() => <Faces />);
