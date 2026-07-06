// /framework/http/llms.ts — render an /llms.txt (the llmstxt.org convention): a Markdown index
// an AI crawler reads to learn what a site IS and where its canonical docs live. The AI-facing
// counterpart to /sitemap.xml + /robots.txt (which target search engines), served the same way.
//
// BATCH owns only the FORMAT — it takes a generic {title, summary, sections} structure and knows
// nothing about the content. The composition root supplies the curated links (batch stays
// vocabulary-agnostic, exactly like createSitemap's extraRoutes). Relative link paths are made
// absolute against `origin` so the export's origin-rewrite (batch/export §.txt) can swap the deploy
// URL in, mirroring how robots.txt/sitemap.xml carry absolute URLs.

export interface LlmsLink {
  title: string;
  url: string;                 // "/batch" (absolutized against origin) or an already-absolute URL
  note?: string;               // one-line description after the link
}
export interface LlmsSection {
  heading: string;             // "## " section header (e.g. "The stack", "Docs")
  links: LlmsLink[];
}
export interface LlmsDoc {
  title: string;               // the required H1
  summary?: string;            // the "> " blockquote right under the title
  details?: string[];          // optional free prose paragraphs before the sections
  sections: LlmsSection[];
}

// A relative "/path" becomes origin + path; an already-absolute URL is left untouched.
const absolutize = (url: string, origin: string): string =>
  /^[a-z]+:\/\//i.test(url) ? url : origin.replace(/\/+$/, "") + url;

export function renderLlms(doc: LlmsDoc, origin: string): string {
  const out: string[] = [`# ${doc.title}`];
  if (doc.summary) out.push("", `> ${doc.summary}`);
  for (const p of doc.details ?? []) out.push("", p);
  for (const s of doc.sections) {
    if (!s.links.length) continue;                 // never emit an empty section header
    out.push("", `## ${s.heading}`, "");
    for (const l of s.links)
      out.push(`- [${l.title}](${absolutize(l.url, origin)})${l.note ? `: ${l.note}` : ""}`);
  }
  return out.join("\n") + "\n";
}
