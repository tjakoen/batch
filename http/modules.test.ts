// batch/http/modules.test.ts — no-build client module serving + the client-safe import guard.
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeModuleServer, findServerOnlyImports } from "./modules.ts";
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

  test("transpiles TS → JS: strips types, keeps .ts import specifiers for URL resolution", async () => {
    const r = await server.serve("/modules/grain/ai/contract.ts");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/javascript");
    const body = await r.text();
    expect(body).toContain(`export const ACTIONS = ["go"]`);   // value kept
    expect(body).not.toContain("export type Kind");            // type erased
    expect(body).toContain(`from "./helper.ts"`);              // relative specifier preserved (browser resolves)
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
