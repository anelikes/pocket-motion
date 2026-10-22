# syntax=docker/dockerfile:1
#
# The digest ledger, reproduced on a machine that is not the author's.
#
#   docker run --rm $(docker build -q https://github.com/anelikes/pocket-motion.git)
#
# builds this repository from nothing — upstream fetched at the pin, patches/
# applied, the wasm core compiled, the pinned faces fetched by sha256 — and
# runs `bun scripts/digests.ts`, which rebuilds every composition in the ledger
# and compares its frame digest with baselines/digests.json. Exit 0 is every
# digest reproduced; exit 1 names the compositions that did not.
#
# It is the CI workflow's job (.github/workflows/determinism.yml) as an image,
# so a reader without a GitHub runner can check the claim on their own
# machine. The pins are the workflow's, and tests/docker.test.ts holds them
# equal, because an image that drifted from the workflow would be reproducing
# a different claim:
#
# - Linux on x86-64. The ffmpeg below is an x86-64 build and the ledger was
#   recorded on macOS/ARM, so a green run here is a cross-architecture
#   reproduction, the same one CI makes. On an ARM host Docker runs this
#   under emulation: slower, and the same bytes.
# - Bun 1.3.11, by image digest. Bun has moved pixels with the tracked source
#   held fixed (src/render/identity.ts), and the ledger records the Bun it was
#   taken on.
# - ffmpeg: the BtbN n8.0 autobuild of 2025-09-30, by sha256. The decoder
#   writes the frozen footage artifacts two ledger compositions draw, so its
#   build is an input to their digests; the workflow says at length why this
#   build and not a package index's.
# - Rust 1.97.1, the toolchain CHANGELOG.md records the v0.5.0 core was built
#   with. The workflow takes rustup's stable; pinning it here is stricter.
#
# NOT PINNED, and on no path that produces a frame: the Debian packages (git
# clones, curl fetches, gcc links cargo's host-side build scripts — the wasm
# itself is linked by rust-lld), and the rustup installer script, which
# installs the pinned toolchain above.
#
# NOT FETCHED: the Mixkit audio under assets/audio. The ledger hashes frames
# and the frame hash never opens an audio file, so `--kind fonts,synthetic`
# fetches and verifies only what a frame can depend on, and an image pushed
# somewhere carries no third-party audio with it.

FROM --platform=linux/amd64 oven/bun:1.3.11@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

ARG FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2025-09-30-13-19/ffmpeg-n8.0-16-gd8605a6b55-linux64-gpl-8.0.tar.xz
ARG FFMPEG_SHA256=cea7c0845fb8ac78b06f94cdd7282d3e7ddb960e20d91d5c07cd9b43f3a04504
RUN curl -fsSL --retry 5 --retry-all-errors --connect-timeout 30 --speed-limit 50000 --speed-time 60 \
      -o /tmp/ffmpeg.tar.xz "$FFMPEG_URL" \
 && echo "$FFMPEG_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/ffmpeg \
 && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 \
 && rm /tmp/ffmpeg.tar.xz \
 && test -x /opt/ffmpeg/bin/ffmpeg && test -x /opt/ffmpeg/bin/ffprobe
ENV PATH=/opt/ffmpeg/bin:$PATH

ARG RUST_TOOLCHAIN=1.97.1
RUN curl --proto '=https' --tlsv1.2 -sSf --retry 5 --connect-timeout 30 --speed-limit 50000 --speed-time 60 https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain "$RUST_TOOLCHAIN" --target wasm32-unknown-unknown
ENV PATH=/root/.cargo/bin:$PATH

WORKDIR /pocket-motion

# The network-bound layers come before the source, so editing a file does not
# re-download any of them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Upstream at the pin, fetched shallow: the one commit `scripts/vendor.ts`
# would check out, rather than the repository's whole history. The script
# reuses a tree that is already there, checks the pin out itself, applies
# patches/ and builds the wasm, so what it produces is the same; this only
# makes the transfer one tree instead of every commit. Measured on a slow
# link: the full clone over HTTP/2 failed at 707 s with `curl 92 ... stream
# was not closed cleanly`, so the fetch is HTTP/1.1 and retried.
# tests/docker.test.ts holds POCKETJS_COMMIT to `UPSTREAM.commit`.
ARG POCKETJS_REPO=https://github.com/pocket-stack/pocketjs.git
ARG POCKETJS_COMMIT=e0b37e20dbfaeb10a4fa2aac6564c75023afe53e
RUN git config --global http.version HTTP/1.1 \
 && for attempt in 1 2 3 4 5; do \
      rm -rf vendor/pocketjs && git init -q vendor/pocketjs \
      && git -C vendor/pocketjs fetch -q --depth 1 "$POCKETJS_REPO" "$POCKETJS_COMMIT" \
      && git -C vendor/pocketjs checkout -q FETCH_HEAD && break; \
      echo "fetch attempt $attempt failed"; sleep 15; \
    done \
 && test "$(git -C vendor/pocketjs rev-parse HEAD)" = "$POCKETJS_COMMIT" \
 && cd vendor/pocketjs && bun install --frozen-lockfile

COPY . .

# Composition discovery asks git (`src/cli/discover.ts`: tracked and untracked
# files minus .gitignore), and a build context carries no .git. An empty
# repository is enough for `ls-files --others --exclude-standard`.
RUN git init -q

RUN bun run vendor
RUN bun scripts/assets.ts --kind fonts,synthetic

CMD ["bun", "scripts/digests.ts"]
