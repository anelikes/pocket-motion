import { mount } from "@pocketjs/framework";
import { Image, Text, View } from "@pocketjs/framework/components";

/**
 * The two facts every reel layout is built around, in one frame.
 *
 * A · `scale` on a wrapper. The Image grows by the scale factor. The Text does
 *     not: its glyph cells come out of the atlas at their baked size and only
 *     the advances scale, so a "camera push-in" over type reads as tracking.
 *     Measured at 80 px bold: cap height 60 px at scale 1.0, 1.25 and 1.5
 *     alike, while the run spreads 819 px -> 938 px -> 1022 px.
 *
 * B · a `rotate-y` wall. The Image is carried into perspective with the wall
 *     (TEX_TRI). The Text stays flat and upright on top of it. This is why the
 *     upstream Motion Lab room study rides SVG letters rather than Text nodes,
 *     and why nothing on the reel's turning walls is type.
 *
 *   bun vendor/pocketjs/tools/build.ts compositions/probe/main.tsx \
 *     --outdir=dist/probe --framework=solid
 *   bun src/cli/main.ts frame compositions/probe --at 0 --out /tmp/probe.png
 */
mount(() => (
  <View class="w-full h-full bg-zinc-950">
    <View class="absolute top-[80] left-[80] flex-row items-center gap-8">
      <Image class="w-[256] h-[128]" src="mark.svg" />
      <Text class="text-[64px] font-bold text-zinc-50">{"SCALE 1.0"}</Text>
    </View>
    <View class="absolute top-[300] left-[80] flex-row items-center gap-8 scale-150">
      <Image class="w-[256] h-[128]" src="mark.svg" />
      <Text class="text-[64px] font-bold text-zinc-50">{"SCALE 1.5"}</Text>
    </View>

    <View class="absolute top-[600] left-[80] w-[1200] h-[400] perspective-[1400]">
      <View class="absolute inset-0 rotate-y-[40] bg-zinc-900 flex-row items-center gap-8 p-10">
        <Image class="w-[256] h-[128]" src="mark.svg" />
        <Text class="text-[64px] font-bold text-zinc-50">{"ON A WALL"}</Text>
      </View>
    </View>
  </View>
));
