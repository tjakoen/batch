import { expect, test } from "bun:test";
import { createRenderer } from "./render.ts";

// BATCH tests its engine with its OWN fixtures (no dependency on grain/project) —
// x-list (each → x-item via data-field), x-link (data-bound URL attr), x-badge.
// File-relative (not cwd-relative) so it resolves both in the monorepo and after the
// split, when batch/ becomes the repo root (SPLIT-PLAN.md).
const FIXTURES = import.meta.dir + "/__fixtures__";
const r = createRenderer({ componentsDir: FIXTURES, missing: "ignore" });

test("escapes hostile text", async () => {
  const out = await r.render("x-list", { items: [{ name: "<script>alert(1)</script>" }] });
  expect(out).toContain("&lt;script&gt;");
  expect(out).not.toContain("<script>alert");
});

test("drops javascript: scheme in a data-bound URL attribute", async () => {
  const bad = await r.render("x-link", { url: "javascript:alert(1)" });
  expect(bad).not.toContain("javascript:");        // unsafe scheme stripped to empty
});

test("child HTML with $ sequences splices verbatim (no $&/$$ corruption)", async () => {
  const out = await r.render("x-list", { items: [{ name: "$& $$ $1" }] });
  expect(out).toContain("$&amp; $$ $1");           // literal, not pattern-substituted
});

test("strict mode catches a binding the data does not provide", async () => {
  const strict = createRenderer({ componentsDir: FIXTURES, missing: "throw" });
  await expect(strict.render("x-badge", { lbel: "typo" }))
    .rejects.toThrow(/unknown binding "label"/);
});

test("templates-only construction (no componentsDir) renders a component", async () => {
  const inline = createRenderer({
    templates: { "x-badge": `<span data-field="label"></span>` },
    missing: "ignore",
  });
  const out = await inline.render("x-badge", { label: "hi" });
  expect(out).toContain("hi");
});

test("an explicit template wins over a discovered file of the same name", async () => {
  const both = createRenderer({
    componentsDir: FIXTURES,
    templates: { "x-badge": `<span data-field="label">explicit</span>` },
    missing: "ignore",
  });
  const out = await both.render("x-badge", { label: "hi" });
  expect(out).toContain("hi");
  expect(out).not.toContain(">b<");   // "b" is the fixture file's hardcoded default text
});

test("a self-closing tag resolves when the component came from templates", async () => {
  const inline = createRenderer({
    templates: {
      "x-badge": `<span data-field="label"></span>`,
      "x-page": `<div><x-badge /></div>`,
    },
    missing: "ignore",
  });
  const out = await inline.render("x-page", { label: "hi" });
  expect(out).toContain("<span");
  expect(out).toContain("hi");
});
