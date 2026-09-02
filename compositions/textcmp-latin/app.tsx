// The same string at five sizes, white on black, for a like-for-like comparison
// against the browser rendering the same font file (baselines/glyph-fidelity.md).
import { Text, View } from "@pocketjs/framework/components";

export default function TextCmp() {
  return (
    <View class="w-full h-full bg-black flex-col justify-start items-start p-[60px] gap-[40px]">
      <View class="flex-col gap-[40px]">
        <Text class="text-[16px] text-white">{"Hamburgefonstiv 0123456789"}</Text>
        <Text class="text-[24px] text-white">{"Hamburgefonstiv 0123456789"}</Text>
        <Text class="text-[32px] text-white">{"Hamburgefonstiv 0123456789"}</Text>
        <Text class="text-[48px] text-white">{"Hamburgefonstiv 0123456789"}</Text>
        <Text class="text-[64px] text-white">{"Hamburgefonstiv 0123456789"}</Text>
      </View>
    </View>
  );
}
