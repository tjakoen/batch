// batch/export/export.test.ts — the crawl+write engine against a throwaway in-process server.
// No product coupling: a 20-line Bun.serve stands in for "a running BATCH app". Uses only bun + fs.
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSite } from "./export.ts";

let server: ReturnType<typeof Bun.serve>;
let baseURL: string;
let assetsSrc: string;
let dist: string;

beforeAll(async () => {
  const tmp = await mkdtemp(join(tmpdir(), "batch-export-"));
  assetsSrc = join(tmp, "styles");
  dist = join(tmp, "dist");
  await mkdir(assetsSrc, { recursive: true });
  // one text asset with an absolute url() + one "binary" + a test file that must NOT ship
  await writeFile(join(assetsSrc, "theme.css"), `@font-face{src:url("/fonts/x.woff2")}`);
  await writeFile(join(assetsSrc, "logo.svg"), `<svg/>`);
  await writeFile(join(assetsSrc, "theme.test.ts"), `// should be skipped`);

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html" } });
      if (p === "/") return html(`<!doctype html><link href="/styles/theme.css"><a href="/grain">g</a>`);
      if (p === "/grain") return html(`<h1>grain</h1><script src="/scripts/x.js"></script>`);
      if (p === "/search.json") return Response.json({ pages: [{ title: "Grain", url: "/grain" }] });
      if (p === "/sitemap.xml") return new Response(`<loc>${new URL(req.url).origin}/grain</loc>`, { headers: { "Content-Type": "application/xml" } });
      if (p === "/missing") return new Response("nope", { status: 404 });
      return new Response("not found", { status: 404 });
    },
  });
  baseURL = `http://localhost:${server.port}`;
});

afterAll(() => server?.stop(true));

const exists = async (p: string) => { try { await stat(p); return true; } catch { return false; } };

describe("exportSite — root host (no base path)", () => {
  test("writes pretty page dirs, data routes, and copied assets", async () => {
    const out = join(dist, "root");
    const report = await exportSite({
      baseURL, distDir: out,
      pages: ["/", "/grain", "/missing"],
      dataRoutes: ["/search.json", "/sitemap.xml"],
      assets: [{ prefix: "/styles", dir: assetsSrc }],
    });

    expect(await readFile(join(out, "index.html"), "utf8")).toContain(`href="/styles/theme.css"`);
    expect(await exists(join(out, "grain/index.html"))).toBe(true);
    expect(await readFile(join(out, "search.json"), "utf8")).toContain(`"/grain"`);
    // asset dir copied verbatim; test file skipped
    expect(await exists(join(out, "styles/theme.css"))).toBe(true);
    expect(await exists(join(out, "styles/logo.svg"))).toBe(true);
    expect(await exists(join(out, "styles/theme.test.ts"))).toBe(false);
    // 404 recorded, not fatal
    expect(report.pages.find((p) => p.route === "/missing")!.ok).toBe(false);
    expect(report.pages.filter((p) => p.ok).length).toBe(2);
  });
});

describe("exportSite — subpath host (base path)", () => {
  test("prefixes every absolute ref across html, css, json", async () => {
    const out = join(dist, "sub");
    await exportSite({
      baseURL, distDir: out, basePath: "/repo",
      pages: ["/", "/grain"],
      dataRoutes: ["/search.json"],
      assets: [{ prefix: "/styles", dir: assetsSrc }],
    });
    expect(await readFile(join(out, "index.html"), "utf8")).toContain(`href="/repo/styles/theme.css"`);
    expect(await readFile(join(out, "grain/index.html"), "utf8")).toContain(`src="/repo/scripts/x.js"`);
    expect(await readFile(join(out, "search.json"), "utf8")).toContain(`"url":"/repo/grain"`);
    expect(await readFile(join(out, "styles/theme.css"), "utf8")).toContain(`url("/repo/fonts/x.woff2")`);
  });

  test("warns when sitemap keeps the crawl origin and no PUBLIC_ORIGIN is set", async () => {
    const out = join(dist, "warn");
    const report = await exportSite({
      baseURL, distDir: out, basePath: "/repo",
      pages: ["/"], dataRoutes: ["/sitemap.xml"],
    });
    expect(report.warnings.some((w) => w.includes("crawl origin"))).toBe(true);
  });

  test("rewrites the crawl origin when PUBLIC_ORIGIN is given", async () => {
    const out = join(dist, "origin");
    await exportSite({
      baseURL, distDir: out, publicOrigin: "https://example.com",
      pages: ["/"], dataRoutes: ["/sitemap.xml"],
    });
    const xml = await readFile(join(out, "sitemap.xml"), "utf8");
    expect(xml).toContain("https://example.com/grain");
    expect(xml).not.toContain(baseURL);
  });
});
