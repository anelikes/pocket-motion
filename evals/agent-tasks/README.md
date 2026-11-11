# Agent task suite

Ten motion-graphics requests of the kind an agent would otherwise build in
HTML and GSAP, each handed to a fresh agent that has this repository and
`skills/pocket-motion/SKILL.md` and nothing else, and each checked against a
written acceptance the agent never sees. What comes out is a number per task
— accepted or not, how long it took, how many tool calls — and a list of
every place the agent got stuck. `docs/agent-adoption-eval.md` is the report
the first runs produced.

## What is in a task

`tasks/<NN-name>/` holds two files:

- `brief.md` — the request, as a client or a producer would write it: canvas,
  timing, the inputs by name, and the `debugName`s the review tooling reads.
  It is the only task-specific text the agent is given.
- `task.ts` — the inputs the brief names, generated (SVGs and JSON written
  out, photos drawn by `lib/photos.ts` from a seed, so the suite carries no
  media and every run gets the same bytes), and the acceptance: the
  `assertions[]` the delivery must satisfy and the observable criteria a
  reading of `layout` and the frames can decide. `unchecked` lists what the
  brief asks for that no criterion reads.

`preamble.md` is the frame every brief is put in: where the checkout is, what
to deliver, the rules (no edits outside the composition, no downloads, no test
suite), and the report to finish with.

## What a run is checked against

`run.ts check` runs the delivered checkout's own CLI — never this
repository's `src/`, which may be another revision — and records each
criterion with what it measured:

| criterion | read from |
|---|---|
| `delivered` | `compositions/<id>/pocket-motion.json` exists (for the captions task, a `render --spec` job is accepted instead) |
| `builds` | `build --json` exits 0, from the delivered sources |
| `canvas` | `layout`'s viewport, the sidecar's `fps` and `durationFrames`, against the brief |
| `verify` | `verify --json` is `ok` — the repository's own gate, as the agent could have run it |
| `assertions` | the task's `assertions[]` written over the sidecar's for one `assert --json`, then the sidecar put back |
| task criteria | `layout --at N` rects and text, and `frame --at N` pixels |
| `video` | ffprobe on `out/<id>.<ext>`: size, frame count, an alpha format where one was asked for |

A run is accepted when every criterion passes. The assertions are the
task's, not the agent's: an agent's own assertions are checked by `verify`,
and an agent that asserted nothing is not excused by it.

## Running it

Prepare one fresh checkout per task. `--ref` is the revision measured;
`vendor/`, `node_modules/` and the fetched assets are cloned from this
checkout (copy-on-write on APFS), and `vendor/` is rebuilt instead when the
ref's patches differ from this checkout's. The checkout carries no copy of
this suite, so the agent cannot read the acceptance.

```bash
bun evals/agent-tasks/run.ts list
bun evals/agent-tasks/run.ts prepare --run r1 --root ../agent-evals --ref HEAD  # not run: it clones ten checkouts
```

Each run directory gets a `PROMPT.md`. Give it, verbatim and with nothing
added, to a fresh agent with no other context — for example a Claude Code
subagent (`Agent` tool, `general-purpose`), one per task, at most three at a
time. Hints from the person running the suite defeat it. When the agent
finishes, record what its harness measured and its final report, then
check:

```bash
bun evals/agent-tasks/run.ts record ../agent-evals/r1/01-logo-draw-on --wall-s 900 --tool-calls 64 --report report.txt  # not run: needs a finished agent
bun evals/agent-tasks/run.ts check ../agent-evals/r1/01-logo-draw-on  # not run: needs a finished agent
bun evals/agent-tasks/run.ts report ../agent-evals  # not run: needs finished runs
```

Run the suite at least twice: one run of one task is an anecdote. What
varies between two runs of the same brief is as much a finding as what fails
in both.

## Reading a result

A failing criterion says what it measured. Before counting a failure against
the tool, open the frames it read (`<run-dir>/check/frame-N.png`) and the
agent's report: a check can be wrong, and a criterion that fails a correct
film is a bug in `task.ts`, fixed and re-checked rather than explained.

The friction an agent reports is classified by hand into four kinds —
**missing capability**, **documentation gap**, **misleading error message**,
**API ergonomics** — because the agent's own words for it (a "bug", a
"workaround") do not say which part of the repository would have to change.
