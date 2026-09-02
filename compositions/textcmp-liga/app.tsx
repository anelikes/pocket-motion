// The nine ASCII ligatures HarmonyOS Sans declares under `liga`, one per line
// at 64px. `liga` is on by default in a browser and off here by construction:
// `bake-font.ts` reads cmap, hmtx and hhea only, so a codepoint maps to one
// glyph and no substitution can happen. A difference is therefore the whole
// of what GSUB would change — both the shape drawn and the width advanced.
import { Text, View } from "@pocketjs/framework/components";

export default function Liga() {
  return (
    <View class="w-full h-full bg-black flex-col justify-start items-start p-[40px] gap-[8px]">
      <View class="flex-col gap-[8px]">
        <Text class="text-[64px] text-white">{"fi"}</Text>
        <Text class="text-[64px] text-white">{"fl"}</Text>
        <Text class="text-[64px] text-white">{"ff"}</Text>
        <Text class="text-[64px] text-white">{"ffi"}</Text>
        <Text class="text-[64px] text-white">{"ffl"}</Text>
        <Text class="text-[64px] text-white">{"rt"}</Text>
        <Text class="text-[64px] text-white">{"ry"}</Text>
        <Text class="text-[64px] text-white">{"rv"}</Text>
        <Text class="text-[64px] text-white">{"rf"}</Text>
      </View>
    </View>
  );
}
