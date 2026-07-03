// batch/http/modules.ts — no-build CLIENT modules: serve any `.ts` module to the browser, transpiled
// on request, with NO build step. This completes the stack's premise (ARCHITECTURE §0.5): Bun already
// transpiles TypeScript on-EXECUTE server-side; this transpiles on-REQUEST for the browser. Ephemeral,
// no bundler, no artifact, no dependency graph baked to disk — the same "the server is the build step"
// philosophy, now symmetric. Feasible precisely because the stack is zero-runtime-dep: there is no
// node_modules graph to resolve, so `Bun.Transpiler` (a builtin) is the whole toolchain.
//
// Why it matters: today the browser islands (grain/scripts/*.js) can't import the real TypeScript
// vocabulary, so they re-declare verbs as string literals kept honest only by a boot-time drift-guard.
// With this, an island imports the real `contract.ts` — one source of truth reaches the client. It is
// also the substrate under an OPT-IN client-side runtime (the door running in-browser for static hosts).
//
// ── THE CLIENT-SAFE BOUNDARY (read this before flagging a module for /modules) ───────────────────────
// A module is safe to ship to the browser ONLY if all three hold. Two are the developer's word; the
// third is enforced here:
//   1. NO server-only imports — no `node:*`, `bun`, `fs`, `path`, no third-party. ENFORCED: a module
//      with a bare (non-relative) import is refused and replaced with a throwing stub whose message
//      names the offending import, so the failure is loud in the browser console, not silent.
//   2. NO secrets — API tokens, keys, credentials. NOT auto-detectable; keep secrets in server-only
//      modules + env, never in anything reachable from a /modules root. Shipping a module here is a
//      DELIBERATE act; treat its full source as public.
//   3. NO server-required behavior — real persistence, multi-user authority, live external APIs. If the
//      logic needs a server, its client-side form is a demo/replay, not the real thing.
// In short: /modules is for static-style pages and self-contained logic. Anything needing a server or
// holding sensitive data stays server-side.
import type { Runtime } from "../platform/runtime.ts";
import { extname, join, resolve, sep } from "path";

const CLIENT_EXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);

/** A bare specifier (npm/node/bun) — anything not relative (`./`, `../`) or root/absolute-URL (`/`, a
 *  scheme). In a zero-dep stack a bare import in a client module is always a server-only leak. Returns
 *  the offending specifiers (minus the caller allowlist), so callers can refuse or report. Pure +
 *  transpiler-only, so it is unit-tested directly. */
export function findServerOnlyImports(source: string, allow: string[] = []): string[] {
  const allowed = new Set(allow);
  const out: string[] = [];
  for (const imp of new Bun.Transpiler({ loader: "ts" }).scanImports(source)) {
    const p = imp.path;
    const isRelative = p.startsWith("./") || p.startsWith("../") || p.startsWith("/");
    const isUrl = /^[a-z]+:\/\//i.test(p);
    if (!isRelative && !isUrl && !allowed.has(p)) out.push(p);
  }
  return out;
}

/** The stub a non-client-safe module is replaced with: a valid ES module that throws on load, so the
 *  browser console shows exactly what went wrong (and why) instead of a silent 4xx. */
function refusalModule(rel: string, offenders: string[]): string {
  const msg =
    `[batch/modules] ${rel} is NOT client-safe: it imports server-only ${JSON.stringify(offenders)}. ` +
    `Client modules must be pure (no node:/bun/npm), carry no secrets, and require no server. ` +
    `See ARCHITECTURE §19 (the client-safe boundary).`;
  return `console.error(${JSON.stringify(msg)});\nthrow new Error(${JSON.stringify(msg)});\n`;
}

export interface ModuleServer {
  /** Handle a request under the mount prefix, e.g. "/modules/grain/ai/contract.ts". */
  serve(pathname: string): Promise<Response>;
  /** Drop the transpile cache (wire to the component watcher for hot reload). */
  refresh(): void;
}

/** Serve TypeScript/JS modules to the browser, transpiled on request.
 *  `roots` maps the first URL segment under the prefix to a directory, e.g. `{ grain: "./grain" }`
 *  serves "/modules/grain/ai/contract.ts" from "./grain/ai/contract.ts". Relative imports inside a
 *  module resolve by URL and get transpiled the same way, recursively — no import rewriting needed
 *  (source uses explicit `.ts` extensions under verbatimModuleSyntax). */
export function makeModuleServer(
  rt: Runtime,
  opts: { roots: Record<string, string>; prefix?: string; allowBareImports?: string[] },
): ModuleServer {
  const prefix = (opts.prefix ?? "/modules").replace(/\/+$/, "");
  const roots = Object.fromEntries(Object.entries(opts.roots).map(([k, v]) => [k, resolve(v)]));
  const allow = opts.allowBareImports ?? [];
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const cache = new Map<string, string>();

  const js = (body: string) =>
    new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });

  async function serve(pathname: string): Promise<Response> {
    if (pathname !== prefix && !pathname.startsWith(prefix + "/")) return new Response("Not found", { status: 404 });
    const rel = pathname.slice(prefix.length + 1);                 // "grain/ai/contract.ts"
    const cached = cache.get(rel);
    if (cached !== undefined) return js(cached);

    const slash = rel.indexOf("/");
    const rootName = slash === -1 ? rel : rel.slice(0, slash);
    const sub = slash === -1 ? "" : rel.slice(slash + 1);
    const root = roots[rootName];
    if (!root || !sub) return new Response("Not found", { status: 404 });

    // separator-aware containment (same guard as static.ts): no path traversal out of the root.
    const file = resolve(join(root, sub));
    if (file !== root && !file.startsWith(root + sep)) return new Response("Forbidden", { status: 403 });
    if (!CLIENT_EXT.has(extname(file))) return new Response("Unsupported module type", { status: 415 });
    if (!(await rt.fileExists(file))) return new Response("Not found", { status: 404 });

    const source = await rt.readFile(file);
    const offenders = findServerOnlyImports(source, allow);
    if (offenders.length) {
      console.warn(`[modules] refused ${rel}: server-only imports ${JSON.stringify(offenders)} (not client-safe)`);
      const stub = refusalModule(rel, offenders);
      cache.set(rel, stub);
      return js(stub);
    }

    const out = transpiler.transformSync(source);                 // TS → browser JS; `.ts` specifiers kept
    cache.set(rel, out);
    return js(out);
  }

  return { serve, refresh: () => cache.clear() };
}
