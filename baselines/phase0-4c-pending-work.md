# Phase 0 work item 4c — pending work, 2026-08-13

The runtime mount-only oracle counted native ops and nothing else. This closes
the gap the oracle's own header had been describing since Phase 0.

## What was actually wrong

Two independent holes, and the composition that walks through both is now a
committed fixture ([`compositions/late-timer`](../compositions/late-timer/)).

**A finite window cannot rule out a booked timer.** `after(20, …)` schedules a
callback for frame 600. `check` observes 30 frames, sees zero guest ops, and
reports mount-only. This is not a tuning problem: the deadline is a free
parameter, so for any window there is a timer that outlasts it.

**The static lint reads one file.** `check` lints `<dir>/main.tsx` and stops
there. The fixture's entry is clean and the `after` import sits in `app.tsx`,
the module the entry renders. The scan never opens it.

So the "ops counting + import lint" pair, which the plan called the enforced
pair, passed a composition that mutates the world twenty seconds in:

```
mountOnly:       true      <- ops oracle, 0 ops over 30 frames
staticFindings:  []        <- lint, reading main.tsx only
pendingWork:     timers=1  <- new; exit 1
```

## The fourth registry the plan missed

The plan named three module-private bindings: `callbacks` (`frame.ts`),
`timers` (`clock.ts`), `pending`/`queue` (`effects.ts`). Reading the frame pump
in `framework/src/index.ts` turned up a fourth — `pumps` in `services.ts`,
drained every frame by `runServicePumps()`. Its own comment says a module joins
the set "only while it has pending work", which makes it the most direct
statement of not-finished in the runtime, and it was outside the plan.

Gesture and focus state are deliberately **not** counted. They hold no
scheduled work and can only act on contacts or button edges — that is input,
not something the world does on its own. The headless pipeline feeds neither.

## How, and why not the way the plan said

The plan proposed build-time aliasing `clock`/`effects`/`frame` to instrumented
copies. That means maintaining three shadow modules that drift against upstream
on every bump, to read four numbers.

[`patches/0003`](../patches/0003-pending-work-counters.patch) instead adds one
read-only counter per module and publishes them from `render()` on a contract
slot, `__pocketPendingWork` — the same channel the guest already uses for
`frame`. **93 lines**, no shadow modules, and shaped like something upstream
would take: a host or DevTools panel asking "is this app idle" has no way to
look today.

The host side is `BootedWorld.pendingWork()`, which copies the numbers out of
the guest realm rather than holding the object. It returns `undefined` for a
bundle built before the patch, and `check` reports that as **unknown, not
clean** — an old bundle cannot be interrogated, which is a different fact from
having nothing outstanding.

## Verification

| | |
| --- | --- |
| `compositions/smoke` | exit 0, all five registries zero |
| `compositions/late-timer` | exit 1 on `timers=1`, with ops and lint both green |
| `compositions/reel` | exit 0, no scheduled work |
| suite | 159 pass |

**The reel renders to digest `9afd9bf701ca97d8…` — byte-identical to the cut
frozen before this change.** A patch to the framework that touched the mount
path had to prove it moved no pixels, and the determinism oracle is what proves
it.

## The one-file scan — closed the same day

Recorded here first as still open, then fixed: `check` now lints every source in
the composition, which is what the `lint` command had been doing all along. Two
corrections to the account above are worth keeping.

**The hole was in `check`, not in the lint.** `lint` globs `*.{ts,tsx}` over the
composition directory and always did; only `check` read the entry alone. The
fixture escaped `check` and was caught by `lint` — as the wrong finding, which
is the second correction.

**`lint` reported it as a bare identifier, not a forbidden import.** The clause
in the import regex is `[\s\S]*?`, so a match anchored on the word "import"
inside a comment runs across the newline and swallows the real statement below
it up to its `from "…"`. The match is discarded for sitting outside code, but
the cursor stayed past what it ate, so the real import was never seen. The
message it fell back to — "not imported here" — was the opposite of true about a
plain import, and it lost the module specifier that names the rule.

Severity is misclassification rather than bypass: in every shape constructed,
including an aliased `after as delay`, the forbidden name still appears
literally in the import clause and the bare-identifier scan catches it. But a
composition explaining itself in prose is the ordinary case, not an exotic one —
`compositions/late-timer` tripped this by describing what it does — and a
triage message pointing away from the actual import is its own cost.

The fixture is now caught **twice, independently**: `timers=1` from the
structural half and `mountOnly.forbiddenImport` from the static half, each
sufficient alone. Suite: 164 pass.
