// @title PocketJS Motion — unplayable-timeline fixture
//
// A composition can declare an entrance the film is too short to reach. The
// compiler bakes it, the pak is valid, `lint` and `check` pass, `trace`
// produces a stable digest that reproduces on another machine, and the node
// simply sits at its first keyframe forever — `both` holds those values through
// the delay, so "never played" and "deliberately at opacity 0" look identical
// in every frame.
//
// Five nodes, one clock (30 frames at 30 fps = 60 core ticks):
//
//   sampled    starts at tick 0, every endpoint on a rendered frame
//   shifted    starts at tick 3, which no frame samples — it begins at tick 4
//   unplayed   starts at tick 90, past the end of the film
//   gated      a 34 ms step at tick 3: two ticks long, and the one frame the
//              render takes inside it shows the step half done
//   contended  two animations in one comma list both writing opacity, the
//              later holding its first keyframe from tick 0 with `both`, so
//              the earlier one's entrance is written over while it runs
//
// `keyframes` must report one timeline that never starts (exit 1), two that
// declare an unsampled instant, one cut a frame lands inside, and one property
// two animations contend for (the last three reported, not failed). The timing
// lives in `pocket.config.ts`; the build picks that up because it sits next to
// the entry.
//
// It is a fixture, not a film: no ledger digest, see `scripts/digests.ts`.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-slate-950">
    <Text
      debugName="sampled"
      class="animate-appear-sampled absolute left-[80px] top-[80px] text-[32px] text-slate-50"
    >
      {"on the grid"}
    </Text>
    <Text
      debugName="shifted"
      class="animate-appear-shifted absolute left-[80px] top-[200px] text-[32px] text-slate-50"
    >
      {"between two frames"}
    </Text>
    <Text
      debugName="unplayed"
      class="animate-appear-unplayed absolute left-[80px] top-[320px] text-[32px] text-slate-50"
    >
      {"never reached"}
    </Text>
    <Text
      debugName="gated"
      class="animate-appear-gated absolute left-[80px] top-[440px] text-[32px] text-slate-50"
    >
      {"a cut a frame lands inside"}
    </Text>
    <Text
      debugName="contended"
      class="animate-appear-contended absolute left-[80px] top-[560px] text-[32px] text-slate-50"
    >
      {"written over while it runs"}
    </Text>
  </View>
));
