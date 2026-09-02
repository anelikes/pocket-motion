// Phase 0 smoke composition.
//
// Deliberately uses ONLY the current upstream vocabulary — font sizes come from
// FONT_PX, motion comes from baked built-in timelines. The pressure composition
// that exercises arbitrary sizes and sub-pixel easing belongs to Phase 1.
//
// Mount-only by construction: no onFrame, no after(), no effects, no signal
// that changes after mount. Everything that moves is a baked timeline the core
// plays itself, so the guest issues zero ops per frame.

import { Text, View } from "@pocketjs/framework/components";

export default function Smoke() {
  return (
    <View class="w-full h-full flex-col bg-slate-950">
      {/* header */}
      <View class="w-full flex-row items-center justify-between p-4">
        <View class="flex-row items-center gap-3">
          <View class="w-8 h-8 rounded-lg bg-blue-600 animate-pulse" />
          <Text class="text-xl font-bold text-slate-50">POCKETJS MOTION</Text>
        </View>
        <Text class="text-sm text-slate-400">PHASE 0 · SMOKE</Text>
      </View>

      {/* stage */}
      <View class="w-full grow flex-row items-center justify-center gap-8">
        {/* arc primitive: round-capped annular sector, drawn by the core */}
        <View class="w-32 h-32 rounded-full bg-cyan-400 arc-start-[220] arc-sweep-[280] arc-width-[10] animate-spin" />

        <View class="flex-col gap-3">
          <Text class="text-4xl font-bold text-slate-50">Deterministic.</Text>
          <View class="w-64 h-1 rounded bg-blue-500" />
          <Text class="text-lg text-slate-300">No browser. No wall clock.</Text>
          <Text class="text-base text-slate-500">Frames are a pure function of the tick index.</Text>
        </View>
      </View>

      {/* footer */}
      <View class="w-full flex-row items-center justify-between p-4">
        <Text class="text-sm text-slate-500">1920 x 1080 · 30 fps</Text>
        <View class="flex-row items-center gap-2">
          <View class="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <Text class="text-sm text-emerald-400">RENDERING</Text>
        </View>
      </View>
    </View>
  );
}
