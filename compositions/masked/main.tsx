// @title PocketJS Motion — overflow-mask fixture
//
// Four windows, one per thing `overflow-mask` (patches/0013) has to get
// right, each in its own 960x540 quadrant over a dark ground:
//
//   iris     a circular window growing about a fixed centre, revealing
//            scene B (a gradient with a title) over scene A; the child moves
//            against the window so B stays put on screen
//   wipe     a window rotated 20 degrees about its left edge, its width
//            growing from nothing, so its far edge sweeps the quadrant
//            diagonally; the scene inside rotates back about the SAME point
//            (`origin-left` on both) and never moves
//   card     a `rounded-[40px]` window whose text overflows it, so `layout`
//            reports `clipped_text` on purpose — the mask is a clip
//   nested   a circle window inside a rotated window: the product rule at
//            the intersection
//
// Every window and every thing inside one carries a debugName, and the
// sidecar asserts what each is FOR. It is in both ledgers.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#0b0f14]">
    {/* iris — top left */}
    <View debugName="iris-quadrant" class="absolute left-0 top-0 w-[960px] h-[540px] overflow-hidden">
      <View debugName="iris-a" class="absolute inset-0 bg-slate-800">
        <Text debugName="iris-a-label" class="absolute left-[60px] top-[60px] text-[48px] font-bold text-slate-400">
          {"scene A"}
        </Text>
      </View>
      <View debugName="iris-window" class="animate-iris-window absolute left-[480px] top-[270px] w-[0px] h-[0px] rounded-[350px] overflow-mask">
        <View debugName="iris-b" class="animate-iris-scene absolute left-[-480px] top-[-270px] w-[960px] h-[540px] bg-gradient-to-r from-[#0e7490] to-[#65a30d]">
          <Text debugName="iris-b-title" class="absolute left-[330px] top-[220px] text-[96px] font-bold text-white">
            {"scene B"}
          </Text>
        </View>
      </View>
    </View>

    {/* wipe — top right */}
    <View debugName="wipe-quadrant" class="absolute left-[960px] top-0 w-[960px] h-[540px] overflow-hidden">
      <View debugName="wipe-a" class="absolute inset-0 bg-slate-800">
        <Text debugName="wipe-a-label" class="absolute left-[60px] top-[60px] text-[48px] font-bold text-slate-400">
          {"before"}
        </Text>
      </View>
      <View debugName="wipe-window" class="animate-wipe-window absolute left-[-600px] top-[-330px] w-[0px] h-[1200px] rotate-20 origin-left overflow-mask">
        <View debugName="wipe-b" class="absolute left-[0px] top-[330px] w-[1900px] h-[540px] rotate-340 origin-left bg-gradient-to-b from-[#7c2d12] to-[#eab308]">
          <Text debugName="wipe-b-label" class="absolute left-[660px] top-[60px] text-[48px] font-bold text-white">
            {"after"}
          </Text>
        </View>
      </View>
    </View>

    {/* card — bottom left */}
    <View debugName="card-quadrant" class="absolute left-0 top-[540px] w-[960px] h-[540px]">
      <View debugName="card" class="absolute left-[130px] top-[120px] w-[700px] h-[300px] rounded-[40px] overflow-mask bg-[#1e293b]">
        <Text debugName="card-text" class="absolute left-[40px] top-[110px] text-[72px] font-bold text-slate-100">
          {"a card clips what it holds, corners included"}
        </Text>
      </View>
    </View>

    {/* nested — bottom right */}
    <View debugName="nested-quadrant" class="absolute left-[960px] top-[540px] w-[960px] h-[540px]">
      <View debugName="nested-outer" class="absolute left-[230px] top-[70px] w-[500px] h-[400px] rotate-15 overflow-mask bg-[#312e81]">
        <View debugName="nested-inner" class="absolute left-[50px] top-[0px] w-[400px] h-[400px] rounded-full overflow-mask">
          <View debugName="nested-core" class="absolute inset-0 bg-gradient-to-r from-[#f97316] to-[#facc15]" />
        </View>
      </View>
    </View>
  </View>
));
