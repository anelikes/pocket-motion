// @title PocketJS Motion — occlusion fixture
//
// A buried caption reduced to three nodes. The defect it models: a generator
// emits footage and caption interleaved, so the next shot's footage sits after
// the caption in document order and paints over it for most of its window.
// `lint`, `check`, `trace` and `diff` all pass on that — a wrong paint order
// still produces a stable, reproducible, self-consistent digest.
//
// Document order decides paint order, so `buried` is covered completely by
// `lid` and contributes no pixel, while `shown` comes after `lid` and does.
// Nothing here animates — the occlusion holds at every frame and does not
// depend on a config being applied, which is what makes it usable as a
// `--no-config` test build. `layout --at 0` must report exactly one
// named-or-text node with a box and no pixel.
//
// It is a fixture, not a film: no ledger digest, see `scripts/digests.ts`.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-slate-950">
    <Text
      debugName="buried"
      class="absolute left-[80px] top-[80px] text-4xl font-bold text-slate-50"
    >
      {"covered by the lid"}
    </Text>
    <View debugName="lid" class="absolute inset-0 bg-slate-900" />
    <Text
      debugName="shown"
      class="absolute left-[80px] top-[240px] text-4xl font-bold text-slate-50"
    >
      {"above the lid"}
    </Text>
  </View>
));
