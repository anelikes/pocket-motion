// The other half of the pair. See `compositions/nested/a/9x16/app.tsx` for
// what the two are for; the only difference that matters is that this picture
// is not that one, so a shared dist directory shows up as a digest mismatch
// rather than as a green run over the wrong film.

import { Text, View } from "@pocketjs/framework/components";

export default function Nested() {
  return (
    <View class="w-full h-full flex-col justify-center gap-8 bg-[#1a0b12] p-20">
      <View class="w-[320px] h-[24px] rounded bg-[#fb7185]" />
      <Text debugName="cut" class="text-[96px] font-bold text-[#f8fafc]">{"cut b"}</Text>
      <Text debugName="path" class="text-[36px] text-[#94a3b8]">{"compositions/nested/b/9x16"}</Text>
    </View>
  );
}
