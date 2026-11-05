// Hero type and colour glyphs (patches/0063). The face has no emoji, so the
// sidecar declares a fallback chain of one colour face, Noto Color Emoji
// (COLRv1); its glyphs are layered outlines, some under gradients.
//
//   hero   480 px Noto Sans SC Bold — 2.7x past the face's 176 px atlas
//          ceiling — rising in scaled and turned, so its outlines are mapped
//          through a world that is neither unit nor axis-aligned while it moves
//   turn   120 px, a size the atlas could bake, declared `text-vector`
//          because it turns: atlas cells stay upright under a rotation
//   flame  a colour glyph in a vector slot, turning: its layers turn with it,
//          gradients included
//   title  an anime title at 64 px from the atlas, a trophy and a flame in it:
//          the atlas draws the CJK, and the colour glyphs are the slot's
//          supplement, drawn as layers in the same run
import { Text, View } from "@pocketjs/framework/components";

export default function HeroType() {
  return (
    <View class="w-full h-full bg-[#101014]">
      <Text debugName="hero" class="animate-rise absolute left-[100px] top-[150px] text-[480px] font-bold text-white">
        {"第一名"}
      </Text>
      <View class="absolute left-[1560px] top-[150px] w-[300px] h-[300px] flex-col justify-center items-center">
        <Text debugName="turn" class="animate-turn text-[120px] text-vector font-bold text-[#ffcf40]">{"榜"}</Text>
      </View>
      <View class="absolute left-[1560px] top-[500px] w-[300px] h-[300px] flex-col justify-center items-center">
        <Text debugName="flame" class="animate-sway text-[160px] text-vector text-white">{"\u{1F525}"}</Text>
      </View>
      <Text debugName="title" class="animate-slide absolute left-[128px] top-[860px] text-[64px] font-bold text-[#e8e8f0]">
        {"\u{1F3C6} 进击的巨人 最终季 \u{1F525}"}
      </Text>
    </View>
  );
}
