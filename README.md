# BATCH — the substrate

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)

**B**un · **A**ddressable · **T**ypeScript · **C**SS · **H**tmx — a no-build, server-rendered
hypermedia substrate. This directory is BATCH itself: the composition engine, HTTP/asset helpers,
and the audit engine. (The component catalog moved up to GRAIN — `grain/catalog`.) The app that
proves it out — a personal site with a `/loop` "watch the AI act" demo (server-rendered HTML,
htmx for reads/nav, one `/intent` door for writes) — lives in
[`../tjakoen.github.io/`](../tjakoen.github.io/), the composition root that wires the stack together.

**GRAIN** (the design system) and **MILL** (the content engine) build on top of BATCH; the product
and the portfolio consume the whole stack. → the *why*: [`../tjakoen.github.io/PHILOSOPHY.md`](../tjakoen.github.io/PHILOSOPHY.md) · the full
reasoning (SSOT): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · the build rules:
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

**What BATCH gives you** (the full, tiered list is the source in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §"What BATCH gives you"):

- **Hero:** no build step (Bun runs the TS; even client `.ts` is transpiled on request, no bundler) ·
  static export as a *projection* of the running server (never a second renderer).
- **Also:** the composition engine (zero runtime deps) · a generic SSE push hub · sitemap/SEO from
  one source · a framework-generic perf + SEO/AEO audit engine. (The `/catalog` component browser
  moved up to GRAIN — `grain/catalog`.)

## Run

```sh
bun install            # or: npm install (bun came in via npm here)
bun run dev            # http://localhost:3000  (hot reload)
bun test               # unit + integration
bun run check          # tsc, erasable-only
```

> Bun is vendored under `node_modules` (GitHub was unreachable, so it was
> installed from the npm registry). Invoke as `./node_modules/.bin/bun` if it
> isn't on PATH.

## What it shows

- **One folder per component** — `<components-root>/<level>/<name>/<name>.{html,css}` (atoms → molecules → organisms), CSS co-located with its template. The roots are wired by the consumer (`tjakoen.github.io/config.ts`; in this monorepo the components live in `grain/components` + `tjakoen.github.io/components`).
- **Flat-file pages** — `<pages-root>/about.html` → `/about` (here: `tjakoen.github.io/pages`); folders only group subpages. URL mirrors the tree. Minimal JS sits in a `<script>` after the UI.
- **Pages compose components** — rendered through the engine (`renderPage`), so they use atomic tags. Raw HTML belongs inside a component's own `.html`, never in a page.
- **Sitemap + SEO** — `/catalog` sidebar lists Pages (site map) + Components; the same page list feeds `/sitemap.xml` and `/robots.txt`. Add a page → it appears in all three.
- **Tokens live up in GRAIN** (`grain/styles`) — BATCH ships the *mechanism*, not a theme: it bundles each component's co-located CSS into `/components.css` at request time, no build step.
- **Animated navigation** — native CSS cross-document View Transitions (`@view-transition { navigation: auto }`); plain `<a href>` loads animate, no client router. Navigate `/` ↔ `/about` to see it (Chromium). Honours `prefers-reduced-motion`.
- **Component catalog** at `/catalog` — Storybook-style, generated server-side from each component's co-located `<name>.md`. Live render + copyable source + side nav. No build, no deps. Vanilla CSS: **one class per element**, variants as attributes (`.btn[data-variant="soft"]`); pseudo-states forced via `data-force`. Two-layer tokens (primitives → semantic) — change a primitive, every panel restyles.
- **Polymorphic atoms** — one `b-text` renders `h2`/`h3`; one `b-button` for all variants.
- **Client `.ts` with no bundler** — modules served to the browser are transpiled on request behind a client-safe guard (no `node:`/secrets), so a static-style page ships typed JS with no build.
- **One write path** — all mutation flows through GRAIN's single door (`POST /intent` → render ops over SSE), not a separate CRUD API. BATCH just provides the generic SSE hub; the vocabulary lives in `grain/ai/*`.

## Try it

```sh
bun run dev            # http://localhost:3000
```

Open `/loop` and drive the "watch the AI act" demo — a click and an AI decision are the **same
Intent** through the one door (`POST /intent`), and the reply streams back as render ops over SSE
(the desk spotlight, the console narration). Navigate `/` ↔ `/about` for the View Transition.

## Deviation from the doc

`tsconfig.json` needs `allowImportingTsExtensions: true` for `tsc` to accept the
`.ts`-extension imports the architecture mandates — the doc's recommended-flags
list omits it.
