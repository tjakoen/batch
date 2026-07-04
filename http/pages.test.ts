// batch/http/pages.test.ts — page routing + the global-asset injection seams.
// The seams exist so EVERY rendered page carries the same platform-wide assets; the
// head seam is render-blocking territory (pre-paint bootstraps), the body seam is
// deferred-island territory. A page shell built elsewhere (the catalog) mirrors them.
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePageServer } from "./pages.ts";
import { bunRuntime } from "../platform/bun-runtime.ts";

const PAGE = `<!DOCTYPE html><html><head><title>t</title></head><body><p>hi</p></body></html>`;
const identity = async (html: string) => html;

describe("makePageServer injection seams", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "batch-pages-"));
    await writeFile(join(dir, "index.html"), PAGE);
    await writeFile(join(dir, "asset.js"), `console.log("raw")`);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test("body seam: injected before </body> on rendered pages", async () => {
    const serve = makePageServer(bunRuntime, dir, identity, `<script src="/x.js"></script>`);
    const out = await (await serve("/")).text();
    expect(out).toContain(`<script src="/x.js"></script></body>`);
  });

  test("head seam: injected before </head> (pre-paint slot), independent of the body seam", async () => {
    const serve = makePageServer(bunRuntime, dir, identity, "", `<script src="/boot.js"></script>`);
    const out = await (await serve("/")).text();
    expect(out).toContain(`<script src="/boot.js"></script></head>`);
    expect(out).toContain(`</body>`);           // body untouched
    expect(out).not.toContain(`boot.js"></script></body>`);
  });

  test("both seams together land in their own slots", async () => {
    const serve = makePageServer(bunRuntime, dir, identity, `<i>body</i>`, `<i>head</i>`);
    const out = await (await serve("/")).text();
    expect(out).toContain(`<i>head</i></head>`);
    expect(out).toContain(`<i>body</i></body>`);
  });

  test("assets pass through untouched (no injection outside pages)", async () => {
    const serve = makePageServer(bunRuntime, dir, identity, `<i>body</i>`, `<i>head</i>`);
    const out = await (await serve("/asset.js")).text();
    expect(out).toBe(`console.log("raw")`);
  });
});
