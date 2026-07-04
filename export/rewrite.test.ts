// batch/export/rewrite.test.ts — the export's branching logic (path mapping + base-path rewrite).
import { expect, test, describe } from "bun:test";
import { normalizeBasePath, routeToDistPath, rewriteRefs, rewriteOrigin, extractRefs, scanModuleImports } from "./rewrite.ts";

describe("scanModuleImports", () => {
  test("resolves relative static/export-from/side-effect/dynamic specifiers against the module path", () => {
    const js = `import { a } from "./contract.js";\nexport { b } from "../shared/util.js";\n` +
      `import "./boot.js";\nconst m = await import("./lazy.js");`;
    expect(scanModuleImports(js, "/modules/grain/ai/client-door.js").sort()).toEqual([
      "/modules/grain/ai/boot.js", "/modules/grain/ai/contract.js",
      "/modules/grain/ai/lazy.js", "/modules/grain/shared/util.js",
    ]);
  });
  test("ignores bare, root-absolute, and url specifiers; dedupes", () => {
    const js = `import h from "htmx";\nimport s from "/scripts/x.js";\nimport u from "https://cdn/z.js";\n` +
      `import { a } from "./a.js";\nimport { b } from "./a.js";`;
    expect(scanModuleImports(js, "/modules/grain/ai/door.js")).toEqual(["/modules/grain/ai/a.js"]);
  });
});

describe("normalizeBasePath", () => {
  test("empty forms → ''", () => {
    for (const v of [undefined, null, "", "  ", "/"]) expect(normalizeBasePath(v)).toBe("");
  });
  test("adds leading slash, strips trailing", () => {
    expect(normalizeBasePath("repo")).toBe("/repo");
    expect(normalizeBasePath("/repo/")).toBe("/repo");
    expect(normalizeBasePath("/a/b/")).toBe("/a/b");
  });
});

describe("routeToDistPath", () => {
  test("pages become pretty directories", () => {
    expect(routeToDistPath("/", true)).toBe("index.html");
    expect(routeToDistPath("/grain", true)).toBe("grain/index.html");
    expect(routeToDistPath("/a/b", true)).toBe("a/b/index.html");
  });
  test("data routes keep their filename", () => {
    expect(routeToDistPath("/components.css", false)).toBe("components.css");
    expect(routeToDistPath("/search.json", false)).toBe("search.json");
    expect(routeToDistPath("/robots.txt", false)).toBe("robots.txt");
  });
});

describe("rewriteRefs — no-op cases", () => {
  test("empty base path leaves content untouched", () => {
    const html = `<a href="/grain">x</a>`;
    expect(rewriteRefs(html, ".html", "")).toBe(html);
    expect(rewriteRefs(html, ".html", "/")).toBe(html);
  });
  test("unknown extension untouched", () => {
    expect(rewriteRefs(`/keep/me`, ".xml", "/repo")).toBe(`/keep/me`);
  });
});

describe("rewriteRefs — HTML", () => {
  const bp = "/repo";
  test("rewrites href/src/action absolute refs", () => {
    const out = rewriteRefs(
      `<link href="/styles/x.css"><script src="/scripts/a.js"></script><form action="/intent">`,
      ".html", bp);
    expect(out).toContain(`href="/repo/styles/x.css"`);
    expect(out).toContain(`src="/repo/scripts/a.js"`);
    expect(out).toContain(`action="/repo/intent"`);
  });
  test("preserves anchors, keeps fragments/queries", () => {
    const out = rewriteRefs(`<a href="/grain#top?x=1">`, ".html", bp);
    expect(out).toBe(`<a href="/repo/grain#top?x=1">`);
  });
  test("leaves relative, protocol-relative, external, and hash refs alone", () => {
    const html = `<a href="about">r</a><a href="//cdn/x">p</a><a href="https://y/z">e</a><a href="#s">h</a>`;
    expect(rewriteRefs(html, ".html", bp)).toBe(html);
  });
  test("rewrites url() inside <style>", () => {
    const out = rewriteRefs(`<style>a{background:url("/assets/s.svg")}</style>`, ".html", bp);
    expect(out).toContain(`url("/repo/assets/s.svg")`);
  });
});

describe("rewriteRefs — CSS", () => {
  test("rewrites url() forms, leaves data: URIs", () => {
    const css = `@font-face{src:url("/fonts/r.woff2")} a{background:url(/assets/s.svg)} b{background:url("data:image/svg+xml,x")}`;
    const out = rewriteRefs(css, ".css", "/repo");
    expect(out).toContain(`url("/repo/fonts/r.woff2")`);
    expect(out).toContain(`url(/repo/assets/s.svg)`);
    expect(out).toContain(`url("data:image/svg+xml,x")`);   // untouched
  });
});

describe("rewriteRefs — JS", () => {
  test("rewrites import/from/fetch absolute specifiers only", () => {
    const js = `import {a} from "/scripts/t.js";\nfetch("/intent");\nconst x="/not/a/url";`;
    const out = rewriteRefs(js, ".js", "/repo");
    expect(out).toContain(`from "/repo/scripts/t.js"`);
    expect(out).toContain(`fetch("/repo/intent")`);
    expect(out).toContain(`const x="/not/a/url"`);   // bare string literal left alone
  });
});

describe("rewriteRefs — JSON url fields", () => {
  test("rewrites only \"url\" values", () => {
    const json = `{"pages":[{"title":"/keep","url":"/grain"}]}`;
    const out = rewriteRefs(json, ".json", "/repo");
    expect(out).toContain(`"url":"/repo/grain"`);
    expect(out).toContain(`"title":"/keep"`);   // non-url string untouched
  });
});

describe("extractRefs", () => {
  test("collects absolute href/src, strips fragment/query, dedupes", () => {
    const html = `<a href="/grain#top">g</a><link href="/grain?v=1"><script src="/scripts/x.js"></script>`;
    expect(extractRefs(html).sort()).toEqual(["/grain", "/scripts/x.js"]);
  });
  test("ignores relative, protocol-relative, scheme, and hash refs", () => {
    const html = `<a href="about">r</a><a href="//cdn/x">p</a><a href="https://y">e</a><a href="#s">h</a><a href="mailto:a@b">m</a>`;
    expect(extractRefs(html)).toEqual([]);
  });
});

describe("rewriteOrigin", () => {
  test("swaps crawl origin for public origin", () => {
    const xml = `<loc>http://localhost:3330/grain</loc>`;
    expect(rewriteOrigin(xml, "http://localhost:3330", "https://ex.com/")).toBe(`<loc>https://ex.com/grain</loc>`);
  });
  test("no public origin → unchanged", () => {
    const xml = `<loc>http://localhost:3330/grain</loc>`;
    expect(rewriteOrigin(xml, "http://localhost:3330", undefined)).toBe(xml);
  });
});
