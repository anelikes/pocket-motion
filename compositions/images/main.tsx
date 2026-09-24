// @title PocketJS Motion — images of any size
//
// The pictures are written by gen.ts (`*.png` is gitignored).
//
// patches/0020: an image is any size from 1 to 2048 px per side, a power of
// two or not. horizon.png is 900x506 and is drawn at its own size (texel
// for pixel) and at 0.8x with bilinear sampling (images.json); texels.png is
// 3x5 and is drawn 40x per texel with nearest sampling, so every texel is a
// visible block and a wrong stride would shear the grid.

import { mount } from "@pocketjs/framework";
import { Image, Text, View } from "@pocketjs/framework/components";

function Images() {
  return (
    <View class="w-full h-full bg-[#0b0d12] flex-row items-center justify-center gap-[60px]">
      <View class="flex-col gap-[16px]">
        <Image debugName="native" class="w-[900px] h-[506px]" src="horizon.png" />
        <Text class="text-[28px] text-[#cbd5e1]">900 x 506 at 1:1</Text>
      </View>
      <View class="flex-col gap-[16px]">
        <Image debugName="scaled" class="w-[720px] h-[405px]" src="horizon.png" />
        <Text class="text-[28px] text-[#cbd5e1]">the same at 0.8x, bilinear</Text>
      </View>
      <View class="flex-col gap-[16px]">
        <Image debugName="texels" class="w-[120px] h-[200px]" src="texels.png" />
        <Text class="text-[28px] text-[#cbd5e1]">3 x 5</Text>
      </View>
    </View>
  );
}

mount(() => <Images />);
