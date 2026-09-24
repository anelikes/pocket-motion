// @title PocketJS Motion — filter layers
//
// patches/0018: a node and its subtree painted into one layer that is
// blurred, shadowed and blended as a unit.
//   top row     blur-sm / blur-md / blur-xl on the same card
//   middle      a text glow that breathes (dropShadowBlur + gain keyframed),
//               a hard drop shadow, and a rack focus (filter: blur() and
//               drop-shadow() keyframed together)
//   bottom row  the five blend modes of one orange disc over a split ground

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";


function Filters() {
  return (
    <View class="w-full h-full flex-col bg-[#0f172a] px-[120px] py-[70px] gap-[60px]">
      <View class="flex-row gap-[80px] items-center">
        <View class="w-[240px] h-[150px] rounded-[24px] bg-[#f8fafc] items-center justify-center"><Text class="text-[40px] font-bold text-[#0f172a]">sharp</Text></View>
        <View class="w-[240px] h-[150px] rounded-[24px] bg-[#f8fafc] items-center justify-center blur-sm"><Text debugName="blur-sm-label" class="text-[40px] font-bold text-[#0f172a]">blur-sm</Text></View>
        <View class="w-[240px] h-[150px] rounded-[24px] bg-[#f8fafc] items-center justify-center blur-md"><Text debugName="blur-md-label" class="text-[40px] font-bold text-[#0f172a]">blur-md</Text></View>
        <View class="w-[240px] h-[150px] rounded-[24px] bg-[#f8fafc] items-center justify-center blur-xl"><Text debugName="blur-xl-label" class="text-[40px] font-bold text-[#0f172a]">blur-xl</Text></View>
      </View>
      <View class="flex-row gap-[90px] items-center h-[180px]">
        <Text debugName="glow-text" class="text-[96px] font-bold text-[#fef9c3] glow-amber-400 animate-breathe">Glow</Text>
        <Text debugName="shadow-text" class="text-[96px] font-bold text-[#f8fafc] drop-shadow-[8px_8px_0px_#e11d48]">Shadow</Text>
        <Text debugName="focus-text" class="text-[96px] font-bold text-[#e0f2fe] animate-focus">Focus</Text>
      </View>
      <View class="relative w-full h-[260px] flex-row">
        <View class="w-[840px] h-[260px] bg-[#1d4ed8]" />
        <View class="w-[840px] h-[260px] bg-[#d1d5db]" />
        <View class="absolute left-0 top-0 w-full h-[260px] flex-row justify-around items-center">
          <View class="w-[200px] h-[200px] rounded-[100px] bg-[#f97316] mix-blend-normal" />
          <View class="w-[200px] h-[200px] rounded-[100px] bg-[#f97316] mix-blend-multiply" />
          <View class="w-[200px] h-[200px] rounded-[100px] bg-[#f97316] mix-blend-screen" />
          <View class="w-[200px] h-[200px] rounded-[100px] bg-[#f97316] mix-blend-overlay" />
          <View class="w-[200px] h-[200px] rounded-[100px] bg-[#f97316] mix-blend-plus-lighter" />
        </View>
      </View>
    </View>
  );
}

mount(() => <Filters />);
