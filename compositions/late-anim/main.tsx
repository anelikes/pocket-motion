// @title PocketJS Motion — unplayable-timeline fixture
//
// A composition can declare an entrance the film is too short to reach. The
// compiler bakes it, the pak is valid, `lint` and `check` pass, `trace`
// produces a stable digest that reproduces on another machine, and the node
// simply sits at its first keyframe forever — `both` holds those values through
// the delay, so "never played" and "deliberately at opacity 0" look identical
// in every frame.
//
// Six nodes, one clock (30 frames at 30 fps = 60 core ticks). Frame f shows
// tick 2f + 1, the last of its two (`clockOfFrame`, src/runtime/clock.ts):
//
//   sampled    starts at tick 1 and ends at 25, both ticks a frame shows
//   shifted    starts at tick 2, which no frame samples — frame 1 shows tick
//              3, the entrance already one tick in
//   unplayed   starts at tick 90, past the end of the film
//   gated      a 34 ms step at tick 2: two ticks long, and frame 1 lands on
//              tick 3, inside it, showing the step half done
//   contended  two animations in one comma list both writing opacity, the
//              later holding its first keyframe from tick 0 with `both`, so
//              the earlier one's entrance is written over while it runs
//   ruler      one pixel per tick across the whole clock, so a frame's pixels
//              say which tick it shows — `tests/keyframes.test.ts` reads it
//              at 20, 30 and 60 fps
//
// `keyframes` must report one timeline that never starts (exit 1), five that
// declare an unsampled instant (`shifted`, `gated`, the ruler's start at tick
// 0 and both halves of `contended`), one cut a frame lands inside, and one
// property two animations contend for (the last three reported, not failed).
// The timing lives in `pocket.config.ts`; the build picks that up because it
// sits next to the entry.
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
    <View debugName="ruler" class="animate-ruler absolute left-[80px] top-[680px] w-[8px] h-[40px] bg-slate-50" />
  </View>
));
