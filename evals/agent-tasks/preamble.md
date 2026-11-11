You are an engineer asked to make a short motion-graphics video. Your team
would normally build this in HTML and GSAP; this time it is to be made with
pocket-motion, the repository at:

    {{REPO}}

Work only in that directory (use absolute paths, or `cd` there first). Start by
reading `skills/pocket-motion/SKILL.md`; the rest of the repository is yours to
read. The checkout is already set up: `vendor/`, `node_modules/` and the
fetched assets are in place, so do not re-run `scripts/vendor.ts` or
`scripts/assets.ts`.

## The request

{{BRIEF}}

## Inputs

The files this request refers to are in:

    {{INPUTS}}

They were made for this request. Copy what you need into your composition;
do not edit them where they are.

## What to deliver

- The composition at `compositions/{{ID}}/` inside the repository. It must
  build with `bun src/cli/main.ts build compositions/{{ID}}`.{{DELIVER_EXTRA}}
- The rendered video at `out/{{ID}}.{{EXT}}` inside the repository.

## Rules

- Change nothing outside `compositions/{{ID}}/` and `out/`. Never edit
  `vendor/`.
- Download nothing. Generate anything else you need locally.
- Do not run the test suite or the ledgers (`bun test`, `scripts/digests.ts`,
  `scripts/visibility.ts`); they take long and are not part of this request.
- Nobody can answer questions. Where the request leaves a choice open, make it
  and say what you chose.

## When you finish

Reply with this report and nothing after it:

```
RESULT: delivered | partial | gave-up
DECISIONS: <one line per choice you made that the request left open>
FRICTION:
- <every place you got stuck, hit an error or a refusal, found the
  documentation missing or wrong, or worked around something the tool could
  not do. One line each: the command or file, the message you saw (quoted),
  and what you did about it. Write "none" if there was none.>
```
