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
