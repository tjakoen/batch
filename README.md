# BATCH — the substrate

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)

**B**un · **A**ddressable · **T**ypeScript · **C**SS · **H**tmx — a no-build, server-rendered
hypermedia substrate. This directory is BATCH itself plus a minimal Items app that proves it out
(in-memory storage, server-rendered HTML fragments + JSON API, htmx for interactivity).

**GRAIN** (the design system) and **MILL** (the CMS) build on top of BATCH; the product and the
portfolio consume the whole stack. → the *why*: [`../portfolio/PHILOSOPHY.md`](../portfolio/PHILOSOPHY.md) · the full
reasoning (SSOT): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · the build rules:
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## Run

```sh
bun install            # or: npm install (bun came in via npm here)
bun run dev            # http://localhost:3000  (hot reload)
bun test               # unit + integration (29 tests)
bun run check          # tsc, erasable-only
```

> Bun is vendored under `node_modules` (GitHub was unreachable, so it was
> installed from the npm registry). Invoke as `./node_modules/.bin/bun` if it
> isn't on PATH.

## What it shows

- **One folder per component** — `frontend/components/<level>/<name>/<name>.{html,css}` (atoms → molecules → organisms), CSS co-located with its template.
- **Flat-file pages** — `frontend/pages/home.html` → `/home`; folders only group subpages (`profile/index.html` + `profile/settings.html`). URL mirrors the tree. Minimal JS sits in a `<script>` after the UI.
- **Pages compose components** — rendered through the engine (`renderPage`), so they use atomic tags. Forms are a native `<form>` built from `<b-input>` + `<b-button>` atoms — reusable, not one-off. Raw HTML belongs inside a component's own `.html`, never in a page.
- **Sitemap + SEO** — `/catalog` sidebar lists Pages (site map) + Components; the same page list feeds `/sitemap.xml` and `/robots.txt`. Add a page → it appears in all three.
- **Design system** in `frontend/styles` (`variables.css` tokens + `global.css` base); component CSS bundled into `/components.css` by the framework — no build step.
- **Animated navigation** — native CSS cross-document View Transitions (`@view-transition { navigation: auto }`); plain `<a href>` loads animate, no client router. Navigate `/home` ↔ `/about` to see it (Chromium). Honours `prefers-reduced-motion`.
- **Component catalog** at `/catalog` — Storybook-style, generated server-side from each component's co-located `<name>.md`. Live render + copyable source + side nav. No build, no deps. Vanilla CSS: **one class per element**, variants as attributes (`.btn[data-variant="soft"]`); pseudo-states forced via `data-force`. Two-layer tokens (primitives → semantic) — change a primitive, every panel restyles.
- **Polymorphic atoms** — one `b-text` renders `h2`/`h3`; one `b-button` for all variants.
- **Two representations off one service** — `/ui/*` HTML fragments, `/api/*` JSON.
- **Ports** — `ItemRepository` (in-memory wired); swap SQL/REST at `server.ts` only.
- **All audit fixes applied** — separator-aware traversal guard, `$`-safe slot
  splice, htmx form-encoded POST, URL-scheme XSS guard (incl. `hx-*`),
  non-silent `each`, own-prop path resolution, ISO dates.

## Try it

Open `/`, add an item via the form, hit **Archive** on a card. Or:

```sh
curl localhost:3000/api/items
curl -X POST localhost:3000/api/items -H 'Content-Type: application/json' -d '{"name":"X","description":"d"}'
```

## Deviation from the doc

`tsconfig.json` needs `allowImportingTsExtensions: true` for `tsc` to accept the
`.ts`-extension imports the architecture mandates — the doc's recommended-flags
list omits it.
