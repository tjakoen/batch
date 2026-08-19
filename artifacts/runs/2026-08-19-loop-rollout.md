---
title: BATCH gets a config, a plan board and a ledger
date: 2026-08-19
status: complete
lane: gated
branch: main
skills: [conformance, loop-standard, voice]
scope: [CLAUDE.md, pantry.config.json, plans/, artifacts/runs/]
touched: [CLAUDE.md, pantry.config.json, plans/README.md, artifacts/runs/README.md, artifacts/runs/2026-08-19-loop-rollout.md]
plans: []
gates:
  - "bun run check | pass, exit 0, tsc --noEmit clean"
  - "bun test | pass, exit 0, 55 pass, 0 fail, 124 expect() calls across 7 files"
  - "bun run lint | pass, exit 0, warnings only"
diffstat: 1 file modified, 4 files added. No source touched.
unpushed: "0 | nothing committed here."
doctor: 21 checks, 0 failing, 2 due at the start and 2 due at the close.
verifiedBy: nobody yet. This is the author's own account.
---

Had a CLAUDE.md and an AGENTS.md symlink and nothing else from the kit. Added
pantry.config.json, a plans/ directory with the board contract, and artifacts/runs/.

plans/ is one step outside the literal file list this run was given, which named the config, the
front door, the symlink and the ledger. It was created because the config this run wrote declares
plansDir: "./plans", and writing a config that points at a directory that does not exist is worse
than writing no config. Flagged rather than done quietly.

## Gate output, verbatim

```
$ tsc --noEmit
check_exit=0

 55 pass
 0 fail
 124 expect() calls
Ran 55 tests across 7 files. [41.00ms]
test_exit=0

lint_exit=0   (warnings only: no-array-sort, one unused variable)
```

## What was not done

Nothing committed, nothing pushed. No source touched. The lint warnings are pre-existing and were
left alone: cleaning them during a kit rollout makes the diff unreviewable.

## What needs human eyes

Whether creating plans/ was inside this run's envelope. It was one step past the file list the run
was handed, taken because the config it wrote declares that directory. If the call was wrong, the fix
is deleting one directory containing one README, and this paragraph is here so the decision is
visible rather than buried in a diff.
