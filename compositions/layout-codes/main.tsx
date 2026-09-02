// @title PocketJS Motion — one node per layout finding code
//
// `src/render/findings.ts` names seven codes. This composition puts each one on
// a node of its own, named, in a region of its own, so a change to a predicate
// has something to be red against — and so the codes can be read next to the
// pictures that produce them rather than only in prose.
//
// Nothing animates and nothing is bound to footage: every frame is the same
// picture, so a finding here is a property of the layout and not of a moment.
//
//   faded       text_not_painted     opacity 0 on the node itself. The walk
//                                    returns above it, so it emits no geometry
//                                    and still reports its box.
//   buried      text_occluded        an unnamed lid after it in document order,
//                                    covering it exactly. Document order is
//                                    paint order.
//   overlap-a   content_overlap      two named runs sharing a corner. Neither
//   overlap-b                        contains the other, which is what
//                                    separates this from text over a
//                                    background.
//   escapee     escaped_container    absolutely placed past its pane's right
//                                    edge, with nothing clipping it.
//   offscreen   panel_out_of_canvas  300 px wide starting at x=2000 on a
//               text_not_painted     1920-wide canvas. Layout clamps every box
//                                    to the viewport, so it comes back
//                                    `1920,620 0x120` — collapsed against the
//                                    right edge. It carries the second code
//                                    too, and has to: a panel wholly off canvas
//                                    emits no geometry.
//   too-long    text_box_overflow    one line, no break, in a box narrower
//                                    than the run. The box is what layout gave
//                                    it; the ink is what the rasteriser drew.
//   cut-off     clipped_text         a 900 px run inside a 300 px
//               escaped_container    `overflow-hidden` strip. BOTH codes, and
//                                    both are true: the box leaves the strip
//                                    and the ink stops at its edge. A node in
//                                    two states is not a defect in the report.
//   wing        escaped_container    the same shape as `escapee`, excused in
//               (excused)            `pocket-motion.json` with a written
//                                    reason. It is in the JSON with an
//                                    `allowedBy`, and out of the counts.
//
// The sidecar also carries four `assertions[]`, all green, one of each shape
// that has an obvious answer here: `overlap-a` in picture for the whole clock,
// `cut-off` entering by frame 0, `too-long` dwelling for all 30 frames, and
// `pane` inside its box. Nothing animates, so every one of them is a statement
// about the layout rather than about a moment. The failing side of the
// predicate is `tests/assert.test.ts` against `compositions/spanned`, where a
// caption really is covered part way through.
//
// `visibility` FAILS on this composition, by construction: `buried` paints at
// every sampled frame and no sampled frame shows it. `baselines/visibility.json`
// records that failure by name, so a run where it comes back clean is a run
// where the gate stopped working.
//
// It is a fixture, not a film: no ledger digest, see `scripts/digests.ts`.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-slate-950">
    <Text
      debugName="faded"
      class="absolute left-[80px] top-[40px] text-[36px] opacity-0 text-slate-50"
    >
      {"declared invisible: opacity 0 on this node"}
    </Text>

    <Text
      debugName="buried"
      class="absolute left-[100px] top-[140px] text-[36px] text-slate-50"
    >
      {"painted, and no pixel survives"}
    </Text>
    <View class="absolute left-[80px] top-[120px] w-[1000px] h-[110px] bg-slate-900" />

    <Text
      debugName="overlap-a"
      class="absolute left-[80px] top-[280px] text-[36px] text-amber-200"
    >
      {"the earlier run"}
    </Text>
    <Text
      debugName="overlap-b"
      class="absolute left-[240px] top-[310px] text-[36px] text-sky-300"
    >
      {"the later run, over its corner"}
    </Text>

    <View
      debugName="pane"
      class="absolute left-[80px] top-[420px] w-[400px] h-[140px] bg-slate-800"
    >
      <View
        debugName="escapee"
        class="absolute left-[300px] top-[30px] w-[300px] h-[80px] bg-amber-500"
      />
    </View>

    <View
      debugName="cap-frame"
      class="absolute left-[1200px] top-[420px] w-[300px] h-[140px] bg-slate-800"
    >
      <View
        debugName="wing"
        class="absolute left-[-40px] top-[30px] w-[380px] h-[60px] bg-emerald-600"
      />
    </View>

    <View
      debugName="offscreen"
      class="absolute left-[2000px] top-[620px] w-[300px] h-[120px] bg-sky-700"
    />

    <View class="absolute left-[80px] top-[780px] w-[520px] h-[70px] flex-col">
      <Text debugName="too-long" class="text-[36px] text-slate-50">
        {"one line with no break in it, far wider than the box"}
      </Text>
    </View>

    <View
      debugName="strip"
      class="absolute left-[1200px] top-[780px] w-[300px] h-[70px] overflow-hidden bg-slate-800 flex-col"
    >
      <Text debugName="cut-off" class="w-[900px] text-[36px] text-slate-50">
        {"this run is three times the strip it rides in"}
      </Text>
    </View>
  </View>
));
