/**
 * The watch page. A normal player over `/movie` (an MP4), not the live PNG
 * debugger. Time, fullscreen, speed, volume come from `<video>`.
 */

import { frameFromBox, inlineDecisions, transportRunning } from "./decide.ts";
import { liveMarkup, liveScript, liveStyles } from "./live.ts";
import { railMarkup, railScript, railStyles } from "./rail.ts";

export function playerPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>pocket-motion</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  /* The UA sheet hides [hidden] with display: none, and .wait/.fail below
     set display: grid in the author origin, which wins over it. Without
     this line the hidden attribute does nothing to either overlay, and
     #fail — empty, inset: 0, opaque #000, painted after the video — is a
     black rectangle over the stage whatever the video is doing. Reader
     Mode drops the author sheet, which is why the same MP4 shows a
     picture there. */
  [hidden] { display: none !important; }
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
  /* The surround is lighter than any composition ground so the picture edge
     is visible. Measured on compositions/open: the encoded ground is
     rgb(2, 6, 10) and a #000 surround put the frame boundary below what a
     display resolves, so a black frame and the letterbox read alike. */
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
  /* In-flow height:100% does not resolve against a parent's aspect-ratio
     height in WebKit/Blink: the video stays 0 tall and you see this black
     stage. Reader Mode's native player uses the file's intrinsic size, so
     the same MP4 shows a picture. Fill the used box instead. */
  .stage video, .stage img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  .stage video[hidden], .stage img[hidden] { display: none; }
  /* The HUD gets out of the way. A full-bleed composition puts content in
     the top-left corner, and this is a player rather than a debugger: which
     film is on screen is also the document title and the highlighted row in
     the rail, so nothing is lost by fading it while the pointer is still.
     The frame debugger keeps its own HUD — latency, the legend and the error
     line are what it is for. */
  .hud {
    position: absolute;
    z-index: 2;
    pointer-events: none;
    font-size: 11px;
    color: #e8e4dc;
    background: rgba(0, 0, 0, 0.55);
    padding: 5px 8px;
    transition: opacity 200ms linear;
  }
  .stage.is-idle .hud { opacity: 0; }
  .hud-tl { top: 8px; left: 8px; max-width: calc(100% - 88px); }
  .hud-tl strong { display: block; font-weight: 600; }
  .hud a {
    pointer-events: auto;
    color: inherit;
    text-decoration: none;
    opacity: 0.75;
  }
  .hud a:hover { opacity: 1; text-decoration: underline; }
  /* The still carries the picture from the first moment, so the encode note
     is a line in the corner rather than a sheet over the film. A failure
     still covers: there is nothing behind it worth looking at. */
  .wait.is-bad { color: #f0c2b0; }
  .wait.is-retry { pointer-events: auto; cursor: pointer; text-decoration: underline; }
  .wait {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 2;
    padding: 4px 8px;
    font-size: 11px;
    color: #c8c4bc;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .fail {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 24px;
    color: #f0c2b0;
    background: #000;
  }
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
  .transport button {
    background: none;
    color: inherit;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .transport button:disabled { opacity: 0.35; cursor: default; }
  #play, #mute, #full {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    color: #e8e4dc;
  }
  #play svg, #mute svg, #full svg { width: 12px; height: 12px; display: block; }
  #play .i-pause { display: none; }
  #play.is-on .i-play { display: none; }
  #play.is-on .i-pause { display: block; }
  #mute .i-off { display: none; }
  #mute.is-off .i-on { display: none; }
  #mute.is-off .i-off { display: block; }
  #clock {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: #e8e4dc;
    min-width: 9ch;
  }
  #scrub {
    flex: 1;
    min-width: 48px;
    position: relative;
    height: 28px;
    cursor: pointer;
    touch-action: none;
  }
  #scrub .track, #scrub .fill {
    position: absolute;
    left: 0; right: 0; top: 13px;
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
    top: 10px; left: 0;
    width: 2px; height: 8px;
    margin-left: -1px;
    background: #e8e4dc;
    pointer-events: none;
  }
  #rate {
    flex: none;
    min-width: 4.2ch;
    color: #e8e4dc;
    text-align: right;
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
    cursor: pointer;
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
  #vol {
    flex: none;
    width: 72px;
    position: relative;
    height: 28px;
    cursor: pointer;
    touch-action: none;
  }
  #vol.is-off { opacity: 0.35; cursor: default; }
  #vol .track, #vol .fill {
    position: absolute;
    left: 0; right: 0; top: 13px;
    height: 2px;
    background: #2a2a2a;
  }
  #vol .fill {
    right: auto;
    width: 100%;
    background: #8a8680;
    transform: scaleX(1);
    transform-origin: left center;
    pointer-events: none;
  }
  #play, #clock, .frame-read, #rate, .tog, #mute, #vol, #full { flex-shrink: 0; }
  #play:focus-visible, #scrub:focus-visible, #at:focus-visible,
  #rate:focus-visible, .tog:has(:focus-visible),
  #mute:focus-visible, #vol:focus-visible, #full:focus-visible {
    outline: 1px solid #e8e4dc;
    outline-offset: 3px;
  }
  @media (max-width: 560px) {
    .transport { gap: 8px; padding: 0 8px; }
    #vol { width: 48px; }
    #frame-max, .tog { display: none; }
  }
</style>
</head>
<body>
${railMarkup()}
${liveMarkup()}
  <div class="app" id="app">
    <div class="viewport">
      <div class="stage" id="stage">
        <img id="still" alt="" />
        <video id="video" playsinline preload="auto" poster="/frame?at=0" hidden></video>
        <div class="hud hud-tl">
          <strong id="title">pocket-motion</strong>
          <span id="sub">loading…</span>
          <div><a href="/">frames</a></div>
        </div>
        <div class="wait" id="wait">frames — encoding…</div>
        <div class="fail" id="fail" hidden></div>
      </div>
    </div>
    <div class="transport">
      <button id="play" type="button" aria-label="Play" disabled>
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
      <button id="rate" type="button" aria-label="Playback speed">1×</button>
      <label class="tog"><input id="loop" type="checkbox" checked /> loop</label>
      <button id="mute" type="button" aria-label="Mute" disabled>
        <svg class="i-on" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M1 4.5h2.2L6 2.2v7.6L3.2 7.5H1zm7.1.1a2.4 2.4 0 0 1 0 2.8l-.8-.8a1.3 1.3 0 0 0 0-1.2zm1.5-1.6a4.4 4.4 0 0 1 0 6l-.9-.9a3.2 3.2 0 0 0 0-4.2z"/></svg>
        <svg class="i-off" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M1 4.5h2.2L6 2.2v7.6L3.2 7.5H1zM8.2 3.2l.8.8L8 5l1 1-.8.8L7.2 5.8 6.2 6.8 5.4 6l1-1-1-1 .8-.8 1 1z"/></svg>
      </button>
      <div id="vol" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="1" aria-valuenow="1">
        <div class="track"></div>
        <div class="fill" id="vfill"></div>
      </div>
      <button id="full" type="button" aria-label="Fullscreen">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M1 1h4v1.4H2.4V5H1zm6 0h4v4h-1.4V2.4H7zM1 7h1.4v2.6H5V11H1zm9.6 0H11v4H7v-1.4h2.6z"/></svg>
      </button>
    </div>
  </div>
  </div>
<script type="module">
${inlineDecisions([frameFromBox, transportRunning])}
  const video = document.getElementById("video");
  const still = document.getElementById("still");
  const wait = document.getElementById("wait");
  const fail = document.getElementById("fail");
  const title = document.getElementById("title");
  const sub = document.getElementById("sub");
  const stage = document.getElementById("stage");
  const app = document.getElementById("app");
  const playBtn = document.getElementById("play");
  const clock = document.getElementById("clock");
  const scrub = document.getElementById("scrub");
  const fill = document.getElementById("fill");
  const head = document.getElementById("head");
  const rateBtn = document.getElementById("rate");
  const atEl = document.getElementById("at");
  const frameMax = document.getElementById("frame-max");
  const loopBox = document.getElementById("loop");
  const muteBtn = document.getElementById("mute");
  const vol = document.getElementById("vol");
  const vfill = document.getElementById("vfill");
  const fullBtn = document.getElementById("full");

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let rateIndex = 2;
  let volume = 1;
  let hasAudio = true;
  let ready = false;
  let dragging = false;
  let movieGeneration = 0;

  // Two sources, one transport. The still is the session's own picture, one
  // PNG per frame, available the moment the page loads — the same bytes the
  // frame command writes. The video is a rendered copy of the whole film and
  // has to be encoded first. Scrubbing and stepping never needed the file;
  // only playing at speed does. So the page starts on the still and moves to
  // the video when there is one, and a rebuild sends it back.
  let mode = "frames";
  let at = 0;
  let stillInflight = false;
  let stillPending = null;
  let stillUrl = "";
  let playing = false;
  let playLast = 0;
  let playAccum = 0;

  const meta = await (await fetch("/meta")).json();
  if (!meta.ok) {
    fail.hidden = false;
    fail.textContent = meta.error || "meta failed";
    wait.hidden = true;
    throw new Error(fail.textContent);
  }

  // The frame grid comes from the sidecar, not from the container: a frame
  // read here is the number that frame --at, layout --at and visibility
  // take, which is the whole point of showing it.
  const fps = meta.fps;
  const last = Math.max(0, meta.durationFrames - 1);
  // The path, not the compositionId: two pairs in this tree share an id, so
  // the id alone cannot say which film is on screen.
  title.textContent = meta.current || meta.compositionId;
  title.title = meta.compositionId;
  document.title = meta.current || meta.compositionId;
  sub.textContent = meta.width + "×" + meta.height + " · " + meta.fps + " fps";
  stage.style.setProperty("--ar", String(meta.width / meta.height));
  stage.style.setProperty("--ar-w", String(meta.width));
  stage.style.setProperty("--ar-h", String(meta.height));
  scrub.setAttribute("aria-valuemax", String(last));
  atEl.max = String(last);
  frameMax.textContent = "/" + last;
  syncTransport(0);

  function pad2(n) { return String(n).padStart(2, "0"); }
  // Same timecode the frame debugger prints, so a position carries between
  // the two pages by reading it off rather than by converting.
  function timecode(frame) {
    const sec = Math.floor(frame / fps);
    return pad2(Math.floor(sec / 60)) + ":" + pad2(sec % 60) + ":" + pad2(frame % fps);
  }
  function frameNow() {
    if (mode !== "video") return at;
    const t = video.currentTime;
    if (!Number.isFinite(t) || t < 0) return 0;
    return Math.max(0, Math.min(last, Math.floor(t * fps)));
  }
  function syncTransport(n) {
    const p = last === 0 ? 0 : n / last;
    fill.style.transform = "scaleX(" + p + ")";
    head.style.left = (p * 100) + "%";
    clock.textContent = timecode(n);
    if (document.activeElement !== atEl) atEl.value = String(n);
    scrub.setAttribute("aria-valuenow", String(n));
    scrub.setAttribute("aria-valuetext", timecode(n) + "  f " + n + "/" + last);
  }
  // Land inside the frame, not on its edge: a seek to exactly n/fps can
  // resolve to either side of the boundary and read back as n-1.
  function seekFrame(n) {
    const clamped = Math.max(0, Math.min(last, Math.round(n)));
    at = clamped;
    syncTransport(clamped);
    if (mode !== "video") { showStill(clamped); return; }
    const t = (clamped + 0.5) / fps;
    video.currentTime = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(t, Math.max(0, video.duration - 1e-3))
      : t;
  }

  /**
   * One frame from the session, as the frame debugger fetches it. Requests
   * coalesce: a drag issues far more than the host can answer, and only the
   * one you stopped on matters.
   */
  async function showStill(n) {
    if (stillInflight) { stillPending = n; return; }
    stillInflight = true;
    try {
      const res = await fetch("/frame?at=" + n);
      if (!res.ok) throw new Error("frame " + n);
      const url = URL.createObjectURL(await res.blob());
      still.src = url;
      if (stillUrl) URL.revokeObjectURL(stillUrl);
      stillUrl = url;
    } catch {
      /* a seek that raced a switch or a rebuild; the next one wins */
    } finally {
      stillInflight = false;
      if (stillPending !== null) {
        const p = stillPending;
        stillPending = null;
        showStill(p);
      }
    }
  }

  /**
   * Playing stills. The clock is real time, so a host that cannot answer
   * every frame drops frames rather than running slow — a preview that plays
   * at a third of speed would be lying about the timing, which is most of
   * what anyone watches a preview for.
   */
  function framesTick(now) {
    if (!playing || mode === "video") return;
    requestAnimationFrame(framesTick);
    if (!playLast) { playLast = now; return; }
    playAccum += (now - playLast) * RATES[rateIndex];
    playLast = now;
    const step = Math.floor(playAccum / (1000 / fps));
    if (step <= 0) return;
    playAccum -= step * (1000 / fps);
    let n = at + step;
    if (n > last) {
      if (!loopBox.checked) { setPlaying(false); n = last; }
      else n = last === 0 ? 0 : n % (last + 1);
    }
    seekFrame(n);
  }

  function setPlaying(on) {
    playing = on;
    playBtn.classList.toggle("is-on", on);
    if (!on) return;
    playLast = 0;
    playAccum = 0;
    requestAnimationFrame(framesTick);
  }

  /** The film arrived: hand the transport over, keeping the frame. */
  function enterVideo() {
    const keep = at;
    const wasPlaying = playing;
    playing = false;
    mode = "video";
    still.hidden = true;
    video.hidden = false;
    video.loop = loopBox.checked;
    video.playbackRate = RATES[rateIndex];
    wait.hidden = true;
    wait.classList.remove("is-bad", "is-retry");
    syncVol();
    seekFrame(keep);
    if (wasPlaying) video.play();
  }

  /** Back to the session's own frames — a rebuild made the film stale. */
  function enterFrames() {
    const wasPlaying = mode === "video" ? !video.paused : playing;
    video.pause();
    mode = "frames";
    video.hidden = true;
    still.hidden = false;
    wait.hidden = false;
    wait.classList.remove("is-bad", "is-retry");
    wait.textContent = "frames — encoding…";
    showStill(at);
    setPlaying(wasPlaying);
  }
  function syncVol() {
    vol.classList.toggle("is-off", !hasAudio);
    muteBtn.disabled = !hasAudio;
    if (!hasAudio) {
      video.muted = true;
      vfill.style.transform = "scaleX(0)";
      muteBtn.classList.add("is-off");
      vol.setAttribute("aria-valuenow", "0");
      return;
    }
    video.volume = volume;
    const shown = video.muted ? 0 : volume;
    vfill.style.transform = "scaleX(" + shown + ")";
    vol.setAttribute("aria-valuenow", String(shown));
    muteBtn.classList.toggle("is-off", video.muted || volume === 0);
  }

  function fractionFromPointer(e, el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  async function pollMovie() {
    for (;;) {
      const res = await fetch("/movie/status");
      const st = await res.json();
      hasAudio = Boolean(st.hasAudio);
      if (st.phase === "ready") return st;
      if (st.phase === "error") {
        throw new Error(st.error || "encode failed");
      }
      const n = st.frame || 0;
      const t = st.total || meta.durationFrames;
      wait.textContent = "frames — encoding " + n + " / " + t;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /**
   * Acquire the viewing copy in the background. Nothing waits on it: the
   * still already has the picture, so this only decides when playing at
   * speed becomes possible. A rebuild bumps the generation, and a load that
   * was in flight for an older one drops its result rather than showing a
   * film that has been superseded.
   */
  async function loadMovie() {
    const want = movieGeneration;
    try {
      await pollMovie();
      if (want !== movieGeneration) return;
      // The pathname is the route; the query is only there so a reloaded
      // picture is not answered from the cache of the one before it.
      video.src = "/movie?g=" + movieGeneration;
      // loadeddata, not loadedmetadata: metadata is duration and size with no
      // decoded sample.
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error("video failed to load"));
      });
      if (want !== movieGeneration) return;
      if (!hasAudio) video.muted = true;
      enterVideo();
    } catch (e) {
      if (want !== movieGeneration) return;
      // The still is still live, so this is a line in the corner rather than
      // a sheet over a working picture.
      wait.hidden = false;
      wait.classList.add("is-bad");
      wait.textContent = (e instanceof Error ? e.message : String(e)) + " — click to encode again";
      wait.classList.add("is-retry");
    }
  }

  // A failed encode is not started again on its own: polling used to restart
  // it, which re-rendered the whole film every 400ms and meant the error was
  // never on screen long enough to read. So asking again is a click.
  wait.addEventListener("click", async () => {
    if (!wait.classList.contains("is-retry")) return;
    wait.classList.remove("is-retry", "is-bad");
    wait.textContent = "frames — encoding…";
    try {
      await fetch("/movie/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {}
    movieGeneration += 1;
    void loadMovie();
  });

  hasAudio = Boolean(meta.hasAudio);
  if (!hasAudio) {
    video.muted = true;
    sub.textContent += " · no audio";
  }
  ready = true;
  playBtn.disabled = false;
  syncVol();
  showStill(0);
  void loadMovie();

  playBtn.addEventListener("click", () => {
    if (!ready) return;
    if (mode !== "video") { setPlaying(!playing); return; }
    if (video.paused) video.play();
    else video.pause();
  });
  // The button follows the source that actually owns the transport.
  // enterFrames() pauses the <video> on its way out and the pause event lands
  // asynchronously, after setPlaying(wasPlaying) has already turned the
  // button back on — so a rebuild that dropped back to frames left the
  // picture moving under a Play icon.
  const syncPlayBtn = () =>
    playBtn.classList.toggle("is-on", transportRunning(mode, playing, video.paused));
  video.addEventListener("play", syncPlayBtn);
  video.addEventListener("pause", syncPlayBtn);
  video.addEventListener("timeupdate", () => {
    if (!dragging && mode === "video") syncTransport(frameNow());
  });
  video.addEventListener("ended", syncPlayBtn);

  scrub.addEventListener("pointerdown", (e) => {
    if (!ready) return;
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    seekFrame(fractionFromPointer(e, scrub) * last);
  });
  scrub.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    seekFrame(fractionFromPointer(e, scrub) * last);
  });
  scrub.addEventListener("pointerup", () => { dragging = false; });
  scrub.addEventListener("pointercancel", () => { dragging = false; });

  atEl.addEventListener("change", () => {
    if (!ready) return;
    const n = frameFromBox(atEl.value, last);
    // An empty box is not frame 0. Clearing it to type a number in, or
    // clearing it and tabbing away, jumped the film to the start.
    if (n === null) { syncTransport(frameNow()); return; }
    seekFrame(n);
  });

  loopBox.addEventListener("change", () => { video.loop = loopBox.checked; });

  rateBtn.addEventListener("click", () => {
    rateIndex = (rateIndex + 1) % RATES.length;
    // In frames mode the rate is read by framesTick; setting it here too
    // means the film picks it up the moment it takes over.
    video.playbackRate = RATES[rateIndex];
    rateBtn.textContent = String(RATES[rateIndex]).replace(/\.0$/, "") + "×";
  });

  muteBtn.addEventListener("click", () => {
    if (!hasAudio) return;
    video.muted = !video.muted;
    syncVol();
  });
  vol.addEventListener("pointerdown", (e) => {
    if (!hasAudio) return;
    vol.setPointerCapture(e.pointerId);
    volume = fractionFromPointer(e, vol);
    video.muted = volume === 0;
    syncVol();
  });
  vol.addEventListener("pointermove", (e) => {
    if (!hasAudio || !vol.hasPointerCapture(e.pointerId)) return;
    volume = fractionFromPointer(e, vol);
    video.muted = volume === 0;
    syncVol();
  });

  // Two seconds of a still pointer and the HUD fades; anything at all brings
  // it back. Leaving the window hides it at once — you are not looking at the
  // corner, you are looking at the picture.
  let idleTimer = 0;
  function wake() {
    stage.classList.remove("is-idle");
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stage.classList.add("is-idle"), 2000);
  }
  app.addEventListener("pointermove", wake);
  app.addEventListener("pointerdown", wake);
  app.addEventListener("pointerleave", () => {
    if (idleTimer) clearTimeout(idleTimer);
    stage.classList.add("is-idle");
  });
  window.addEventListener("keydown", wake, true);
  wake();

  fullBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else app.requestFullscreen();
  });

  // A rebuild produced a new picture. Geometry or length changing is a
  // different film in every way the page is built around, so that reloads;
  // anything else keeps the frame you were on and re-acquires the file.
  //
  // A different COMPOSITION reloads too, whatever its geometry. Somebody
  // picked another film in another tab and this one is still showing the old
  // one's name, rail row and title while serving the new one's bytes.
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
    // Back to the session's frames at once — they are the new picture
    // already — and the film re-encodes behind them.
    at = frameNow();
    movieGeneration = m.generation || movieGeneration + 1;
    enterFrames();
    void loadMovie();
  });

  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " " ) {
      if (tag === "BUTTON") return;
      e.preventDefault();
      playBtn.click();
    }
    if (!ready) return;
    // A frame, not five seconds: most compositions in this tree are shorter
    // than one press of the old step. Shift is a second.
    const step = e.shiftKey ? fps : 1;
    if (e.key === "ArrowRight") { e.preventDefault(); seekFrame(frameNow() + step); }
    if (e.key === "ArrowLeft") { e.preventDefault(); seekFrame(frameNow() - step); }
    if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      loopBox.checked = !loopBox.checked;
      video.loop = loopBox.checked;
    }
    if (e.key === "f" || e.key === "F") { e.preventDefault(); fullBtn.click(); }
    if (e.key === "m" || e.key === "M") { e.preventDefault(); muteBtn.click(); }
  });
</script>
${railScript()}
${liveScript()}
</body>
</html>
`;
}
