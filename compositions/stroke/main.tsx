// @title PocketJS Motion — text stroke
//
// The four stroke forms of patches/0017 and one animated width:
//   outside  under the fill, grown outward (the default position)
//   center   over the fill, straddling the glyph edge
//   hollow   center stroke with a transparent fill — the ring only
//   grow     width keyframed 0 -> 10 px, colour keyframed with it
//   cjk      an outside stroke on the Noto Sans SC face
// A stroke is paint only: layout never grows for it, so an outside stroke
// is ink past the glyph box and the sidecar allows that overflow by name.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

function Stroke() {
  return (
    <View class="w-full h-full flex-col justify-center gap-6 bg-[#1e293b] px-[140px]">
      <Text debugName="outside" class="text-[120px] font-bold text-[#f8fafc] text-stroke-[8px] text-stroke-[#e11d48]">Outside 8px</Text>
      <Text debugName="center" class="text-[120px] font-bold text-[#fde047] text-stroke-[4px] text-stroke-[#0f172a] text-stroke-center">Center 4px</Text>
      <Text debugName="hollow" class="text-[120px] font-bold text-transparent text-stroke-[3px] text-stroke-[#f8fafc] text-stroke-center">Hollow</Text>
      <Text debugName="grow" class="text-[96px] font-bold text-[#0f172a] animate-stroke-grow">Width 0 → 10</Text>
      <Text debugName="cjk" class="text-[88px] font-[cjk] font-bold text-[#fef3c7] text-stroke-[6px] text-stroke-[#7c2d12]">描边的中文歌词</Text>
    </View>
  );
}

mount(() => <Stroke />);
