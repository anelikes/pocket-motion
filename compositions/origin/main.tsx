// @title PocketJS Motion — transform origin anywhere
//
// patches/0066: `origin-[..]` takes CSS's transform-origin — percentages,
// px lengths, keywords and calc() of a percentage and a length — and the
// origin animates. Three 100x40 bars turned 90 degrees, each a flat colour:
//
//   red      origin-top-left, the keyword form, the reference
//   green    origin-[12px_0]: 12 px in from the left edge
//   blue     origin-[calc(100%_-_20px)_bottom]: 20 px in from the right,
//            on the bottom edge
//
// and a 100x60 card held at scale 2 whose origin moves from 0% 0% to
// 100% 100% over the film (`transformOrigin` keyframed): the magnified card
// pans up and left by its own size. tests/origin.test.ts reads each
// colour's bounding box out of the frame and holds it to the geometry.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#111827]">
    <View debugName="named" class="absolute left-[80px] top-[30px] w-[100px] h-[40px] bg-[#ff0000] rotate-90 origin-top-left" />
    <View debugName="px" class="absolute left-[150px] top-[30px] w-[100px] h-[40px] bg-[#00ff00] rotate-90 origin-[12px_0]" />
    <View debugName="calc" class="absolute left-[200px] top-[60px] w-[100px] h-[40px] bg-[#0000ff] rotate-90 origin-[calc(100%_-_20px)_bottom]" />
    <View debugName="zoom" class="absolute left-[430px] top-[150px] w-[100px] h-[60px] bg-[#ffff00] scale-200 animate-pan" />
  </View>
));
