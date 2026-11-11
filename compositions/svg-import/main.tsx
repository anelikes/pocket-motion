// @title PocketJS Motion — SVG import fixture
//
// `lighthouse.svg` is imported as a tree (patches/0053): every shape is a
// `<Path>` whose transform, viewBox and preserveAspectRatio are folded into
// its outline and whose box is its own bounds, every id a debugName, and the
// `parts` map adds an animation to the shape (or group) it names. The parts
// draw on one after another, the lamp pops about its own centre and the beam
// sweeps about the lamp — a View's transform origin is its box's centre, and
// a part's box is the part.
//
// The picture is 960x720 over a 400x400 viewBox, so `xMidYMax meet` scales
// it by 1.8 and centres it across 960 px. The sidecar asserts the order the
// parts are drawn in by their ids. It is in both ledgers.

import { mount } from "@pocketjs/framework";
import { Svg, Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#0b1220]">
    <Svg
      src="./lighthouse.svg"
      debugName="lighthouse"
      width={960}
      height={720}
      class="absolute left-[480px] top-[150px]"
      parts={{
        horizon: "animate-draw-0",
        sea: "animate-draw-1",
        rock: "animate-draw-2",
        tower: "animate-draw-3",
        "stripe-low": "animate-draw-4",
        "stripe-high": "animate-draw-5",
        gallery: "animate-draw-6",
        roof: "animate-draw-7",
        moon: "animate-draw-8",
        gull: "animate-draw-8",
        lamp: "animate-pop",
        beam: "animate-sweep",
      }}
    />
    <Text debugName="caption" class="absolute left-[120px] top-[80px] text-[40px] text-slate-400">
      {"lighthouse.svg, part by part"}
    </Text>
  </View>
));
