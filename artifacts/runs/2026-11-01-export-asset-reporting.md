---
title: Preserve asset directory failures in export reports
date: 2026-11-01
status: complete
lane: gated
branch: codex/batch-export-reliability
skills: [graph, session-loop, voice]
scope: [export/export.ts, export/export.test.ts, plans, artifacts/runs]
scopeGrowth: none
touched: [export/export.ts, export/export.test.ts, plans/export-asset-reporting.md]
dirty: ["implementation and evidence | independent review complete; deliberately uncommitted, no commit requested"]
plans: ["export-asset-reporting | ../../plans/export-asset-reporting.md"]
gates: ["bun test export/export.test.ts | 7 pass, 0 fail", "bun run check | exit 0", "bun test | 58 pass, 0 fail", "bun run lint | exit 0 with six existing warnings", "git diff --check | exit 0"]
diffstat: 2 source/test files changed, 26 insertions and 3 deletions; plus plan and run report
unpushed: "0 | no commits created"
doctor: delegated bounded implementation; no separate doctor run
verifiedBy: root session | independently reviewed warning propagation, partial-copy semantics and regressions
---

# Export asset failure reporting

Unreadable configured directories now appear in the returned warnings with their source path and
filesystem error, even when the caller supplies no logger. Other mounts still copy. Omitting the
asset list remains valid. The two failure regressions failed before the implementation changed.

Verbatim gate excerpts:

```text
 7 pass
 0 fail
 20 expect() calls
Ran 7 tests across 1 file. [84.00ms]

$ tsc --noEmit

 58 pass
 0 fail
 129 expect() calls
Ran 58 tests across 7 files. [42.00ms]
$ oxlint
```

The linter exited successfully with six existing warnings: five uses of array sort and one unused
variable. This run did not change those lines.

No commit, push, package publication, or deployment ran. Canonical documentation is assigned to the
coordinating portfolio session. The coordinating root independently reviewed the final warning path and regression cases; no blocking finding remained. There is no rendered UI change.

## Local landing, November 1

The owner subsequently requested clean main branches. The verified changes and their evidence are
being recorded in a local commit and brought onto main by fast-forward. Earlier statements about
uncommitted work describe the implementation phase. No push, package release, or deployment is part
of this landing.
