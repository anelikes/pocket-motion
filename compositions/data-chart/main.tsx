// @title PocketJS Motion — data chart fixture
//
// A line chart drawn from rows: the rules, the area, the series and its dots
// are `<Path>`s whose `d` is computed at mount by `chart.ts` from `data.ts`,
// so the build cannot read any of them where they are written. It mounts the
// bundle, takes the four outlines from the tree, bakes them and mounts again
// (patches/0054); `main.paths.json` beside the pak lists what it baked. The
// series draws on, the area fades in under it, then the dots. The month
// labels are text the same mount lays out.
//
// The values sit in a fixed 0-100 domain: d3-scale's `nice()` and `ticks()`
// go through Math.log10 and Math.pow, whose last bit is the host's. It is in
// both ledgers.

import { mount } from "@pocketjs/framework";
import { Path, Text, View } from "@pocketjs/framework/components";
import { areaUnder, dots, monotoneX, rules } from "./chart.ts";
import { ROWS } from "./data.ts";

const W = 1520;
const H = 600;
const POINTS = ROWS.map((r, i) => ({ x: (W * i) / (ROWS.length - 1), y: H * (1 - r.value / 100) }));

mount(() => (
  <View class="w-full h-full bg-[#0f172a]">
    <Text debugName="title" class="absolute left-[200px] top-[90px] text-[56px] text-slate-100">
      {"Monthly active, % of target"}
    </Text>
    <View debugName="plot" class="absolute left-[200px] top-[220px] w-[1520px] h-[600px]">
      <Path debugName="rules" d={rules(W, 0, H, 4)} class="absolute inset-0 fill-none stroke-[#1e293b] stroke-[2px]" />
      <Path debugName="area" d={areaUnder(POINTS, H)} class="absolute inset-0 fill-[#f59e0b40] animate-fill" />
      <Path
        debugName="series"
        d={monotoneX(POINTS)}
        class="absolute inset-0 fill-none stroke-amber-400 stroke-[6px] stroke-cap-round stroke-join-round animate-draw"
      />
      <Path debugName="dots" d={dots(POINTS, 9)} class="absolute inset-0 fill-amber-100 animate-dots" />
    </View>
    <View class="absolute left-[160px] top-[850px] w-[1600px] flex-row justify-between">
      {ROWS.map((r) => (
        <Text class="w-[80px] text-[26px] text-slate-400 text-center">{r.month}</Text>
      ))}
    </View>
  </View>
));
