/**
 * Input identity — the three claims `baselines/phase1-2-acceptance.md` made,
 * now executed, plus one assertion per `DELIBERATELY_ABSENT` entry.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalise, parseSidecar } from "../src/manifest/sidecar.ts";
import {
  computeIdentity,
  DELIBERATELY_ABSENT,
  identityProjection,
  sidecarCanonicalOf,
  type IdentityInputs,
} from "../src/render/identity.ts";
import {
  currentBuildRecord,
  type BuildRecord,
} from "../src/render/build-record.ts";

/** A record of the shape `build.json` holds, with nothing read off disk. */
function record(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    bun: "1.3.11",
    upstream: "e0b37e2",
    patches: [
      { file: "0001-dynamic-font-slots.patch", sha256: "aa".repeat(32) },
      { file: "0007-debug-hide-node.patch", sha256: "bb".repeat(32) },
    ],
    argv: [
      "bun",
      "vendor/pocketjs/tools/build.ts",
      "compositions/smoke/main.tsx",
      "--outdir=dist/compositions/smoke",
      "--framework=solid",
      "--hz=60",
    ],
    ...overrides,
  };
}

const TMP = "/tmp/pocketjs-motion-identity-test";
const BUNDLE = join(TMP, "bundle.js");
const PAK = join(TMP, "main.pak");
const FONT_REGULAR = join(TMP, "Regular.ttf");
const FONT_BOLD = join(TMP, "Bold.ttf");

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(BUNDLE, "/* guest bundle */\n");
  writeFileSync(PAK, "pak-bytes");
  writeFileSync(FONT_REGULAR, "font-regular");
  writeFileSync(FONT_BOLD, "font-bold");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function inputs(overrides: Partial<IdentityInputs> = {}): IdentityInputs {
  return {
    bundlePath: BUNDLE,
    pakPath: PAK,
    buildRecord: record(),
    width: 1920,
    height: 1080,
    fps: 30,
    durationFrames: 90,
    renderScale: 1,
    rasterDensity: 1,
    ...overrides,
  };
}

const SILENT_SIDECAR = {
  motion: 1 as const,
  durationFrames: 90,
  fps: 30,
  supersample: 1,
  footage: [] as const,
};

describe("computeIdentity — the acceptance record, executed", () => {
  test("changing the viewport changes the digest", async () => {
    const a = await computeIdentity(inputs({ width: 1920, height: 1080 }));
    const b = await computeIdentity(inputs({ width: 1080, height: 1920 }));
    expect(a.digest).not.toBe(b.digest);
    expect(a.components.params).not.toBe(b.components.params);
  });

  test("adding a footage artifact changes the digest", async () => {
    const a = await computeIdentity(inputs());
    const b = await computeIdentity(
      inputs({ footageHashes: { "a-roll": "ab".repeat(32) } }),
    );
    expect(a.digest).not.toBe(b.digest);
    expect(a.components["footage:a-roll"]).toBeUndefined();
    expect(b.components["footage:a-roll"]).toBe("ab".repeat(32));
  });

  test("recomputation over identical inputs is stable", async () => {
    const once = inputs({
      sidecarCanonical: sidecarCanonicalOf(SILENT_SIDECAR),
      fontPaths: [FONT_REGULAR, FONT_BOLD],
      footageHashes: { "a-roll": "cd".repeat(32) },
    });
    const a = await computeIdentity(once);
    const b = await computeIdentity(once);
    expect(a).toEqual(b);
  });
});

describe("computeIdentity — shape", () => {
  test("component keys are sorted and the digest does not depend on insertion order", async () => {
    const a = await computeIdentity(
      inputs({
        fontPaths: [FONT_REGULAR, FONT_BOLD],
        footageHashes: { "a-roll": "aa".repeat(32), "b-roll": "bb".repeat(32) },
      }),
    );
    const b = await computeIdentity(
      inputs({
        fontPaths: [FONT_BOLD, FONT_REGULAR],
        footageHashes: { "b-roll": "bb".repeat(32), "a-roll": "aa".repeat(32) },
      }),
    );
    expect(a.digest).toBe(b.digest);
    const keys = Object.keys(a.components);
    expect(keys).toEqual([...keys].sort());
    expect(Object.keys(b.components)).toEqual(keys);
  });

  test("the toolchain is an input — the RECORDED one, in all four parts", async () => {
    // Not `Bun.version` read out of this process: the component hashes
    // `build.json`, so a bundle baked by another Bun, against another
    // upstream commit, with a patch whose content moved, or with different
    // build flags is a different input. Each of the four is varied on its own
    // — a single case would pass on a component that hashed only one field.
    const base = await computeIdentity(inputs());
    const varied: Array<[string, BuildRecord]> = [
      ["bun", record({ bun: "1.2.0" })],
      ["upstream", record({ upstream: "0000000" })],
      [
        "patches",
        record({
          patches: [
            { file: "0001-dynamic-font-slots.patch", sha256: "aa".repeat(32) },
            { file: "0007-debug-hide-node.patch", sha256: "cc".repeat(32) },
          ],
        }),
      ],
      [
        "argv",
        record({
          argv: [
            "bun",
            "vendor/pocketjs/tools/build.ts",
            "compositions/smoke/main.tsx",
            "--outdir=dist/compositions/smoke",
            "--framework=solid",
            "--hz=30",
          ],
        }),
      ],
    ];
    expect(base.components.toolchain).toBeDefined();
    for (const [what, buildRecord] of varied) {
      const other = await computeIdentity(inputs({ buildRecord }));
      expect(other.components.toolchain, what).not.toBe(base.components.toolchain);
      expect(other.digest, what).not.toBe(base.digest);
    }
    // …and the same record twice is the same component.
    expect((await computeIdentity(inputs({ buildRecord: record() }))).components.toolchain).toBe(
      base.components.toolchain,
    );
  });
});

describe("identityProjection", () => {
  test("two sidecars that differ only in a sound block produce the same identity", async () => {
    const withSound = {
      ...SILENT_SIDECAR,
      sound: { bed: "assets/audio/silent-descent.mp3", gainDb: -6 },
    };
    expect("sound" in identityProjection(withSound)).toBe(false);
    expect(identityProjection(withSound)).toEqual(identityProjection(SILENT_SIDECAR));
    expect(sidecarCanonicalOf(withSound)).toBe(sidecarCanonicalOf(SILENT_SIDECAR));
    expect(sidecarCanonicalOf(withSound)).toBe(canonicalise(identityProjection(SILENT_SIDECAR)));

    const a = await computeIdentity(
      inputs({ sidecarCanonical: sidecarCanonicalOf(SILENT_SIDECAR) }),
    );
    const b = await computeIdentity(
      inputs({ sidecarCanonical: sidecarCanonicalOf(withSound) }),
    );
    expect(a.digest).toBe(b.digest);
    expect(a.components.sidecar).toBe(b.components.sidecar);
  });

  test("a sound block parsed through parseSidecar is dropped by sidecarCanonicalOf", async () => {
    const silent = parseSidecar(SILENT_SIDECAR);
    const withSound = parseSidecar({
      ...SILENT_SIDECAR,
      sound: {
        bed: { src: "assets/audio/silent-descent.mp3", gain: 0.5 },
        narration: [
          { id: "vo-1", src: "assets/audio/silent-descent.mp3", startFrame: 0, duck: 0.2 },
        ],
        cues: [{ id: "hit-1", src: "assets/audio/sfx/whoosh.mp3", atFrame: 12 }],
      },
    });
    expect(silent.ok).toBe(true);
    expect(withSound.ok).toBe(true);
    if (!silent.ok || !withSound.ok) throw new Error("unreachable");

    expect(silent.value.sound.narration).toEqual([]);
    expect(withSound.value.sound.bed?.src).toBe("assets/audio/silent-descent.mp3");
    expect("sound" in identityProjection(silent.value)).toBe(false);
    expect("sound" in identityProjection(withSound.value)).toBe(false);
    expect(sidecarCanonicalOf(silent.value)).toBe(sidecarCanonicalOf(withSound.value));
    expect(sidecarCanonicalOf(silent.value)).toBe(sidecarCanonicalOf(SILENT_SIDECAR));

    const a = await computeIdentity(
      inputs({ sidecarCanonical: sidecarCanonicalOf(silent.value) }),
    );
    const b = await computeIdentity(
      inputs({ sidecarCanonical: sidecarCanonicalOf(withSound.value) }),
    );
    expect(a.digest).toBe(b.digest);
    expect(a.components.sidecar).toBe(b.components.sidecar);
  });

  /**
   * `layoutAllow` is the second key the projection drops, and it is dropped for
   * a reason the parser makes sharper than `sound`'s: defaults are MATERIALISED,
   * so the key appears in every parsed sidecar in this tree whether the file
   * carries it or not. Left in, adding the schema would have moved the identity
   * of every composition here while moving no pixel of any of them.
   */
  test("two sidecars that differ only in layoutAllow or assertions produce the same identity", async () => {
    const plain = parseSidecar(SILENT_SIDECAR);
    const excused = parseSidecar({
      ...SILENT_SIDECAR,
      layoutAllow: [
        { node: "caption", allow: "overlap", reason: "the lower third sits over it on purpose" },
      ],
      assertions: [{ node: "caption", inPicture: [0, 5] }],
    });
    expect(plain.ok).toBe(true);
    expect(excused.ok).toBe(true);
    if (!plain.ok || !excused.ok) throw new Error("unreachable");

    expect(plain.value.layoutAllow).toEqual([]);
    expect(excused.value.layoutAllow.length).toBe(1);
    expect(excused.value.assertions.length).toBe(1);
    for (const key of ["layoutAllow", "assertions"]) {
      expect(key in identityProjection(plain.value)).toBe(false);
      expect(key in identityProjection(excused.value)).toBe(false);
    }
    expect(sidecarCanonicalOf(plain.value)).toBe(sidecarCanonicalOf(excused.value));

    const a = await computeIdentity(
      inputs({ sidecarCanonical: sidecarCanonicalOf(plain.value) }),
    );
    const b = await computeIdentity(
      inputs({ sidecarCanonical: sidecarCanonicalOf(excused.value) }),
    );
    expect(a.digest).toBe(b.digest);
    expect(a.components.sidecar).toBe(b.components.sidecar);
  });
});

/**
 * Omissions that cannot be varied inside `computeIdentity` without asserting
 * something weaker than the claim (e.g. "the function does not read Date").
 * Each skip names the reason; adding an omission without a reason or a
 * simulation fails the inventory test below.
 */
const SIMULATED = new Set([
  "sound",
  "`layoutAllow` and `assertions`",
  "where the checkout sits on disk",
  "when the build ran",
]);

const UNSIMULABLE: Record<string, string> = {
  "the ffmpeg build":
    "ffmpeg is not on the render path; identity hashes the frozen artifact, not the decoder that produced it",
  "the wall clock":
    "identity does not read the clock; the claim is enforced by the guest realm's poison, not by this hash",
  "the locale":
    "identity does not read the locale; the claim is enforced by the guest realm's poison, not by this hash",
  "the machine's installed fonts":
    "identity hashes only the paths it is given; a system face the build never opened cannot be introduced here",
};

describe("shutter — an input, and only where it is declared", () => {
  // A shutter moves pixels (patches/0034), so unlike `sound` it is NOT dropped
  // by the projection; and unlike `supersample` the parser fills in no
  // default, so a composition that declares none hashes as it did before the
  // key existed.
  const base = { motion: 1, durationFrames: 30, fps: 30 };
  const parsed = (input: object) => {
    const r = parseSidecar(input);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    return r.value;
  };

  test("two sidecars that differ only in the shutter have two identities", async () => {
    const eight = parsed({ ...base, shutter: { angle: 180, samples: 8 } });
    const four = parsed({ ...base, shutter: { angle: 180, samples: 4 } });
    const wide = parsed({ ...base, shutter: { angle: 360, samples: 8 } });
    const none = parsed(base);
    const ids = await Promise.all(
      [eight, four, wide, none].map((s) => computeIdentity(inputs({ sidecarCanonical: sidecarCanonicalOf(s) }))),
    );
    expect(new Set(ids.map((i) => i.components.sidecar)).size).toBe(4);
    expect(new Set(ids.map((i) => i.digest)).size).toBe(4);
  });

  test("a sidecar without the key carries no shutter, so its identity did not move", () => {
    const none = parsed(base);
    expect("shutter" in none).toBe(false);
    expect(sidecarCanonicalOf(none)).not.toContain("shutter");
    expect(sidecarCanonicalOf(none)).toBe(
      canonicalise(identityProjection({ ...none })),
    );
  });
});

describe("build.json — the two omissions it makes on purpose", () => {
  test("the argv is recorded repo-relative, so the checkout's location is not an input", async () => {
    const ROOT = resolve(import.meta.dir, "..");
    const written = await currentBuildRecord([
      "bun",
      join(ROOT, "vendor/pocketjs/tools/build.ts"),
      join(ROOT, "compositions/smoke/main.tsx"),
      `--outdir=${join(ROOT, "dist/compositions/smoke")}`,
      "--framework=solid",
      "--hz=60",
    ]);
    expect(written.argv).toEqual([
      "bun",
      "vendor/pocketjs/tools/build.ts",
      "compositions/smoke/main.tsx",
      "--outdir=dist/compositions/smoke",
      "--framework=solid",
      "--hz=60",
    ]);
    expect(written.argv.join(" ")).not.toContain(ROOT);
  });

  test("no timestamp: two records of the same build are the same bytes", async () => {
    const argv = ["bun", "tools/build.ts", "--outdir=dist/x"];
    const a = await currentBuildRecord(argv);
    await Bun.sleep(5);
    const b = await currentBuildRecord(argv);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a).sort()).toEqual(["argv", "bun", "patches", "upstream"]);
  });
});

describe("DELIBERATELY_ABSENT", () => {
  test("every omission is either simulated or skipped with a reason", () => {
    const simulated = SIMULATED;
    const missing: string[] = [];
    for (const entry of DELIBERATELY_ABSENT) {
      if (simulated.has(entry.what)) continue;
      if (UNSIMULABLE[entry.what] === undefined) {
        missing.push(entry.what);
      }
    }
    expect(missing, `no skip reason for: ${missing.join(", ")}`).toEqual([]);
  });

  for (const entry of DELIBERATELY_ABSENT) {
    if (SIMULATED.has(entry.what)) continue;
    const reason = UNSIMULABLE[entry.what] ?? "no reason recorded";
    test.skip(`${entry.what} cannot be simulated in-process: ${reason}`, () => {
      // The inventory test above fails if this skip has no reason.
    });
  }
});
