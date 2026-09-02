/**
 * The preview page. A debugger, not an editor: scrub, overlay layout, play.
 * All pixels come from the Bun host over `/frame` and `/layout`.
 *
 * The picture is the page. Chrome is a HUD on the frame plus a transport
 * bar — not a document wrapping a thumbnail.
 */

import { frameFromBox, inlineDecisions } from "./decide.ts";
import { liveMarkup, liveScript, liveStyles } from "./live.ts";
import { railMarkup, railScript, railStyles } from "./rail.ts";

export function previewPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>pocket-motion preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; overflow: hidden; }
  body {
    background: #000;
    color: #b4b0a8;
    font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .app {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
${railStyles()}
${liveStyles()}
  /* Lighter than any composition ground, so the picture edge is visible.
     A #000 surround and a near-black frame read alike. */
  .viewport {
    flex: 1;
    min-height: 0;
    container-type: size;
    display: grid;
    place-items: center;
    background: #141414;
  }
  .stage {
    position: relative;
    width: min(100cqw, calc(100cqh * var(--ar, 1.777)));
    max-height: 100cqh;
    aspect-ratio: var(--ar-w, 16) / var(--ar-h, 9);
    background: #000;
    overflow: hidden;
  }
  .stage img, .stage svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .stage svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .hud {
    position: absolute;
    z-index: 2;
    pointer-events: none;
    font-size: 11px;
    letter-spacing: 0.01em;
    color: #e8e4dc;
    background: rgba(0, 0, 0, 0.55);
    padding: 5px 8px;
  }
  .hud-tl { top: 8px; left: 8px; max-width: calc(100% - 88px); }
  .hud-tl strong {
    display: block;
    font-weight: 600;
  }
  .hud a {
    pointer-events: auto;
    color: inherit;
    text-decoration: none;
    opacity: 0.75;
  }
  .hud a:hover { opacity: 1; text-decoration: underline; }
  .hud-tr {
    top: 8px;
    right: 8px;
    font-variant-numeric: tabular-nums;
  }
  .hud-bl { bottom: 8px; left: 8px; max-width: calc(100% - 16px); }
  .hud-err {
    left: 8px;
    right: 8px;
    bottom: 8px;
    color: #f0c2b0;
    background: rgba(40, 12, 8, 0.72);
  }
  .legend i { font-style: normal; }
  .ok { stroke: #34d399; color: #34d399; }
  .dark { stroke: #f59e0b; color: #f59e0b; }
  .transport {
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    min-width: 0;
    background: #0a0a0a;
    border-top: 1px solid #1c1c1c;
    color: #9a968e;
  }
  .transport button, .transport label.tog {
    background: none;
    color: inherit;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  #play {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    color: #e8e4dc;
  }
  #play svg { width: 12px; height: 12px; display: block; }
  #play .i-pause { display: none; }
  #play.is-on .i-play { display: none; }
  #play.is-on .i-pause { display: block; }
  #clock {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: #e8e4dc;
    min-width: 7.4ch;
  }
  #scrub {
    flex: 1;
    min-width: 64px;
    position: relative;
    height: 28px;
    cursor: pointer;
    touch-action: none;
  }
  #scrub .track, #scrub .fill {
    position: absolute;
    left: 0;
    right: 0;
    top: 13px;
    height: 2px;
    background: #2a2a2a;
  }
  #scrub .fill {
    right: auto;
    width: 100%;
    background: #8a8680;
    transform: scaleX(0);
    transform-origin: left center;
    pointer-events: none;
  }
  #scrub .head {
    position: absolute;
    top: 10px;
    left: 0;
    width: 2px;
    height: 8px;
    margin-left: -1px;
    background: #e8e4dc;
    pointer-events: none;
  }
  .frame-read {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    color: #7a7670;
    font-variant-numeric: tabular-nums;
  }
  #at {
    width: 5.5ch;
    background: transparent;
    color: #e8e4dc;
    border: 0;
    padding: 0;
    font: inherit;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
  }
  #at::-webkit-outer-spin-button, #at::-webkit-inner-spin-button { appearance: none; }
  .tog {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    user-select: none;
  }
  .tog input {
    appearance: none;
    width: 11px;
    height: 11px;
    margin: 0;
    border: 1px solid #5a564e;
    background: transparent;
  }
  .tog input:checked {
    background: #e8e4dc;
    border-color: #e8e4dc;
  }
  #play, #clock, .frame-read, .tog { flex-shrink: 0; }
  #play:focus-visible, #scrub:focus-visible, #at:focus-visible, .tog:has(:focus-visible) {
    outline: 1px solid #e8e4dc;
    outline-offset: 3px;
  }
  @media (max-width: 560px) {
    .transport { gap: 8px; padding: 0 8px; }
    #frame-max { display: none; }
  }
</style>
</head>
<body>
${railMarkup()}
${liveMarkup()}
  <div class="app">
    <div class="viewport">
      <div class="stage" id="stage">
        <img id="frame" alt="" />
        <svg id="overlay" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="hud hud-tl">
          <strong id="title">pocket-motion preview</strong>
          <span id="sub">loading…</span>
          <div><a href="/watch">player</a></div>
        </div>
        <div class="hud hud-tr" id="latency"></div>
        <div class="hud hud-bl legend" id="legend" hidden>
          <i class="ok">■</i> in picture
          · <i class="dark">■</i> not in picture
          <span id="nip"></span>
        </div>
        <div class="hud hud-err" id="status" hidden></div>
      </div>
    </div>
    <div class="transport">
      <button id="play" type="button" aria-label="Play">
        <svg class="i-play" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2.2 1.2v9.6L11 6z"/></svg>
        <svg class="i-pause" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 1.5h3v9H2zm5 0h3v9H7z"/></svg>
      </button>
      <span id="clock">00:00:00</span>
      <div id="scrub" role="slider" tabindex="0" aria-label="Frame" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0">
        <div class="track"></div>
        <div class="fill" id="fill"></div>
        <div class="head" id="head"></div>
      </div>
      <label class="frame-read">f <input id="at" type="number" min="0" value="0" /> <span id="frame-max">/0</span></label>
      <label class="tog"><input id="boxes" type="checkbox" /> overlay</label>
    </div>
  </div>
  </div>
<script type="module">
${inlineDecisions([frameFromBox])}
  const frameEl = document.getElementById("frame");
  const overlay = document.getElementById("overlay");
  const scrub = document.getElementById("scrub");
  const fill = document.getElementById("fill");
  const head = document.getElementById("head");
  const atEl = document.getElementById("at");
  const playBtn = document.getElementById("play");
  const boxes = document.getElementById("boxes");
  const status = document.getElementById("status");
  const title = document.getElementById("title");
  const sub = document.getElementById("sub");
  const stage = document.getElementById("stage");
  const clock = document.getElementById("clock");
  const latency = document.getElementById("latency");
  const legend = document.getElementById("legend");
  const nip = document.getElementById("nip");
  const frameMax = document.getElementById("frame-max");

  const meta = await (await fetch("/meta")).json();
  if (!meta.ok) {
    status.hidden = false;
    status.textContent = meta.error || "meta failed";
    throw new Error(status.textContent);
  }

  const last = Math.max(0, meta.durationFrames - 1);
  const fps = meta.fps;
  // The path, not the compositionId: two pairs in this tree share an id, so
  // the id alone cannot say which film is on screen.
  title.textContent = meta.current || meta.compositionId;
  title.title = meta.compositionId;
  document.title = (meta.current || meta.compositionId) + " · preview";
  sub.textContent = meta.width + "×" + meta.height + " · " + fps + " fps · " +
    meta.durationFrames + " frames" + (meta.hasFootage ? " · footage" : "");
  stage.style.setProperty("--ar", String(meta.width / meta.height));
  stage.style.setProperty("--ar-w", String(meta.width));
  stage.style.setProperty("--ar-h", String(meta.height));
  overlay.setAttribute("viewBox", "0 0 " + meta.width + " " + meta.height);
  overlay.setAttribute("preserveAspectRatio", "none");
  atEl.max = String(last);
  frameMax.textContent = "/" + last;
  scrub.setAttribute("aria-valuemax", String(last));

  let at = 0;
  let playing = false;
  let inflight = false;
  let pending = null;
  let playAccum = 0;
  let playLast = 0;
  const frameMs = 1000 / fps;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function timecode(frame) {
    const sec = Math.floor(frame / fps);
    return pad2(Math.floor(sec / 60)) + ":" + pad2(sec % 60) + ":" + pad2(frame % fps);
  }

  function syncTransport(n) {
    const p = last === 0 ? 0 : n / last;
    fill.style.transform = "scaleX(" + p + ")";
    head.style.left = (p * 100) + "%";
    clock.textContent = timecode(n);
    atEl.value = String(n);
    scrub.setAttribute("aria-valuenow", String(n));
    scrub.setAttribute("aria-valuetext", timecode(n) + "  f " + n + "/" + last);
  }

  function drawOverlay(layout) {
    overlay.replaceChildren();
    if (!boxes.checked) return;
    for (const n of layout.nodes) {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", n.x);
      r.setAttribute("y", n.y);
      r.setAttribute("width", n.w);
      r.setAttribute("height", n.h);
      r.setAttribute("fill", "none");
      r.setAttribute("stroke-width", "2");
      r.setAttribute("vector-effect", "non-scaling-stroke");
      r.setAttribute("class", n.inPicture ? "ok" : "dark");
      overlay.appendChild(r);
    }
  }

  async function load(n) {
    const t0 = performance.now();
    const png = await fetch("/frame?at=" + n);
    if (!png.ok) {
      const err = await png.json().catch(() => ({ error: png.statusText }));
      status.hidden = false;
      status.textContent = err.error || ("frame " + n + " failed");
      return;
    }
    const blob = await png.blob();
    const url = URL.createObjectURL(blob);
    const prev = frameEl.src;
    frameEl.src = url;
    frameEl.alt = "frame " + n;
    if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);

    let layout = { notInPicture: 0, nodes: [] };
    if (boxes.checked) {
      const res = await fetch("/layout?at=" + n);
      layout = await res.json();
      drawOverlay(layout);
    } else {
      overlay.replaceChildren();
    }
    const ms = Math.round(performance.now() - t0);
    status.hidden = true;
    latency.textContent = ms + " ms";
    nip.textContent = layout.notInPicture
      ? " · " + layout.notInPicture + " named/text not in picture"
      : "";
  }

  function show(n) {
    n = Math.max(0, Math.min(last, n | 0));
    at = n;
    syncTransport(n);
    if (inflight) { pending = n; return; }
    inflight = true;
    load(n).finally(() => {
      inflight = false;
      if (pending !== null) {
        const p = pending;
        pending = null;
        show(p);
      }
    });
  }

  function tick(now) {
    if (!playing) return;
    requestAnimationFrame(tick);
    if (!playLast) { playLast = now; return; }
    playAccum += now - playLast;
    playLast = now;
    if (playAccum < frameMs) return;
    playAccum -= frameMs;
    show(at >= last ? 0 : at + 1);
  }

  function setPlaying(on) {
    playing = on;
    playBtn.classList.toggle("is-on", on);
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    playLast = 0;
    playAccum = 0;
    if (on) requestAnimationFrame(tick);
  }

  function frameFromPointer(e) {
    const rect = scrub.getBoundingClientRect();
    const x = rect.width === 0 ? 0 : (e.clientX - rect.left) / rect.width;
    return Math.round(Math.min(1, Math.max(0, x)) * last);
  }

  scrub.addEventListener("pointerdown", (e) => {
    scrub.setPointerCapture(e.pointerId);
    show(frameFromPointer(e));
  });
  scrub.addEventListener("pointermove", (e) => {
    if (!scrub.hasPointerCapture(e.pointerId)) return;
    show(frameFromPointer(e));
  });
  atEl.addEventListener("change", () => {
    const n = frameFromBox(atEl.value, last);
    // An empty box is not frame 0. Clearing it to type a number in, or
    // clearing it and tabbing away, jumped the picture to the start.
    if (n === null) { syncTransport(at); return; }
    show(n);
  });
  boxes.addEventListener("change", () => {
    legend.hidden = !boxes.checked;
    show(at);
  });
  playBtn.addEventListener("click", () => setPlaying(!playing));
  // A rebuild produced a new picture. Geometry or length changing is a
  // different film in every way the page is built around, so that reloads;
  // anything else re-fetches the frame already on screen, which is what makes
  // this feel like an edit taking effect rather than a page load.
  //
  // A different COMPOSITION reloads too, whatever its geometry. Somebody
  // picked another film in another tab and this one is still showing the old
  // one's name, rail row and title while serving the new one's frames.
  window.addEventListener("pocket-motion:reloaded", (e) => {
    const m = e.detail || {};
    if (
      (m.current !== undefined && m.current !== meta.current) ||
      m.durationFrames !== meta.durationFrames ||
      m.fps !== meta.fps ||
      m.width !== meta.width ||
      m.height !== meta.height
    ) {
      location.reload();
      return;
    }
    show(at);
  });

  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " ") {
      if (tag === "BUTTON") return;
      e.preventDefault();
      playBtn.click();
      return;
    }
    if (e.key === "ArrowRight") { e.preventDefault(); show(at + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); show(at - 1); }
  });

  show(0);
</script>
${railScript()}
${liveScript()}
</body>
</html>
`;
}
