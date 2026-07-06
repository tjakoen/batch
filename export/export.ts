// batch/export/export.ts — a framework-generic static export: crawl a running BATCH app and freeze
// its bytes to dist/. A PROJECTION of the server, never a second renderer (ARCHITECTURE §18): it
// boots nothing and composes nothing — it fetches final, component-expanded HTML the server already
// produced, copies the static assets verbatim, and writes files. If it ever re-rendered, it would be
// a build step and would have violated the stack's premise. It stays a crawler + writer.
//
// Generic, like batch/audit: it knows no vocabulary, no page names, nothing about /intent or SSE. The
// consumer boots its own server and supplies the base URL, the page allowlist (operable surfaces
// already excluded — §18's exportable boundary), the generated data routes, and the asset mounts. So
// ANY BATCH site gets Pages hosting from this one tool.
//
// Zero third-party deps: node fs/path + the global fetch. Pure path/rewrite logic lives in rewrite.ts.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { extractRefs, normalizeBasePath, rewriteRefs, rewriteOrigin, routeToDistPath, scanModuleImports } from "./rewrite.ts";

/** A static-asset dir served under a URL prefix, copied verbatim (e.g. { prefix:"/styles", dir:"./grain/styles" }). */
export interface AssetMount { prefix: string; dir: string; }

export interface ExportConfig {
  /** Origin of an ALREADY-RUNNING app (the caller boots + kills it), e.g. "http://localhost:3330". */
  baseURL: string;
  /** Output directory, wiped and recreated. e.g. "dist". */
  distDir: string;
  /** HTML routes to fetch → dist/<route>/index.html. Caller-filtered: NO operable surfaces (§18). */
  pages: string[];
  /** Generated routes (not linked static files) copied at their literal path → dist/<path>.
   *  e.g. ["/components.css", "/search.json", "/sitemap.xml", "/robots.txt"]. */
  dataRoutes?: string[];
  /** Static dirs copied verbatim under their prefix. Binaries preserved; text (.css/.js) base-rewritten. */
  assets?: AssetMount[];
  /** Client-module entry URLs (browser-facing `.js`, e.g. "/modules/grain/ai/client-door.js"): each
   *  entry's transpiled JS is fetched and its RELATIVE import graph walked + frozen to dist at the
   *  same paths (transpile-at-export, §19.3) — so an operable-static page ships as plain files. */
  moduleEntries?: string[];
  /** Caller-owned transform on a fetched page's HTML before it is rewritten + written. The projection
   *  stays honest (fetch, don't re-render); this is for deployment-mode markers a STATIC copy needs
   *  baked in (e.g. flipping a page to its client-side transport). Return the HTML unchanged for
   *  pages you don't mean to touch. */
  transformPage?: (route: string, html: string) => string;
  /** PUBLIC_BASE_PATH for subpath hosting (user.github.io/<repo>/). "" / "/" = root host. */
  basePath?: string;
  /** Real deploy origin, swapped in for the crawl origin in sitemap.xml/robots.txt. Optional. */
  publicOrigin?: string;
  log?: (msg: string) => void;
}

export interface ExportReport {
  distDir: string;
  basePath: string;
  pages: { route: string; status: number; bytes: number; ok: boolean; error?: string }[];
  dataRoutes: { route: string; status: number; ok: boolean }[];
  assets: { prefix: string; files: number }[];
  modules: string[];
  warnings: string[];
}

// Text extensions get a base-path rewrite; everything else (fonts, images) is copied byte-for-byte.
const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".xml"]);
const isTest = (name: string) => /\.test\.[cm]?[jt]sx?$/.test(name);

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const r = await fetch(url);
  return { status: r.status, body: await r.text() };
}

async function writeInto(distDir: string, rel: string, body: string): Promise<number> {
  const dest = join(distDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, body);
  return Buffer.byteLength(body);
}

/** Recursively copy an asset dir into dist/<prefix>/, skipping test files. Text files are rewritten
 *  for the base path (CSS url(), JS import/fetch specifiers); binaries are copied verbatim. */
async function copyAssetDir(srcDir: string, destDir: string, bp: string, log: (m: string) => void): Promise<number> {
  const abs = resolve(srcDir);
  let count = 0;
  async function walk(dir: string, out: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { log(`  ! asset dir not found: ${dir}`); return; }
    for (const e of entries) {
      if (isTest(e.name)) continue;                       // never ship *.test.* to a public site
      const from = join(dir, e.name), to = join(out, e.name);
      if (e.isDirectory()) { await walk(from, to); continue; }
      const ext = extname(e.name).toLowerCase();
      if (bp && (ext === ".css" || ext === ".js" || ext === ".mjs")) {
        const rewritten = rewriteRefs(await readFile(from, "utf8"), ext, bp);
        await mkdir(dirname(to), { recursive: true });
        await writeFile(to, rewritten);
      } else {
        await mkdir(dirname(to), { recursive: true });
        await cp(from, to);                               // verbatim (preserves woff2/svg bytes)
      }
      count++;
    }
  }
  await walk(abs, destDir);
  return count;
}

/** Crawl an already-running BATCH app and write a static dist/. The caller owns booting/killing. */
export async function exportSite(cfg: ExportConfig): Promise<ExportReport> {
  const log = cfg.log ?? (() => {});
  const bp = normalizeBasePath(cfg.basePath);
  const dist = resolve(cfg.distDir);
  const warnings: string[] = [];

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  log(`[export] → ${dist}${bp ? `  (base path ${bp})` : "  (root host)"}`);

  // 1. Pages → dist/<route>/index.html
  const pages: ExportReport["pages"] = [];
  const writtenHtml: { route: string; html: string }[] = [];
  for (const route of cfg.pages) {
    try {
      const { status, body } = await fetchText(cfg.baseURL + route);
      if (status !== 200) { pages.push({ route, status, bytes: 0, ok: false, error: `HTTP ${status}` }); log(`  ✗ ${route} (HTTP ${status})`); continue; }
      const html = rewriteRefs(cfg.transformPage ? cfg.transformPage(route, body) : body, ".html", bp);
      const bytes = await writeInto(dist, routeToDistPath(route, true), html);
      writtenHtml.push({ route, html });
      pages.push({ route, status, bytes, ok: true });
      log(`  ✓ ${route}  (${(bytes / 1024).toFixed(1)}kb)`);
    } catch (e) {
      pages.push({ route, status: 0, bytes: 0, ok: false, error: (e as Error).message });
      log(`  ✗ ${route} (${(e as Error).message})`);
    }
  }

  // 2. Generated data routes → dist/<path> (literal filename), rewritten by extension.
  const dataRoutes: ExportReport["dataRoutes"] = [];
  for (const route of cfg.dataRoutes ?? []) {
    try {
      const { status, body } = await fetchText(cfg.baseURL + route);
      if (status !== 200) { dataRoutes.push({ route, status, ok: false }); log(`  ✗ ${route} (HTTP ${status})`); continue; }
      const ext = extname(route).toLowerCase();
      let out = rewriteRefs(body, ext, bp);
      if (ext === ".xml" || ext === ".txt") {
        out = rewriteOrigin(out, cfg.baseURL, cfg.publicOrigin);
        if (!cfg.publicOrigin && out.includes(cfg.baseURL))
          warnings.push(`${route} still carries the crawl origin ${cfg.baseURL} — set PUBLIC_ORIGIN to the deploy URL to fix absolute links.`);
      }
      await writeInto(dist, routeToDistPath(route, false), out);
      dataRoutes.push({ route, status, ok: true });
      log(`  ✓ ${route}`);
    } catch (e) {
      dataRoutes.push({ route, status: 0, ok: false });
      log(`  ✗ ${route} (${(e as Error).message})`);
    }
  }

  // 2b. Frozen client modules (§19.3, transpile-at-export): walk the browser-facing module graph
  // from each entry — the server already serves transpiled `.js` with relative specifiers, so the
  // frozen files are byte-honest projections; a static host serves them with a JS MIME type.
  const modules: string[] = [];
  const moduleQueue = [...(cfg.moduleEntries ?? [])];
  const moduleSeen = new Set<string>();
  while (moduleQueue.length) {
    const route = moduleQueue.shift()!;
    if (moduleSeen.has(route)) continue;
    moduleSeen.add(route);
    try {
      const { status, body } = await fetchText(cfg.baseURL + route);
      if (status !== 200) { warnings.push(`module ${route} → HTTP ${status}; the frozen graph is incomplete.`); continue; }
      await writeInto(dist, routeToDistPath(route, false), rewriteRefs(body, ".js", bp));
      modules.push(route);
      moduleQueue.push(...scanModuleImports(body, route));
    } catch (e) {
      warnings.push(`module ${route} failed: ${(e as Error).message}`);
    }
  }
  if (modules.length) log(`  ⧉ modules  (${modules.length} frozen from ${(cfg.moduleEntries ?? []).length} entr${(cfg.moduleEntries ?? []).length === 1 ? "y" : "ies"})`);

  // 3. Static assets copied verbatim under their prefix.
  const assets: ExportReport["assets"] = [];
  for (const { prefix, dir } of cfg.assets ?? []) {
    const files = await copyAssetDir(dir, join(dist, prefix.replace(/^\/+/, "")), bp, log);
    assets.push({ prefix, files });
    log(`  ⧉ ${prefix}  (${files} file${files === 1 ? "" : "s"})`);
  }

  // 4. Enforce the exportable boundary (don't ship broken pages, §18): any internal href/src that
  // points to a route we didn't export is a dead link in the static site — typically an operable
  // surface the caller intentionally excluded (/loop, /intent). Warn, listing them, so the
  // operator confirms each is expected rather than an accidental omission. Generic: batch judges
  // resolvability against what it wrote, knowing nothing of which routes are "operable".
  const exportedPages = new Set(cfg.pages);
  const exportedData = new Set(cfg.dataRoutes ?? []);
  const assetPrefixes = (cfg.assets ?? []).map((a) => a.prefix.replace(/\/+$/, ""));
  const resolves = (ref: string): boolean => {
    const r = ref === "/" ? "/" : ref.replace(/\/+$/, "");
    if (exportedPages.has(ref) || exportedPages.has(r) || exportedData.has(ref)) return true;
    return assetPrefixes.some((p) => ref === p || ref.startsWith(p + "/"));
  };
  const dead = new Set<string>();
  for (const { html } of writtenHtml)
    for (const ref of extractRefs(html)) {
      const path = bp && ref.startsWith(bp + "/") ? ref.slice(bp.length) : ref;   // undo the base-path prefix before matching
      if (!resolves(path)) dead.add(path);
    }
  if (dead.size)
    warnings.push(`${dead.size} internal link(s) point outside the export (expected for operable surfaces excluded per §18): ${[...dead].sort().join(", ")}`);

  for (const w of warnings) log(`  ⚠ ${w}`);

  const okPages = pages.filter((p) => p.ok).length;
  log(`[export] done: ${okPages}/${pages.length} pages, ${dataRoutes.filter((d) => d.ok).length}/${(cfg.dataRoutes ?? []).length} data routes, ${modules.length} frozen modules, ${assets.reduce((s, a) => s + a.files, 0)} asset files.`);
  return { distDir: dist, basePath: bp, pages, dataRoutes, assets, modules, warnings };
}
