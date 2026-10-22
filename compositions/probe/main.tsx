import { mount } from "@pocketjs/framework";
import { Image, Text, View } from "@pocketjs/framework/components";

/**
 * The two facts every reel layout is built around, in one frame.
 *
 * A · `scale` on a wrapper. The Image grows by the scale factor, and since
 *     the pin moved to 66caf4e5 (upstream 119297b3) so does the Text: its
 *     cells are resampled bilinearly from the 64 px atlas, so the 1.5 row is a
 *     magnified bitmap, softer than a 96 px bake. Measured on this frame: the
 *     1.5 row's ink is 431x72 against the 1.0 row's 282x48; before the pin
 *     moved it was 385x48 — only the advances scaled, and a "camera push-in"
 *     over type read as tracking. A rotated run still keeps its cells upright
 *     and unscaled.
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
