// @title PocketJS Motion — path primitives fixture
//
// One quadrant per primitive a GSAP user reaches for, each 960x540 over a
// dark ground:
//
//   connectors  dashed (`stroke-dash-[12_8]`), dotted (zero-length dashes
//               with round caps) and marching (the dash offset animated)
//               connectors between three boxes, and marching ants round
//               the third (patches/0045). Each connector's box touches the
//               boxes it joins and overlaps none, so `layout` has nothing
//               to report about it
//   morphs      three morphs between keys drawn separately: a play
//               triangle into two pause bars, a heart into a star, a ring
//               into a square — command lists that differ, equalised at
//               build time (patches/0046)
//   route       a dashed route drawn on by trimEnd, a dart flying along it
//               turned to its direction of travel, and a dot trailing it:
//               motion along a path, baked into translate and rotate
//               keyframes by `src/anim/path-motion.ts` in pocket.config.ts
//   orbit       a dashed ring drawn on (the dashes stay where the pattern
//               puts them as the trim reveals them) and a dot circling a
//               dotted ellipse, looping
//
// The outlines a node moves along are written twice: here, where the build
// bakes them for `<Path>`, and in pocket.config.ts, where the kit samples
// them. `tests/path-primitives.test.ts` holds the two copies equal.
// Every path carries a debugName and the sidecar asserts what each is FOR.
// It is in both ledgers.

import { mount } from "@pocketjs/framework";
import { Path, View } from "@pocketjs/framework/components";

const ROUTE =
  "M70 430 C230 430 250 150 410 150 C570 150 600 360 480 360 C360 360 420 150 590 150 C750 150 770 430 890 430";
const ORBIT = "M200 20 A180 160 0 1 1 200 340 A180 160 0 1 1 200 20 Z";

const PLAY = "M30 20 L80 50 L30 80 Z";
const PAUSE = "M25 20 H43 V80 H25 Z M57 20 H75 V80 H57 Z";
const HEART =
  "M50 85 C50 85 12 60 12 35 C12 20 24 12 36 12 C44 12 50 18 50 24 C50 18 56 12 64 12 C76 12 88 20 88 35 C88 60 50 85 50 85 Z";
const STAR =
  "M50 12 L59.99 40.25 L89.94 41.02 L66.17 59.25 L74.69 87.98 L50 71 L25.31 87.98 L33.83 59.25 L10.06 41.02 L40.01 40.25 Z";
const RING = "M50 10 A40 40 0 1 1 50 90 A40 40 0 1 1 50 10 Z M50 30 A20 20 0 1 1 50 70 A20 20 0 1 1 50 30 Z";
const SQUARE = "M14 14 H86 V86 H14 Z";

mount(() => (
  <View class="w-full h-full bg-[#0b0f14]">
    {/* connectors — top left */}
    <View debugName="connectors-quadrant" class="absolute left-0 top-0 w-[960px] h-[540px]">
      <View debugName="box-a" class="absolute left-[80px] top-[80px] w-[200px] h-[100px] rounded-[14px] bg-[#1e293b]" />
      <View debugName="box-b" class="absolute left-[680px] top-[80px] w-[200px] h-[100px] rounded-[14px] bg-[#1e293b]" />
      <View debugName="box-c" class="absolute left-[380px] top-[360px] w-[200px] h-[100px] rounded-[14px] bg-[#1e293b]" />
      <Path
        debugName="connector-dashed"
        d="M0 10 L400 10"
        class="absolute left-[280px] top-[120px] w-[400px] h-[20px] fill-none stroke-slate-300 stroke-[3px] stroke-dash-[12_8]"
      />
      <Path
        debugName="connector-dotted"
        d="M5 0 C5 140 70 230 185 230"
        class="absolute left-[175px] top-[180px] w-[185px] h-[240px] fill-none stroke-sky-400 stroke-[7px] stroke-cap-round stroke-dash-[0_16]"
      />
      <Path
        debugName="connector-marching"
        d="M180 0 C180 140 115 230 0 230"
        class="absolute left-[600px] top-[180px] w-[185px] h-[240px] fill-none stroke-amber-400 stroke-[3px] stroke-dash-[12_8] animate-march"
      />
      <Path
        debugName="selection"
        d="M6 6 H234 V134 H6 Z"
        class="absolute left-[360px] top-[340px] w-[240px] h-[140px] fill-none stroke-white stroke-[2px] stroke-dash-[6_6] animate-march-select"
      />
    </View>

    {/* morphs — top right */}
    <View debugName="morphs-quadrant" class="absolute left-[960px] top-0 w-[960px] h-[540px]">
      <Path
        debugName="play-pause"
        d={[PLAY, PAUSE]}
        viewBox="0 0 100 100"
        class="absolute left-[60px] top-[150px] w-[240px] h-[240px] fill-white animate-toggle"
      />
      <Path
        debugName="heart-star"
        d={[HEART, STAR]}
        viewBox="0 0 100 100"
        class="absolute left-[360px] top-[150px] w-[240px] h-[240px] bg-linear-135 from-rose-400 to-amber-300 bg-clip-path stroke-[#fff7ed] stroke-[1.5px] stroke-join-round animate-breathe"
      />
      <Path
        debugName="ring-square"
        d={[RING, SQUARE]}
        viewBox="0 0 100 100"
        class="absolute left-[660px] top-[150px] w-[240px] h-[240px] fill-cyan-400 fill-evenodd animate-breathe"
      />
    </View>

    {/* route — bottom left */}
    <View debugName="route-quadrant" class="absolute left-0 top-[540px] w-[960px] h-[540px]">
      <Path
        debugName="route"
        d={ROUTE}
        class="absolute inset-0 fill-none stroke-slate-500 stroke-[3px] stroke-cap-round stroke-dash-[10_8] animate-draw-route"
      />
      <View debugName="trail" class="absolute left-0 top-0 w-[18px] h-[18px] rounded-full bg-sky-400 animate-trail" />
      <Path
        debugName="dart"
        d="M8 16 L50 28 L8 40 L18 28 Z"
        class="absolute left-0 top-0 w-[56px] h-[56px] fill-amber-400 animate-fly"
      />
    </View>

    {/* orbit — bottom right */}
    <View debugName="orbit-quadrant" class="absolute left-[960px] top-[540px] w-[960px] h-[540px]">
      <Path
        debugName="dashed-ring"
        d="M150 10 A140 140 0 1 1 150 290 A140 140 0 1 1 150 10 Z"
        class="absolute left-[90px] top-[120px] w-[300px] h-[300px] fill-none stroke-emerald-400 stroke-[10px] stroke-cap-round stroke-dash-[22_14] animate-draw-ring"
      />
      <Path
        debugName="orbit-track"
        d={ORBIT}
        class="absolute left-[480px] top-[90px] w-[400px] h-[360px] fill-none stroke-slate-600 stroke-[4px] stroke-cap-round stroke-dash-[0_14]"
      />
      <View debugName="orbiter" class="absolute left-0 top-0 w-[28px] h-[28px] rounded-full bg-rose-500 animate-orbit" />
    </View>
  </View>
));
