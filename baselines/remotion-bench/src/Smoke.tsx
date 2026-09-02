// A faithful port of compositions/smoke/app.tsx, the composition that produced
// PocketJS Motion's 5.75 ms/frame figure. Same layout, same four motions
// (pulse, spin, ping, and the 280-degree annular sector), same 1920x1080/30fps.
//
// Written the way Remotion is meant to be written: every moving value is
// derived from useCurrentFrame(). That per-frame JS is exactly the work
// PocketJS Motion does not do, so it belongs in the comparison rather than
// being engineered around.
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export const Smoke: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // animate-pulse: 2s ease-in-out opacity 1 -> .5 -> 1
  const pulse = 0.75 + 0.25 * Math.cos((2 * Math.PI * t) / 2);
  // animate-spin: 1 turn per second
  const spin = (t * 360) % 360;
  // animate-ping: 1s scale 1 -> 2 with fade
  const pingT = t % 1;
  const pingScale = interpolate(pingT, [0, 1], [1, 2]);
  const pingOpacity = interpolate(pingT, [0, 0.75, 1], [1, 0, 0]);

  const R = 54;
  const C = 2 * Math.PI * R;

  return (
    <AbsoluteFill style={{ backgroundColor: "#020617", display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "#2563eb", opacity: pulse }} />
          <span style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>POCKETJS MOTION</span>
        </div>
        <span style={{ fontSize: 14, color: "#94a3b8" }}>PHASE 0 · SMOKE</span>
      </div>

      <div style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 32 }}>
        <svg width={128} height={128} style={{ transform: `rotate(${spin}deg)` }}>
          <circle
            cx={64} cy={64} r={R}
            fill="none" stroke="#22d3ee" strokeWidth={10} strokeLinecap="round"
            strokeDasharray={`${(C * 280) / 360} ${C}`}
            transform="rotate(220 64 64)"
          />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 36, fontWeight: 700, color: "#f8fafc" }}>Deterministic.</span>
          <div style={{ width: 256, height: 4, borderRadius: 4, backgroundColor: "#3b82f6" }} />
          <span style={{ fontSize: 18, color: "#cbd5e1" }}>No browser. No wall clock.</span>
          <span style={{ fontSize: 16, color: "#64748b" }}>Frames are a pure function of the tick index.</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
        <span style={{ fontSize: 14, color: "#64748b" }}>1920 x 1080 · 30 fps</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: "#34d399", transform: `scale(${pingScale})`, opacity: pingOpacity }} />
          <span style={{ fontSize: 14, color: "#34d399" }}>RENDERING</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
