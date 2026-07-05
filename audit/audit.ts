// batch/audit/audit.ts — a framework-generic performance + SEO/AEO auditor.
//
// Drives Playwright (chromium) across a list of pages on an ALREADY-RUNNING BATCH app and reports:
//   • performance — TTFB, DOMContentLoaded, load, wire bytes, JS/CSS bytes, request count, render-blocking
//   • SEO — <title>, meta description, canonical, Open Graph/Twitter, <html lang>, one-h1, semantic tags
//   • AEO/AIEO — schema.org JSON-LD, machine-readable affordances, plus caller-named endpoint probes
//
// This is the reusable engine, not the product's audit: it knows nothing about which app it's pointed
// at, which pages exist, or any design vocabulary. The consumer supplies the base URL, the page list,
// the endpoints, and any extra selectors to count (e.g. grain's [data-surface]) via `selectors`. It
// returns pure data + a generic table renderer; the consumer owns booting its server and any narrative.
// Parallel to `batch/export`: framework-generic capability in batch, invoked against an app from outside.
import { chromium } from "@playwright/test";

export interface AuditConfig {
  /** Base URL of a running app, e.g. "http://localhost:3320". */
  baseURL: string;
  /** Page paths to visit, e.g. ["/", "/about"]. 404s are recorded, not fatal. */
  pages: string[];
  /** Site-level endpoints to probe for HTTP status, e.g. ["/sitemap.xml", "/robots.txt"]. */
  endpoints?: string[];
  /** Extra CSS selectors to count per page, keyed by a human label. Lets a consumer measure its own
      affordances (grain counts [data-surface] etc.) without batch knowing the vocabulary. */
  selectors?: Record<string, string>;
  viewport?: { width: number; height: number };
}

export interface Perf {
  status: number; ttfbMs: number; domContentLoadedMs: number; loadMs: number;
  wireBytes: number; jsBytes: number; cssBytes: number; requests: number;
}
export interface DomAudit {
  title: string | null; titleLen: number;
  metaDescription: string | null; canonical: string | null; htmlLang: string | null;
  og: string[]; twitter: number;
  h1Count: number; hasMain: boolean; hasArticle: boolean; hasNav: boolean; hasTime: boolean;
  jsonLd: string[];
  renderBlockingCss: number; renderBlockingJs: number; ariaAttrs: number;
  /** Counts for each selector in AuditConfig.selectors, keyed by the same label. */
  selectorCounts: Record<string, number>;
}
export interface PageReport { path: string; ok: boolean; perf?: Perf; dom?: DomAudit; error?: string; }
export interface AuditReport { generatedAgainst: string; pages: PageReport[]; endpoints: Record<string, number>; }

export const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)}kb`;

async function auditPage(
  page: import("@playwright/test").Page,
  baseURL: string,
  path: string,
  selectors: Record<string, string>,
): Promise<PageReport> {
  try {
    const resp = await page.goto(`${baseURL}${path}`, { waitUntil: "load", timeout: 20000 });
    const status = resp?.status() ?? 0;
    if (!resp || !resp.ok()) return { path, ok: false, error: `HTTP ${status}` };
    await page.waitForTimeout(200);
    // Read everything in-page. Access DOM/perf via globalThis casts so this stays valid under a
    // non-DOM tsconfig (the stack is server-side; tsc must stay green).
    const data = await page.evaluate((sel: Record<string, string>) => {
      const doc = (globalThis as unknown as { document: any }).document;
      const perf = (globalThis as unknown as { performance: any }).performance;
      const qa = (s: string): any[] => Array.from(doc.querySelectorAll(s));
      const q = (s: string): any => doc.querySelector(s);
      const nav = perf.getEntriesByType("navigation")[0];
      const res: any[] = perf.getEntriesByType("resource");
      const wireBytes = (nav?.transferSize ?? 0) + res.reduce((s2, r) => s2 + (r.transferSize || 0), 0);
      // The headline native-first metric: JS shipped to the browser (framework runtime + islands).
      let jsBytes = 0, cssBytes = 0;
      for (const r of res) {
        const sz = r.transferSize || 0; const u = String(r.name || "");
        if (r.initiatorType === "script" || u.endsWith(".js")) jsBytes += sz;
        else if (r.initiatorType === "link" || r.initiatorType === "css" || u.endsWith(".css")) cssBytes += sz;
      }
      const jsonLd: string[] = [];
      qa('script[type="application/ld+json"]').forEach((s) => {
        try { const j = JSON.parse(s.textContent || "{}"); const t = j["@type"]; jsonLd.push(t ? (Array.isArray(t) ? t.join("/") : String(t)) : "(no @type)"); }
        catch { jsonLd.push("(invalid)"); }
      });
      const head = doc.head;
      const rbJs = head ? qa("head script[src]").filter((s) => !s.hasAttribute("async") && !s.hasAttribute("defer") && s.getAttribute("type") !== "module").length : 0;
      let ariaAttrs = 0;
      qa("*").forEach((el) => { for (const a of Array.from(el.attributes) as any[]) if (a.name.startsWith("aria-") || a.name === "role") ariaAttrs++; });
      const selectorCounts: Record<string, number> = {};
      for (const [label, s] of Object.entries(sel)) selectorCounts[label] = qa(s).length;
      const title: string | null = doc.title || null;
      const dom: DomAudit = {
        title, titleLen: title?.length ?? 0,
        metaDescription: q('meta[name="description"]')?.content ?? null,
        canonical: q('link[rel="canonical"]')?.href ?? null,
        htmlLang: doc.documentElement.getAttribute("lang"),
        og: qa('meta[property^="og:"]').map((m) => m.getAttribute("property") || "").filter(Boolean),
        twitter: qa('meta[name^="twitter:"]').length,
        h1Count: qa("h1").length,
        hasMain: !!q("main"), hasArticle: !!q("article"), hasNav: !!q("nav"), hasTime: !!q("time"),
        jsonLd,
        renderBlockingCss: head ? qa('head link[rel="stylesheet"]').length : 0,
        renderBlockingJs: rbJs,
        ariaAttrs, selectorCounts,
      };
      const perfOut = {
        ttfbMs: Math.round(nav?.responseStart ?? 0),
        domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd ?? 0),
        loadMs: Math.round(nav?.loadEventEnd ?? 0),
        wireBytes, jsBytes, cssBytes, requests: 1 + res.length,
      };
      return { dom, perfOut } as { dom: DomAudit; perfOut: Omit<Perf, "status"> };
    }, selectors);
    return { path, ok: true, perf: { status, ...data.perfOut }, dom: data.dom };
  } catch (e) {
    return { path, ok: false, error: (e as Error).message };
  }
}

/** Run the audit against an already-running app. The caller owns booting/killing the server. */
export async function audit(config: AuditConfig): Promise<AuditReport> {
  const { baseURL, pages: paths, endpoints = [], selectors = {} } = config;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: config.viewport ?? { width: 1200, height: 850 } });
  const pages: PageReport[] = [];
  for (const path of paths) {
    process.stdout.write(`[audit] ${path} … `);
    const r = await auditPage(page, baseURL, path, selectors);
    pages.push(r);
    console.log(r.ok ? `ok (${r.perf!.status}, ${kb(r.perf!.jsBytes)} JS / ${kb(r.perf!.wireBytes)} total, ${r.perf!.requests} req, load ${r.perf!.loadMs}ms)` : `skip (${r.error})`);
  }
  await browser.close();

  const endpointStatus: Record<string, number> = {};
  for (const e of endpoints) { try { endpointStatus[e] = (await fetch(`${baseURL}${e}`)).status; } catch { endpointStatus[e] = 0; } }

  return { generatedAgainst: baseURL, pages, endpoints: endpointStatus };
}

const mark = (ok: boolean) => (ok ? "✓" : "✗");
const endpointLine = (e: string, status: number) => `\`${e}\` ${status === 200 ? "✓" : `✗ (${status})`}`;

/** Generic markdown tables for the report: a per-page perf/SEO grid (one extra column per selector
    label) plus an endpoints list. Consumers wrap this with their own narrative / verdicts. */
export function renderTables(report: AuditReport, selectorLabels: string[] = []): string {
  const okp = report.pages.filter((p) => p.ok);
  const selCols = selectorLabels.map((l) => ` ${l} |`).join("");
  const selDivs = selectorLabels.map(() => ":--:|").join("");
  const rows = okp.map((p) => {
    const d = p.dom!, pf = p.perf!;
    const sel = selectorLabels.map((l) => ` ${d.selectorCounts[l] ?? 0} |`).join("");
    return `| \`${p.path}\` | ${pf.ttfbMs}ms | ${pf.loadMs}ms | ${kb(pf.wireBytes)} | **${kb(pf.jsBytes)}** | ${pf.requests} | ${d.renderBlockingCss}css/${d.renderBlockingJs}js | ` +
      `${mark(!!d.title)} | ${mark(!!d.metaDescription)} | ${mark(!!d.canonical)} | ${mark(d.og.length > 0)} | ${mark(d.h1Count === 1)} | ${mark(d.jsonLd.length > 0)} |${sel}`;
  }).join("\n");
  const epLines = Object.entries(report.endpoints).map(([e, s]) => `- ${endpointLine(e, s)}`).join("\n");
  return `| Page | TTFB | Load | Wire | JS | Req | Blocking | Title | Desc | Canon | OG | 1×H1 | JSON-LD |${selCols}\n` +
    `|------|------|------|------|----|-----|----------|:-----:|:----:|:-----:|:--:|:----:|:-------:|${selDivs}\n` +
    `${rows}`;
}
