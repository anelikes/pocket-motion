/**
 * The client half of hot reload: one EventSource, shared by both pages, and a
 * pill that says what the host is doing.
 *
 * The transport is shared; the reaction is not. `/` re-renders the frame it is
 * already sitting on, `/watch` has to wait for a new viewing copy — so this
 * module turns each server event into a DOM event on `window` and each page
 * answers it in its own terms.
 */

import { inlineDecisions, reportsDisconnected } from "./decide.ts";

export function liveStyles(): string {
  return `
  .live {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 5;
    padding: 4px 8px;
    font-size: 11px;
    color: #b4b0a8;
    background: rgba(10, 10, 10, 0.9);
    border: 1px solid #2a2a2a;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms linear;
  }
  .live.is-on { opacity: 1; }
  .live.is-bad { color: #f0c2b0; border-color: #4a2a20; }`;
}

export function liveMarkup(): string {
  return `<div class="live" id="live" role="status" aria-live="polite"></div>`;
}

export function liveScript(): string {
  return `<script type="module">
${inlineDecisions([reportsDisconnected])}
  const pill = document.getElementById("live");
  let clear = 0;

  function say(text, bad, holdMs) {
    if (clear) { clearTimeout(clear); clear = 0; }
    pill.textContent = text;
    pill.classList.toggle("is-bad", Boolean(bad));
    pill.classList.add("is-on");
    if (holdMs > 0) {
      clear = setTimeout(() => { pill.classList.remove("is-on"); clear = 0; }, holdMs);
    }
  }

  const events = new EventSource("/events");
  events.addEventListener("message", (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === "building") { say("rebuilding…", false, 0); return; }
    if (ev.type === "error") { say(ev.message || "reload failed", true, 0); return; }
    // The build ran and left the artefacts where they were, so no session
    // reopened. Nothing to react to, but the pill is still saying
    // "rebuilding…" and only a terminal event takes it down.
    if (ev.type === "unchanged") { say("no change", false, 1400); return; }
    if (ev.type === "reloaded") {
      say("reloaded", false, 1400);
      window.dispatchEvent(new CustomEvent("pocket-motion:reloaded", { detail: ev }));
    }
  });
  // A dropped stream is the host going away, not a reload; EventSource
  // retries on its own, so this only reports it. When it does report it, the
  // stream is normally still CONNECTING rather than CLOSED — see
  // reportsDisconnected, which is why this used to say nothing at all.
  let liveErrors = 0;
  let lastOpen = Date.now();
  let toldGone = false;
  events.addEventListener("open", () => {
    liveErrors = 0;
    lastOpen = Date.now();
    if (toldGone) { toldGone = false; say("reconnected", false, 1400); }
  });
  events.addEventListener("error", () => {
    liveErrors += 1;
    if (reportsDisconnected(events.readyState, liveErrors, Date.now() - lastOpen)) {
      toldGone = true;
      say("preview disconnected", true, 0);
    }
  });
</script>`;
}
