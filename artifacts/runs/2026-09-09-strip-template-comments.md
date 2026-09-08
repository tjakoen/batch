---
title: A render option that stops a commented template shipping its comments
date: 2026-09-09
status: complete
lane: gated
branch: main
skills: [voice]
scope: [render/, package.json, plans/, artifacts/runs/]
scopeGrowth: none
touched:
  - render/render.ts
  - render/render.test.ts
  - package.json
  - plans/strip-template-comments.md
  - artifacts/runs/2026-09-09-strip-template-comments.md
dirty: []
plans: ["strip-template-comments | plans/strip-template-comments.md"]
gates:
  - "bunx tsc --noEmit | clean, no output"
  - "bun test | 60 pass, 0 fail, 135 expect() calls, 7 files"
  - "bunx oxlint | 6 warnings, 0 errors — all six pre-date this change, confirmed by stashing it and re-running"
diffstat: 2 commits, 214 insertions, 3 deletions
unpushed: "0 | pushed to main, which is what publishes it"
doctor: not run — no native bun on this machine, and the doctor is not containerised here
verifiedBy: nobody yet
---

## What was asked, and what it turns out to be

The owner asked for the BATCH release that `people-manager`'s `plans/072` is blocked on: a
`stripComments` option on `RenderConfig`.

It is a two-line feature with a careful helper behind it, and the reason it belongs here rather than
in the consumer is worth stating plainly. **Every BATCH consumer that comments its templates has
this problem.** The consumer's only alternative was to stop using `componentsDir` and build the
`templates` record itself, which means owning a copy of the discovery walk in `render.ts` including
its "hyphenated filename means component" rule. That is a copy that drifts.

## The measurement that justified it

Taken on the consumer before any of this was written, because 65% is a number worth checking rather
than assuming:

| page | total bytes | comment bytes | share |
| --- | --- | --- | --- |
| `/` | 61,228 | 40,268 | **65%** |
| `/people/1` | 65,309 | 43,199 | **66%** |
| `/settings` | 42,365 | 27,627 | **65%** |
| `/heatmap` | 58,840 | 27,695 | 47% |

And the part that decided the shape of it: gzip alone takes `/` from 61,228 to 6,275, and stripping
the comments takes it to **2,529**. A further 59% *after* compression has already done its work.
Prose is the most compressible content there is and it still costs more than the markup around it.

## Where it went, and why there is only one place it could

`template()` is the one seam both source paths converge on — the `readdirSync` walk and the
`templates` record meet at a single line, and the result is cached per component. So the strip runs
once per component per process rather than once per request, and neither source path can bypass it.

It runs **before** `bindAttrs` is extracted, two lines down, and that ordering is a behavior change
rather than an accident of placement:

> A `data-bind-*` attribute mentioned only inside a comment used to land in `bindAttrs` and become a
> live binding the template does not actually have. With comments gone first, a commented-out
> binding is commented out.

That is a fix, and it has its own test using `missing: "throw"` as the proof — with the comment
still counted, the render rejects on a binding the data does not provide.

## The two carve-outs, which are the whole difficulty

**A `<script>` or `<style>` body is raw text, not markup.** `<!--` inside one is not an HTML comment,
so a regex that does not know the difference corrupts a legacy `<!--` script wrapper or any
JavaScript containing the sequence. `stripHtmlComments` walks past raw-text elements and copies them
verbatim; the closing tag is a backreference so a `<style>` cannot be closed by a `</script>`. The
test asserts that `if (a < b) {}` survives, which is the corruption a naive `<` heuristic causes.

**Whitespace is left exactly as it was.** Removing a comment leaves the newline it sat on. That is
deliberate: whitespace between inline elements is significant in HTML, so collapsing it would change
how a page renders in order to save bytes gzip reclaims anyway.

Also deliberate, and named in the plan rather than discovered later: an HTML comment ends at the
**first** `-->`, so the matcher is non-greedy and the text between two comments survives.

## How this reaches the registry

`.github/workflows/publish.yml` publishes on a version change pushed to `main`, through npm trusted
publishing over OIDC. There is no token in the workflow and none on the machine this ran from —
there is no `npm` binary here either, and no `~/.npmrc`. So the release is the version bump plus the
push, and CI does the rest. `0.2.1` to **`0.3.0`**: a new option is a feature, and the option is off
by default so nothing existing moves.

## What was not done

- **The canonical docs were not synced.** BATCH's own definition of done requires it, and they live
  in `tjakoen.github.io/docs/batch/`, a different repository that is not cloned on this machine.
  Named below rather than quietly skipped.
- **No memory was written**, because no decision was made that the plan and this report do not
  already carry. The one judgment call — strip at load, never over a finished document — is argued in
  both.
- **The consumer was not wired in this run.** `people-manager`'s `plans/072` is a separate change in
  a separate repository, and it needs this version on the registry first.
- **The doctor was not run.** No native bun on this machine and the doctor is not containerised here.

## What needs human eyes

- **`tjakoen.github.io/docs/batch/` needs the option documented.** One paragraph on `RenderConfig`,
  and it is the half of the definition of done this run could not reach.
- **Whether CI actually published.** The workflow skips a version already on the registry and
  publishes otherwise, so the evidence is the run on `main` and `npm view @tjakoen/batch version`.
  This report is written before that run finished.
