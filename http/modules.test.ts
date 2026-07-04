// batch/http/modules.test.ts — no-build client module serving + the client-safe import guard.
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeModuleServer, findServerOnlyImports, rewriteTsSpecifiers } from "./modules.ts";
import { bunRuntime } from "../platform/bun-runtime.ts";

describe("findServerOnlyImports", () => {
  test("passes relative + url imports, flags bare (server-only/npm) imports", () => {
    const src = `import a from "./x.ts";\nimport b from "../y.ts";\nimport c from "https://cdn/z.js";\n` +
      `import fs from "node:fs";\nimport { x } from "bun";\nimport htmx from "htmx";`;
    expect(findServerOnlyImports(src).sort()).toEqual(["bun", "htmx", "node:fs"]);
  });
  test("honors the allowlist", () => {
    expect(findServerOnlyImports(`import x from "htmx";`, ["htmx"])).toEqual([]);
  });
  test("clean module → nothing flagged", () => {
    expect(findServerOnlyImports(`export const x: number = 1;\nimport {a} from "./a.ts";`)).toEqual([]);
  });
});

describe("rewriteTsSpecifiers", () => {
  test("rewrites relative static, export-from, side-effect, and dynamic imports", () => {
    const js = `import { a } from "./x.ts";\nexport { b } from "../deep/y.tsx";\nimport "./boot.mts";\n` +
      `const m = await import("./lazy.ts");`;
    const out = rewriteTsSpecifiers(js);
    expect(out).toContain(`from "./x.js"`);
    expect(out).toContain(`from "../deep/y.js"`);
    expect(out).toContain(`import "./boot.js"`);
    expect(out).toContain(`import("./lazy.js")`);
  });
  test("leaves bare/url/absolute specifiers and non-import strings alone", () => {
    const js = `import h from "htmx";\nimport u from "https://cdn/z.ts";\nconst s = "./not-an-import.ts";`;
    expect(rewriteTsSpecifiers(js)).toBe(js);
  });
});

describe("makeModuleServer", () => {
  let dir: string, server: ReturnType<typeof makeModuleServer>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "batch-modules-"));
    await mkdir(join(dir, "ai"), { recursive: true });
    await writeFile(join(dir, "ai", "contract.ts"),
      `import { helper } from "./helper.ts";\nexport type Kind = "a" | "b";\nexport const ACTIONS: string[] = ["go"];\nexport const h = helper;`);
    await writeFile(join(dir, "ai", "helper.ts"), `export const helper: number = 42;`);
    await writeFile(join(dir, "ai", "leaky.ts"), `import { readFileSync } from "node:fs";\nexport const x = readFileSync;`);
    server = makeModuleServer(bunRuntime, { roots: { grain: dir } });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test("transpiles TS → JS: strips types, rewrites relative .ts specifiers to .js", async () => {
    const r = await server.serve("/modules/grain/ai/contract.ts");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/javascript");
    const body = await r.text();
    expect(body).toContain(`export const ACTIONS = ["go"]`);   // value kept
    expect(body).not.toContain("export type Kind");            // type erased
    expect(body).toContain(`from "./helper.js"`);              // .ts → .js: uniform browser-facing graph
  });

  test("a .js URL falls back to the .ts source on disk (same body as the .ts URL)", async () => {
    const r = await server.serve("/modules/grain/ai/contract.js");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(`from "./helper.js"`);
    expect((await server.serve("/modules/grain/ai/truly-missing.js")).status).toBe(404);
  });

  test("refuses a server-only module with a throwing stub that names the offender", async () => {
    const r = await server.serve("/modules/grain/ai/leaky.ts");
    expect(r.status).toBe(200);                                // 200 so the browser LOADS + shows the error
    const body = await r.text();
    expect(body).toContain("client-safe");
    expect(body).toContain("node:fs");
    expect(body).toContain("throw new Error");
  });

  test("404 unknown root / missing file; 403 on traversal; 415 on unsupported type", async () => {
    expect((await server.serve("/modules/nope/x.ts")).status).toBe(404);
    expect((await server.serve("/modules/grain/ai/missing.ts")).status).toBe(404);
    expect((await server.serve("/modules/grain/../../etc/passwd")).status).toBe(403);
    await writeFile(join(dir, "ai", "note.md"), `# not a module`);
    expect((await server.serve("/modules/grain/ai/note.md")).status).toBe(415);
  });

  test("outside the prefix → 404", async () => {
    expect((await server.serve("/scripts/x.js")).status).toBe(404);
  });

  test("refresh clears the cache", async () => {
    await server.serve("/modules/grain/ai/helper.ts");
    server.refresh();                                          // no throw; next serve re-transpiles
    expect((await server.serve("/modules/grain/ai/helper.ts")).status).toBe(200);
  });
});
