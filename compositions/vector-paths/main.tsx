// @title PocketJS Motion — vector paths fixture
//
// One quadrant per thing a `<Path>` (patches/0042, 0043) has to get right,
// each 960x540 over a dark ground:
//
//   signature  an open curve stroked with round caps and joins, drawn on by
//              a trimEnd keyframe — invisible by declaration until the draw
//              starts, then shown to the end
//   blob       two morph keys of eight cubics each, a circle and a star,
//              filled with a gradient through `bg-clip-path`
//   cluster    a hexagon cut into six triangles that share every edge: the
//              seams are partitioned, not drawn twice
//   globe      a wireframe in a 100-unit viewBox, stroked in viewBox units
//              and turning; a fifth of a ring orbits it, its trim window
//              wrapping past the ring's start every turn; and a wave under an
//              `overflow-mask` window, drawn 250 px past it on each side and
//              morphing between two keys
//
// Every path carries a debugName and the sidecar asserts what each is FOR.
// It is in both ledgers.

import { mount } from "@pocketjs/framework";
import { Path, Text, View } from "@pocketjs/framework/components";

const SIGNATURE =
  "M40 200 C90 60 160 60 190 170 S260 260 300 150 C330 70 380 80 390 160 C400 230 450 230 480 150 " +
  "S560 60 600 160 C630 240 700 240 740 140 S840 60 860 180";

const BLOB_CIRCLE =
  "M160 20 C197.1 20 232.7 34.7 259 61 C285.3 87.3 300 122.9 300 160 C300 197.1 285.3 232.7 259 259 " +
  "C232.7 285.3 197.1 300 160 300 C122.9 300 87.3 285.3 61 259 C34.7 232.7 20 197.1 20 160 " +
  "C20 122.9 34.7 87.3 61 61 C87.3 34.7 122.9 20 160 20 Z";
const BLOB_STAR =
  "M160 10 C180 10 182.6 80.8 210.9 109.1 C239.2 137.4 310 140 310 160 C310 180 239.2 182.6 210.9 210.9 " +
  "C182.6 239.2 180 310 160 310 C140 310 137.4 239.2 109.1 210.9 C80.8 182.6 10 180 10 160 " +
  "C10 140 80.8 137.4 109.1 109.1 C137.4 80.8 140 10 160 10 Z";

const GLOBE =
  "M50 4 A46 46 0 1 1 50 96 A46 46 0 1 1 50 4 Z " +
  "M50 4 A23 46 0 1 1 50 96 A23 46 0 1 1 50 4 Z " +
  "M50 4 L50 96 M8.6 30 L91.4 30 M4 50 L96 50 M8.6 70 L91.4 70";
const RING = "M50 1 A49 49 0 1 1 50 99 A49 49 0 1 1 50 1 Z";

// Two keys of one wave, its crest and trough exchanged. Both run 250 px past
// the window on each side: the window is what clips them.
const WAVE_UP = "M-250 150 C-100 40 50 260 200 150 S500 40 650 150 L650 300 L-250 300 Z";
const WAVE_DOWN = "M-250 150 C-100 260 50 40 200 150 S500 260 650 150 L650 300 L-250 300 Z";

mount(() => (
  <View class="w-full h-full bg-[#0b0f14]">
    {/* signature — top left */}
    <View debugName="signature-quadrant" class="absolute left-0 top-0 w-[960px] h-[540px]">
      <Text debugName="signature-caption" class="absolute left-[60px] top-[440px] text-[28px] text-slate-500">
        {"trimEnd 0 -> 1"}
      </Text>
      <Path
        debugName="signature"
        d={SIGNATURE}
        class="absolute left-[40px] top-[100px] w-[900px] h-[300px] fill-none stroke-white stroke-[7px] stroke-cap-round stroke-join-round animate-draw"
      />
    </View>

    {/* blob — top right */}
    <View debugName="blob-quadrant" class="absolute left-[960px] top-0 w-[960px] h-[540px]">
      <Path
        debugName="blob"
        d={[BLOB_CIRCLE, BLOB_STAR]}
        class="absolute left-[320px] top-[110px] w-[320px] h-[320px] bg-linear-135 from-amber-300 to-rose-600 bg-clip-path stroke-[#fff7ed] stroke-[3px] animate-breathe"
      />
    </View>

    {/* cluster — bottom left */}
    <View debugName="cluster-quadrant" class="absolute left-0 top-[540px] w-[960px] h-[540px]">
      <View class="absolute left-[280px] top-[90px] w-[400px] h-[360px]">
        <Path debugName="wedge-0" d="M200 180 L200 10 L347.2 95 Z" class="absolute inset-0 fill-[#0ea5e9]" />
        <Path debugName="wedge-1" d="M200 180 L347.2 95 L347.2 265 Z" class="absolute inset-0 fill-[#0284c7]" />
        <Path debugName="wedge-2" d="M200 180 L347.2 265 L200 350 Z" class="absolute inset-0 fill-[#0369a1]" />
        <Path debugName="wedge-3" d="M200 180 L200 350 L52.8 265 Z" class="absolute inset-0 fill-[#0ea5e9]" />
        <Path debugName="wedge-4" d="M200 180 L52.8 265 L52.8 95 Z" class="absolute inset-0 fill-[#0284c7]" />
        <Path debugName="wedge-5" d="M200 180 L52.8 95 L200 10 Z" class="absolute inset-0 fill-[#0369a1]" />
      </View>
    </View>

    {/* globe, orbit and wave — bottom right */}
    <View debugName="globe-quadrant" class="absolute left-[960px] top-[540px] w-[960px] h-[540px]">
      <Path
        debugName="globe"
        d={GLOBE}
        viewBox="0 0 100 100"
        class="absolute left-[60px] top-[90px] w-[360px] h-[360px] fill-none stroke-[#a5f3fc] stroke-[1px] stroke-join-round animate-turn"
      />
      <Path
        debugName="orbit"
        d={RING}
        viewBox="0 0 100 100"
        class="absolute left-[40px] top-[70px] w-[400px] h-[400px] fill-none stroke-amber-400 stroke-[2.5px] stroke-cap-round trim-start-[0] trim-end-[0.2] animate-orbit"
      />
      <View debugName="wave-window" class="absolute left-[500px] top-[120px] w-[400px] h-[300px] rounded-[48px] overflow-mask bg-[#111827]">
        <Path
          debugName="wave"
          d={[WAVE_UP, WAVE_DOWN]}
          class="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-700 bg-clip-path animate-swell"
        />
      </View>
    </View>
  </View>
));
