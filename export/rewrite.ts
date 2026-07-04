// batch/export/rewrite.ts — the pure, testable core of the static export.
//
// Two concerns, both string→string (no I/O), so the crawl/write engine (export.ts) stays a thin
// shell around them and this file carries the branching logic BATCH requires a colocated test for:
//
//   1. routeToDistPath — a fetched route → its file location under dist/.
//   2. rewriteRefs     — the PUBLIC_BASE_PATH problem (ARCHITECTURE §18): every ref the stack emits
//      is ROOT-ABSOLUTE ("/styles", "/scripts/x.js", url("/fonts/..")). That resolves on a root host
//      but 404s under user.github.io/<repo>/ (a subpath). To ship under a subpath we prefix every
//      absolute ref with the base path. This is the "rewrite absolute→relative" option §18 names
//      (kept absolute-under-a-prefix, which is what a subpath host actually needs — `<base>` can't
//      help because absolute URLs ignore it).

/** Normalize a caller base path: "", "/", "/repo", "repo/", "/repo/" → "" or "/repo" (no trailing /). */
export function normalizeBasePath(raw: string | undefined | null): string {
  if (!raw) return "";
  let b = raw.trim();
  if (b === "" || b === "/") return "";
  if (!b.startsWith("/")) b = "/" + b;
  return b.replace(/\/+$/, "");
}

/** Route → path under dist/.
 *  Pages become pretty directories:  "/" → "index.html",  "/grain" → "grain/index.html".
 *  Data routes keep their filename:   "/search.json" → "search.json",  "/robots.txt" → "robots.txt".
 *  Distinguished by `asDir` (pages are directories; the generated data routes are files). */
export function routeToDistPath(route: string, asDir: boolean): string {
  const clean = route.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!asDir) return clean;              // data route: literal filename (e.g. "components.css")
  return clean === "" ? "index.html" : `${clean}/index.html`;
}

// A ref we rewrite is root-absolute: starts with a single "/" and NOT "//" (protocol-relative) and
// NOT "/" alone that we still want prefixed. We PREFIX with the base path. Applied per-file-type so
// we never touch prose, only real URL positions.
const isEmpty = (bp: string) => bp === "";

/** HTML: rewrite the URL-bearing attributes + inline `url(..)` in <style>/style="". */
function rewriteHtml(html: string, bp: string): string {
  // href="/..", src="/..", action="/..", srcset="/..", poster="/..", data-src="/.."
  const attr = /\b(href|src|action|srcset|poster|data-src)=(["'])(\/(?!\/)[^"']*)\2/gi;
  let out = html.replace(attr, (_m, name, q, url) => `${name}=${q}${bp}${url}${q}`);
  out = rewriteCssUrls(out, bp);   // covers <style> blocks and inline style="" url(..)
  return out;
}

/** CSS: rewrite `url(/..)`, `url("/..")`, `url('/..')`. */
function rewriteCssUrls(css: string, bp: string): string {
  return css.replace(/url\(\s*(["']?)(\/(?!\/)[^"')]*)\1\s*\)/gi, (_m, q, url) => `url(${q}${bp}${url}${q})`);
}

/** JS (ES-module islands): rewrite absolute specifiers in `import … from "/…"`, `import("/…")`,
 *  and `fetch("/…")`. Runtime-constructed URLs (string concat) are out of scope — documented in §18. */
function rewriteJs(js: string, bp: string): string {
  const spec = /(\bfrom\s*|\bimport\s*\(\s*|\bfetch\s*\(\s*)(["'])(\/(?!\/)[^"']*)\2/g;
  return js.replace(spec, (_m, kw, q, url) => `${kw}${q}${bp}${url}${q}`);
}

/** Scan module JS for RELATIVE import/export specifiers (static, export-from, side-effect, dynamic)
 *  and resolve each against the module's own URL path — the graph walker for freezing the /modules
 *  mount (§19.3). Root-absolute and bare specifiers are ignored: absolutes are base-rewritten, bares
 *  are refused by the module server. Pure, so it is unit-tested directly. */
export function scanModuleImports(js: string, fromPath: string): string[] {
  const out = new Set<string>();
  const spec = /(?:\bfrom|\bimport)\s*\(?\s*(["'])(\.\.?\/[^"']+)\1/g;
  for (const m of js.matchAll(spec)) out.add(new URL(m[2]!, "http://x" + fromPath).pathname);
  return [...out];
}

/** JSON with `"url":"/…"` fields (search.json for the ⌘K palette). Targeted so arbitrary strings
 *  that merely start with "/" are left alone. */
function rewriteJsonUrls(json: string, bp: string): string {
  return json.replace(/("url"\s*:\s*")(\/(?!\/)[^"]*)"/g, (_m, pre, url) => `${pre}${bp}${url}"`);
}

/** Rewrite absolute refs in `content` for the given file extension (".html", ".css", ".js",
 *  ".json"). No-op when basePath is empty (root host) or the type carries no refs. */
export function rewriteRefs(content: string, ext: string, basePath: string): string {
  const bp = normalizeBasePath(basePath);
  if (isEmpty(bp)) return content;
  switch (ext.toLowerCase()) {
    case ".html": case ".htm": return rewriteHtml(content, bp);
    case ".css": return rewriteCssUrls(content, bp);
    case ".js": case ".mjs": return rewriteJs(content, bp);
    case ".json": return rewriteJsonUrls(content, bp);
    default: return content;
  }
}

/** Pull the root-absolute href/src targets out of an HTML doc, path-only (fragment + query stripped),
 *  deduped. Skips protocol-relative ("//cdn"), scheme URLs ("https:", "mailto:"), and non-absolute
 *  refs. Used to check for dead internal links against what the export actually wrote. */
export function extractRefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\b(?:href|src)=(["'])(\/(?!\/)[^"']*)\1/gi)) {
    const path = m[2].split("#")[0].split("?")[0];
    if (path) out.add(path);
  }
  return [...out];
}

/** Replace the crawl origin (http://localhost:PORT) with the real deploy origin in generated files
 *  that embed absolute URLs (sitemap.xml, robots.txt). Returns unchanged if no public origin given —
 *  the caller warns in that case (the files then still carry the localhost origin). */
export function rewriteOrigin(content: string, crawlOrigin: string, publicOrigin: string | undefined): string {
  if (!publicOrigin) return content;
  return content.split(crawlOrigin).join(publicOrigin.replace(/\/+$/, ""));
}
