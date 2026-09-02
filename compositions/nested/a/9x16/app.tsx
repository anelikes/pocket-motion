// One half of a pair whose PATHS differ only above the last segment.
//
// `compositions/nested/a/9x16` and `compositions/nested/b/9x16` share a
// `compositionId` (`pocket.json`), share a basename, and share a dist root —
// `resolve(dir, "../../dist")` is `compositions/nested/dist` for both. What
// tells them apart is the key below that root, which `src/cli/resolve.ts`
// takes from the composition's PATH rather than its last segment. Keyed on
// the basename they resolve to one directory, so a build of either writes
// over the other's bundle; `trace` does not build, so the second one traced
// then reports the first one's pixels under its own name.
//
// The two pictures therefore have to differ, and the ledger has to hold both
// digests: a collision shows up as this cut reporting b's digest. Nothing
// else here is load-bearing — no motion, no footage, no measurement.

import { Text, View } from "@pocketjs/framework/components";

export default function Nested() {
  return (
    <View class="w-full h-full flex-col justify-center gap-8 bg-[#0b1220] p-20">
      <View class="w-[320px] h-[24px] rounded bg-[#38bdf8]" />
      <Text debugName="cut" class="text-[96px] font-bold text-[#f8fafc]">{"cut a"}</Text>
      <Text debugName="path" class="text-[36px] text-[#94a3b8]">{"compositions/nested/a/9x16"}</Text>
    </View>
  );
}
