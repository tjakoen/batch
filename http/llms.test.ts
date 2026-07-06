import { expect, test } from "bun:test";
import { renderLlms, type LlmsDoc } from "./llms.ts";

const origin = "http://localhost:3000";

const doc: LlmsDoc = {
  title: "BREAD",
  summary: "one vocabulary, two operators",
  details: ["No build step. Zero runtime deps."],
  sections: [
    { heading: "The stack", links: [
      { title: "BATCH", url: "/batch", note: "the substrate" },
      { title: "GRAIN", url: "/grain" },                                  // no note
    ]},
    { heading: "External", links: [
      { title: "llmstxt.org", url: "https://llmstxt.org", note: "the spec" }, // already-absolute
    ]},
    { heading: "Empty", links: [] },                                       // dropped
  ],
};

test("renders the llmstxt.org shape: H1, blockquote, prose, sections", () => {
  const md = renderLlms(doc, origin);
  expect(md.startsWith("# BREAD\n")).toBe(true);
  expect(md).toContain("> one vocabulary, two operators");
  expect(md).toContain("No build step. Zero runtime deps.");
  expect(md).toContain("## The stack");
  expect(md.endsWith("\n")).toBe(true);
});

test("absolutizes relative paths against origin, leaves absolute URLs untouched", () => {
  const md = renderLlms(doc, origin);
  expect(md).toContain("[BATCH](http://localhost:3000/batch): the substrate");
  expect(md).toContain("[GRAIN](http://localhost:3000/grain)");           // no trailing ": "
  expect(md).not.toContain("[GRAIN](http://localhost:3000/grain):");
  expect(md).toContain("[llmstxt.org](https://llmstxt.org): the spec");   // not double-prefixed
});

test("a trailing slash on origin does not double up", () => {
  expect(renderLlms(doc, "http://localhost:3000/")).toContain("(http://localhost:3000/batch)");
});

test("empty sections emit no header", () => {
  expect(renderLlms(doc, origin)).not.toContain("## Empty");
});

test("a bare doc (no summary/details) still renders just the title + sections", () => {
  const md = renderLlms({ title: "X", sections: [{ heading: "S", links: [{ title: "a", url: "/a" }] }] }, origin);
  expect(md).toBe("# X\n\n## S\n\n- [a](http://localhost:3000/a)\n");
});
