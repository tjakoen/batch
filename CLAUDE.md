# CLAUDE.md — batch

Onboarding + operating rules for any AI (or human) working in **`batch/`**, the no-build
server-rendered hypermedia substrate. Read this first, then the docs it points to. Keep it accurate.

> Personal standards (voice, badges, AI-use posture) live in `../portfolio/standards/` and this file
> is seeded from `CLAUDE.starter.md`.

## What this is

BATCH is the **substrate**: server-rendered hypermedia with **no build step** (Bun runs the
TypeScript directly). It owns rendering (the composition engine + binding vocabulary), HTTP, asset
serving, the component catalog, the platform runtime, and a framework-generic audit engine. It is
**the bottom layer** — grain builds on it, the product builds on grain. BATCH must **extract into
its own repo as a clean copy**, so it imports *nothing* upward. `README.md` is the usage reference.

## Start here (reading order)

1. [`../portfolio/PHILOSOPHY.md`](../portfolio/PHILOSOPHY.md) — the *why* beneath the whole stack.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the substrate's reasoning (**single source of
   truth** for the stack: no-build, server-rendered hypermedia, the export, the audit).
3. [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — the **build standard** across the whole stack
   (layering, TypeScript, components, tokens, the action vocabulary, the 3-tier testing bar).

The doc map for the whole monorepo is [`../DOCS.md`](../DOCS.md).

## Non-negotiables

- **Imports nothing inward.** `batch/` must not import from `grain/` or `project/` — it's the
  substrate and has to extract cleanly (SPLIT-PLAN). If you need something from above, **add a port
  (an interface) and inject the concrete thing at the composition root** (`project/server.ts`);
  never reach up.
- **No-build / native-first governs the *runtime*, not the toolbox.** Two things only: no build step
  (no bundler/transpiler between source and server), and near-zero framework JS shipped to the
  browser. It does **not** mean zero dependencies: **platform builtins** (`fs`, `path` via Bun) and
  **devDependencies** (`@playwright/test` for tests/shots/audit — measures from outside, never ships)
  are fine. The bar is the `dependencies` block: **zero third-party runtime deps** (today only Bun).
- **Vocabulary-agnostic.** BATCH knows only the **binding vocabulary** (the markup forms the
  composition engine interprets) and ships a **generic SSE hub** (`http/stream.ts`, opaque
  payloads). It knows **nothing about `RenderOp`s, the door, verbs, or surfaces** — all of that
  lives in `grain/ai/*`; batch's stream satisfies grain's `OpChannel` port structurally, wired at
  the composition root. The audit engine is likewise generic (takes `selectors`, returns an
  `AuditReport`) so it can measure any app, not just this one.
- **Factories, not classes**, for wiring (`createX(deps)` returning closures). Classes only for port
  implementations, error types, plain aggregators. **Erasable TypeScript only** (no `enum`/`namespace`);
  model closed sets as a union + a const registry.
- **Tokens live in grain, not batch.** BATCH ships the mechanism, no theme/colors of its own.
- **Client modules are client-SAFE or refused.** BATCH can serve `.ts` to the browser transpiled on
  request (`http/modules.ts`, no-build client modules — ARCHITECTURE §19). Anything served there must
  be pure (no `node:`/`bun`/npm — the guard refuses it), **carry no secrets/tokens**, and need no
  server; it's for static-style pages only. BATCH enforces the import rule mechanically and stays
  ignorant of the door/vocabulary — the client-side runtime that uses this lives in grain + the
  composition root.
- **Tests travel with the code:** colocated `*.test.ts` only — **no app, no e2e** in `batch/`
  (those live in `project/`). `tsc` + `bun test` green before "done".

## The meta-lesson (from hardening grain)

A pattern that lives only as a comment inside one module is **not a contract** — it gets reinvented,
wrong. When a rule matters across the stack, **promote it to a doc and, where you can, make it
machine-checkable** (BATCH already models this: the boot drift guard *warns* on verbs not in the
registry — upgrading it to fail-fast is on the ROADMAP; the audit runbook checks layering purity +
tokens-only). Prefer **designing a mistake out** over
documenting around it. An AI (or human) tripping on the system is a measurement of the system's
clarity, not just the operator's — read the signal and harden the contract.

## Definition of done

Code + colocated unit test(s) for any branching logic + `tsc` and `bun test` green + docs synced
(`docs/ARCHITECTURE.md` / `docs/CONVENTIONS.md` when behavior changes) + a memory if a decision was made.

## Working notes

- Commit/push only when asked; branch off `main` if you must. End commit messages with the
  `Co-Authored-By: Claude` trailer.
- Voice for prose in the owner's name: `../portfolio/standards/VOICE.md` (no backticks in prose).
  README badges/footer: `../portfolio/standards/README-STANDARD.md`.
