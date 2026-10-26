/**
 * Preview is the same host as `frame` / `layout`, with an HTTP display.
 * These tests drive PreviewSession and listenPreview — the shipped functions
 * the CLI command calls — not a reimplementation of seek/render.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { run as runFrame } from "../src/cli/commands/frame.ts";
import { run as runLayout } from "../src/cli/commands/layout.ts";
import { runBuild } from "../src/cli/build.ts";
import { writeBuildRecord } from "../src/render/build-record.ts";
import { helpText } from "../src/cli/main.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_OK } from "../src/cli/types.ts";
import { compositionDirs, discoverCompositions } from "../src/cli/discover.ts";
import {
  frameFromBox,
  reportsDisconnected,
  transportRunning,
} from "../src/preview/decide.ts";
import { MovieCancelled, MovieJob } from "../src/preview/movie.ts";
import { artefactKey, isBuildOutput, watchSources } from "../src/preview/reload.ts";
import {
  PendingCloses,
  hostAllowed,
  listenPreview,
  makeSwitchQueue,
  normaliseSelection,
  parseByteRange,
  refuseSelect,
} from "../src/preview/host.ts";
import { previewPage } from "../src/preview/page.ts";
import { playerPage } from "../src/preview/player.ts";
import {
  PreviewArtefactMovedError,
  PreviewSession,
  type PreviewSessionOptions,
} from "../src/preview/session.ts";

const ROOT = resolve(import.meta.dir, "..");
const SMOKE_DIR = join(ROOT, "compositions", "smoke");
const OCCLUDED_DIR = join(ROOT, "compositions", "occluded");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const TMP = "/tmp/pocketjs-motion-preview-test";

async function post(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SMOKE_DIST = join(TMP, "smoke");
const SMOKE_BUNDLE = join(SMOKE_DIST, "main.js");
const SMOKE_PAK = join(SMOKE_DIST, "main.pak");
const OCCLUDED_DIST = join(TMP, "occluded");
const OCCLUDED_BUNDLE = join(OCCLUDED_DIST, "main.js");
const OCCLUDED_PAK = join(OCCLUDED_DIST, "main.pak");
const FOOTAGE_DIR = join(TMP, "compositions", "preview-footage");
const FOOTAGE_DIST = join(FOOTAGE_DIR, "dist");
const FOOTAGE_BUNDLE = join(FOOTAGE_DIST, "main.js");
const FOOTAGE_PAK = join(FOOTAGE_DIST, "main.pak");
const FOOTAGE_CLIP_A = join(TMP, "clip-a.mp4");
const FOOTAGE_CLIP_B = join(TMP, "clip-b.mp4");

// A composition tree of its own for the rail: git-initialised, so the shared
// discovery rule lists it, and with its own dist root, so a test that drives
// /select never needs the repository to have been built. Reached through
// /tmp, which is a symlink on macOS — the tree the rail names is the one git
// reports, and that is a physical path.
const RAIL_ROOT = join(TMP, "rail-tree");
const railDir = (name: string) => join(RAIL_ROOT, "compositions", name);
const railDist = (name: string) => join(RAIL_ROOT, "dist", "compositions", name);

// Where the repository's own build of the two compositions this suite reads
// would land: the dist root is two levels above the composition, so
// `compositions/smoke` builds to `dist/compositions/smoke`. The suite's own
// builds go to TMP and the rail tree's to RAIL_ROOT, and keeping them out of
// these four files is what two tests below check.
const REPO_ARTEFACTS = ["smoke", "occluded"].flatMap((name) => [
  join(ROOT, "dist", "compositions", name, "main.js"),
  join(ROOT, "dist", "compositions", name, "main.pak"),
]);

/**
 * The repository's own build output for those compositions, by mtime and size.
 *
 * Two tests below assert that nothing they run writes there. Asked as
 * `existsSync(dist/compositions/smoke/main.js) === false`, that was a claim
 * about the CHECKOUT rather than about the test: it holds in a fresh worktree
 * and on CI, where `bun test` runs before anything is built, and fails
 * outright once `bun scripts/digests.ts` has been run here — which is the
 * state a full ledger run leaves this tree in, for all 21 measured
 * compositions. What the tests mean is whether anything MOVED, and that is
 * the question `artefactKey` asks either side of a trace: mtime and size
 * rather than content, because a second build writing identical bytes is
 * still a build this suite did not intend. A file that is not there stamps
 * as absent, so a fresh checkout compares equal to itself rather than being
 * skipped.
 *
 * Named files, not the whole of `dist`: nothing holds that directory
 * exclusively. A `preview` session left running rebuilds the composition it
 * is watching on every change under the tree, and one watching
 * `compositions/open` rewrote `dist/compositions/open` during a run of this
 * file — a real property of the tree, and not something these two tests are
 * about.
 */
function repoArtefactStamp(): string {
  return REPO_ARTEFACTS.map((path) => {
    try {
      const s = statSync(path);
      return `${path}:${s.mtimeMs}:${s.size}`;
    } catch {
      return `${path}:absent`;
    }
  }).join("\n");
}

process.env.POCKETJS_ROOT = VENDOR;

function flags(
  bundle: string,
  pak: string,
  extra: Record<string, string | number | boolean> = {},
) {
  return { json: true, bundle, pak, frames: 8, ...extra };
}

async function buildComposition(entryDir: string, outdir: string, bundle: string): Promise<void> {
  const argv = [
    "bun",
    join(VENDOR, "tools", "build.ts"),
    join(entryDir, "main.tsx"),
    `--outdir=${outdir}`,
    "--framework=solid",
    "--no-config",
  ];
  const proc = Bun.spawn(argv, {
    cwd: VENDOR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, POCKETJS_ROOT: VENDOR },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 || !existsSync(bundle)) {
    throw new Error(`${entryDir} build failed (${code})\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  // What `runBuild` writes, written here too: resolving a bundle with no
  // `build.json` beside it is a usage error, fixture or not.
  await writeBuildRecord(outdir, argv);
}

async function ffmpegClip(filter: string, out: string): Promise<void> {
  const ff = Bun.spawn(
    ["ffmpeg", "-y", "-f", "lavfi", "-i", filter, "-pix_fmt", "yuv420p", out],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, code] = await Promise.all([new Response(ff.stderr).text(), ff.exited]);
  if (code !== 0 || !existsSync(out)) {
    throw new Error(`ffmpeg clip failed (${code})\n${stderr}`);
  }
}

async function makeFootageFixture(): Promise<void> {
  mkdirSync(FOOTAGE_DIR, { recursive: true });
  // Patterned, not flat colour: a solid fill hid the missing UV after restore.
  await ffmpegClip("testsrc=size=126x126:rate=30:duration=3", FOOTAGE_CLIP_A);
  await ffmpegClip("testsrc2=size=126x126:rate=30:duration=3", FOOTAGE_CLIP_B);
  writeFileSync(
    join(FOOTAGE_DIR, "pocket.json"),
    JSON.stringify({
      $schema: "https://pocketjs.dev/schema/pocket-2.json",
      pocket: 2,
      id: "dev.pocket-stack.motion-preview-footage",
      name: "preview-footage",
      title: "preview footage rewind",
      version: "0.0.0",
      engine: { capabilities: { requires: ["text.glyphs.baked"] } },
      app: {
        entry: "main.tsx",
        output: "main",
        framework: "solid",
        viewport: { fixed: { logical: [126, 126], presentation: "native" } },
      },
    }),
  );
  writeFileSync(
    join(FOOTAGE_DIR, "pocket-motion.json"),
    JSON.stringify({
      motion: 1,
      durationFrames: 90,
      fps: 30,
      supersample: 1,
      footage: [
        {
          id: "a-roll",
          src: "clip-a.mp4",
          nodePrefix: "footage:a-roll",
          tile: 128,
          grid: [1, 1],
          startFrame: 0,
          endFrame: 40,
          sourceFrame: 0,
        },
        {
          id: "b-roll",
          src: "clip-b.mp4",
          nodePrefix: "footage:b-roll",
          tile: 128,
          grid: [1, 1],
          startFrame: 50,
          endFrame: 80,
          sourceFrame: 0,
        },
      ],
    }),
  );
  writeFileSync(
    join(FOOTAGE_DIR, "app.tsx"),
    `import { Image, View } from "@pocketjs/framework/components";
export default function FootageRewind() {
  return (
    <View class="w-full h-full bg-slate-950">
      <Image debugName="footage:a-roll/tile:0:0" class="absolute w-[126px] h-[126px] top-[0px] left-[0px]" />
      <Image debugName="footage:b-roll/tile:0:0" class="absolute w-[126px] h-[126px] top-[0px] left-[0px]" />
    </View>
  );
}
`,
  );
  writeFileSync(
    join(FOOTAGE_DIR, "main.tsx"),
    `import { mount } from "@pocketjs/framework";
import FootageRewind from "./app.tsx";
mount(() => <FootageRewind />);
`,
  );
  await buildComposition(FOOTAGE_DIR, FOOTAGE_DIST, FOOTAGE_BUNDLE);
}

/**
 * Three compositions in a tree the test owns, plus one piece of build output.
 *
 * `one` and `twin` are the same composition copied twice, so they share a
 * `pocket.json` id — the measured reason the rail is keyed by path rather than
 * by compositionId, made a fact this test controls instead of one it reads off
 * the repository. `twin` is deliberately not built, so "listed and refused"
 * is also under the test's control; asserting that some real composition
 * happens to have no bundle is an assertion about whatever last ran here.
 */
async function makeRailTree(): Promise<void> {
  mkdirSync(join(RAIL_ROOT, "compositions"), { recursive: true });
  for (const [name, from] of [
    ["one", SMOKE_DIR],
    ["twin", SMOKE_DIR],
    ["other", OCCLUDED_DIR],
  ] as const) {
    cpSync(from, railDir(name), { recursive: true });
  }
  // build output inside the source tree, excluded by name at any depth
  mkdirSync(join(RAIL_ROOT, "compositions", "dist", "leftover"), { recursive: true });
  writeFileSync(join(RAIL_ROOT, "compositions", "dist", "leftover", "main.tsx"), "");

  // The two ways a composition fails to resolve, which the rail used to give
  // the same label to: no sidecar at all, and a sidecar with a typo in it.
  mkdirSync(railDir("bare"), { recursive: true });
  writeFileSync(join(railDir("bare"), "main.tsx"), "");
  cpSync(SMOKE_DIR, railDir("broken"), { recursive: true });
  writeFileSync(
    join(railDir("broken"), "pocket-motion.json"),
    JSON.stringify({ motion: 1, durationFrames: 30, fps: 30, font: {} }),
  );

  const init = Bun.spawnSync(["git", "init", "-q"], { cwd: RAIL_ROOT });
  if (init.exitCode !== 0) {
    throw new Error(`git init failed in ${RAIL_ROOT}: ${init.stderr.toString()}`);
  }
  // where resolveComposition looks for them, so /select needs no flags
  for (const name of ["one", "other"]) {
    await buildComposition(railDir(name), railDist(name), join(railDist(name), "main.js"));
  }
}

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(SMOKE_DIST, { recursive: true });
  mkdirSync(OCCLUDED_DIST, { recursive: true });
  if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
    throw new Error(`vendor pocketjs missing at ${VENDOR} — run bun scripts/vendor.ts`);
  }
  await buildComposition(SMOKE_DIR, SMOKE_DIST, SMOKE_BUNDLE);
  await buildComposition(OCCLUDED_DIR, OCCLUDED_DIST, OCCLUDED_BUNDLE);
  await makeFootageFixture();
  await makeRailTree();
}, 180_000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

async function openSmoke(
  extra: Record<string, string | number | boolean> = {},
  sessionOpts: PreviewSessionOptions = {},
): Promise<PreviewSession> {
  const resolved = await resolveComposition({
    dir: SMOKE_DIR,
    flags: flags(SMOKE_BUNDLE, SMOKE_PAK, extra),
    requireBundle: true,
  });
  if (!resolved.ok) throw new Error(resolved.message);
  return PreviewSession.open(resolved.value, sessionOpts);
}

describe("hostAllowed", () => {
  const req = (h: string) => new Request("http://x/", { headers: { host: h } });

  test("loopback aliases, including IPv6 brackets", () => {
    const ok = (bind: string, h: string) => hostAllowed(req(h), bind, 8741);
    expect(ok("127.0.0.1", "127.0.0.1:8741")).toBe(true);
    expect(ok("127.0.0.1", "localhost:8741")).toBe(true);
    expect(ok("127.0.0.1", "[::1]:8741")).toBe(true);
    expect(ok("::1", "[::1]:8741")).toBe(true);
    expect(ok("::1", "127.0.0.1:8741")).toBe(true);
    expect(ok("127.0.0.1", "evil.example:8741")).toBe(false);
    expect(ok("127.0.0.1", "127.0.0.1:80")).toBe(false);
    expect(hostAllowed(req("localhost"), "127.0.0.1", 80)).toBe(true);
    expect(hostAllowed(req("localhost"), "127.0.0.1", 8741)).toBe(false);
  });

  test("wildcard bind is the opt-in to accept any Host", () => {
    expect(hostAllowed(req("192.168.1.5:8741"), "0.0.0.0", 8741)).toBe(true);
    expect(hostAllowed(req("[::1]:8741"), "::", 8741)).toBe(true);
  });

  test("a specific non-loopback bind accepts only itself", () => {
    expect(hostAllowed(req("192.168.1.5:8741"), "192.168.1.5", 8741)).toBe(true);
    expect(hostAllowed(req("127.0.0.1:8741"), "192.168.1.5", 8741)).toBe(false);
  });
});

describe("refuseSelect — /select is this preview's own page or nobody", () => {
  const post = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:8741/select", { method: "POST", headers, body: "{}" });
  const same = { host: "127.0.0.1:8741", "content-type": "application/json" };

  test("a page on another origin cannot swap the session", () => {
    // /select was reachable with a text/plain body, which is a SIMPLE
    // request: no preflight, no consent asked of this server, and the page
    // never has to read the response to have swapped the film every other tab
    // is reading.
    expect(refuseSelect(post({ ...same, origin: "https://evil.example" }))?.status).toBe(403);
    expect(refuseSelect(post({ ...same, "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(refuseSelect(post({ ...same, "sec-fetch-site": "same-site" }))?.status).toBe(403);
    expect(refuseSelect(post({ ...same, origin: "not a url" }))?.status).toBe(403);
    expect(refuseSelect(post({ ...same, origin: "http://127.0.0.1:9999" }))?.status).toBe(403);
  });

  test("application/json, so a browser has to preflight and gets no grant", () => {
    expect(refuseSelect(post({ host: "127.0.0.1:8741" }))?.status).toBe(415);
    expect(
      refuseSelect(post({ host: "127.0.0.1:8741", "content-type": "text/plain" }))?.status,
    ).toBe(415);
    // a charset is a parameter, not a different type
    expect(
      refuseSelect(post({ ...same, "content-type": "application/json; charset=utf-8" })),
    ).toBeNull();
  });

  test("this preview's own page, and a person with curl, are let through", () => {
    expect(refuseSelect(post(same))).toBeNull();
    expect(refuseSelect(post({ ...same, origin: "http://127.0.0.1:8741" }))).toBeNull();
    expect(
      refuseSelect(post({ ...same, origin: "http://127.0.0.1:8741", "sec-fetch-site": "same-origin" })),
    ).toBeNull();
    // typed into the address bar, or curl: no Origin and no fetch metadata
    expect(refuseSelect(post({ ...same, "sec-fetch-site": "none" }))).toBeNull();
  });
});

describe("what the pages decide", () => {
  // A page's script is a string this process emits, so nothing in it can be
  // imported and a test could only assert that a LINE APPEARS — an assertion
  // about a guard rather than a guard. These three were one-line expressions
  // in the page that were wrong; they are functions now, and the pages get
  // them by their own source, so this is the copy that runs there.

  test("an empty frame box leaves the picture where it is", () => {
    // Number("") is 0. Clearing the box to type a number in, or clearing it
    // and tabbing away, jumped to the first frame. Both pages had their own
    // copy of that line and both were wrong the same way.
    expect(frameFromBox("", 449)).toBeNull();
    expect(frameFromBox("   ", 449)).toBeNull();
    expect(frameFromBox("abc", 449)).toBeNull();
    expect(frameFromBox("0", 449)).toBe(0);
    expect(frameFromBox("12", 449)).toBe(12);
    expect(frameFromBox(" 12 ", 449)).toBe(12);
    expect(frameFromBox("-4", 449)).toBe(0);
    expect(frameFromBox("9999", 449)).toBe(449);
    expect(frameFromBox("12.6", 449)).toBe(13);
  });

  test("the play button follows whichever source owns the transport", () => {
    // enterFrames() pauses the <video> on its way out and the pause event
    // lands asynchronously, after setPlaying(wasPlaying) has turned the
    // button back on — so a rebuild that dropped back to frames left the
    // picture moving under a Play icon. This is that case:
    expect(transportRunning("frames", true, true)).toBe(true);
    expect(transportRunning("frames", false, true)).toBe(false);
    expect(transportRunning("frames", true, false)).toBe(true);
    expect(transportRunning("video", true, true)).toBe(false);
    expect(transportRunning("video", false, false)).toBe(true);
  });

  test("a host that stopped answering is announced", () => {
    // The condition was `readyState === EventSource.CLOSED`. CLOSED means the
    // browser gave up, and for a host that simply stopped answering it never
    // does — it retries on the `retry: 1000` this server sends, so readyState
    // sits at CONNECTING (0) and the pill's one message was unreachable.
    const CONNECTING = 0;
    const OPEN = 1;
    const CLOSED = 2;
    expect(reportsDisconnected(CONNECTING, 1, 200)).toBe(false); // one blip, still early
    expect(reportsDisconnected(CONNECTING, 2, 1200)).toBe(true); // it is not coming back
    expect(reportsDisconnected(CONNECTING, 1, 4000)).toBe(true); // backed off, still gone
    expect(reportsDisconnected(CLOSED, 1, 0)).toBe(true);
    expect(reportsDisconnected(OPEN, 3, 9999)).toBe(false); // a blip on a live stream
  });

  test("every script these pages emit is parseable JavaScript", () => {
    // The pages are template literals with functions pasted into them, so a
    // stray backtick in a comment closes the literal and the page ships JS
    // that stops at that character. Nothing else here would notice: the
    // server would serve it, every assertion about its text would pass, and
    // the page would simply do nothing. That happened once while this was
    // being written.
    const transpiler = new Bun.Transpiler({ loader: "js" });
    for (const html of [previewPage(), playerPage()]) {
      const blocks = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
      expect(blocks.length).toBeGreaterThanOrEqual(3); // page, rail, live
      for (const [, code] of blocks) {
        expect(() => transpiler.transformSync(code!)).not.toThrow();
      }
    }
  });

  test("both pages carry the decisions they use, not a copy of them", () => {
    for (const html of [previewPage(), playerPage()]) {
      expect(html).toContain("function frameFromBox(");
      expect(html).toContain("function reportsDisconnected(");
    }
    expect(playerPage()).toContain("function transportRunning(");
    // and nothing left over from the expressions they replaced
    expect(previewPage()).not.toContain("show(Number(atEl.value))");
    expect(playerPage()).not.toContain("EventSource.CLOSED");
    expect(previewPage()).not.toContain("EventSource.CLOSED");
  });
});

describe("help", () => {
  test("names preview as a command, not an editor", () => {
    const text = helpText();
    expect(text).toContain("preview");
    expect(text).toContain("same host that hashes it");
  });

  test("overlay is off until asked — layout is tens of times a frame", () => {
    const html = previewPage();
    expect(html).toContain('<input id="boxes" type="checkbox" />');
    expect(html).not.toContain('<input id="boxes" type="checkbox" checked');
  });

  test("the watch page is a time player over /movie, not live PNGs", () => {
    const html = playerPage();
    expect(html).toContain("<video");
    expect(html).toContain('preload="auto"');
    expect(html).toContain("onloadeddata");
    expect(html).toContain("/movie");
    expect(html).toContain("playbackRate");
    expect(html).toContain("requestFullscreen");
    expect(html).toContain('aria-label="Volume"');
    expect(html).toContain('href="/"');
    expect(html).toContain('poster="/frame?at=0"');
    expect(html).toMatch(/\.stage video, \.stage img \{[^}]*position: absolute/);
    expect(html).toMatch(/\.stage video, \.stage img \{[^}]*inset: 0/);
    expect(html).not.toContain("/layout?at=");
    expect(html).not.toContain("onloadedmetadata");
  });

  test("the hidden attribute actually hides the watch overlays", () => {
    const html = playerPage();
    // .wait/.fail declare display:grid in the author origin, which beats the
    // UA [hidden] rule. Drop this line and #fail — empty, inset:0, opaque
    // #000, after the video in document order — covers the stage on every
    // load, so /watch is black and Reader Mode is not.
    expect(html).toContain("[hidden] { display: none !important; }");
    expect(html).toContain('<div class="wait" id="wait">');
    expect(html).toContain('<div class="fail" id="fail" hidden>');
  });

  test("the player addresses frames, so a position carries to frame --at", () => {
    const html = playerPage();
    // the same widgets the frame debugger uses, so the two pages read alike
    expect(html).toContain('<input id="at" type="number"');
    expect(html).toContain('<span id="frame-max">');
    expect(html).toContain("function timecode(frame)");
    expect(html).toContain("frame % fps");
    // a frame, not five seconds: compositions/open is 90 frames long, so the
    // old step passed the end of the film in one press
    expect(html).toContain("seekFrame(frameNow() + step)");
    expect(html).toContain("seekFrame(frameNow() - step)");
    expect(html).not.toContain("video.currentTime + 5");
    expect(html).not.toContain("video.currentTime - 5");
    expect(html).toContain('aria-label="Frame"');
    // short compositions get watched round and round
    expect(html).toContain('<input id="loop" type="checkbox" checked />');
  });

  test("the player's HUD gets out of the way; the debugger's does not", () => {
    const player = playerPage();
    // a full-bleed composition puts content in the top-left corner, and which
    // film it is also reaches the reader as the document title and the
    // highlighted rail row
    expect(player).toContain(".stage.is-idle .hud { opacity: 0; }");
    expect(player).toContain('stage.classList.add("is-idle")');
    expect(player).toContain('app.addEventListener("pointermove", wake)');

    // the frame debugger keeps its HUD: latency, the legend and the error
    // line are what it is for
    expect(previewPage()).not.toContain("is-idle");
  });

  test("the surround is not the same black as a composition ground", () => {
    // measured on compositions/open: the encoded ground is rgb(2, 6, 10), so
    // a #000 surround puts the picture edge below what a display resolves
    for (const html of [previewPage(), playerPage()]) {
      expect(html).toMatch(/\.viewport \{[^}]*background: #141414/);
    }
  });

  test("both pages carry the rail, and name the composition by path", () => {
    for (const html of [previewPage(), playerPage()]) {
      expect(html).toContain('<div class="shell" id="shell">');
      expect(html).toContain('<ul class="rail-list" id="rail-list">');
      expect(html).toContain('fetch("/compositions")');
      expect(html).toContain('method: "POST"');
      expect(html).toContain('fetch("/select"');
      // the path is the identity shown; the id is not unique in this tree
      expect(html).toContain("meta.current || meta.compositionId");
      expect(html).toContain("title.title = meta.compositionId");
    }
  });

  test("the player has a picture before the film is encoded", () => {
    const html = playerPage();
    // Two sources behind one transport: the still is the session's own PNG
    // per frame, the video is the encoded copy. Scrubbing and stepping never
    // needed the file, so the page does not wait for it.
    expect(html).toContain('<img id="still" alt="" />');
    expect(html).toContain('<video id="video" playsinline preload="auto" poster="/frame?at=0" hidden>');
    expect(html).toContain("async function showStill(n)");
    expect(html).toContain('fetch("/frame?at=" + n)');
    expect(html).toContain("function enterVideo()");
    expect(html).toContain("function enterFrames()");
    // nothing awaits the encode any more
    expect(html).toContain("void loadMovie();");
    expect(html).not.toContain("await loadMovie(");
    // playing stills keeps real time and drops frames, rather than running slow
    expect(html).toContain("function framesTick(now)");
    expect(html).toContain("playAccum -= step * (1000 / fps)");
    // and the encode note is a line in the corner, not a sheet over the film
    expect(html).toMatch(/\.wait \{[^}]*bottom: 8px/);
    expect(html).not.toMatch(/\.wait \{[^}]*inset: 0/);
  });

  test("both pages hear the host, and answer in their own terms", () => {
    for (const html of [previewPage(), playerPage()]) {
      expect(html).toContain('new EventSource("/events")');
      expect(html).toContain('"pocket-motion:reloaded"');
      // geometry or length changing is a different film in every way the
      // page is built around, so that reloads rather than patches
      expect(html).toContain("m.durationFrames !== meta.durationFrames");
      expect(html).toContain("location.reload()");
    }
    // the debugger re-renders the frame it is on; the player re-acquires the
    // file, keeping the frame
    expect(previewPage()).toContain("show(at);");
    expect(playerPage()).toContain("enterFrames();");
    expect(playerPage()).toContain('video.src = "/movie?g=" + movieGeneration');
  });

  test("the frame debugger links to the player", () => {
    expect(previewPage()).toContain('href="/watch"');
  });
});

describe("PreviewSession — same pixels as `frame`", () => {
  test("PNG bytes at a frame equal `frame --at N`", async () => {
    const session = await openSmoke();
    try {
      const fromPreview = await session.pngAt(3);
      expect(fromPreview.bytes[0]).toBe(0x89);
      expect(fromPreview.bytes[1]).toBe(0x50);
      expect(fromPreview.bytes[2]).toBe(0x4e);
      expect(fromPreview.bytes[3]).toBe(0x47);

      const out = join(TMP, "frame-3.png");
      const result = await runFrame({
        dir: SMOKE_DIR,
        at: 3,
        out,
        flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      });
      expect(result.exitCode).toBe(EXIT_OK);
      const fromCommand = new Uint8Array(await Bun.file(out).arrayBuffer());
      expect(fromPreview.bytes).toEqual(fromCommand);
    } finally {
      await session.close();
    }
  }, 60_000);

  test("rewind through a checkpoint equals a forward seek to the same frame", async () => {
    const session = await openSmoke();
    try {
      const forward = await session.pngAt(2);
      await session.pngAt(7);
      const rewind = await session.pngAt(2);
      expect(rewind.hash).toBe(forward.hash);
      expect(rewind.bytes).toEqual(forward.bytes);
    } finally {
      await session.close();
    }
  }, 60_000);

  test("a memory ratchet rebuilds the world instead of growing forever", async () => {
    const session = await openSmoke(
      { frames: 90 },
      { rebuildWhenMemoryMultiple: 1.05 },
    );
    try {
      const boot = session.memoryBytes;
      for (let i = 0; i < 6; i++) {
        await session.pngAt(60);
        await session.pngAt(30);
      }
      // Six restore cycles without rebuild would add ~6 framebuffers (~50 MB).
      // Rebuild resets the heap; we may still be one restore past boot.
      expect(session.memoryBytes).toBeLessThan(boot + 20 * 1024 * 1024);
    } finally {
      await session.close();
    }
  }, 60_000);

  test("rewind still works after the ladder can no longer hold the origin", async () => {
    // checkpointMax 1 is the state the byte-budget cap used to leave a
    // long-lived session in: only the playhead snap remains, nearest(earlier)
    // is undefined. Rebuild must make that seek succeed.
    const session = await openSmoke({ frames: 90 }, { checkpointMax: 1 });
    try {
      await session.pngAt(60);
      const rewound = await session.pngAt(30);
      const out = join(TMP, "frame-30-rebuild.png");
      const result = await runFrame({
        dir: SMOKE_DIR,
        at: 30,
        out,
        flags: flags(SMOKE_BUNDLE, SMOKE_PAK, { frames: 90 }),
      });
      expect(result.exitCode).toBe(EXIT_OK);
      const cold = new Uint8Array(await Bun.file(out).arrayBuffer());
      expect(rewound.bytes).toEqual(cold);
    } finally {
      await session.close();
    }
  }, 60_000);

  test("the ratchet refuses a bundle that was rebuilt underneath the session", async () => {
    // #rebuild re-reads the bundle FROM DISK, and preview rebuilds into the
    // same directory. After a reload that failed — the old session is kept on
    // purpose then — the next memory ratchet would come back on the NEW
    // bundle, at whatever moment it happened to trip, with nothing reported.
    const session = await openSmoke({ frames: 90 }, { rebuildWhenMemoryMultiple: 1.05 });
    const original = await Bun.file(SMOKE_BUNDLE).arrayBuffer();
    let refused: unknown = null;
    try {
      await session.pngAt(60);
      // valid JS, so a session that does boot it boots it SILENTLY — the
      // failure this refuses is not a crash
      await Bun.write(SMOKE_BUNDLE, new Blob([original, "\n// rebuilt under it\n"]));
      for (let i = 0; i < 8 && refused === null; i++) {
        try {
          await session.pngAt(30);
          await session.pngAt(60);
        } catch (e) {
          refused = e;
        }
      }
    } finally {
      await Bun.write(SMOKE_BUNDLE, original);
      await session.close().catch(() => {});
    }
    expect(refused).toBeInstanceOf(PreviewArtefactMovedError);
    expect(String(refused)).toContain("rebuilt underneath it");
  }, 60_000);

  test("footage rewind onto snapshot 0 equals a cold `frame --at N`", async () => {
    // Two disjoint windows: a-roll [0,40), b-roll [50,80). Jump to 60 binds
    // b-roll; nearest(10) is snapshot 0. present(10) skips b-roll, so it
    // cannot repair a snap taken before openFootage. A single full-length
    // track would be rebound at 10 and hide the bug.
    const resolved = await resolveComposition({
      dir: FOOTAGE_DIR,
      flags: flags(FOOTAGE_BUNDLE, FOOTAGE_PAK, { frames: 90 }),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const session = await PreviewSession.open(resolved.value);
    try {
      await session.pngAt(60);
      const rewound = await session.pngAt(10);
      const out = join(TMP, "footage-10.png");
      const result = await runFrame({
        dir: FOOTAGE_DIR,
        at: 10,
        out,
        flags: flags(FOOTAGE_BUNDLE, FOOTAGE_PAK, { frames: 90 }),
      });
      expect(result.exitCode).toBe(EXIT_OK);
      const cold = new Uint8Array(await Bun.file(out).arrayBuffer());
      expect(rewound.bytes).toEqual(cold);
    } finally {
      await session.close();
    }
  }, 120_000);

  test("restore from a mid-film snapshot equals a cold `frame --at N`", async () => {
    // Default interval is 30. 8-frame smoke only ever snapshots frame 0;
    // this is the first restore of a snap that is not the origin.
    const session = await openSmoke({ frames: 90 });
    try {
      await session.pngAt(60);
      const rewound = await session.pngAt(35);
      const out = join(TMP, "frame-35.png");
      const result = await runFrame({
        dir: SMOKE_DIR,
        at: 35,
        out,
        flags: flags(SMOKE_BUNDLE, SMOKE_PAK, { frames: 90 }),
      });
      expect(result.exitCode).toBe(EXIT_OK);
      const cold = new Uint8Array(await Bun.file(out).arrayBuffer());
      expect(rewound.bytes).toEqual(cold);
    } finally {
      await session.close();
    }
  }, 60_000);
});

describe("PreviewSession — same layout as `layout`", () => {
  test("nodes and inPicture match the layout command on smoke", async () => {
    const session = await openSmoke();
    try {
      const fromPreview = await session.layoutAt(3);
      const result = await runLayout({
        dir: SMOKE_DIR,
        at: 3,
        all: false,
        flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      });
      expect(result.exitCode).toBe(EXIT_OK);
      const fromCommand = result.json as {
        notInPicture: number;
        nodes: Array<{ id: number; inPicture: boolean; x: number; y: number; w: number; h: number }>;
      };
      expect(fromPreview.notInPicture).toBe(fromCommand.notInPicture);
      expect(fromPreview.nodes.map((n) => [n.id, n.inPicture, n.x, n.y, n.w, n.h])).toEqual(
        fromCommand.nodes.map((n) => [n.id, n.inPicture, n.x, n.y, n.w, n.h]),
      );
    } finally {
      await session.close();
    }
  }, 60_000);

  test("a named node under an opaque lid is not in picture", async () => {
    const resolved = await resolveComposition({
      dir: OCCLUDED_DIR,
      flags: flags(OCCLUDED_BUNDLE, OCCLUDED_PAK, { frames: 1 }),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const session = await PreviewSession.open(resolved.value);
    try {
      const layout = await session.layoutAt(0);
      const byName = new Map(layout.nodes.map((n) => [n.name, n.inPicture]));
      expect(byName.get("buried")).toBe(false);
      expect(byName.get("lid")).toBe(true);
      expect(byName.get("shown")).toBe(true);
      expect(layout.notInPicture).toBe(1);
    } finally {
      await session.close();
    }
  }, 60_000);
});

describe("a dropped viewing copy stops", () => {
  test("close() during an encode stops the render instead of finishing it", async () => {
    // preview drops viewing copies for ordinary reasons — a second edit
    // during an encode, or a fifth composition pushing the first out of the
    // cache. Measured before this: a close at frame 69 of 1350 returned at
    // once and the render carried on to 1350, into a directory that had just
    // been deleted, so ffmpeg failed at the end on a file that was gone.
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK, { frames: 120 }),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const encoders = () =>
      Bun.spawnSync(["pgrep", "-f", "pocketjs-motion-watch-"])
        .stdout.toString()
        .split("\n")
        .filter(Boolean).length;
    const before = encoders();
    const job = new MovieJob(resolved.value);
    const run = job.ensure();
    let rejected: unknown = null;
    run.catch((e) => { rejected = e; });

    // far enough in to be rendering, far short of the end
    for (let i = 0; i < 60 && job.status().frame < 5; i++) await Bun.sleep(50);
    const atClose = job.status().frame;
    expect(atClose).toBeGreaterThan(0);
    expect(atClose).toBeLessThan(resolved.value.durationFrames);

    await job.close();
    const stopped = job.status().frame;
    expect(stopped).toBeLessThan(resolved.value.durationFrames);
    expect(rejected).toBeInstanceOf(MovieCancelled);

    // and it stays stopped rather than running on in the background, with no
    // ffmpeg left holding the pipe it was writing frames into
    await Bun.sleep(1500);
    expect(job.status().frame).toBe(stopped);
    expect(job.status().phase).toBe("idle");
    expect(encoders()).toBeLessThanOrEqual(before);
  }, 120_000);
});

describe("an encode that failed says so, once", () => {
  test("a failed encode reports error and is not restarted by asking again", async () => {
    // `/movie/status` called ensure() and then read status(). `#encode`
    // cleared `#run` on its way out, so ensure() began a FRESH render every
    // time — and /watch polls this every 400 ms. The whole film re-rendered
    // every 400 ms, the phase read back was always `running`, and the one
    // thing the route existed to report was the one thing it could never say.
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const job = new MovieJob({
      ...resolved.value,
      bundlePath: join(TMP, "no-such-bundle.js"),
    });
    try {
      await expect(job.ensure()).rejects.toThrow();
      const failed = job.status();
      expect(failed.phase).toBe("error");
      expect(failed.error).toBeTruthy();

      // Asking again is not a reason to spend a whole film again. The
      // discriminator is the phase RIGHT AFTER the second ensure(): a restart
      // sets "running" before it returns.
      const second = job.ensure();
      expect(job.status().phase).toBe("error");
      await expect(second).rejects.toThrow();
      expect(job.status()).toEqual(failed);

      // and retry() is the way back, because it was asked for
      const third = job.retry();
      expect(job.status().phase).toBe("running");
      await expect(third).rejects.toThrow();
      expect(job.status().phase).toBe("error");
    } finally {
      await job.close();
    }
  }, 60_000);
});

describe("a route waits for the work it asked for", () => {
  test("a request outliving the idle deadline is answered, not cut", async () => {
    // idleTimeout caps how long a request may go without producing bytes, and
    // 255s is its maximum — but a /select of a composition with footage pays a
    // whole ingest before it can answer, and this /movie pays a whole encode.
    // Bun cut the connection; the page kept the meta it already had while the
    // work it asked for completed with nothing left to tell about it. Every
    // route lifts the deadline per request. Measured on this Bun (1.3.11):
    // whatever idleTimeout is set to, a handler producing nothing is cut at
    // about 4s and no sooner — idleTimeout 2 passed a 3.5s handler and cut a
    // 4.5s one at 4009ms — and `server.timeout(req, 0)` is what stops it. So
    // this asks for an encode long enough to cross that floor, and asserts it
    // really did: if the encode ever gets fast enough to finish inside the
    // deadline, this fails rather than passing without testing anything.
    const resolved = await resolveComposition({
      dir: railDir("one"),
      flags: { json: false, frames: 2400 },
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const host = await listenPreview({
      composition: resolved.value,
      port: 0,
      hostname: "127.0.0.1",
      watch: false,
      idleTimeout: 2,
    });
    try {
      const started = Date.now();
      const res = await fetch(`${host.url}/movie`);
      expect(res.ok).toBe(true);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!)).toBe("ftyp");
      // and it really did outlive the deadline it was given
      expect(Date.now() - started).toBeGreaterThan(4500);
    } finally {
      await host.stop();
    }
  }, 180_000);
});

describe("hot reload — an edit reaches the page", () => {
  test("artefactKey moves when the bundle does, and says so when it is absent", async () => {
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const before = artefactKey(resolved.value);
    expect(before).toContain(SMOKE_DIR);
    expect(artefactKey(resolved.value)).toBe(before);

    // A rebuild rewrites the bundle; the key is what notices. (Restoring the
    // stamp afterwards cannot round-trip: a Date carries whole milliseconds
    // and the filesystem records finer, so the check is that it moved.)
    const stat = await Bun.file(resolved.value.bundlePath).stat();
    utimesSync(resolved.value.bundlePath, stat.atime, new Date(stat.mtimeMs + 5000));
    const moved = artefactKey(resolved.value);
    expect(moved).not.toBe(before);
    utimesSync(resolved.value.bundlePath, stat.atime, new Date(stat.mtimeMs));
    expect(artefactKey(resolved.value)).not.toBe(moved);

    const missing = { ...resolved.value, bundlePath: join(TMP, "no-such-bundle.js") };
    expect(artefactKey(missing)).toContain("absent");
  });

  test("the watch ignores what the build writes, at every depth", () => {
    // Every build this CLI spawns lands in one root, `<repo>/dist`, which is
    // not under the watched tree at all. `dist` inside `compositions/` is
    // still real: the root used to move with the composition's depth
    // (`compositions/<name>/<cut>/<variant>` built into
    // `compositions/<name>/dist/<cut>/<variant>`), so a tree built before that
    // change carries those directories, and a build run by hand takes
    // whatever --outdir it is given. Matching a leading `dist/` missed them,
    // and a rebuild writing inside the watched tree asks for the next one.
    expect(isBuildOutput("dist")).toBe(true);
    expect(isBuildOutput("dist/smoke/main.js")).toBe(true);
    expect(isBuildOutput("delivery/dist/g/16x9/main.js")).toBe(true);
    expect(isBuildOutput("delivery/dist")).toBe(true);
    expect(isBuildOutput("smoke/main.tsx")).toBe(false);
    expect(isBuildOutput("distant/main.tsx")).toBe(false);
    expect(isBuildOutput("delivery-shared/copy.ts")).toBe(false);
  });

  test("a change under compositions/ fires; what the build writes does not", async () => {
    const root = join(TMP, "watch-root");
    const shared = join(root, "compositions", "delivery-shared");
    const output = join(root, "compositions", "dist", "x");
    const nested = join(root, "compositions", "delivery", "dist", "g", "16x9");
    mkdirSync(shared, { recursive: true });
    mkdirSync(output, { recursive: true });
    mkdirSync(nested, { recursive: true });
    let fired = 0;
    const watcher = watchSources({ root, onChange: () => { fired += 1; }, debounceMs: 80 });
    if (watcher === null) return; // platform cannot watch recursively
    try {
      await Bun.sleep(300); // FSEvents takes a moment to arm

      // A cut imports from beside it — a multi-cut delivery keeps its shared
      // modules one level up — so the watch is over the tree rather than the
      // one directory being previewed.
      writeFileSync(join(shared, "copy.ts"), "export const a = 1;\n");
      await Bun.sleep(600);
      expect(fired).toBeGreaterThan(0);

      // Build output must not trigger the next rebuild, at any depth. One
      // root is outside this tree now; these two are what an older tree and a
      // hand-run --outdir leave inside it.
      const quiet = fired;
      writeFileSync(join(output, "main.js"), "console.log(1);\n");
      await Bun.sleep(600);
      expect(fired).toBe(quiet);
      writeFileSync(join(nested, "main.js"), "console.log(2);\n");
      await Bun.sleep(600);
      expect(fired).toBe(quiet);
    } finally {
      watcher.close();
    }
  }, 30_000);

  test("a save that changes no byte says so, and does not reboot the world", async () => {
    // The reload re-resolves the composition. It used to do that with an
    // empty flag set, so every `--bundle` / `--pak` / `--frames` / `--fps` /
    // `--supersample` the person opened the session with — including the
    // artefacts `--spec` stages — was dropped on the first edit. Here that is
    // load-bearing twice over: the session is opened on this suite's own
    // build, and a defaulted re-resolve would go looking for the repository's
    // dist and broadcast an error instead.
    const opened = flags(SMOKE_BUNDLE, SMOKE_PAK, { frames: 30 });
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: opened,
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    // Taken before this test builds anything, so the comparison at the end is
    // about what this test wrote and not about what the checkout arrived
    // holding — the setup build below included.
    const distBefore = repoArtefactStamp();
    // Build it once through the command the reload itself runs. beforeAll
    // builds these fixtures directly, and that argv is not the CLI's — the
    // first reload would legitimately produce different bytes, which is a
    // difference in how the test set up, not the property under test. (Three
    // builds of this composition through the same argv are byte-identical:
    // main.js 49a87871…, main.pak 2e09cd48…, measured.)
    await runBuild(resolved.value);
    // A save writes the file. Read the bytes first so the write can put the
    // same ones back, and so a failure part-way through leaves the source as
    // it found it — this one is a file in the repository, not in TMP.
    const entry = join(SMOKE_DIR, "main.tsx");
    const source = await Bun.file(entry).text();
    const host = await listenPreview({
      composition: resolved.value,
      flags: opened,
      port: 0,
      hostname: "127.0.0.1",
    });
    try {
      expect(host.watching).toBe(true);
      expect(host.meta.durationFrames).toBe(30);
      const sessions = PreviewSession.openSessions;
      const res = await fetch(`${host.url}/events`);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await Bun.sleep(300); // the recursive watch takes a moment to arm

      // The file is written back byte for byte: what an editor does when
      // nothing was typed. No byte of any composition changes, and the
      // rebuild is the command the CLI prints, so it writes the same bundle
      // back. The tree is watched WHOLE, so this is also every save to every
      // other composition and every shared module beside them.
      //
      // Not `utimesSync`. An mtime-only touch is not a save, and it is not
      // reliably a change event either: on the Linux runner it surfaced
      // nothing at all, and this test sat on a stream carrying only
      // heartbeats until it timed out, while the edit test below — a real
      // write — passed on the same runner.
      await Bun.write(entry, source);

      let seen = "";
      const deadline = Date.now() + 90_000;
      while (
        !seen.includes('"unchanged"') &&
        !seen.includes('"reloaded"') &&
        Date.now() < deadline
      ) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
      expect(seen).toContain("retry: 1000");
      expect(seen).toContain('"building"');

      // Decided on the BYTES. On mtime the answer is always "it moved" — the
      // build rewrites both files unconditionally — so every save anywhere
      // under the tree tore down the world, booted it again and re-encoded
      // the whole viewing copy for a picture that had not changed.
      expect(seen).toContain('"unchanged"');
      expect(seen).not.toContain('"reloaded"');
      expect(PreviewSession.openSessions).toBe(sessions);

      // and the session is still the one the person asked for: the suite's
      // bundle, at the 30 frames the flags named, not smoke's own 450. A
      // re-resolve with an empty flag set would have found no bundle where it
      // looked and broadcast an error instead.
      expect(host.meta.durationFrames).toBe(30);
      expect(host.meta.dir).toBe(SMOKE_DIR);
      expect(seen).not.toContain('"error"');

      // nothing was written to the repository's own dist: the build the
      // reload runs takes its --outdir from the resolved bundle path, which
      // is this suite's own dist under TMP
      expect(repoArtefactStamp()).toBe(distBefore);
    } finally {
      await host.stop();
      if ((await Bun.file(entry).text()) !== source) await Bun.write(entry, source);
    }
  }, 180_000);

  test("an edit that changes the picture reopens the session", async () => {
    // The other side of the same decision, over a tree this suite owns: a
    // real edit must still cost a boot, or the reload does nothing at all.
    const resolved = await resolveComposition({ dir: railDir("one"), flags: { json: false } });
    if (!resolved.ok) throw new Error(resolved.message);
    const host = await listenPreview({
      composition: resolved.value,
      port: 0,
      hostname: "127.0.0.1",
    });
    const entry = join(railDir("one"), "app.tsx");
    const original = await Bun.file(entry).text();
    try {
      expect(host.watching).toBe(true);
      const res = await fetch(`${host.url}/events`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await Bun.sleep(300); // FSEvents takes a moment to arm
      // A class, so the style table and the pak move. This used to append a
      // comment, which reaches no pixel and passed only because the fixture
      // and the reload built from two working directories and Bun named the
      // bundle's modules relative to each; since 0051 the two bundles are one,
      // and a comment is correctly `unchanged`.
      const edited = original.replace("bg-blue-600", "bg-red-600");
      expect(edited).not.toBe(original);
      await Bun.write(entry, edited);

      let seen = "";
      const deadline = Date.now() + 90_000;
      while (
        !seen.includes('"unchanged"') &&
        !seen.includes('"reloaded"') &&
        Date.now() < deadline
      ) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
      expect(seen).toContain('"building"');
      expect(seen).toContain('"reloaded"');
      // and it names the composition, so a page showing another one knows to
      // reload rather than only noticing a change of geometry
      const reloaded = seen
        .split("\n")
        .filter((l) => l.startsWith("data: ") && l.includes('"reloaded"'))
        .map((l) => JSON.parse(l.slice(6)) as { current: string; generation: number });
      expect(reloaded.at(-1)!.current).toBe("compositions/one");
      expect(reloaded.at(-1)!.generation).toBeGreaterThan(0);
    } finally {
      await Bun.write(entry, original);
      await host.stop();
    }
  }, 180_000);

  test("--no-watch is a flag the parser knows, not only a line in the help", async () => {
    // It was in the help text and in runFromArgv and nowhere in args.ts, so
    // `preview --no-watch` exited 2 with "unknown flag" — a documented flag
    // that did not exist. The help assertion alone could not see that:
    // nothing between the two ever ran the parser.
    const { parseArgs } = await import("../src/cli/args.ts");
    const parsed = parseArgs(["preview", "compositions/smoke", "--no-watch"]);
    expect(parsed.flags["no-watch"]).toBe(true);
    expect(() => parseArgs(["trace", "compositions/smoke", "--no-watch"])).toThrow();
    expect(helpText()).toContain("--no-watch");
  });

  test("--no-watch is a host that says it is not watching", async () => {
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const host = await listenPreview({
      composition: resolved.value,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      port: 0,
      hostname: "127.0.0.1",
      watch: false,
    });
    try {
      expect(host.watching).toBe(false);
    } finally {
      await host.stop();
    }
  }, 60_000);
});

describe("the rail picks a composition, and /select swaps the session", () => {
  test("compositions in this tree share a compositionId", async () => {
    // The measured reason the rail is keyed by path. If either pair ever
    // stops sharing an id this fails — re-read this then, and keep the key as
    // the path anyway: nothing stops the next two from colliding. Read off
    // the sidecars rather than off a running host, so it needs nothing built.
    const idOf = async (dir: string) =>
      ((await Bun.file(join(ROOT, dir, "pocket.json")).json()) as { id: string }).id;

    // One pair by accident: two unrelated fixtures that were named alike.
    expect(await idOf("compositions/malicious")).toBe(await idOf("compositions/smoke"));

    // One on purpose: two cuts whose paths differ only ABOVE the last
    // segment, declaring one id. Keyed by id the rail would show a single row
    // for two films, which is the shape `src/cli/resolve.ts` already had to
    // fix once for dist directories.
    expect(await idOf("compositions/nested/a/9x16")).toBe(
      await idOf("compositions/nested/b/9x16"),
    );
  });

  test("keyed by path, because two compositions can share an id", async () => {
    // Over the suite's own tree (see makeRailTree): `one` and `twin` are the
    // same composition copied twice and so share an id, `twin` is not built,
    // and `compositions/dist/leftover` is build output. All three are facts
    // this test set up, not ones it reads off the repository — and nothing
    // here resolves or writes the repository's dist.
    const resolved = await resolveComposition({ dir: railDir("one"), flags: { json: false } });
    if (!resolved.ok) throw new Error(resolved.message);
    const distBefore = repoArtefactStamp();
    const host = await listenPreview({
      composition: resolved.value,
      port: 0,
      hostname: "127.0.0.1",
    });
    try {
      const cat = (await (await fetch(`${host.url}/compositions`)).json()) as {
        ok: boolean;
        current: string;
        items: Array<{ path: string; id: string | null; ready: boolean; note?: string }>;
      };
      expect(cat.ok).toBe(true);
      // git reports the physical path and the composition arrives lexical;
      // /tmp is a symlink here, so subtracting one from the other used to
      // give a name starting with `..` and no rail row ever matched it
      expect(cat.current).toBe("compositions/one");
      const by = new Map(cat.items.map((i) => [i.path, i]));
      expect(by.has("compositions/one")).toBe(true);
      expect(by.has("compositions/other")).toBe(true);
      expect(by.has("compositions/dist/leftover")).toBe(false);

      expect(by.get("compositions/twin")!.id).toBe(by.get("compositions/one")!.id);

      // a composition without a bundle is listed and refused, not hidden
      expect(by.get("compositions/twin")!.ready).toBe(false);
      expect(by.get("compositions/twin")!.note).toBe("not built");
      expect(by.get("compositions/one")!.ready).toBe(true);

      // and a composition that will not resolve says WHY. Every failure used
      // to read "no sidecar", so a typo in a sidecar that is right there was
      // reported as a missing file and its diagnostic reached nobody.
      expect(by.get("compositions/bare")!.note).toBe("no sidecar");
      expect(by.get("compositions/broken")!.note).not.toBe("no sidecar");
      expect(by.get("compositions/broken")!.note).toContain("font");

      // /select is the one route that is not a GET
      const wrongMethod = await fetch(`${host.url}/select`);
      expect(wrongMethod.status).toBe(405);

      // and a page on another origin cannot swap the film out from under it
      const crossOrigin = await fetch(`${host.url}/select`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "text/plain" },
        body: JSON.stringify({ path: "compositions/other" }),
      });
      expect(crossOrigin.status).toBe(403);
      expect(
        ((await (await fetch(`${host.url}/compositions`)).json()) as { current: string }).current,
      ).toBe("compositions/one");

      const unknown = await post(host.url, { path: "compositions/nope" });
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as { error: string }).error).toContain(
        "not a composition in this tree",
      );

      const escape = await post(host.url, { path: "../../etc" });
      expect(escape.status).toBe(400);

      const unbuilt = await post(host.url, { path: "compositions/twin" });
      expect(unbuilt.status).toBe(400);
      // the refusal carries the command that would fix it
      expect(((await unbuilt.json()) as { error: string }).error).toContain("tools/build.ts");

      const ok = await post(host.url, { path: "compositions/other" });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { ok: boolean; current: string };
      expect(body.ok).toBe(true);
      expect(body.current).toBe("compositions/other");

      // the whole host follows: meta, the rail's idea of current, and frames
      const meta = (await (await fetch(`${host.url}/meta`)).json()) as {
        current: string;
        dir: string;
      };
      expect(meta.current).toBe("compositions/other");
      // /select joins the selected path onto the root git reported, so the
      // directory it lands on is the physical one
      expect(meta.dir).toBe(realpathSync(railDir("other")));
      const after = (await (await fetch(`${host.url}/compositions`)).json()) as {
        current: string;
      };
      expect(after.current).toBe("compositions/other");
      const png = await fetch(`${host.url}/frame?at=0`);
      expect(png.ok).toBe(true);
      expect(png.headers.get("content-type")).toBe("image/png");

      // the whole exchange stayed inside the tree this test built: the rail
      // is rooted where git reported, `/select` joins onto that root, and the
      // build the refusal names is one nobody ran. `one` and `twin` are
      // copies of `compositions/smoke` and `other` of `compositions/occluded`,
      // so those are the artefacts a repository-rooted resolve would have
      // landed on. A backstop rather than the assertion this test turns on:
      // nothing here builds, so no defect drives it red on its own.
      expect(repoArtefactStamp()).toBe(distBefore);
    } finally {
      await host.stop();
    }
  }, 180_000);
});

describe("one switch at a time, and a stop that always finishes", () => {
  test("a close nobody is waiting for is reported, and stop() waits for it", async () => {
    // Written `void job.close()`, a rejection here has nobody attached to it:
    // an EACCES unlinking the temp directory ends the whole preview process
    // over a cache entry nobody asked about. And nothing can wait for it, so
    // Ctrl-C returns while an ingest's ffmpeg is still running.
    const said: string[] = [];
    const closes = new PendingCloses((m) => said.push(m));
    let slowFinished = false;
    closes.add("a slow viewing copy", async () => {
      await Bun.sleep(60);
      slowFinished = true;
    });
    closes.add("a stuck viewing copy", async () => {
      throw new Error("EACCES: permission denied, rm '/tmp/pocketjs-motion-watch-x'");
    });
    await closes.settle();
    expect(slowFinished).toBe(true);
    expect(said).toEqual([
      "a stuck viewing copy did not close: EACCES: permission denied, rm '/tmp/pocketjs-motion-watch-x'",
    ]);
  });

  test("two switches queued at once run one after the other", async () => {
    // The gate used to be a nullable slot every waiter spun on, and `await
    // settled()` yields even with nothing to wait for — so two callers found
    // it empty in the same tick, both took it, and the second overwrote the
    // first. A hot reload and a /select then ran concurrently over one wasm
    // world, and stop() waited on whichever promise was stored last.
    const gate = makeSwitchQueue();
    const log: string[] = [];
    const first = gate.withSwitch(async () => {
      log.push("first in");
      await Bun.sleep(40);
      log.push("first out");
    });
    const second = gate.withSwitch(async () => {
      log.push("second in");
      await Bun.sleep(5);
      log.push("second out");
    });
    await Promise.all([first, second]);
    expect(log).toEqual(["first in", "first out", "second in", "second out"]);

    // a switch that throws does not wedge the queue or reject the next one
    const failed = gate.withSwitch(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(gate.withSwitch(async () => "after")).resolves.toBe("after");

    // and a reader parks on what is queued, not on what is queued later
    await gate.settled();
  });

  test("concurrent selects leave one session, and stop() closes it once", async () => {
    const encoders = () =>
      Bun.spawnSync(["pgrep", "-f", "pocketjs-motion-watch-"])
        .stdout.toString()
        .split("\n")
        .filter(Boolean).length;
    const beforeEncoders = encoders();
    const beforeSessions = PreviewSession.openSessions;

    const resolved = await resolveComposition({ dir: railDir("one"), flags: { json: false } });
    if (!resolved.ok) throw new Error(resolved.message);
    const host = await listenPreview({
      composition: resolved.value,
      port: 0,
      hostname: "127.0.0.1",
      watch: false,
    });
    let stopped = false;
    try {
      expect(PreviewSession.openSessions).toBe(beforeSessions + 1);

      // start an encode of the composition we are about to switch away from
      await fetch(`${host.url}/movie/status`);
      for (let i = 0; i < 100; i++) {
        const st = (await (await fetch(`${host.url}/movie/status`)).json()) as {
          phase: string;
          frame: number;
        };
        if (st.phase === "running" && st.frame > 0) break;
        if (st.phase === "ready" || st.phase === "error") break;
        await Bun.sleep(50);
      }

      // Two switches asked for at the same moment. Serialised, they are two
      // swaps and one live session; racing, both open a world and one of the
      // two is never closed again — a leaked wasm heap per switch, and a
      // FootageLayer has been measured at ~13 GiB.
      const [a, b] = await Promise.all([
        post(host.url, { path: "compositions/other" }),
        post(host.url, { path: "compositions/one" }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(PreviewSession.openSessions).toBe(beforeSessions + 1);

      // and the host is one composition, not one name over another's world
      const meta = (await (await fetch(`${host.url}/meta`)).json()) as {
        current: string;
        dir: string;
      };
      expect(meta.current).toBe(relative(realpathSync(RAIL_ROOT), meta.dir));
      expect((await fetch(`${host.url}/frame?at=0`)).ok).toBe(true);

      // stop() is one shutdown however many callers ask for it, and every
      // caller gets the answer of the one that ran
      const first = host.stop();
      const second = host.stop();
      stopped = true;
      expect(second).toBe(first);
      await Promise.all([first, second]);
      await host.closed;

      // nothing is left encoding into a directory that has been deleted
      expect(encoders()).toBeLessThanOrEqual(beforeEncoders);
      expect(PreviewSession.openSessions).toBe(beforeSessions);
    } finally {
      if (!stopped) await host.stop();
    }
  }, 180_000);

  test("a close that fails still lets the host finish closing", async () => {
    // `release()` used to sit after four awaits with nothing catching them.
    // One session that would not dispose and `closed` never resolved, so
    // `preview`'s keepAlive never returned: the process hung on a Ctrl-C that
    // had already stopped the server, and the --spec staging directory that
    // keepAlive disposes was never cleaned up.
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const host = await listenPreview({
      composition: resolved.value,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      port: 0,
      hostname: "127.0.0.1",
      watch: false,
    });
    const realClose = PreviewSession.prototype.close;
    // close for real, then fail: the bookkeeping stays honest and the throw
    // is the thing stop() has to survive
    PreviewSession.prototype.close = async function (this: PreviewSession) {
      await realClose.call(this);
      throw new Error("the world would not dispose");
    };
    try {
      await host.stop();
      await host.closed;
    } finally {
      PreviewSession.prototype.close = realClose;
    }
  }, 60_000);
});

describe("one discovery rule", () => {
  test("main.tsx at any depth, build output excluded at any depth, sorted", () => {
    expect(
      compositionDirs(
        [
          "compositions/reel/main.tsx",
          "compositions/nested/a/9x16/main.tsx",
          "compositions/dist/smoke/main.tsx",
          // Build output at a depth `compositions/dist/` does not match. The
          // dist root used to move with the composition's depth, so a tree
          // built before that change carries directories like this one, and a
          // hand-run build takes whatever --outdir it is given. Matching a
          // leading `compositions/dist/` left them visible to the rail and to
          // both coverage gates. AGENTS.md states the rule as `dist` by name
          // at any depth.
          "compositions/nested/dist/b/9x16/main.tsx",
          "compositions/distant/main.tsx",
          "compositions/open/main.tsx",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "compositions/distant",
      "compositions/nested/a/9x16",
      "compositions/open",
      "compositions/reel",
    ]);
  });

  test("the rule is stated once, and the two gates read it", async () => {
    // scripts/visibility.ts said in its own comment that its copy of this
    // pipeline was deliberate, so a composition added tomorrow could not fall
    // out of one loop while staying in the other. A rail that discovered
    // compositions its own way would be a third copy — and one that could
    // show a composition the ledger has never measured, silently.
    for (const script of ["scripts/digests.ts", "scripts/visibility.ts"]) {
      const src = await Bun.file(join(ROOT, script)).text();
      expect(src).toContain('from "../src/cli/discover.ts"');
      expect(src).not.toContain('"ls-files"');
    }
  });

  test("both gates ask about this tree, not about the directory they were run from", async () => {
    // Every other path in both scripts is anchored on their own ROOT; the
    // discovery call was the one that asked `process.cwd()`. Run from another
    // repository the ledger gate reported 39 compositions unaccounted for —
    // every EXEMPT entry "renamed or removed", every ENTRIES entry "has no
    // main.tsx" — and run from a directory in no repository at all, both threw
    // DiscoveryError before reaching their ledger. `--only` names nothing, so
    // this runs the coverage gate and no build.
    for (const script of ["scripts/digests.ts", "scripts/visibility.ts"]) {
      const proc = Bun.spawn(["bun", join(ROOT, script), "--only", "zzz-no-such-composition"], {
        cwd: TMP,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, POCKETJS_ROOT: VENDOR },
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(`${script}: ${code}\n${out}\n${err}`).toContain(`${script}: 0`);
      expect(err).not.toContain("DiscoveryError");
      expect(err).not.toContain("not accounted for");
    }
  }, 60_000);

  test("a digest is refused if the artefact moved while it was traced", async () => {
    // Nothing holds dist exclusively: preview rebuilds into the same
    // directory when a source changes under it, and a person can run the
    // build by hand. The race is not prevented — a lock would have to span
    // the whole run — it is made impossible to pass silently. Exercised for
    // real by touching the bundle through a --only run: green untouched,
    // exit 1 and this message when touched.
    const src = await Bun.file(join(ROOT, "scripts/digests.ts")).text();
    expect(src).toContain('from "../src/cli/artefacts.ts"');
    expect(src).toContain("const built = artefactKey(resolved.value);");
    expect(src).toContain("if (artefactKey(resolved.value) !== built) {");
    expect(src).toContain("changed while it was being traced");
  });

  test("the tree discovers as git lists it", async () => {
    const catalog = await discoverCompositions(ROOT);
    expect(catalog.root).toBe(ROOT);
    expect(catalog.dirs).toContain("compositions/open");
    expect(catalog.dirs).toContain("compositions/smoke");
    expect(catalog.dirs.some((d) => d.startsWith("compositions/dist/"))).toBe(false);
    expect([...catalog.dirs]).toEqual([...catalog.dirs].sort());
  });

  test("a selection is one of the discovered directories and nothing else", () => {
    const catalog = { root: "/repo", dirs: ["compositions/open", "compositions/nested/a/9x16"] };
    expect(normaliseSelection("compositions/open", catalog)).toBe("compositions/open");
    expect(normaliseSelection("compositions/open/", catalog)).toBe("compositions/open");
    expect(normaliseSelection("/repo/compositions/nested/a/9x16", catalog)).toBe(
      "compositions/nested/a/9x16",
    );
    // a path that leaves the tree, or names something not discovered, is not
    // resolved against the filesystem — it is simply not a composition here
    expect(normaliseSelection("../../etc/passwd", catalog)).toBeNull();
    expect(normaliseSelection("/etc/passwd", catalog)).toBeNull();
    expect(normaliseSelection("compositions/dist/open", catalog)).toBeNull();
    expect(normaliseSelection("compositions", catalog)).toBeNull();
    expect(normaliseSelection("", catalog)).toBeNull();
  });
});

describe("parseByteRange — /movie is seekable", () => {
  test("a range is one satisfiable span, and anything else is stated", () => {
    // start-end, clamped to the file
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=0-9999", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange("BYTES=10-20", 1000)).toEqual({ start: 10, end: 20 });
    expect(parseByteRange(" bytes=10-20 ", 1000)).toEqual({ start: 10, end: 20 });
    // open end
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    // suffix — the last N bytes, which is how a player finds a trailing moov
    expect(parseByteRange("bytes=-64", 1000)).toEqual({ start: 936, end: 999 });
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });

    // outside the file: 416, not a truncated 206
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");

    // but a last-byte-pos below the first-byte-pos is an INVALID spec, not an
    // unsatisfiable one — RFC 9110 §14.1.1 says a recipient ignores it, so it
    // is the whole file and a 200. 416 is for a well-formed range that lands
    // outside the representation.
    expect(parseByteRange("bytes=50-40", 1000)).toBe("none");
    expect(parseByteRange("bytes=0-0", 1000)).toEqual({ start: 0, end: 0 });

    // RFC 9110: a server ignores a Range it cannot parse, and answering a
    // multi-range request with the whole file is allowed.
    expect(parseByteRange(null, 1000)).toBe("none");
    expect(parseByteRange("bytes=", 1000)).toBe("none");
    expect(parseByteRange("bytes=abc-def", 1000)).toBe("none");
    expect(parseByteRange("bytes=0-99,200-299", 1000)).toBe("none");
    expect(parseByteRange("items=0-99", 1000)).toBe("none");
    expect(parseByteRange("bytes=12", 1000)).toBe("none");
  });
});

describe("listenPreview — HTTP is the display", () => {
  test("GET /frame and /layout serve the session, and out-of-range is 400", async () => {
    const resolved = await resolveComposition({
      dir: SMOKE_DIR,
      flags: flags(SMOKE_BUNDLE, SMOKE_PAK),
      requireBundle: true,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const host = await listenPreview({
      composition: resolved.value,
      port: 0,
      hostname: "127.0.0.1",
    });
    try {
      const metaRes = await fetch(`${host.url}/meta`);
      const meta = (await metaRes.json()) as {
        ok: boolean;
        durationFrames: number;
        compositionId: string;
      };
      expect(meta.ok).toBe(true);
      expect(meta.durationFrames).toBe(8);
      expect(meta.compositionId.length).toBeGreaterThan(0);

      const page = await fetch(host.url);
      expect(page.headers.get("content-type")).toContain("text/html");
      // Both pages are generated per request; a cached copy survives the
      // restart that was supposed to pick the edit up.
      expect(page.headers.get("cache-control")).toBe("no-store");
      const html = await page.text();
      expect(html).toContain("/frame?at=");
      expect(html).toContain("/layout?at=");
      expect(html).toContain('href="/watch"');

      const watch = await fetch(`${host.url}/watch`);
      expect(watch.headers.get("content-type")).toContain("text/html");
      expect(watch.headers.get("cache-control")).toBe("no-store");
      const watchHtml = await watch.text();
      expect(watchHtml).toContain("<video");
      expect(watchHtml).toContain("/movie");

      const t0 = Date.now();
      let movieSt: { phase: string; hasAudio?: boolean; error?: string } = { phase: "idle" };
      while (movieSt.phase !== "ready" && movieSt.phase !== "error") {
        if (Date.now() - t0 > 50_000) {
          throw new Error(`movie encode timed out: ${JSON.stringify(movieSt)}`);
        }
        const stRes = await fetch(`${host.url}/movie/status`);
        movieSt = (await stRes.json()) as typeof movieSt;
        if (movieSt.phase !== "ready" && movieSt.phase !== "error") {
          await Bun.sleep(200);
        }
      }
      expect(movieSt.phase).toBe("ready");
      expect(movieSt.hasAudio).toBe(false);

      const movieRes = await fetch(`${host.url}/movie`);
      expect(movieRes.ok).toBe(true);
      expect(movieRes.headers.get("content-type")).toBe("video/mp4");
      expect(movieRes.headers.get("accept-ranges")).toBe("bytes");
      const movieBytes = new Uint8Array(await movieRes.arrayBuffer());
      expect(
        String.fromCharCode(movieBytes[4]!, movieBytes[5]!, movieBytes[6]!, movieBytes[7]!),
      ).toBe("ftyp");

      // Without a range answer <video> reports the file as not seekable
      // whatever it has buffered, and every write to currentTime is a
      // no-op: no scrub bar, no arrow keys, no frame stepping.
      const size = movieBytes.byteLength;
      const partial = await fetch(`${host.url}/movie`, {
        headers: { range: "bytes=0-99" },
      });
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
      const head = new Uint8Array(await partial.arrayBuffer());
      expect(head.byteLength).toBe(100);
      expect(head).toEqual(movieBytes.slice(0, 100));

      const tail = await fetch(`${host.url}/movie`, { headers: { range: "bytes=-64" } });
      expect(tail.status).toBe(206);
      expect(tail.headers.get("content-range")).toBe(`bytes ${size - 64}-${size - 1}/${size}`);
      expect(new Uint8Array(await tail.arrayBuffer())).toEqual(movieBytes.slice(size - 64));

      const past = await fetch(`${host.url}/movie`, { headers: { range: "bytes=99999999-" } });
      expect(past.status).toBe(416);
      expect(past.headers.get("content-range")).toBe(`bytes */${size}`);


      const pngRes = await fetch(`${host.url}/frame?at=3`);
      expect(pngRes.ok).toBe(true);
      expect(pngRes.headers.get("content-type")).toBe("image/png");
      const png = new Uint8Array(await pngRes.arrayBuffer());
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
      const hash = pngRes.headers.get("x-frame-hash");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      const session = await openSmoke();
      try {
        const direct = await session.pngAt(3);
        expect(hash).toBe(direct.hash);
        expect(Buffer.from(png).equals(Buffer.from(direct.bytes))).toBe(true);
      } finally {
        await session.close();
      }

      const layoutRes = await fetch(`${host.url}/layout?at=3`);
      const layout = (await layoutRes.json()) as { ok: boolean; nodes: unknown[] };
      expect(layout.ok).toBe(true);
      expect(layout.nodes.length).toBeGreaterThan(0);

      const bad = await fetch(`${host.url}/frame?at=99`);
      expect(bad.status).toBe(400);
      const body = (await bad.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/out of range/);

      const blocked = new Request(`${host.url}/frame?at=0`, {
        headers: { host: `evil.example:${host.port}` },
      });
      expect(hostAllowed(blocked, host.hostname, host.port)).toBe(false);
      expect(
        hostAllowed(
          new Request(`${host.url}/frame?at=0`, {
            headers: { host: `127.0.0.1:${host.port}` },
          }),
          host.hostname,
          host.port,
        ),
      ).toBe(true);
    } finally {
      await host.stop();
    }
  }, 120_000);

  test("CLI preview --json prints the URL then serves from that process", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        join(ROOT, "src/cli/main.ts"),
        "preview",
        SMOKE_DIR,
        "--json",
        "--no-open",
        "--port",
        "0",
        `--bundle=${SMOKE_BUNDLE}`,
        `--pak=${SMOKE_PAK}`,
        "--frames",
        "8",
      ],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, POCKETJS_ROOT: VENDOR },
      },
    );
    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!buf.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      const obj = JSON.parse(buf.trim().split("\n")[0]!) as {
        ok: boolean;
        url: string;
        durationFrames: number;
      };
      expect(obj.ok).toBe(true);
      expect(obj.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(obj.durationFrames).toBe(8);
      const pngRes = await fetch(`${obj.url}/frame?at=0`);
      expect(pngRes.ok).toBe(true);
      expect(pngRes.headers.get("content-type")).toBe("image/png");
      const png = new Uint8Array(await pngRes.arrayBuffer());
      expect(png[0]).toBe(0x89);
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
  }, 60_000);
});
