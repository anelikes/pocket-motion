// @title PocketJS Motion — text fitted, wrapped and clamped by layout
//
// `patches/0059` moves three decisions a generator used to make before the
// build into the core's layout, where the box is known: which size of a
// declared ladder a run takes (`text-fit-[..]`), where it wraps
// (`text-wrap`, at spaces and U+200B only), and how many lines it keeps
// (`line-clamp-N`, the last ending in an ellipsis). This composition puts
// each case on a named node of its own, beside the case that shows the
// boundary:
//
//   short        ladder 48..88 in 820×200   holds at the top rung, 88 px
//   long         the same box and ladder    a smaller rung, two lines
//   overlong     the same, `line-clamp-2`   no rung holds: drawn at 48 px,
//                                           clamped to two lines, and
//                                           `text_truncated` says how much
//                                           was left out
//   empty        the same declarations      an empty run takes no box at all,
//                                           as an empty run always has
//   price        [56,72,96] in a 420 badge  no wrapping: one line, a rung
//   price-short  the same badge             the top rung
//   flex-short   ladder 40..72, flex-1      the box comes from flex, which no
//   flex-long                               generator sees; each half fits
//                                           the 400 px it was given
//   cjk          ladder 40..72, `font-[sc]` wrapped at the U+200B marks a
//                                           segmenter would write; U+200B is
//                                           never drawn
//   legal-short  24 px, `line-clamp-3`      fits in three lines, nothing left
//   legal        the same                   eight lines' worth: three kept,
//                                           `text_truncated`
//   twin-fit     ladder 40..72 in 500×80    the rung it takes is the size
//   twin-fixed   `text-[49px]`, no ladder   its twin declares, so the two
//                                           draw the same pixels: a fitted
//                                           run is a run at its rung
//
// Nothing animates: every frame is the same picture, so each reading is a
// property of the layout. The sidecar asserts what each node is for —
// `untruncated` on every node that must be drawn whole, `insideBox` on the
// ones a clamp or a fit keeps inside their box. `overlong` and `legal` are
// the two `text_truncated` findings, and they are reported, not excused:
// a clamp that drops text is the reading this fixture exists to produce.
// `tests/text-fit.test.ts` holds the readings, the findings and the red side
// of `untruncated`.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-slate-950">
    <View class="absolute left-[80px] top-[60px] w-[820px] h-[200px] bg-slate-800" />
    <Text debugName="short" class="absolute left-[80px] top-[60px] w-[820px] h-[200px] text-fit-[48..88] text-wrap font-bold text-slate-50">
      {"Short."}
    </Text>
    <View class="absolute left-[80px] top-[280px] w-[820px] h-[200px] bg-slate-800" />
    <Text debugName="long" class="absolute left-[80px] top-[280px] w-[820px] h-[200px] text-fit-[48..88] text-wrap font-bold text-slate-50">
      {"A product name long enough to need a second line"}
    </Text>
    <View class="absolute left-[80px] top-[500px] w-[820px] h-[200px] bg-slate-800" />
    <Text debugName="overlong" class="absolute left-[80px] top-[500px] line-clamp-2 w-[820px] h-[200px] text-fit-[48..88] text-wrap font-bold text-slate-50">
      {
        "Kühlschrankzubehör Pro 3000 Ultra with an extended warranty, a second filter cartridge, a door alarm and a name nobody would print in full"
      }
    </Text>
    <View class="absolute left-[80px] top-[720px] w-[820px] h-[200px] bg-slate-800" />
    <Text debugName="empty" class="absolute left-[80px] top-[720px] line-clamp-2 w-[820px] h-[200px] text-fit-[48..88] text-wrap font-bold text-slate-50">
      {""}
    </Text>

    <View class="absolute left-[1000px] top-[60px] w-[420px] h-[120px] bg-red-700 rounded-[20px]" />
    <Text
      debugName="price"
      class="absolute left-[1000px] top-[60px] w-[420px] h-[120px] text-fit-[56,72,96] font-bold text-white text-center"
    >
      {"€ 1.234.567,89"}
    </Text>
    <View class="absolute left-[1440px] top-[60px] w-[400px] h-[120px] bg-red-700 rounded-[20px]" />
    <Text
      debugName="price-short"
      class="absolute left-[1440px] top-[60px] w-[400px] h-[120px] text-fit-[56,72,96] font-bold text-white text-center"
    >
      {"€ 9"}
    </Text>

    <View class="absolute left-[1000px] top-[220px] w-[840px] h-[160px] flex-row gap-[40px] bg-slate-900">
      <Text debugName="flex-short" class="flex-1 h-[160px] text-fit-[40..72] text-wrap text-amber-200">
        {"Ada"}
      </Text>
      <Text debugName="flex-long" class="flex-1 h-[160px] text-fit-[40..72] text-wrap text-amber-200">
        {"Bartholomew Montgomery-Wells"}
      </Text>
    </View>

    <View class="absolute left-[1000px] top-[420px] w-[840px] h-[200px] bg-slate-800" />
    <Text
      debugName="cjk"
      class="absolute left-[1000px] top-[420px] w-[840px] h-[200px] font-[sc] text-fit-[40..72] text-wrap text-sky-200"
    >
      {"超长商品名称​会在​分词​标记处​换行​并​缩小​字号​直到​放得下"}
    </Text>

    <View class="absolute left-[1000px] top-[660px] w-[840px] h-[110px] bg-slate-900" />
    <Text
      debugName="legal-short"
      class="absolute left-[1000px] top-[660px] w-[840px] text-[24px] text-wrap line-clamp-3 text-slate-400"
    >
      {"Prices include VAT. Offer valid while stocks last."}
    </Text>
    <View class="absolute left-[1000px] top-[800px] w-[840px] h-[110px] bg-slate-900" />
    <Text
      debugName="legal"
      class="absolute left-[1000px] top-[800px] w-[840px] text-[24px] text-wrap line-clamp-3 text-slate-400"
    >
      {
        "Prices include VAT where applicable. Offer valid while stocks last and not combinable with other promotions, vouchers or loyalty discounts. Delivery times are estimates and depend on the carrier. The manufacturer's warranty applies; see the leaflet in the box for its terms, exclusions and the address for claims. Images are illustrative. Errors and omissions excepted."
      }
    </Text>

    <Text
      debugName="twin-fit"
      class="absolute left-[80px] top-[960px] w-[500px] h-[80px] text-fit-[40..72] font-bold text-slate-50"
    >
      {"Same pixels, any size"}
    </Text>
    <Text debugName="twin-fixed" class="absolute left-[620px] top-[960px] text-[49px] font-bold text-slate-50">
      {"Same pixels, any size"}
    </Text>
  </View>
));
