import { expect, test } from "bun:test";
import { createRenderer, stripHtmlComments } from "./render.ts";

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

// --- stripComments (plans/strip-template-comments) ---------------------------------------------
//
// Driven through the `templates` record rather than a fixture file, so each case's input is visible
// in the assertion that reads it. The option applies identically to both source paths — they meet
// at one line in `template()` — and `stripHtmlComments` is tested directly for the carve-outs where
// a string is easier to read than a rendered component.

test("stripComments removes a template's comments from the output", async () => {
  const commented = createRenderer({
    templates: { "x-doc": "<!-- why this exists, at length -->\n<span data-field=\"label\">b</span>" },
    missing: "ignore",
    stripComments: true,
  });

  const out = await commented.render("x-doc", { label: "hello" });
  expect(out).not.toContain("why this exists");
  expect(out).not.toContain("<!--");
  expect(out).toContain("hello");
});

test("the default leaves comments exactly where they were", async () => {
  // The compatibility claim. Upgrading must not move anybody's bytes, so the same template through
  // a renderer with no `stripComments` keeps its comment.
  const plain = createRenderer({
    templates: { "x-doc": "<!-- kept -->\n<span data-field=\"label\">b</span>" },
    missing: "ignore",
  });

  expect(await plain.render("x-doc", { label: "hi" })).toContain("<!-- kept -->");
});

test("a script body survives, because its content is not markup", async () => {
  // The case a naive regex corrupts. `<!--` inside a raw-text element is not a comment, and a
  // legacy script wrapper or any JavaScript containing the sequence has to come through untouched.
  const source = [
    "<!-- this goes -->",
    "<script>const wrapped = \"<!-- this stays -->\"; if (a < b) {}</script>",
    "<style>/* <!-- and this --> */ .x { color: red }</style>",
    "<span data-field=\"label\">b</span>",
  ].join("\n");
  const r2 = createRenderer({ templates: { "x-doc": source }, missing: "ignore", stripComments: true });

  const out = await r2.render("x-doc", { label: "hi" });
  expect(out).not.toContain("this goes");
  expect(out).toContain("this stays");
  expect(out).toContain("and this");
  // And the script's own operators are intact, which is the corruption a `<` heuristic would cause.
  expect(out).toContain("if (a < b) {}");
});

test("a binding mentioned only inside a comment stops being a live binding", async () => {
  // The behavior change that comes with stripping before `bindAttrs` is extracted. The commented
  // `data-bind-href` used to be collected and applied; now it is what it looks like, which is off.
  const source = "<!-- <a data-bind-href=\"url\">old</a> --><span data-field=\"label\">b</span>";
  const stripped = createRenderer({ templates: { "x-doc": source }, missing: "throw", stripComments: true });

  // `missing: "throw"` is the proof: with the comment counted, `url` is a binding this data does
  // not provide and the render would reject.
  expect(await stripped.render("x-doc", { label: "hi" })).toContain("hi");
});

test("stripHtmlComments keeps whitespace, and ends a comment at the first arrow", async () => {
  // Two properties asserted on strings because that is where they are legible.
  //
  // Whitespace first: the newline a comment sat on stays, because whitespace between inline
  // elements is significant in HTML and collapsing it would change rendering to save bytes gzip
  // reclaims anyway.
  expect(stripHtmlComments("<b>a</b> <!-- x --> <i>b</i>")).toBe("<b>a</b>  <i>b</i>");

  // And a comment ends at the FIRST `-->`, so the text between two comments survives rather than
  // being swallowed by a greedy match.
  expect(stripHtmlComments("<!-- a --> keep <!-- c -->")).toBe(" keep ");
});
