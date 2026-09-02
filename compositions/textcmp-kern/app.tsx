// The fourteen classic kerning pairs, one per line at 64px, so a missing pair
// adjustment shows as ink width rather than as an opinion about the shape.
// HarmonyOS Sans Regular declares 13 of these non-zero
// (baselines/phase1_5-kerning-trigger.md); the browser applies them from GPOS.
import { Text, View } from "@pocketjs/framework/components";

export default function Kern() {
  return (
    <View class="w-full h-full bg-black flex-col justify-start items-start p-[40px] gap-[8px]">
      <View class="flex-col gap-[8px]">
        <Text class="text-[64px] text-white">{"P."}</Text>
        <Text class="text-[64px] text-white">{"F,"}</Text>
        <Text class="text-[64px] text-white">{"LT"}</Text>
        <Text class="text-[64px] text-white">{"Ta"}</Text>
        <Text class="text-[64px] text-white">{"To"}</Text>
        <Text class="text-[64px] text-white">{"r."}</Text>
        <Text class="text-[64px] text-white">{"Yo"}</Text>
        <Text class="text-[64px] text-white">{"AV"}</Text>
        <Text class="text-[64px] text-white">{"VA"}</Text>
        <Text class="text-[64px] text-white">{"W."}</Text>
        <Text class="text-[64px] text-white">{"Wa"}</Text>
        <Text class="text-[64px] text-white">{"Av"}</Text>
        <Text class="text-[64px] text-white">{"av"}</Text>
        <Text class="text-[64px] text-white">{"ry"}</Text>
      </View>
    </View>
  );
}
