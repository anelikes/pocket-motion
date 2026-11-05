// @title PocketJS Motion — colour filters
//
// patches/0055: CSS's colour filter functions on a node's filter layer —
// brightness, contrast, grayscale, hue-rotate, invert, saturate, sepia — each
// a fixed-point colour matrix applied after the blur and before the shadow,
// in Tailwind's order, clamped between steps.
//
//   top row     one gradient card with a white disc, drawn plain (`ref`) and
//               under each filter at a Tailwind step; a filter takes the
//               card's whole subtree, the disc included
//   bottom row  grey to full colour (`filter: grayscale()` keyframed), a
//               brightness flash, a hue cycle that loops,
//               `brightness-200 contrast-50` — where the clamp between the
//               two steps is the picture — and an orange disc greyed under a
//               cyan glow: the glow is made from alpha and keeps its colour
//
// 30 frames at 960x540. tests/colour-filters.test.ts reads every card
// against the reference card through a CSS reference written in TypeScript.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full flex-col bg-[#0f172a] px-[24px] py-[40px] gap-[56px]">
    <View class="flex-row gap-[16px]">
      <View class="flex-col items-center gap-[10px]">
        <View debugName="ref" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"none"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="brightness" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center brightness-150">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"brightness-150"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="contrast" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center contrast-200">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"contrast-200"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="grayscale" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center grayscale">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"grayscale"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="hue-rotate" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center hue-rotate-90">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"hue-rotate-90"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="invert" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center invert">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"invert"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="saturate" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center saturate-200">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"saturate-200"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="sepia" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center sepia">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"sepia"}</Text>
      </View>
    </View>
    <View class="flex-row gap-[16px] items-center">
      <View class="flex-col items-center gap-[10px]">
        <View debugName="colour-in" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center animate-colour-in">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"grey to colour"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="flash" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center animate-flash">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"flash"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="hue-cycle" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center animate-hue-cycle">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"hue cycle"}</Text>
      </View>
      <View class="flex-col items-center gap-[10px]">
        <View debugName="clamped" class="w-[100px] h-[120px] rounded-[12px] bg-linear-90 from-[#ef4444] via-[#22c55e] to-[#3b82f6] items-center justify-center brightness-200 contrast-50">
          <View class="w-[40px] h-[40px] rounded-[20px] bg-white" />
        </View>
        <Text class="text-[14px] text-[#cbd5e1]">{"brightness, contrast"}</Text>
      </View>
      <View class="w-[220px] h-[160px] items-center justify-center">
        <View debugName="glow-kept" class="w-[90px] h-[90px] rounded-[45px] bg-[#f97316] grayscale glow-[24px] glow-[#22d3ee]" />
      </View>
    </View>
  </View>
));
