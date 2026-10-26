// @title PocketJS Motion — sections shorter than the sampling stride
//
// A ranking at the proportions of hajibang's top-reveal template with one
// rank a second: an intro, eight ranks of 9 frames each, an outro. Each rank
// is a full-bleed card whose opacity is 0 outside its 9 frames, so outside
// them the draw walk returns above the card and its two named nodes have no
// box at all. `num-rK` is up for the card's whole window; `title-rK` fades in
// 3 frames after it.
//
// The sidecar asserts each of them over exactly the frames it is shown —
// `assert --samples 300` passes all 19 at every frame — and the point is the
// default grid: 24 samples over 300 frames step every 13, so a 9-frame rank
// can hold no sampled frame (ranks 3 and 7) and a 6-frame title window can
// miss the one its rank holds (ranks 1 and 4). On that grid alone 8 of the 19
// fail on a correct film, and five of those said "no node carries the
// debugName" about a node the tree carries — the message that misled the
// hajibang port. `assert` now also samples the frames each assertion names,
// and these pass; `tests/assert.test.ts` holds both halves.
//
// `lint`, `check` and `trace` all pass. It is a fixture, not a film: no ledger
// digest, see `scripts/digests.ts`.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-slate-950">
    <View class="animate-intro absolute inset-0 bg-slate-900">
      <Text debugName="intro" class="absolute left-[80px] top-[480px] text-[56px] font-bold text-slate-50">
        {"this week's ranking"}
      </Text>
    </View>
    <View class="animate-rank-1 absolute inset-0 bg-slate-800">
      <Text debugName="num-r1" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#1"}
      </Text>
      <Text
        debugName="title-r1"
        class="animate-title-1 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 1"}
      </Text>
    </View>
    <View class="animate-rank-2 absolute inset-0 bg-slate-800">
      <Text debugName="num-r2" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#2"}
      </Text>
      <Text
        debugName="title-r2"
        class="animate-title-2 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 2"}
      </Text>
    </View>
    <View class="animate-rank-3 absolute inset-0 bg-slate-800">
      <Text debugName="num-r3" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#3"}
      </Text>
      <Text
        debugName="title-r3"
        class="animate-title-3 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 3"}
      </Text>
    </View>
    <View class="animate-rank-4 absolute inset-0 bg-slate-800">
      <Text debugName="num-r4" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#4"}
      </Text>
      <Text
        debugName="title-r4"
        class="animate-title-4 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 4"}
      </Text>
    </View>
    <View class="animate-rank-5 absolute inset-0 bg-slate-800">
      <Text debugName="num-r5" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#5"}
      </Text>
      <Text
        debugName="title-r5"
        class="animate-title-5 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 5"}
      </Text>
    </View>
    <View class="animate-rank-6 absolute inset-0 bg-slate-800">
      <Text debugName="num-r6" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#6"}
      </Text>
      <Text
        debugName="title-r6"
        class="animate-title-6 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 6"}
      </Text>
    </View>
    <View class="animate-rank-7 absolute inset-0 bg-slate-800">
      <Text debugName="num-r7" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#7"}
      </Text>
      <Text
        debugName="title-r7"
        class="animate-title-7 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 7"}
      </Text>
    </View>
    <View class="animate-rank-8 absolute inset-0 bg-slate-800">
      <Text debugName="num-r8" class="absolute left-[80px] top-[360px] text-[96px] font-bold text-amber-200">
        {"#8"}
      </Text>
      <Text
        debugName="title-r8"
        class="animate-title-8 absolute left-[80px] top-[600px] text-4xl font-bold text-slate-50"
      >
        {"rank 8"}
      </Text>
    </View>
    <View class="animate-outro absolute inset-0 bg-slate-900">
      <Text debugName="outro" class="absolute left-[80px] top-[480px] text-[56px] font-bold text-slate-50">
        {"see you next week"}
      </Text>
    </View>
  </View>
));
