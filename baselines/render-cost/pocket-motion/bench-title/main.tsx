// @title PocketJS Motion — render-cost benchmark scene
//
// A 10 s title card with a lower third, 1920x1080 at 30 fps, built to be
// reproduced as closely as the other two renderers allow in
// `../../remotion/src/BenchTitle.tsx` and `../../hyperframes/bench-title/`.
// It uses only what all three can draw the same way: absolutely placed
// boxes, a linear and a radial gradient, rounded corners, two weights of one
// face, and translate / scale / rotate / opacity timelines. The progress rule
// and the three turning shapes move on every frame, so no renderer can skip
// a frame as a repeat of the one before it.
//
// Not a composition of this repository: it sits outside `compositions/` and
// neither ledger reads it. `docs/render-cost-benchmark.md` says how it is
// staged into a scratch tree and measured.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[linear-gradient(135deg,#0f172a,#1e1b4b_60%,#312e81)]">
    <View debugName="glow" class="absolute left-[-100px] top-[40px] w-[1000px] h-[1000px] bg-[radial-gradient(circle_closest-side,#6366f1,#6366f100)] opacity-50 animate-glow" />
    <View debugName="shape-c" class="absolute left-[1240px] top-[600px] w-[320px] h-[320px] rounded-[64px] bg-[#22d3ee] opacity-20 animate-shape-c" />
    <View debugName="shape-a" class="absolute left-[1380px] top-[140px] w-[220px] h-[220px] rounded-[40px] bg-[#6366f1] opacity-40 animate-shape-a" />
    <View debugName="shape-b" class="absolute left-[1600px] top-[480px] w-[140px] h-[140px] rounded-[28px] bg-[#f59e0b] opacity-60 animate-shape-b" />

    <View debugName="title-out" class="absolute left-[0px] top-[0px] w-[1920px] h-[1080px] animate-title-out">
      <View debugName="title-push" class="absolute left-[0px] top-[0px] w-[1920px] h-[1080px] animate-push">
        <View debugName="kicker" class="absolute left-[160px] top-[250px] animate-kicker"><Text class="text-[28px] font-bold text-[#a5b4fc]">{"RENDER COST · OCTOBER 2026"}</Text></View>
        <View debugName="title1" class="absolute left-[160px] top-[300px] animate-title1"><Text class="text-[120px] font-bold text-[#ffffff]">{"Same picture,"}</Text></View>
        <View debugName="title2" class="absolute left-[160px] top-[440px] animate-title2"><Text class="text-[120px] font-bold text-[#c7d2fe]">{"three renderers."}</Text></View>
        <View debugName="bar" class="absolute left-[164px] top-[610px] w-[480px] h-[8px] rounded-[4px] bg-[#f59e0b] origin-left animate-bar" />
        <View debugName="subtitle" class="absolute left-[160px] top-[650px] animate-subtitle"><Text class="text-[40px] text-[#cbd5e1]">{"1920 x 1080 · 30 fps · 300 frames"}</Text></View>
      </View>
    </View>

    <View debugName="plate-out" class="absolute left-[120px] top-[790px] w-[760px] h-[150px] animate-plate-out">
      <View debugName="plate" class="absolute left-[0px] top-[0px] w-[760px] h-[150px] rounded-[16px] bg-[#f8fafc] animate-plate-in">
        <View class="absolute left-[0px] top-[0px] w-[14px] h-[150px] rounded-[4px] bg-[#f59e0b]" />
        <View debugName="name" class="absolute left-[48px] top-[22px] animate-name"><Text class="text-[56px] font-bold text-[#0f172a]">{"Ada Lovelace"}</Text></View>
        <View debugName="role" class="absolute left-[50px] top-[92px] animate-role"><Text class="text-[30px] text-[#475569]">{"Analyst · Analytical Engine No. 1"}</Text></View>
      </View>
    </View>

    <View debugName="progress" class="absolute left-[0px] top-[1072px] w-[1920px] h-[8px] bg-[#818cf8] origin-left animate-progress" />
  </View>
));
