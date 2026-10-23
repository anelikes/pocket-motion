// The render-cost benchmark scene, ported to Remotion from
// ../../pocket-motion/bench-title (pocket.config.ts holds the timing).
// Written the way Remotion is meant to be written: every moving value is
// derived from useCurrentFrame(), each one an `animation` entry there at the
// same instants and with the same cubic-bezier. CSS `infinite` loops are
// evaluated per segment, which is how CSS applies a timing function.
import { AbsoluteFill, Easing, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";

const fontsReady = delayRender("HarmonyOS Sans");
Promise.all([
  new FontFace("HarmonyOS Sans", `url(${staticFile("fonts/HarmonyOS_Sans_Regular.ttf")})`, { weight: "400" }).load(),
  new FontFace("HarmonyOS Sans", `url(${staticFile("fonts/HarmonyOS_Sans_Bold.ttf")})`, { weight: "700" }).load(),
]).then((faces) => {
  for (const f of faces) document.fonts.add(f);
  continueRender(fontsReady);
});

const OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
const IN_EXPO = Easing.bezier(0.7, 0, 0.84, 0);
const SINE = Easing.bezier(0.37, 0, 0.63, 1);
const LINEAR = (t: number) => t;

/** One CSS animation with fill `both` (or `forwards`, whose `from` is the resting value). */
function tween(t: number, start: number, dur: number, from: number, to: number, ease: (x: number) => number): number {
  return interpolate(t, [start, start + dur], [from, to], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/** A looping keyframe list with equal segments: the timing function applies per segment. */
function loop(t: number, period: number, values: readonly number[], ease: (x: number) => number): number {
  const legs = values.length - 1;
  const leg = period / legs;
  const local = t % period;
  const i = Math.min(Math.floor(local / leg), legs - 1);
  return values[i]! + (values[i + 1]! - values[i]!) * ease((local - i * leg) / leg);
}

const abs = (style: React.CSSProperties): React.CSSProperties => ({ position: "absolute", ...style });
const text = (size: number, weight: number, color: string): React.CSSProperties => ({
  fontFamily: "HarmonyOS Sans", fontSize: size, fontWeight: weight, color, whiteSpace: "nowrap", lineHeight: "normal",
});

export const BenchTitle: React.FC = () => {
  const t = useCurrentFrame() / 30;
  const rise = (dy: number, dur: number, at: number) => ({
    transform: `translateY(${tween(t, at, dur, dy, 0, OUT_EXPO)}px)`,
    opacity: tween(t, at, dur, 0, 1, OUT_EXPO),
  });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg, #0f172a, #1e1b4b 60%, #312e81)" }}>
      <div style={abs({ left: -100, top: 40, width: 1000, height: 1000, opacity: 0.5,
        background: "radial-gradient(circle closest-side, #6366f1, #6366f100)",
        transform: `scale(${loop(t, 4, [1, 1.15, 1], SINE)})` })} />
      <div style={abs({ left: 1240, top: 600, width: 320, height: 320, borderRadius: 64, background: "#22d3ee", opacity: 0.2,
        transform: `rotate(${(t / 20) * 360}deg)` })} />
      <div style={abs({ left: 1380, top: 140, width: 220, height: 220, borderRadius: 40, background: "#6366f1", opacity: 0.4,
        transform: `translateY(${loop(t, 5, [0, -40, 0], SINE)}px) rotate(${((t % 12) / 12) * 360}deg)` })} />
      <div style={abs({ left: 1600, top: 480, width: 140, height: 140, borderRadius: 28, background: "#f59e0b", opacity: 0.6,
        transform: `translateX(${loop(t, 4, [0, 30, 0], SINE)}px) rotate(${360 - ((t % 9) / 9) * 360}deg)` })} />

      <div style={abs({ left: 0, top: 0, width: 1920, height: 1080, opacity: tween(t, 9.3, 0.5, 1, 0, IN_EXPO) })}>
        <div style={abs({ left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${tween(t, 0, 10, 1, 1.04, LINEAR)})` })}>
          <div style={abs({ left: 160, top: 250, ...text(28, 700, "#a5b4fc"), ...rise(30, 0.6, 0.3) })}>RENDER COST · OCTOBER 2026</div>
          <div style={abs({ left: 160, top: 300, ...text(120, 700, "#ffffff"), ...rise(80, 0.7, 0.5) })}>Same picture,</div>
          <div style={abs({ left: 160, top: 440, ...text(120, 700, "#c7d2fe"), ...rise(80, 0.7, 0.7) })}>three renderers.</div>
          <div style={abs({ left: 164, top: 610, width: 480, height: 8, borderRadius: 4, background: "#f59e0b",
            transformOrigin: "0% 50%", transform: `scaleX(${tween(t, 1.1, 0.6, 0, 1, IN_OUT)})` })} />
          <div style={abs({ left: 160, top: 650, ...text(40, 400, "#cbd5e1"), ...rise(30, 0.6, 1.4) })}>1920 x 1080 · 30 fps · 300 frames</div>
        </div>
      </div>

      <div style={abs({ left: 120, top: 790, width: 760, height: 150, transform: `translateX(${tween(t, 8.6, 0.5, 0, -900, IN_EXPO)}px)` })}>
        <div style={abs({ left: 0, top: 0, width: 760, height: 150, borderRadius: 16, background: "#f8fafc",
          transform: `translateX(${tween(t, 4.5, 0.6, -900, 0, OUT_EXPO)}px)` })}>
          <div style={abs({ left: 0, top: 0, width: 14, height: 150, borderRadius: 4, background: "#f59e0b" })} />
          <div style={abs({ left: 48, top: 22, ...text(56, 700, "#0f172a"), ...rise(30, 0.5, 4.8) })}>Ada Lovelace</div>
          <div style={abs({ left: 50, top: 92, ...text(30, 400, "#475569"), ...rise(30, 0.5, 5.0) })}>Analyst · Analytical Engine No. 1</div>
        </div>
      </div>

      <div style={abs({ left: 0, top: 1072, width: 1920, height: 8, background: "#818cf8",
        transformOrigin: "0% 50%", transform: `scaleX(${tween(t, 0, 10, 0, 1, LINEAR)})` })} />
    </AbsoluteFill>
  );
};
