import { View } from "@pocketjs/framework/components";

export default function Open() {
  return (
    <View class="w-full h-full bg-[#03070a] items-center justify-center">
      <View debugName="psp" class="relative w-[1400px] h-[610px] rounded-[200px] border-[#c5d4de] border-[4px]">
        <View
          debugName="psp-dpad"
          class="absolute left-[88px] top-[92px] w-[96px] h-[96px] rounded-[16px] border-[#c5d4de] border-[4px]"
        />
        <View
          debugName="psp-stick"
          class="absolute left-[96px] top-[380px] w-[80px] h-[80px] rounded-full border-[#c5d4de] border-[4px]"
        />
        <View
          debugName="psp-screen"
          class="absolute left-[340px] top-[102px] w-[720px] h-[406px] rounded-[10px] border-[#c5d4de] border-[4px]"
        />
        <View
          debugName="psp-face-n"
          class="absolute left-[1208px] top-[236px] w-[44px] h-[44px] rounded-full border-[#c5d4de] border-[4px]"
        />
        <View
          debugName="psp-face-e"
          class="absolute left-[1256px] top-[284px] w-[44px] h-[44px] rounded-full border-[#c5d4de] border-[4px]"
        />
        <View
          debugName="psp-face-s"
          class="absolute left-[1208px] top-[332px] w-[44px] h-[44px] rounded-full border-[#c5d4de] border-[4px]"
        />
        <View
          debugName="psp-face-w"
          class="absolute left-[1160px] top-[284px] w-[44px] h-[44px] rounded-full border-[#c5d4de] border-[4px]"
        />
      </View>
    </View>
  );
}
