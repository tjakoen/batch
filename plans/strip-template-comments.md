---
id: strip-template-comments
status: done
track: render
depends: []
touches: [render/render.ts, render/render.test.ts, package.json]
owner: ai
---

# A commented template ships its comments to every reader

Asked for by the owner on 2026-09-09, and measured in a consumer first rather than guessed at.

`people-manager` comments its components heavily, by its own house standard, and BATCH inlines each
template verbatim. So the commentary goes down the wire:

| page | total bytes | comment bytes | share |
| --- | --- | --- | --- |
| `/` | 61,228 | 40,268 | **65%** |
| `/people/1` | 65,309 | 43,199 | **66%** |
| `/settings` | 42,365 | 27,627 | **65%** |
| `/heatmap` | 58,840 | 27,695 | 47% |

Gzip takes `/` from 61,228 to 6,275. Stripping the comments takes it to **2,529** — a further 59%
after compression is already doing its work. Prose is the most compressible thing in a file and it
still costs more than the markup around it.

**Every BATCH consumer that comments its templates has this problem**, which is what makes it
BATCH's rather than an application's. The consumer's alternative was to stop using `componentsDir`
and hand-build the `templates` record instead, which means owning a copy of the discovery walk in
this file, including its "hyphenated filename means component" rule. That is a copy that drifts.

## Where it goes, and why there is only one place it can

`template(name)` is the one seam both source paths converge on:

```ts
const html = entry.source !== undefined ? entry.source : await Bun.file(entry.path!).text();
```

Disk and inline `templates` meet there, and the result is cached per component. So a strip here runs
once per component per process, not once per request, and covers both ways a template can arrive.

It has to happen **before** `bindAttrs` is extracted, which is two lines down. That ordering is a
behavior change worth naming: a `data-bind-*` attribute mentioned only inside a comment currently
lands in `bindAttrs` and becomes a live binding the template does not have. After this it does not.
That is a fix, and it gets its own test.

## What the strip must not eat

**A `<script>` or `<style>` body is raw text, not markup.** `<!--` inside one is not an HTML comment
and a regex that does not know the difference will corrupt a legacy `<!--` script wrapper or any
JavaScript that happens to contain the sequence. So the strip walks past raw-text elements and
leaves them verbatim.

**Whitespace is left exactly as it was.** Removing a comment leaves the newline it sat on, and that
is deliberate: whitespace between inline elements is significant in HTML, so tidying it would change
rendering to save bytes that gzip reclaims anyway.

Opt-in, default off, so no existing consumer's output moves by upgrading.

## Tasks

- [x] `stripComments?: boolean` on `RenderConfig`, default off.
- [x] Applied in `template()`, before `bindAttrs`, so both source paths and the cache all get it.
- [x] Raw-text elements walked past rather than stripped through.
- [x] Colocated tests: a comment goes, a script body survives, a commented binding stops being
      extracted, and the default leaves output byte-identical.
- [x] `tsc` and `bun test` green.
- [x] Version bumped, which is what publishes it — `.github/workflows/publish.yml` publishes on a
      version change pushed to `main`, by trusted publishing, no token anywhere.
- [x] A run report in `artifacts/runs/`.

## What this plan does not do

- **It does not strip anything from the finished document.** A consumer's rendered page contains
  content as well as templates, and markdown can legitimately produce an HTML comment. Stripping at
  template load is the only layer that can tell one from the other, which is the whole reason this
  is a render-time option and not a response filter.
- **It does not preserve conditional comments.** `<!--[if IE]>` is markup for a browser that no
  longer exists, and a consumer that needs one can leave the option off.
- **It does not touch the canonical docs.** They live in `tjakoen.github.io/docs/batch/`, which is
  a different repository and not cloned here. Named in the run report as needing human eyes.
