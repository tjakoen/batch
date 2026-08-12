// batch/http/static.ts — generic static serving; root is INJECTED
import type { Runtime } from "../platform/runtime.ts";
import { extname, join, normalize, resolve, sep } from "node:path";

// Extension → Content-Type. The fallback is text/html, which is right for a static SITE (every
// extensionless route is a page) and silently wrong for anything binary: a browser handed a PDF or
// a PNG labelled text/html renders the raw bytes as text. That is exactly how this was found, with
// a sample PDF dumping its own source onto a docs page. Serve what a mount can actually contain.
const TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".html": "text/html",
};

export function makeStatic(rt: Runtime, root: string) {
  const ROOT = resolve(root);                            // absolute → traversal guard is reliable
  return async (pathname: string): Promise<Response> => {
    const rel = pathname === "/" ? "/index.html" : pathname;
    const path = resolve(normalize(join(ROOT, rel)));
    // separator-aware containment: "/p/frontend-secret" must NOT pass for ROOT "/p/frontend"
    if (path !== ROOT && !path.startsWith(ROOT + sep)) return new Response("Forbidden", { status: 403 });
    if (!(await rt.fileExists(path))) return new Response("Not found", { status: 404 });
    const type = TYPES[extname(path).toLowerCase()] ?? "text/html";
    return new Response(await rt.readFile(path), { headers: { "Content-Type": type } });
  };
}
