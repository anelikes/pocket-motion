/**
 * HTTP surface over PreviewSession. The browser is a display.
 *
 *   GET /              frame debugger
 *   GET /watch         normal player (time, fullscreen, speed, volume)
 *   GET /meta          duration, viewport, fps
 *   GET /frame?at      PNG of that frame (same encoder as `frame`)
 *   GET /layout?at     layout JSON (same inspectLayout as `layout`)
 *   GET /movie/status  encode progress for `/watch`
 *   GET /movie         the MP4 `/watch` plays
 *   GET /compositions  what the rail lists, from the shared discovery rule
 *   GET /events        server-sent events: building, reloaded, error
 *   POST /select       point this host at another composition
 */

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { discoverCompositions, type CompositionCatalog } from "../cli/discover.ts";
import { runBuild } from "../cli/build.ts";
import { errMsg, resolveComposition, type ResolvedComposition } from "../cli/resolve.ts";
import type { GlobalFlags } from "../cli/types.ts";
import { MovieJob } from "./movie.ts";
import { artefactDigest, artefactKey, watchSources, type SourceWatch } from "./reload.ts";
import { previewPage } from "./page.ts";
import { playerPage } from "./player.ts";
import {
  PreviewRangeError,
  PreviewSession,
  previewErrorMessage,
  type PreviewMeta,
} from "./session.ts";

export interface ListenPreviewOptions {
  readonly composition: ResolvedComposition;
  /**
   * The flags this session was opened with. Every re-resolve reuses them, so
   * a hot reload and a rail selection see the composition the person asked
   * for rather than a defaulted one — `--bundle`, `--pak`, `--frames`,
   * `--fps`, `--width`, `--height`, `--supersample` and the staging `--spec`
   * puts behind `--bundle` were all dropped on the way through. Default is
   * the same empty set the resolver used to be handed.
   */
  readonly flags?: GlobalFlags;
  readonly port?: number;
  readonly hostname?: string;
  readonly checkpointInterval?: number;
  /** Rebuild and reopen when the composition tree changes. Default true. */
  readonly watch?: boolean;
  /**
   * Bun's per-request deadline, in seconds. Default 255, its maximum. Every
   * route lifts it per-request; a test sets this small to prove that.
   */
  readonly idleTimeout?: number;
}

/**
 * The flags a re-resolve of a DIFFERENT composition may keep.
 *
 * `--bundle` and `--pak` name files, and the files they name belong to the
 * composition they were given for. Carried across a `/select` they would boot
 * one film's bundle under another film's name, which is the mixup
 * `src/cli/resolve.ts` already had to fix once for dist directories. The rest
 * are render parameters the person set for this session, and the session is
 * what `/select` keeps.
 */
export function flagsForAnotherComposition(flags: GlobalFlags): GlobalFlags {
  const { bundle: _bundle, pak: _pak, ...rest } = flags;
  return rest;
}

export interface SwitchQueue {
  /** Run `fn` after every switch queued before it, and before any queued after. */
  withSwitch<T>(fn: () => Promise<T>): Promise<T>;
  /** Where a read parks: every switch queued so far, and no more. */
  settled(): Promise<void>;
}

/**
 * Serialise the swaps. A QUEUE, not a slot.
 *
 * The gate used to be a nullable `switching` that every waiter spun on, and
 * `await settled()` yields even when there is nothing to wait for — so two
 * callers could both find the slot empty in the same tick, both take it, and
 * the second overwrite the first. A hot reload and a `/select` then ran
 * concurrently over one wasm world, each opening a session and each closing
 * the one it had captured before starting, so one live world was left with
 * nothing pointing at it — a whole leaked wasm heap per switch. `stop()` was
 * bypassed the same way: it waited on whichever promise was stored last.
 *
 * This is the shape `PreviewSession.runExclusive` already uses to serialise
 * seeks, for the same reason and over the same world.
 */
export function makeSwitchQueue(): SwitchQueue {
  let switching: Promise<void> = Promise.resolve();
  return {
    withSwitch<T>(fn: () => Promise<T>): Promise<T> {
      const next = switching.then(fn, fn);
      switching = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    settled(): Promise<void> {
      return switching;
    },
  };
}

/**
 * Closes nobody is waiting for: an evicted viewing copy, an encode dropped by
 * switching away from the composition it was rendering.
 *
 * Two things go wrong when that is written `void job.close()`. A rejection has
 * nobody attached to it — an `EACCES` unlinking the temp directory ends the
 * whole preview process on an unhandled rejection, over a cache entry nobody
 * asked about. And `stop()` cannot wait for it: `MovieJob.close()` is bounded
 * by one frame except during a footage ingest, which has no per-frame hook, so
 * Ctrl-C returned while that ingest's ffmpeg was still running and left it an
 * orphan.
 */
export class PendingCloses {
  readonly #pending = new Set<Promise<void>>();
  readonly #report: (message: string) => void;

  constructor(report: (message: string) => void) {
    this.#report = report;
  }

  /** Start `close` now; report a failure rather than throwing it at nobody. */
  add(what: string, close: () => Promise<void>): void {
    const done = (async () => {
      try {
        await close();
      } catch (e) {
        this.#report(`${what} did not close: ${errMsg(e)}`);
      }
    })();
    this.#pending.add(done);
    void done.finally(() => this.#pending.delete(done));
  }

  /** Every close started so far, including any started while this waits. */
  async settle(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.all([...this.#pending]);
    }
  }
}

export interface PreviewHost {
  readonly url: string;
  readonly port: number;
  readonly hostname: string;
  readonly meta: PreviewMeta;
  /** True when a source change rebuilds and reopens without a restart. */
  readonly watching: boolean;
  readonly closed: Promise<void>;
  stop(): Promise<void>;
}

export async function listenPreview(
  options: ListenPreviewOptions,
): Promise<PreviewHost> {
  let composition = options.composition;
  const sessionFlags: GlobalFlags = options.flags ?? { json: false };
  const otherFlags = flagsForAnotherComposition(sessionFlags);
  let session = await PreviewSession.open(composition, {
    checkpointInterval: options.checkpointInterval,
  });
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 0;

  // One session at a time. A FootageLayer holding a whole decoded track was
  // ~13 GiB resident for one composition, so two live footage compositions is
  // that twice over: selecting another one closes this one rather than
  // joining it. A request
  // that arrives mid-switch waits for the new session instead of reading a
  // closed one.
  const { withSwitch, settled } = makeSwitchQueue();

  // Closes nobody is waiting for — an evicted viewing copy, an encode
  // cancelled by switching away. `stop()` waits for them.
  const closes = new PendingCloses((message) => {
    console.warn(`preview: ${message}`);
  });

  // Viewing copies, keyed by what they were rendered from. Switching away and
  // back used to re-render the whole film — 450 frames of compositions/smoke
  // is 2.4s and 1071 of compositions/reel is about 6s, and effectively all of
  // it is the render: the mux is under a tenth of a second. Keeping the file means the
  // second visit costs nothing, which is the point of having a rail at all.
  // An entry whose artefacts have moved is dropped rather than shown.
  const MOVIE_CACHE = 4;
  const movies = new Map<string, MovieJob>();
  let movie = movieFor(composition);
  let generation = 0;

  function movieFor(c: ResolvedComposition): MovieJob {
    const key = artefactKey(c);
    const hit = movies.get(key);
    if (hit) {
      movies.delete(key);
      movies.set(key, hit);
      return hit;
    }
    const job = new MovieJob(c);
    movies.set(key, job);
    for (const [k, v] of movies) {
      if (movies.size <= MOVIE_CACHE) break;
      if (k === key) continue;
      movies.delete(k);
      closes.add("a viewing copy pushed out of the cache", () => v.close());
    }
    return job;
  }

  /** Drop cached copies of this composition rendered from older artefacts. */
  function dropStale(c: ResolvedComposition): void {
    const keep = artefactKey(c);
    for (const [k, v] of [...movies]) {
      if (k !== keep && k.startsWith(`${c.dir}|`)) {
        movies.delete(k);
        closes.add("a viewing copy of artefacts that moved", () => v.close());
      }
    }
  }

  // Server-sent events. A page learns that the picture moved from the host
  // that moved it, rather than by being reloaded by hand — which is the state
  // this whole branch started in.
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  function broadcast(event: Record<string, unknown>): void {
    const line = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const c of [...clients]) {
      try {
        c.enqueue(line);
      } catch {
        clients.delete(c);
      }
    }
  }

  const heartbeat = setInterval(() => {
    const ping = encoder.encode(": ping\n\n");
    for (const c of [...clients]) {
      try {
        c.enqueue(ping);
      } catch {
        clients.delete(c);
      }
    }
  }, 20_000);

  /**
   * Point this host at `next`, and tell both pages. The one place a session
   * is swapped — a hot reload and a rail selection are the same act on two
   * different reasons, and they were two copies of this sequence that had
   * already drifted: only one of them dropped stale viewing copies, only one
   * bumped the generation, and only one broadcast anything at all.
   *
   * Runs inside `withSwitch` and nowhere else.
   *
   * The old session closes BEFORE the new one opens. Every read is parked on
   * the gate for the whole of it, so nothing observes the gap, and one
   * `FootageLayer` has been measured holding ~13 GiB resident, so two live
   * sessions over footage is that twice. Opening first doubled it for the
   * length of a boot. If the new
   * session will not open, the old composition is booted back rather than
   * leaving every read on a disposed world.
   */
  async function swapTo(next: ResolvedComposition): Promise<void> {
    const previous = composition;
    const outgoing = movie;

    // A running encode for a film nobody is going to watch is a whole film's
    // worth of work spent on a file nothing will read. A FINISHED copy stays
    // in the cache — that is what the cache is for, and what makes switching
    // back free — but a running one is dropped, which is also what keeps the
    // number of encodes in flight at one: only the current composition's job
    // is ever asked to `ensure()`.
    if (outgoing.status().phase === "running") {
      for (const [k, v] of movies) {
        if (v === outgoing) {
          movies.delete(k);
          break;
        }
      }
      closes.add("the encode of the composition switched away from", () => outgoing.close());
    }

    await session.close();
    try {
      session = await PreviewSession.open(next, {
        checkpointInterval: options.checkpointInterval,
      });
    } catch (e) {
      session = await PreviewSession.open(previous, {
        checkpointInterval: options.checkpointInterval,
      });
      throw e;
    }
    composition = next;
    dropStale(next);
    movie = movieFor(next);
    generation += 1;
    broadcast({
      type: "reloaded",
      generation,
      current: await currentPath(),
      ...session.meta,
    });
  }

  /**
   * Rebuild the current composition and reopen the session on the result.
   *
   * The build is the one `resolveComposition` prints — the same argv the
   * digest ledger runs — so a hot reload cannot produce an artefact no other
   * command would. When the rebuild leaves the bundle and pak where they
   * were, the session is left alone: the tree is watched whole, so an edit to
   * a composition nobody is looking at must not cost a boot.
   *
   * The build runs OUTSIDE the switch gate. Every read route parks on that
   * gate, so holding it across a compile made the page answer nothing for the
   * whole of it — seconds, on any composition worth previewing. Only the swap
   * needs to be exclusive.
   */
  async function reload(): Promise<void> {
    const target = composition;
    try {
      broadcast({ type: "building", current: target.dir });
      // The bytes, before the build overwrites them. Not their mtime: the
      // build rewrites both files unconditionally, so mtime answers "this
      // moved" to every save anywhere under the watched tree and every one of
      // them cost a teardown, a boot and a re-encode of the whole film.
      const before = await artefactDigest(target);
      await runBuild(target);
      const resolved = await resolveComposition({
        dir: target.dir,
        flags: sessionFlags,
      });
      if (!resolved.ok) throw new Error(resolved.message);
      await withSwitch(async () => {
        // Somebody picked another composition while this was compiling. The
        // build was still worth doing; reopening on it is not.
        if (composition !== target) return;
        if ((await artefactDigest(resolved.value)) === before) {
          // Nothing moved, so nothing reopens — but the page said
          // `rebuilding…` and needs to be told the build is over, or the pill
          // sits there until the next edit.
          broadcast({ type: "unchanged", generation, current: await currentPath() });
          return;
        }
        await swapTo(resolved.value);
      });
    } catch (e) {
      broadcast({ type: "error", message: errMsg(e) });
    }
  }

  // A save that lands during a build is queued, not dropped. Dropping it left
  // the page saying `reloaded` over the source from BEFORE that save — and a
  // rebuild is exactly when a second save is likely, because the first one is
  // what the person is waiting on.
  let reloading: Promise<void> | null = null;
  let reloadQueued = false;
  function requestReload(): void {
    if (reloading) {
      reloadQueued = true;
      return;
    }
    reloading = reload().finally(() => {
      reloading = null;
      if (reloadQueued) {
        reloadQueued = false;
        requestReload();
      }
    });
  }

  async function selectComposition(pathArg: string): Promise<string | null> {
    try {
      const catalog = await discoverCompositions(composition.dir);
      const wanted = normaliseSelection(pathArg, catalog);
      if (wanted === null) {
        return `not a composition in this tree: ${pathArg}`;
      }
      const resolved = await resolveComposition({
        dir: join(catalog.root, wanted),
        flags: otherFlags,
      });
      if (!resolved.ok) {
        return resolved.kind === "usage"
          ? resolved.message
          : (resolved.diagnostics ?? [])
              .map((d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`)
              .join("\n") || "invalid pocket-motion.json";
      }
      await withSwitch(() => swapTo(resolved.value));
      return null;
    } catch (e) {
      return errMsg(e);
    }
  }

  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let boundPort = 0;

  const server = Bun.serve({
    hostname,
    port,
    idleTimeout: options.idleTimeout ?? 255,
    async fetch(req, server) {
      const url = new URL(req.url);
      try {
        // No deadline on anything here. `idleTimeout` caps how long a request
        // may go without producing bytes and 255s is its maximum, but almost
        // every route parks on the switch gate first, and a switch to a
        // composition with footage pays a whole ingest before it can answer.
        // Bun cut the connection at 255s, the page kept the meta it already
        // had, and the switch it had asked for completed anyway with nothing
        // left to tell about it. Preview is one person on loopback; a request
        // here waits for the work it asked for.
        server.timeout(req, 0);
        if (!hostAllowed(req, hostname, boundPort)) {
          return json({ ok: false, error: "host not allowed" }, 403);
        }
        if (url.pathname === "/movie/retry") {
          // Encoding again is a state change and costs a whole film, so it is
          // a POST fenced exactly like /select.
          if (req.method !== "POST") {
            return json({ ok: false, error: "POST /movie/retry" }, 405);
          }
          const refusal = refuseSelect(req);
          if (refusal) {
            return json({ ok: false, error: refusal.error }, refusal.status);
          }
          await settled();
          // Started, not awaited: /watch polls /movie/status for progress,
          // and a whole film is minutes.
          void movie.retry().catch(() => {});
          return json({ ok: true, ...movie.status() });
        }
        if (url.pathname === "/select") {
          // The one state change a page can ask for, and the only route that
          // is not a GET. Everything else here reads: /frame seeks a shared
          // world, so a GET that reordered it would be a GET with a side
          // effect. Preview is a single-user local tool bound to loopback
          // unless --bind says otherwise; that premise is what makes one
          // mutable session acceptable at all, and it is stated here rather
          // than assumed.
          if (req.method !== "POST") {
            return json({ ok: false, error: "POST /select" }, 405);
          }
          const refusal = refuseSelect(req);
          if (refusal) {
            return json({ ok: false, error: refusal.error }, refusal.status);
          }
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return json({ ok: false, error: "/select takes JSON" }, 400);
          }
          const wanted =
            typeof body === "object" && body !== null && "path" in body
              ? (body as { path: unknown }).path
              : undefined;
          if (typeof wanted !== "string" || wanted === "") {
            return json({ ok: false, error: "/select takes { path }" }, 400);
          }
          const failure = await selectComposition(wanted);
          if (failure !== null) return json({ ok: false, error: failure }, 400);
          return json({ ok: true, current: await currentPath(), ...session.meta });
        }
        if (req.method !== "GET") {
          return json({ ok: false, error: "GET only" }, 405);
        }
        if (url.pathname === "/compositions") {
          await settled();
          return json({ ok: true, ...(await catalogue()) });
        }
        if (url.pathname === "/events") {
          let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              mine = controller;
              clients.add(controller);
              controller.enqueue(encoder.encode("retry: 1000\n\n"));
            },
            cancel() {
              if (mine) clients.delete(mine);
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-store",
              connection: "keep-alive",
            },
          });
        }
        if (url.pathname === "/") {
          return new Response(previewPage(), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
        if (url.pathname === "/watch") {
          await settled();
          void movie.ensure().catch(() => {});
          return new Response(playerPage(), {
            headers: {
              // Both pages are generated from source on every request. Without
              // this a restarted server still hands Chrome the copy it cached
              // before the edit, and the fix looks like it did nothing.
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
        if (url.pathname === "/movie/status") {
          await settled();
          void movie.ensure().catch(() => {});
          return json({ ok: true, ...movie.status() });
        }
        if (url.pathname === "/movie") {
          await settled();
          try {
            const path = await movie.ensure();
            const file = Bun.file(path);
            const size = file.size;
            const range = parseByteRange(req.headers.get("range"), size);
            if (range === "unsatisfiable") {
              return new Response(null, {
                status: 416,
                headers: {
                  "accept-ranges": "bytes",
                  "content-range": `bytes */${size}`,
                  "cache-control": "no-store",
                },
              });
            }
            if (range !== "none") {
              return new Response(file.slice(range.start, range.end + 1), {
                status: 206,
                headers: {
                  "content-type": "video/mp4",
                  "cache-control": "no-store",
                  "accept-ranges": "bytes",
                  "content-range": `bytes ${range.start}-${range.end}/${size}`,
                },
              });
            }
            return new Response(file, {
              headers: {
                "content-type": "video/mp4",
                "cache-control": "no-store",
                "accept-ranges": "bytes",
              },
            });
          } catch (e) {
            return json({ ok: false, error: previewErrorMessage(e), ...movie.status() }, 500);
          }
        }
        if (url.pathname === "/meta") {
          await settled();
          return json({
            ok: true,
            ...session.meta,
            hasAudio: movie.hasAudio,
            current: await currentPath(),
          });
        }
        if (url.pathname === "/frame") {
          await settled();
          const at = parseAt(url);
          const png = await session.pngAt(at);
          return new Response(png.bytes, {
            headers: {
              "content-type": "image/png",
              "cache-control": "no-store",
              "x-frame-hash": png.hash,
              "x-frame-at": String(png.at),
            },
          });
        }
        if (url.pathname === "/layout") {
          await settled();
          const at = parseAt(url);
          const layout = await session.layoutAt(at);
          return json({ ok: true, ...layout });
        }
        return json({ ok: false, error: `no route ${url.pathname}` }, 404);
      } catch (e) {
        if (e instanceof PreviewRangeError) {
          return json({ ok: false, error: e.message }, 400);
        }
        return json({ ok: false, error: previewErrorMessage(e) }, 500);
      }
    },
  });

  if (server.port === undefined) {
    await session.close();
    server.stop(true);
    throw new Error("PocketJS Motion: preview server bound no port");
  }
  boundPort = server.port;

  let sources: SourceWatch | null = null;
  if (options.watch !== false) {
    try {
      const catalog = await discoverCompositions(composition.dir);
      sources = watchSources({ root: catalog.root, onChange: requestReload });
    } catch {
      sources = null;
    }
  }

  /**
   * Shut the host down, once, and let `closed` resolve whatever happens.
   *
   * `release()` used to sit after four awaits with nothing catching them: one
   * viewing copy that would not delete its temp directory and `closed` never
   * resolved, so `preview`'s `keepAlive` never returned, the process hung on a
   * Ctrl-C that had already stopped the server, and the `--spec` staging
   * directory `keepAlive` disposes was never cleaned up. A second `stop()`
   * returned an already-resolved promise while the first was still mid-flight,
   * so a caller could believe the host was down while an encode was running.
   * Now the first call's promise IS the answer to every later one.
   */
  let stopping: Promise<void> | null = null;
  function stop(): Promise<void> {
    stopping ??= shutDown();
    return stopping;
  }

  async function shutDown(): Promise<void> {
    try {
      sources?.close();
      clearInterval(heartbeat);
      for (const c of [...clients]) {
        try {
          c.close();
        } catch {
          /* already gone */
        }
      }
      clients.clear();
      server.stop(true);
      await settled();
      if (reloading) await reloading.catch(() => {});
      for (const [key, job] of [...movies]) {
        movies.delete(key);
        closes.add("a viewing copy", () => job.close());
      }
      // Including the ones started long before this: an evicted entry's
      // close waits on an ingest it has no per-frame hook to interrupt, and
      // returning ahead of it leaves that ffmpeg an orphan.
      await closes.settle();
      await session.close();
    } catch (e) {
      // `preview` stops from a signal handler that cannot await this, so a
      // rejection here would be the same unobserved rejection `void
      // job.close()` was. The host is down either way; say what did not.
      console.warn(`preview: stopping did not finish cleanly: ${errMsg(e)}`);
    } finally {
      release();
    }
  }

  return {
    url: `http://${hostname}:${boundPort}`,
    port: boundPort,
    hostname,
    get meta() {
      return session.meta;
    },
    get watching() {
      return sources !== null;
    },
    closed,
    stop,
  };

  /** The current composition as the rail names it: relative to the tree. */
  async function currentPath(): Promise<string | null> {
    try {
      const catalog = await discoverCompositions(composition.dir);
      return railPath(catalog.root, composition.dir);
    } catch {
      return null;
    }
  }

  /**
   * What the rail lists. Keyed by PATH, never by compositionId: two pairs in
   * this tree share an id — compositions/malicious with compositions/smoke,
   * and compositions/nested/a/9x16 with compositions/nested/b/9x16 — so a
   * rail keyed by id would offer one row for two different films.
   */
  async function catalogue(): Promise<{
    root: string;
    current: string | null;
    items: Array<{ path: string; id: string | null; ready: boolean; note?: string }>;
  }> {
    const catalog = await discoverCompositions(composition.dir);
    const items = [];
    for (const dir of catalog.dirs) {
      const resolved = await resolveComposition({
        dir: join(catalog.root, dir),
        flags: otherFlags,
        requireBundle: false,
      });
      if (!resolved.ok) {
        items.push({ path: dir, id: null, ready: false, note: railNote(resolved) });
        continue;
      }
      const built = existsSync(resolved.value.bundlePath);
      items.push({
        path: dir,
        id: resolved.value.compositionId,
        ready: built,
        ...(built ? {} : { note: "not built" }),
      });
    }
    return { root: catalog.root, current: railPath(catalog.root, composition.dir), items };
  }
}

/**
 * The name the rail gives a composition: its path below the tree root.
 *
 * Both sides are resolved through the filesystem first. The root comes from
 * `git rev-parse --show-toplevel`, which reports the PHYSICAL path, and the
 * composition's directory comes from `resolve()`, which is purely lexical —
 * so a checkout reached through a symlink subtracted one from the other and
 * got a name starting with `..`. Every rail row is keyed by this string, so
 * the current composition simply never matched one and nothing was
 * highlighted. A path that is genuinely outside the tree is null rather than
 * a `..` chain, because there is no row for it either way.
 */
export function railPath(root: string, dir: string): string | null {
  const rel = relative(realOrLexical(root), realOrLexical(dir));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

function realOrLexical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * A selection is one of the discovered directories, and nothing else. The
 * request names a path, so the answer to "which composition" cannot be a
 * substring match or a join with whatever arrived — an absolute path or one
 * carrying `..` is only accepted when it lands on a directory the rule
 * already found.
 */
export function normaliseSelection(
  wanted: string,
  catalog: CompositionCatalog,
): string | null {
  const listed = new Set(catalog.dirs);
  const direct = wanted.replace(/\/+$/, "");
  if (listed.has(direct)) return direct;
  const abs = isAbsolute(direct) ? direct : resolve(catalog.root, direct);
  const rel = relative(catalog.root, abs);
  return listed.has(rel) ? rel : null;
}

/**
 * One byte range out of a Range header, or why there is none.
 *
 * `<video>` reports a file as not seekable unless the server advertises
 * ranges, whatever it has already buffered: served plain, /movie downloaded
 * whole, `buffered` read [0, duration], `seekable` ended at 0, and every
 * write to currentTime was a no-op — the scrub bar and the arrow keys did
 * nothing on any composition.
 *
 * RFC 9110 says a server ignores a Range it cannot satisfy the syntax of, so
 * an unparseable header is "none" (200 with the whole file) rather than an
 * error. Only a syntactically valid range that falls outside the file is 416.
 * Multiple ranges are legal to answer with the whole file, and a player
 * asking for one is not a case worth a multipart body here.
 */
export type ByteRange = { readonly start: number; readonly end: number };

export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | "none" | "unsatisfiable" {
  if (header === null) return "none";
  const spec = header.trim();
  if (!spec.toLowerCase().startsWith("bytes=")) return "none";
  const set = spec.slice(6).trim();
  if (set === "" || set.includes(",")) return "none";

  const dash = set.indexOf("-");
  if (dash === -1) return "none";
  const rawStart = set.slice(0, dash).trim();
  const rawEnd = set.slice(dash + 1).trim();

  if (rawStart === "") {
    // bytes=-N — the last N bytes.
    if (!/^\d+$/.test(rawEnd)) return "none";
    const want = Number(rawEnd);
    if (want === 0 || size === 0) return "unsatisfiable";
    const start = Math.max(0, size - want);
    return { start, end: size - 1 };
  }

  if (!/^\d+$/.test(rawStart)) return "none";
  const start = Number(rawStart);
  if (start >= size) return "unsatisfiable";

  if (rawEnd === "") return { start, end: size - 1 };
  if (!/^\d+$/.test(rawEnd)) return "none";
  // RFC 9110 §14.1.1: a last-byte-pos present and less than the first-byte-pos
  // makes the byte-range-spec INVALID, and an invalid spec is ignored — the
  // whole file, 200. 416 is for a spec that is well formed and lands outside
  // the representation, which `bytes=1000-` on a 1000-byte file is and
  // `bytes=50-40` is not.
  if (Number(rawEnd) < start) return "none";
  return { start, end: Math.min(Number(rawEnd), size - 1) };
}

/**
 * What the rail says about a composition it could not resolve.
 *
 * Every failure was labelled "no sidecar", and that is true of exactly one of
 * them. A `pocket-motion.json` with a typo in it — the case the sidecar's
 * diagnostics exist for, each one naming the key and why — was reported as an
 * ABSENT FILE: the row was disabled, its tooltip said the file was missing,
 * and the file was right there with a message nothing would show. The
 * diagnostic that says `fonts` is not `font` is the one this project already
 * had to fix once for being unreachable (CAPABILITIES.md gate G5).
 *
 * One line, because it is a row in a list and a tooltip. The rest of the
 * diagnostics are counted rather than joined.
 */
export function railNote(failure: {
  readonly kind: "usage" | "sidecar";
  readonly message: string;
  readonly diagnostics?: readonly { path: string; code: string; message: string }[];
}): string {
  if (failure.kind === "usage") {
    // The one case the old label described. Anything else — an unreadable
    // file, a directory that went away — says what it actually was.
    return /^missing pocket-motion\.json/.test(failure.message)
      ? "no sidecar"
      : failure.message.split("\n")[0]!;
  }
  const diagnostics = failure.diagnostics ?? [];
  const first = diagnostics[0];
  if (!first) return failure.message;
  const where = first.path || "/";
  const rest = diagnostics.length - 1;
  return `sidecar ${where}: ${first.message}${rest > 0 ? ` (+${rest} more)` : ""}`;
}

/**
 * Why this `POST /select` is not one of ours, or null if it is.
 *
 * The `Host` check above says the request is addressed to this preview. It
 * does not say who sent it: any page on any origin could POST here, and
 * `/select` swaps the session every other tab is reading. It was reachable
 * with a `text/plain` body, which is a SIMPLE request — no preflight, no
 * consent asked of this server, and the attacker never has to read the
 * response to have done the damage.
 *
 * Three things close it, and they are not redundant:
 *
 * - `Sec-Fetch-Site` is set by the browser and cannot be forged by the page.
 *   `same-origin` and `none` (a person typing the URL) pass; `same-site` and
 *   `cross-site` do not.
 * - `Origin` is checked against the `Host` this request was addressed to, for
 *   the browsers or contexts that send one without the fetch metadata.
 * - `application/json` is required, which makes the request non-simple. A
 *   browser then has to preflight it, the `OPTIONS` falls through to this
 *   host's 405 with no CORS headers on it, and the POST is never sent — so
 *   the two header checks above are a backstop rather than the whole fence.
 *
 * A request with no `Origin` and no fetch metadata is allowed: that is curl,
 * and preview is a local tool people script.
 */
export function refuseSelect(req: Request): { status: number; error: string } | null {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return { status: 403, error: `/select is same-origin only; Sec-Fetch-Site: ${site}` };
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    const host = (req.headers.get("host") ?? "").toLowerCase();
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { status: 403, error: `/select is same-origin only; Origin: ${origin}` };
    }
    if (originHost !== host) {
      return { status: 403, error: `/select is same-origin only; Origin: ${origin}` };
    }
  }

  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    return {
      status: 415,
      error: `/select takes application/json; got ${type === "" ? "no content-type" : type}`,
    };
  }
  return null;
}

/**
 * Who may talk to preview. `/frame` seeks shared world state.
 *
 * - loopback bind (`127.0.0.1` / `localhost` / `::1`): those three names, any
 *   bracket form. A page on another origin must not drive the session.
 * - wildcard (`0.0.0.0` / `::`): `--bind` is an opt-in to listen off
 *   loopback; any Host is then accepted.
 * - a specific address: that address only (IPv6 with or without brackets).
 */
export function hostAllowed(req: Request, hostname: string, port: number): boolean {
  const header = req.headers.get("host");
  if (!header) return false;
  const bind = stripBrackets(hostname).toLowerCase();
  if (bind === "0.0.0.0" || bind === "::") return true;

  const got = splitHostPort(header);
  if (got.port === "") {
    if (port !== 80) return false;
  } else if (got.port !== String(port)) {
    return false;
  }
  const name = stripBrackets(got.name).toLowerCase();
  if (name === bind) return true;
  return isLoopback(bind) && isLoopback(name);
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function splitHostPort(host: string): { name: string; port: string } {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return { name: host, port: "" };
    const name = host.slice(1, end);
    const rest = host.slice(end + 1);
    return { name, port: rest.startsWith(":") ? rest.slice(1) : "" };
  }
  const i = host.lastIndexOf(":");
  if (i === -1) return { name: host, port: "" };
  return { name: host.slice(0, i), port: host.slice(i + 1) };
}

function isLoopback(host: string): boolean {
  const h = stripBrackets(host).toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function parseAt(url: URL): number {
  const raw = url.searchParams.get("at");
  if (raw === null || raw === "") {
    throw new PreviewRangeError("missing ?at=");
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new PreviewRangeError(`?at= must be an integer; got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body) + "\n", {
    status,
    headers: { "content-type": "application/json" },
  });
}
