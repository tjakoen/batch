// batch/http/static.test.ts — the static mount serves what a file actually is.
//
// Why this exists. The Content-Type used to be a four-branch ternary ending in `text/html`, which is
// the right default for a static SITE (an extensionless route is a page) and silently wrong for
// anything binary. A browser handed a PDF labelled text/html does not fail: it renders the raw bytes
// as text. It was found that way, a sample PDF dumping its own source onto a docs page, and nothing
// in any test suite had an opinion about it. This is that opinion.
import { test, expect } from "bun:test";
import { makeStatic } from "./static.ts";
import type { Runtime } from "../platform/runtime.ts";

const rt = {
  fileExists: async () => true,
  readFile: async () => new Uint8Array([1, 2, 3]),
} as unknown as Runtime;

const typeOf = async (file: string): Promise<string | null> =>
  (await makeStatic(rt, "/root")(`/${file}`)).headers.get("content-type");

test("binary assets are served as themselves, never as text/html", async () => {
  expect(await typeOf("deck.pdf")).toBe("application/pdf");
  expect(await typeOf("photo.jpg")).toBe("image/jpeg");
  expect(await typeOf("photo.jpeg")).toBe("image/jpeg");
  expect(await typeOf("shot.png")).toBe("image/png");
  expect(await typeOf("icon.ico")).toBe("image/x-icon");
  expect(await typeOf("art.webp")).toBe("image/webp");
});

test("the text and font types the shell already depended on still hold", async () => {
  expect(await typeOf("app.css")).toBe("text/css");
  expect(await typeOf("island.js")).toBe("text/javascript");
  expect(await typeOf("body.woff2")).toBe("font/woff2");
  expect(await typeOf("sprite.svg")).toBe("image/svg+xml");
  expect(await typeOf("data.json")).toBe("application/json");
});

test("an unknown or absent extension still falls back to text/html, because routes are pages", async () => {
  expect(await typeOf("about")).toBe("text/html");
  expect(await typeOf("weird.qqq")).toBe("text/html");
});

test("the extension match is case-insensitive (a camera writes IMG_0001.JPG)", async () => {
  expect(await typeOf("IMG_0001.JPG")).toBe("image/jpeg");
  expect(await typeOf("DECK.PDF")).toBe("application/pdf");
});

test("traversal is still refused, and a missing file is still a 404", async () => {
  const missing = { ...rt, fileExists: async () => false } as unknown as Runtime;
  expect((await makeStatic(rt, "/root")("/../secret.pdf")).status).toBe(403);
  expect((await makeStatic(missing, "/root")("/gone.pdf")).status).toBe(404);
});
