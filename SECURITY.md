# Security

## Reporting

Report a vulnerability privately, by either:

- GitHub's **Report a vulnerability** button under this repository's Security
  tab, which opens a private advisory, or
- email to **anelikes@gmail.com**.

Please do not open a public issue for something exploitable. Include what you
did, what happened, and what you expected — a reproducing composition or
command line is worth more than a description.

This is a small project with one maintainer. Expect an acknowledgement within a
week. There is no bounty.

## What this project is, and what it is not

**Building or rendering a composition executes that composition's code.** A
composition is TypeScript, it is bundled and run, and the generators under
`compositions/*/gen.ts` are ordinary programs. Treat a composition from an
untrusted source exactly as you would treat any other program you were asked to
run — because that is what it is.

The checks this repository does run are **determinism guards, not a sandbox**,
and it is worth being precise about the difference:

- `lint` refuses per-frame JS and the runtime refuses `Date`, `Math.random`
  and locale formatting. This exists so that frames are reproducible, not so
  that hostile code is contained. `compositions/malicious` is the fixture, and
  its own header calls every line "a determinism violation" — not an exploit.
- The mount-only lint is an import check, and `src/lint/mount-only.ts` says in
  its own header that an import blacklist "can be walked around with a
  re-export or a helper". It is paired with an ops oracle and a pending-work
  check because none of the three is sufficient alone. All three are aimed at
  determinism.

So: a composition that gets past those checks is reproducible. It is not
thereby safe. **Nothing here is a security boundary**, and a report that a
composition can reach the filesystem or the network is a description of how
the tool works rather than a vulnerability.

## What is in scope

- A path that lets a composition's *declared inputs* differ from what actually
  reaches a pixel without any command noticing — the repository's central
  claim, and the thing worth breaking.
- `scripts/assets.ts` or `scripts/vendor.ts` accepting bytes that do not match
  their pinned SHA-256 or pinned commit.
- The preview server (`bun src/cli/main.ts preview`) serving to a host it
  should have refused. It binds `127.0.0.1` by default and rejects a request
  whose `Host` header does not match the bind with a 403 — a DNS-rebinding
  guard for the loopback case. A way past that is in scope. Passing
  `--bind 0.0.0.0` or `--bind ::` disables the check by design
  (`hostAllowed` returns true for both), so exposure that follows from
  choosing it is not.
- Anything in this repository that sends data anywhere. There should be
  nothing but the two pinned fetches above.

## What is out of scope

- Untrusted composition code doing what code does. See above.
- Vulnerabilities in the pinned upstream PocketJS engine — report those to
  https://github.com/pocket-stack/pocketjs. If a patch under `patches/`
  introduces one, that is in scope here.
- Denial of service by giving the renderer a very large composition.
