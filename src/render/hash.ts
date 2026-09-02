/**
 * The determinism oracle: hashes of raw RGBA frames.
 *
 * Deliberately NOT the MP4's hash. Encoded container bytes drag the ffmpeg
 * build, the libx264 build and container metadata into a claim that is supposed
 * to be about pixels. Upstream's own golden suite shows what that costs — it
 * compares PNG bytes, so all 54 goldens fail across a Bun upgrade while the
 * pixels are byte-identical (pocket-stack/pocketjs#263).
 *
 * Frames are hashed before encoding, so the encoder can never move a hash.
 */

export type FrameHash = string;

/**
 * Which per-frame hash to use.
 *
 * Measured at 1080p on an 8.3 MB frame: SHA-256 costs 2.71 ms and wyhash 0.24 ms,
 * against 1.19 ms to rasterise. For a text-heavy composition the oracle was
 * costing more than twice the renderer, which is the wrong shape for something
 * that runs on every frame of every render.
 *
 * - `"fast"`: wyhash per frame, SHA-256 over the sequence. The digest
 *   stays a cryptographic commitment to the whole render; only the per-frame
 *   step is cheap. A 64-bit hash over even a million frames is far inside the
 *   birthday bound for accidental collision, and this is not an adversarial
 *   setting — nobody is constructing a frame to collide with another.
 * - `"sha256"` (default): per-frame SHA-256.
 *
 * Both are verified equal across darwin/arm64 and linux/x64, and `fast` also
 * across Bun 1.1 through 1.3 — that second axis matters more, because
 * `Bun.hash` is Bun's implementation detail rather than a standard, so a digest
 * recorded today could otherwise disagree with itself after an upgrade
 * (`baselines/hash-portability.md`). Measured at 1.87x end to end on the reel.
 *
 * `sha256` remains the DEFAULT regardless: every digest recorded in
 * `baselines/` is a SHA-256 one, and four Bun versions is evidence rather than
 * a guarantee. Use `--hash fast` when the output is the video; leave the
 * default when the output is the number.
 */
export type HashAlgorithm = "fast" | "sha256";

/** Hash of one RGBA frame, lowercase hex. */
export function hashFrame(rgba: Uint8Array, algorithm: HashAlgorithm = "sha256"): FrameHash {
  if (algorithm === "sha256") {
    return new Bun.CryptoHasher("sha256").update(rgba).digest("hex");
  }
  return Bun.hash(rgba).toString(16).padStart(16, "0");
}

/**
 * Rolling hash over a whole sequence: each frame's hash is fed into a running
 * digest, so a single number identifies the entire render. Frame order is part
 * of the identity — swapping two frames changes it.
 */
export class FrameHashSequence {
  #hashes: FrameHash[] = [];
  #rolling = new Bun.CryptoHasher("sha256");
  readonly algorithm: HashAlgorithm;

  constructor(algorithm: HashAlgorithm = "sha256") {
    this.algorithm = algorithm;
  }

  push(rgba: Uint8Array): FrameHash {
    return this.pushHash(hashFrame(rgba, this.algorithm));
  }

  /** Append an already-computed hash — the parallel driver stitches worker output. */
  pushHash(h: FrameHash): FrameHash {
    this.#hashes.push(h);
    this.#rolling.update(h);
    return h;
  }

  get frames(): readonly FrameHash[] {
    return this.#hashes;
  }

  /** Identity of the whole sequence. */
  digest(): FrameHash {
    return new Bun.CryptoHasher("sha256")
      .update(this.#hashes.join("\n"))
      .digest("hex");
  }

  /** First index where two sequences differ, or -1 when identical. */
  static firstDivergence(
    a: readonly FrameHash[],
    b: readonly FrameHash[],
  ): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : n;
  }
}
