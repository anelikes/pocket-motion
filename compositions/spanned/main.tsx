// @title PocketJS Motion — a caption spanning two shots
//
// `compositions/occluded` is the same defect with the clean prefix removed:
// its `buried` node is behind the lid from frame 0, so "no sampled frame shows
// it" catches it. A caption buried in a real cut is shown FIRST and covered
// afterwards, and that one passes every check that does not compare one
// sampled frame with a later one — `visibility` included, until it read the
// ordering, because the node WAS on screen.
//
// Document order is paint order, and `lid` comes after the three it covers.
// Seven nodes, all named, four of them the same mechanism at proportions a
// predicate has to tell apart:
//
//   spanning   shown, then covered from frame 72 to the end. THE DEFECT.
//   crossfade  fades out over exactly the frames the lid fades in. Covered at
//              no frame at all: it stops emitting geometry on the frame the
//              lid turns opaque. An ordinary dissolve, and it must pass.
//   trailing   the same dissolve with a longer exit than the entrance. Covered
//              for the 24 frames its tail outlives the lid's fade. It FAILS,
//              and the film is fine — the gate reads the picture and there is
//              nothing in the picture that separates this from `spanning`.
//   lid        the incoming shot: opaque, full bleed, in at frame 72.
//   above      after the lid in document order, so it stays on screen. Without
//              it a predicate that darkened everything would look correct.
//   revealed   covered by `early-lid` first and shown for the rest. A reveal,
//              not a burial, and the only one in the tree: it is what the
//              ordering in the predicate ("covered at a LATER frame than the
//              last that showed it") exists for. It must pass.
//   early-lid  the box that covers `revealed`, and only `revealed`.
//
// `lint`, `check` and `trace` all pass. It is a fixture, not a film: no ledger
// digest, see `scripts/digests.ts`.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-slate-950">
    <Text
      debugName="spanning"
      class="animate-caption-span absolute left-[80px] top-[120px] text-4xl font-bold text-slate-50"
    >
      {"meant to carry across the cut"}
    </Text>
    <Text
      debugName="crossfade"
      class="animate-cross-out absolute left-[80px] top-[300px] text-4xl font-bold text-amber-200"
    >
      {"the outgoing half of a dissolve"}
    </Text>
    <Text
      debugName="trailing"
      class="animate-trail-out absolute left-[80px] top-[480px] text-4xl font-bold text-amber-200"
    >
      {"a dissolve whose exit outlives the entrance"}
    </Text>
    <View debugName="lid" class="animate-lid-in absolute inset-0 bg-slate-900" />
    <Text
      debugName="above"
      class="absolute left-[80px] top-[660px] text-4xl font-bold text-slate-50"
    >
      {"after the lid, so still on screen"}
    </Text>
    <Text
      debugName="revealed"
      class="absolute left-[80px] top-[840px] text-4xl font-bold text-slate-50"
    >
      {"covered first, shown after"}
    </Text>
    <View
      debugName="early-lid"
      class="animate-early-out absolute left-[40px] top-[810px] w-[1400px] h-[130px] bg-slate-800"
    />
  </View>
));
