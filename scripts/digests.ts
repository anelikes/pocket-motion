#!/usr/bin/env bun
/**
 * The digest ledger: build every listed composition the way the CLI tells an
 * author to, trace it, and compare against what is recorded.
 *
 * This is the determinism claim as a continuously-checked fact rather than an
 * anecdote. Until now it was proven by a human running commands by hand — the
 * Phase 0 acceptance record is a snapshot of one afternoon, and nothing has
 * re-verified it since. Run from CI on a different OS and architecture, this
 * script is also the cross-platform criterion: a ledger written on macOS/ARM
 * that reproduces on Linux/x86-64 is the whole claim, per composition, per
 * commit.
 *
 *   bun scripts/digests.ts            # verify (exit 1 on any mismatch)
 *   bun scripts/digests.ts --write    # re-record, after an intended change
 *   bun scripts/digests.ts --only reel
 *
 * Every run first checks that every composition in the tree is either measured
 * here or excused in `EXEMPT` with a written reason, so a composition cannot
 * fall out of coverage quietly — which is how footage stayed outside the ledger
 * for four commits after the CLI learned to render it.
 *
 * The build command is not written here: it comes from `resolveComposition`,
 * the same string the CLI prints when an artifact is missing. So this checks
 * the documented recipe, not a private one that could drift from it — the
 * faces come from each sidecar's `fonts`, the density from its `supersample`.
 *
 * Generators run first where they exist, and the composition's own sources
 * must come back byte-identical. That is a second, independent claim: a
 * build-time measurement pass reaches the same layout decisions on another
 * machine. It is measured against the renderer's own advance tables, so
 * there is no reason it should not — which is exactly why it is worth
 * checking rather than assuming.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { artefactKey } from "../src/cli/artefacts.ts";
import { runBuild } from "../src/cli/build.ts";
import {
  FULL_RUN_COMFORTABLE_GIB,
  FULL_RUN_NEED_GIB,
  FULL_RUN_RGBA_FILES,
  FULL_RUN_RGBA_MEASURED,
  HEADROOM_MULTIPLE,
  RECLAIM_COMMAND,
  formatGiB,
  freeGiB,
  strayRgba,
} from "../src/cli/disk.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { discoverCompositions } from "../src/cli/discover.ts";
import { PARAMETERISED, generatorPath, runGenerator } from "../src/cli/generators.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LEDGER = join(ROOT, "baselines/digests.json");

/**
 * What is in the ledger, and why each one earns its runtime.
 *
 * The verification loop once did not cover footage at all, and the CLI half of
 * that was fixed — `check`, `frame`, `trace` and `render` all read a sidecar's
 * `footage` array. THIS LIST WAS NOT FIXED WITH IT. For four commits after
 * that, every one of the six entries was a composition with no footage in it,
 * so "6/6 digests reproduce" was a true sentence that said nothing whatever
 * about the footage path — while `FootageLayer`, `ingest.ts` and the tiling
 * arithmetic were being changed underneath it.
 *
 * Nothing forced that question to be asked. `EXEMPT` below is what forces it:
 * membership in this list is the default, and staying out of it costs a
 * written reason that `assertLedgerCoversEveryComposition` checks.
 */
const ENTRIES = [
  "compositions/smoke", // the smallest thing that renders; no generator
  // No declared ground, two frames. Measured rather than excused because its
  // digest is the one in this tree that would move if the core's clear colour
  // did: the frame hash covers all four channels, and `clear_black` is what
  // decides three of them everywhere this composition does not paint.
  "compositions/alpha",
  "compositions/curves", // custom keyframes, generated
  "compositions/curves-race", // the generated figure docs/ argues from
  "compositions/copy", // CJK, and the build-time fit
  "compositions/lower-third", // name plate; optional footage is a job, not the sample
  "compositions/glow", // baked 取消-button glow plate; no runtime blur
  "compositions/glow-column", // the column veil rendered: rotate-180 is a picture, not a string
  "compositions/open", // opening hold: #03070a ground, PSP outline in #020608
  "compositions/probe", // the two facts every reel layout is built around
  "compositions/textcmp-latin", // the glyph-fidelity fixture, Latin (baselines/glyph-fidelity.md)
  "compositions/textcmp-cjk", // the same, CJK — a CFF face, so it also covers the winding patch
  "compositions/textcmp-kern",
  "compositions/textcmp-liga", // the fourteen classic kerning pairs (baselines/glyph-fidelity.md)
  "compositions/late-timer", // renders deterministically; `lint` is what rejects it
  "compositions/reel", // the long one: 1071 frames, beat-locked
  // A motion technique taken off a reference recording: the curved slat
  // shutter. In the ledger because its geometry is arithmetic in `gen.ts` and
  // its cadence is five frames wide — both are exactly the kind of thing a
  // change elsewhere moves without anyone noticing.
  "compositions/shutter",
  // rename-card. shutter's opening carried six seconds further: a typed name
  // whose caret sits at a measured width, and a close built from the arc
  // primitive and one-tick step gates — the gates are what a change to the
  // bake rate or the sampling grid would move first.
  "compositions/rename-card",
  // timeline. One translateX timeline with 29 stops moves an 8040px strip;
  // fourteen per-card scale pops and caption crossfades are timed against it
  // by arithmetic alone, so a drift in how a delay or a percentage bakes
  // shows up here first.
  "compositions/timeline",
  // captions/*. Five caption styles ported from the HyperFrames catalog, one
  // transcript, every word at a measured x. Each is a different treatment of
  // word timestamps — a box growing behind the word, a clip window, a colour
  // timeline, a step-gated scramble, a directional entrance — so a change to
  // how width, color or a one-tick gate bakes moves one of them first.
  "compositions/captions/highlight",
  "compositions/captions/kinetic-slam",
  "compositions/captions/pill-karaoke",
  "compositions/captions/clip-wipe",
  "compositions/captions/matrix-decode",
  // captions/alpha-en, captions/burn-zh. The two samples of the `captions` job
  // template (src/captions/template.ts): a Latin alpha track read from a
  // WhisperX transcript, and a CJK track read from OpenAI's verbose_json and
  // burned into a footage clip. Where a page breaks, what size it takes and
  // which frame a word enters on are all decided by the template, so a change
  // to the layout, the clock arithmetic or a style moves one of these first.
  "compositions/captions/alpha-en",
  "compositions/captions/burn-zh",
  // transitions. Nine scene-to-scene transitions ported from the HyperFrames
  // catalog in one film: a velocity-matched cut, a clip wipe, a wash, a tile
  // grid, a match cut, a rubber band, a whip pan with echoes, and two flat
  // reveals standing in for a mask. 557 animations over 756 frames — the
  // widest sweep of the baker's fill and ordering rules in the tree.
  "compositions/transitions",
  // The mechanism fixtures. Each is here for one thing and carries no film.
  // masked. Four `overflow-mask` windows (patches/0013): a growing circle, a
  // rotated window whose width sweeps, a rounded card clipping its text, and
  // a circle inside a rotated window. The first composition whose pixels go
  // through MASK_PUSH — a change to the outline flattener, the coverage
  // sampler or the nesting rule moves this digest first, and a mask that
  // stopped multiplying would move only the nested quadrant.
  "compositions/masked",
  "compositions/footage-tracks", // four windows over three clips: two mappings of one clip, cover, contain
  "compositions/sound-roles", // one of each sound role; the digest is its PICTURE, sound being outside identity
  "compositions/nested/a/9x16", // one compositionId, two paths differing only above the last segment;
  "compositions/nested/b/9x16", // both are here because a shared dist directory reads as one digest twice
  "compositions/typography", // arbitrary font sizes, every one outside the pinned FONT_PX scale
  // faces. The default pair and three named faces (`fonts.faces`, patch 0016)
  // in one frame, one of them the fetched CJK pair. A face baked from the
  // wrong file, or a slot shared between two faces, moves this digest.
  "compositions/faces",
  // stroke. The four GLYPH_STROKE forms (patches/0017) — outside under the
  // fill, centred over it, hollow, and a keyframed width 0 -> 10 px — over
  // 45 frames. A change to the distance field or the ring arithmetic moves
  // this digest and no other.
  "compositions/stroke",
  // filters. The filter layers of patches/0018 over 30 frames: three blur
  // steps on one card, a breathing text glow, a hard drop shadow, a rack
  // focus keyframed as a CSS filter, and the five blend modes over a split
  // ground. A change to the blur passes, the shadow, the composite or a
  // blend function moves this digest.
  "compositions/filters",
  // bloom. patches/0033: an alpha glow and a luma glow side by side on the
  // same 85 % dark plate carrying a white rule and a cyan bar, two frames.
  // The alpha glow lightens the plate; the luma glow leaves it as it is and
  // lights the rule and the bar. A change to the luma halo, its threshold
  // ramp, its tint or the add moves this digest and no other.
  "compositions/bloom",
  // gradients. The gradient paint of patches/0019 over 30 frames: three
  // stops inside a rounded border, four stops at 30deg, a radial fade to
  // transparent, a rotated card, gradient text whose angle turns, CJK
  // gradient text, and a via stop sweeping a bar. A change to the stop
  // table, the parameter map or bg-clip-text moves this digest.
  "compositions/gradients",
  // images. patches/0020: a 900x506 image drawn 1:1 and at 0.8x bilinear,
  // and a 3x5 image drawn 40 px per texel. A stride or sampling that assumed
  // a power of two moves this digest.
  "compositions/images",
  // shutter-blur. patches/0034: the one composition here that declares a
  // shutter, so its digest is of exposures — 180°, 8 samples a frame. A spin
  // through its wraps, an eased sweep, a zero-length jump and a one-tick
  // flick the samples must not cross, opacity gates the shutter must hold,
  // and one label under `shutter-hold`. A change to where a sample sits, to
  // the jump rule or to the integer average moves this digest and no other.
  "compositions/shutter-blur",
] as const;

/**
 * Compositions deliberately outside the ledger, each with the fact that keeps
 * it out. A reason here is a claim about behaviour, so it is checkable and it
 * can go stale: an earlier version of this file excused several compositions as
 * "omitted while their authors are still revising them", which stopped being
 * true the moment those cuts were finished and went unnoticed for months,
 * because nothing ever re-read it. Prose that no gate reaches is the same
 * defect this ledger exists to catch, one level up.
 *
 * Two entries here used to say "DEBT": `footage` and `typography` had no
 * sidecar, so `resolveComposition` failed before anything could be measured.
 * Written down, the debt was payable rather than permanent — `typography` has
 * a sidecar and a viewport now and is measured above, and `footage` was
 * deleted when `footage-tracks` took over what it demonstrated. Nothing in
 * this table is debt today; an entry that says it is should be read as a
 * commitment.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "compositions/same-frame":
    "The calling-card film 《同一帧》, under review and recut every round; its end card carries the digest of its own first 3000 frames (digest.json), re-derived each cut. It enters ENTRIES when the cut is frozen.",
  "compositions/mg-bauhaus":
    "A showcase film written against mg-styles-15's Bauhaus prompt and recut after every jury round; a digest recorded now would be retired by the next cut. It enters ENTRIES when the cut is frozen.",
  "compositions/mg-hud":
    "A showcase film written against mg-styles-15's HUD prompt and recut after every jury round; a digest recorded now would be retired by the next cut. It enters ENTRIES when the cut is frozen.",
  "compositions/malicious":
    "The determinism rejection fixture. `trace` returns frames [], digest \"\" and a " +
    "DeterminismViolation by design; recording a digest would mean it stopped working.",
  "compositions/occluded":
    "Three nodes: a named Text buried under an opaque lid, so `layout` reports " +
    "exactly one node with a box and no pixel — the fixture for `visibility`'s " +
    "covered classification. A `tests/cli.test.ts` fixture, not a deliverable — its " +
    "frames carry no film, and a digest would pin a test input as if it were a cut.",
  "compositions/spanned":
    "The same burial at the proportions it appears at in a real cut, and the three " +
    "things it has to be told apart from: a named caption shown for a clean 72 frames and covered " +
    "for the other 168, beside a dissolve covered at no frame, a dissolve whose " +
    "longer exit IS covered for 24 (the reading's known reach, red on purpose), " +
    "and a reveal that is covered first and shown after. `lint`, `check` and " +
    "`trace` all pass on all of it, which is the point — a fixture for the " +
    "predicate, not a deliverable, and a digest would pin a test input as if it " +
    "were a cut.",
  "compositions/layout-codes":
    "One named node per finding code in `src/render/findings.ts`, plus one the " +
    "sidecar's `layoutAllow` excuses. `layout --at 0` prints all seven codes and " +
    "exits 0, which is the fixture's whole output — findings are reported, never " +
    "failed on. A `tests/cli.test.ts` fixture, not a deliverable: its frames are a " +
    "diagram of the predicates, and a digest would pin a test input as if it were " +
    "a cut. It IS swept by `scripts/visibility.ts`, which records `buried` as a " +
    "failure by name.",
  "compositions/late-anim":
    "Three entrances on a 30-frame clock, one of them declared 1500 ms in — past " +
    "the end of the film. `lint`, `check` and `trace` all pass on it and `keyframes` " +
    "exits 1, which is the whole point; a `tests/keyframes.test.ts` fixture, not a " +
    "deliverable, and a digest would pin a test input as if it were a cut.",
  "compositions/missing-image":
    "One Image whose file is in this repository in no version, and a Text. " +
    "Upstream's build discovers the name off a string literal, finds nothing, " +
    "bakes a 32×32 checkerboard and succeeds — so it TRACES, deterministically " +
    "and reproducibly, with a placeholder where the mark should be. Recording " +
    "that digest would pin the loss as if it were a picture; `lint` and " +
    "`check` are what refuse it (`src/lint/images.ts`), and that refusal is " +
    "the fixture's whole output.",
  "compositions/fit":
    "`gen.ts` takes a spec file (`usage: gen.ts <spec.json>`), so there is no fixed " +
    "composition to record — `scripts/fit-probe.ts` supplies the identity per run.",
  "compositions/shimmer":
    "`gen.ts` takes grid arguments (`usage: gen.ts <cols> <rows> <cell>`), and without " +
    "`scripts/shimmer-probe.ts` pushing its textures it traces byte-identical to " +
    "`kenburns` (60f 90f06da9…) — an entry would pin the empty scene, not the probe.",
  "compositions/kenburns":
    "Its pixels come from `scripts/push-probe.ts`. Traced alone it is byte-identical " +
    "to `shimmer` (60f 90f06da9…), so the digest does not distinguish the two.",
};

/**
 * Every composition is either measured or excused, and the excuse is written down.
 *
 * A leaf composition is a directory holding a `main.tsx` — the unit
 * `resolveComposition` accepts — found at any depth, since a delivery may nest
 * its cuts (`compositions/nested/a/9x16`). A `dist` directory at any depth is
 * build output, not a composition.
 */
async function assertLedgerCoversEveryComposition(): Promise<void> {
  // The rule lives in src/cli/discover.ts so this loop, scripts/visibility.ts
  // and preview's rail cannot drift apart.
  //
  // Anchored on ROOT, like every other path in this file. Asking from
  // `process.cwd()` made the gate a claim about wherever the script was
  // invoked from: run from another repository it reported 39 compositions
  // unaccounted for — every EXEMPT entry "renamed or removed", every ENTRIES
  // entry "has no main.tsx" — and run from a directory in no repository at
  // all it threw DiscoveryError before reaching the ledger.
  const found = (await discoverCompositions(ROOT)).dirs;

  const listed = new Set<string>(ENTRIES);
  const problems: string[] = [];

  for (const dir of found) {
    const inEntries = listed.has(dir);
    const inExempt = dir in EXEMPT;
    if (inEntries && inExempt) {
      problems.push(`${dir}: in both ENTRIES and EXEMPT — decide which`);
    } else if (!inEntries && !inExempt) {
      problems.push(
        `${dir}: neither measured nor excused. Add it to ENTRIES, or to EXEMPT with ` +
          "the fact that keeps it out.",
      );
    }
  }
  for (const dir of Object.keys(EXEMPT)) {
    if (!found.includes(dir)) {
      problems.push(`${dir}: excused in EXEMPT but no such composition — renamed or removed?`);
    }
    if (EXEMPT[dir]!.trim().length === 0) {
      problems.push(`${dir}: excused with a blank reason`);
    }
  }
  for (const dir of ENTRIES) {
    if (!found.includes(dir)) {
      problems.push(`${dir}: listed in ENTRIES but has no main.tsx`);
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} composition(s) are not accounted for:\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      "\nThe ledger's coverage is the claim. A composition nobody measures and\n" +
        "nobody excused is the shape this project has now found four times: a\n" +
        "green loop over a thing nothing checks.",
    );
    process.exit(1);
  }
}

interface Record_ {
  readonly frames: number;
  readonly digest: string;
}
interface Ledger {
  readonly hash: "sha256";
  /**
   * `Bun.version` of the run that recorded these digests.
   *
   * Every artifact carries the Bun that built it (`build.json`) and every
   * command refuses a bundle whose recorded Bun is not the running one, so
   * the version is checkable per artifact. The LEDGER's own was written down
   * in exactly one place — a comment beside `bun-version:` in
   * `.github/workflows/determinism.yml` — which is prose no gate reaches, the
   * category this file's own header names. `doctor` reads it from here.
   *
   * A mismatch is reported and does not fail the run: whether the digests
   * still reproduce is what this script measures, and the Bun is the
   * explanation for a mismatch rather than the verdict. An older ledger with
   * no `bun` at all is accepted and says so.
   */
  readonly bun?: string;
  readonly compositions: Record<string, Record_>;
}

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const only = argv.indexOf("--only");
const ONLY = only >= 0 ? argv[only + 1] : undefined;

/**
 * The disk figures come from `src/cli/disk.ts`, because `doctor` reports the
 * same ones. Duplicating the need would let this banner and that check
 * disagree about how much room a full run wants.
 *
 * This script is also where that number is MEASURED — it is the run that
 * leaves the bytes — so a full run re-reads `dist/` at the end and says so
 * when what it left disagrees with the constant. That is the only thing in
 * the tree that can notice a composition making the need bigger:
 * `baselines/ingest-bytes.json` pins digests and frame counts, not decoded
 * sizes.
 */

async function run(cmd: string[], label: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    throw new Error(`${label} failed\n${cmd.join(" ")}\n${out}\n${err}`);
  }
  return out;
}

const dirty = async (dir: string): Promise<Set<string>> =>
  new Set(
    (await run(["git", "status", "--porcelain", "--", dir], "git status"))
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean),
  );

/**
 * What a generator writes must match what is committed.
 *
 * The comparison is before-and-after rather than "this directory is clean":
 * locally the generator's own source is usually the uncommitted thing being
 * worked on, and holding that against it would make the check unusable at the
 * only time it matters. Anything that becomes dirty BECAUSE the generator ran
 * is drift either way.
 */
async function assertNoDrift(dir: string, before: Set<string>): Promise<void> {
  const after = await dirty(dir);
  const fresh = [...after].filter((f) => !before.has(f));
  if (fresh.length > 0) {
    throw new Error(
      `${dir}: the generator did not reproduce its committed sources\n  ${fresh.join("\n  ")}\n` +
        "Either the generator is not deterministic, or the committed output is stale.",
    );
  }
}

// Before any rendering: the coverage claim. `--only` narrows what runs, never
// what must be accounted for, and `--write` re-records rather than admitting a
// composition nobody decided about.
await assertLedgerCoversEveryComposition();

if (!ONLY) {
  const free = await freeGiB(ROOT);
  const already = await strayRgba();
  const held = already.count > 0
    ? `${already.count} .rgba file(s) already in this tree holding ${formatGiB(already.gib)}; `
    : "";
  const need =
    `a full run decodes ${formatGiB(FULL_RUN_NEED_GIB)} of RGBA under dist/ ` +
    `(${FULL_RUN_RGBA_FILES} files, measured ${FULL_RUN_RGBA_MEASURED}), and ` +
    `${formatGiB(FULL_RUN_COMFORTABLE_GIB)} is ${HEADROOM_MULTIPLE}x that`;
  if (free === null) {
    console.warn(
      `digests: ${held}${need}. Free space could not be read, so this is the only ` +
        "warning you get.",
    );
  } else {
    console.log(`digests: ${held}${formatGiB(free)} free — ${need}.`);
    if (free < FULL_RUN_COMFORTABLE_GIB) {
      console.warn(
        `digests: ${
          free < FULL_RUN_NEED_GIB
            ? "that is less than a full run needs"
            : "that fits, but leaves little room beside it"
        }. ffmpeg reports running out as \`No space left on device\` and nothing ` +
          "above it mentions capacity, so if an ingest fails, check here first. The " +
          "decoded bytes are re-derivable from the pinned sources and safe to delete:\n" +
          `  ${RECLAIM_COMMAND}`,
      );
    }
  }
}

const results: Record<string, Record_> = {};
const failures: string[] = [];

for (const dir of ENTRIES) {
  if (ONLY && !dir.includes(ONLY)) continue;

  // Through `src/cli/generators.ts`, which is the one place `bun gen.ts` is
  // spawned: `tests/cli.test.ts` runs the same generators before the image
  // lint sweeps the tree, and a fresh checkout has no `glow.png` until one of
  // the two has run.
  if (generatorPath(ROOT, dir) !== null) {
    const before = await dirty(dir);
    const { ran } = await runGenerator(ROOT, dir);
    if (!ran) {
      throw new Error(
        `${dir}: its generator writes from arguments (${PARAMETERISED[dir]}), so nothing ` +
          "here reproduces its committed sources and a digest would pin whatever the last " +
          "probe left behind. It belongs in EXEMPT, not ENTRIES.",
      );
    }
    await assertNoDrift(dir, before);
  }

  // The build command the CLI would print — faces and density included.
  const resolved = await resolveComposition({
    dir: join(ROOT, dir),
    flags: { json: false },
    requireBundle: false,
  });
  if (!resolved.ok) throw new Error(`${dir}: ${resolved.message}`);
  // Through `runBuild`, which is the one place a build is spawned: it runs the
  // argv `resolveComposition` printed AND writes `build.json` beside the
  // artifacts. Spawning the argv here directly would leave a bundle every
  // command in the loop below then refuses.
  await runBuild(resolved.value);

  // A digest is a claim about the artefact this loop just built. Nothing here
  // holds `dist` exclusively: `preview` rebuilds into the same directory when
  // a source changes under it, and a person can run the build by hand. The
  // race is rare and preventing it would need a lock spanning the whole run —
  // so it is not prevented, it is made impossible to pass silently. The same
  // check also catches a second ledger run, a hand-edited bundle, and the
  // leftovers of a run that did not finish.
  const built = artefactKey(resolved.value);

  const json = await run(
    ["bun", "src/cli/main.ts", "trace", dir, "--json"],
    `${dir} trace`,
  );

  if (artefactKey(resolved.value) !== built) {
    throw new Error(
      `${dir}: the bundle or pak changed while it was being traced, so this ` +
        "digest is not a claim about what this run built. Something else " +
        "wrote dist — a `preview` watching the tree (stop it, or pass " +
        "--no-watch), a second digest run, or a build by hand. Re-run.",
    );
  }

  const trace = JSON.parse(json) as { digest: string; frames: string[] };
  results[dir] = { frames: trace.frames.length, digest: trace.digest };
  console.log(`${dir.padEnd(32)} ${String(trace.frames.length).padStart(5)}f  ${trace.digest}`);
}

if (WRITE) {
  const previous: Ledger | null = existsSync(LEDGER)
    ? (JSON.parse(await Bun.file(LEDGER).text()) as Ledger)
    : null;
  const merged: Record<string, Record_> = { ...(previous?.compositions ?? {}) };
  Object.assign(merged, results);
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  // `bun` is a claim about EVERY entry, so only a full run may restate it. A
  // `--write --only x` re-records one composition and leaves the rest alone;
  // stamping the running Bun over the whole file there would say the other
  // twenty were recorded on it too.
  const bun = ONLY ? previous?.bun : Bun.version;
  await Bun.write(
    LEDGER,
    JSON.stringify(
      { hash: "sha256", ...(bun ? { bun } : {}), compositions: sorted },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nwrote ${LEDGER}${ONLY ? " (bun unchanged — a partial run)" : ""}`);
  process.exit(0);
}

if (!existsSync(LEDGER)) {
  console.error(`\nno ledger at ${LEDGER} — create it with --write`);
  process.exit(1);
}
const ledger = JSON.parse(await Bun.file(LEDGER).text()) as Ledger;
if (ledger.bun === undefined) {
  console.warn(
    "digests: this ledger does not say which Bun recorded it. A full " +
      "`--write` records one.",
  );
} else if (ledger.bun !== Bun.version) {
  console.warn(
    `digests: recorded on Bun ${ledger.bun}; this process is Bun ${Bun.version}. ` +
      "That is the first thing to check if a digest below does not match — it is " +
      "reported rather than refused, because whether they still reproduce is what " +
      "this run measures.",
  );
}
for (const [dir, got] of Object.entries(results)) {
  const want = ledger.compositions[dir];
  if (!want) {
    failures.push(`${dir}: not in the ledger (add it with --write)`);
    continue;
  }
  if (want.digest !== got.digest || want.frames !== got.frames) {
    failures.push(
      `${dir}\n  recorded ${want.frames}f ${want.digest}\n  got      ${got.frames}f ${got.digest}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} composition(s) do not match the ledger:\n`);
  for (const f of failures) console.error(f);
  console.error(
    "\nA mismatch is either a real regression or an intended change. If it is\n" +
      "intended, re-record with `bun scripts/digests.ts --write` in the same\n" +
      "commit as the change that moved it, so the diff shows both.",
  );
  process.exit(1);
}
console.log(`\n${Object.keys(results).length} composition(s) match the ledger.`);

// What this run actually left, against what `src/cli/disk.ts` says a run
// leaves. Only after a FULL run: `--only` decodes a subset and would report a
// need smaller than the real one, which is the direction that matters.
//
// Reported, not failed. A tree part way through adding footage is a normal
// state and a red ledger over disk bookkeeping would be a gate on the wrong
// thing — but the number is a measurement with a date on it, and this is the
// one place that can tell it has stopped being one.
if (!ONLY) {
  const left = await strayRgba();
  const drift = Math.abs(left.gib - FULL_RUN_NEED_GIB);
  if (left.count !== FULL_RUN_RGBA_FILES || drift > FULL_RUN_NEED_GIB * 0.05) {
    console.warn(
      `digests: this run left ${left.count} .rgba file(s) holding ${formatGiB(left.gib)}; ` +
        `src/cli/disk.ts records ${FULL_RUN_RGBA_FILES} files and ` +
        `${formatGiB(FULL_RUN_NEED_GIB)}, measured ${FULL_RUN_RGBA_MEASURED}. ` +
        "Re-measure and update FULL_RUN_RGBA_BYTES in the same commit as whatever moved it.",
    );
  }
}
