// batch/render/render.ts — generic composition engine (createRenderer)
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type MissingMode = "ignore" | "warn" | "throw";
export interface RenderConfig {
  componentsDir?: string | string[];
  // component name (e.g. "b-button") → template SOURCE text. Lets a consumer
  // supply templates directly instead of the readdirSync directory walk — a
  // Bun `--compile` binary has no real filesystem to walk, so this is how a
  // compiled consumer feeds in components it embedded at build time.
  templates?: Record<string, string>;
  missing: MissingMode;
  // Drop HTML comments from template source as it loads. Off by default, so upgrading
  // moves nobody's output.
  //
  // For a consumer that comments its components as documentation — the house style in at
  // least one — the commentary is most of what it serves: measured at 65% of every HTML
  // document on one app, and still 59% of the compressed bytes after gzip had done its
  // work. Prose is the most compressible thing in a file and it still costs more than the
  // markup around it.
  //
  // Strips at load rather than on the way out, and that is the whole reason this belongs
  // here rather than in a consumer's response filter: a finished page holds content as
  // well as templates, and content can legitimately contain a comment (markdown renders
  // one through). Only this layer can tell a template's commentary from a document's own.
  stripComments?: boolean;
}

/**
 * Every `<script>` or `<style>` element, body and all.
 *
 * These are HTML's raw-text elements: their content is not markup, so `<!--` inside one is not a
 * comment and has to survive verbatim. A legacy `<!--` script wrapper, or any JavaScript that
 * happens to contain the sequence, is corrupted by a comment regex that does not know the
 * difference.
 *
 * The closing tag is a backreference (`<\/\1`), so a `<style>` cannot be closed by a `</script>`.
 */
const RAW_TEXT_ELEMENT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Non-greedy on purpose: an HTML comment ends at the FIRST `-->`, so `<!-- a --> b <!-- c -->` is
 * two comments with ` b ` surviving between them rather than one comment swallowing it.
 */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Template source with its HTML comments removed and its raw-text elements untouched.
 *
 * Exported for its own test, and because a consumer that builds the `templates` record by hand
 * wants the same treatment without reimplementing the raw-text carve-out.
 *
 * **Whitespace is left exactly as it was.** Removing a comment leaves the newline it sat on. That is
 * deliberate rather than lazy: whitespace between inline elements is significant in HTML, so
 * collapsing it would change how a page renders in order to save bytes gzip reclaims anyway.
 *
 * Conditional comments (`<!--[if IE]>`) go with everything else. They are markup for a browser that
 * no longer exists, and a consumer who needs one leaves the option off.
 */
export function stripHtmlComments(html: string): string {
  let out = "";
  let cursor = 0;
  for (const match of html.matchAll(RAW_TEXT_ELEMENT)) {
    out += html.slice(cursor, match.index).replace(HTML_COMMENT, "");
    out += match[0];   // raw text, verbatim
    cursor = match.index + match[0].length;
  }
  return out + html.slice(cursor).replace(HTML_COMMENT, "");
}

interface Resolved { found: boolean; value: unknown; }
function resolvePath(obj: any, path: string): Resolved {
  if (path === "" || path === ".") return { found: true, value: obj };  // self: the scope itself
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur == null || !Object.hasOwn(Object(cur), key)) return { found: false, value: undefined };
    cur = cur[key];                            // own-prop only: no __proto__/constructor reach
  }
  return { found: true, value: cur };          // found:true even when value is null
}
function format(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();   // deterministic across host locale/tz
  return String(v);
}

// Attributes whose VALUE is a URL — a data-driven `javascript:` / `data:` scheme
// is an XSS vector that HTML-quote-escaping does NOT neutralize. Block it.
const URL_ATTRS = new Set([
  "href", "src", "action", "formaction", "xlink:href", "poster", "background", "ping",
  "hx-get", "hx-post", "hx-put", "hx-patch", "hx-delete",   // htmx request targets are URLs too
]);
const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|\?)/i;
function safeAttr(attr: string, value: string): string {
  if (!URL_ATTRS.has(attr.toLowerCase())) return value;
  const trimmed = value.trim();
  if (trimmed === "" || SAFE_URL.test(trimmed)) return value;
  return "";   // unknown/unsafe scheme (javascript:, data:, vbscript:, …) → drop
}

export function createRenderer(config: RenderConfig) {
  // path: on disk, discovered by readdirSync. source: inline template text, supplied
  // via `templates`. Exactly one is set per entry.
  const registry = new Map<string, { path?: string; source?: string }>();
  const cache = new Map<string, { html: string; bindAttrs: string[] }>();
  let names: string[] = [];
  let selfCloseRe: RegExp | null = null;   // rebuilt on refresh() (names change only then)

  function discover(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) discover(full);
      else if (e.name.endsWith(".html")) {
        const n = e.name.slice(0, -5);
        if (n.includes("-")) registry.set(n, { path: full });   // hyphenated = component
      }
    }
  }
  function refresh() {
    registry.clear(); cache.clear();
    if (config.componentsDir) {
      for (const root of ([] as string[]).concat(config.componentsDir)) discover(root);   // one or many roots
    }
    if (config.templates) {
      for (const [n, source] of Object.entries(config.templates)) {
        if (n.includes("-")) registry.set(n, { source });   // hyphenated = component; explicit wins over discovered
      }
    }
    names = [...registry.keys()];
    selfCloseRe = names.length ? new RegExp(`<(${names.join("|")})((?:\\s[^>]*?)?)\\s*/>`, "g") : null;
  }

  function onMissing(component: string, path: string) {
    if (config.missing === "ignore") return;
    const msg = `[render] unknown binding "${path}" in <${component}>`;
    if (config.missing === "throw") throw new Error(msg);
    console.warn(msg);
  }
  async function template(name: string): Promise<{ html: string; bindAttrs: string[] }> {
    const hit = cache.get(name);
    if (hit) return hit;
    const entry = registry.get(name);
    if (!entry) throw new Error(`Component not found: <${name}>`);
    const raw = entry.source !== undefined ? entry.source : await Bun.file(entry.path!).text();   // platform seam
    // One place, because both source paths meet here and the result is cached: a strip costs one
    // pass per component per process rather than one per request.
    const html = config.stripComments === true ? stripHtmlComments(raw) : raw;
    // Extracted from the STRIPPED source, and the ordering is a deliberate behavior change rather
    // than an accident of where the line sits. A `data-bind-*` attribute mentioned only inside a
    // comment used to land here and become a live binding the template does not actually have.
    // With comments gone first, a commented-out binding is commented out.
    const bindAttrs = [...new Set([...html.matchAll(/data-bind-([\w-]+)=/g)].map(m => m[1]))];
    const tpl = { html, bindAttrs };
    cache.set(name, tpl);
    return tpl;
  }

  // PASS 0 — resolve config props (literal attrs a component was used with).
  function applyProps(html: string, props: Record<string, string>): string {
    const slot = html.match(/<slot-tag\b[^>]*?\bprop-as="([^"]*)"/);
    if (slot) {
      const tag = (props["as"] ?? slot[1] ?? "span").replace(/[^a-zA-Z0-9-]/g, "");
      html = html.replace(/<slot-tag\b/g, `<${tag}`)
                 .replace(/<\/slot-tag>/g, `</${tag}>`)
                 .replace(/\sprop-as="[^"]*"/g, "");
    }
    return html.replace(/\sprop-attr-([\w-]+)="([^"]*)"/g, (_m, attr, propName) => {
      const v = props[propName];
      if (v == null) return "";                       // prop not supplied → drop the attribute
      if (v === "") return ` ${attr}`;                // bare boolean attr (e.g. `required`)
      return ` ${attr}="${v.replace(/"/g, "&quot;")}"`;
    });
  }

  // HTML forbids self-closing custom elements (`<b-input />` is parsed as an
  // UNCLOSED tag that swallows its siblings). Normalize self-closing component
  // tags to an explicit open/close so authors can write `<b-input />`.
  function expandSelfClosing(html: string): string {
    if (!selfCloseRe) return html;
    selfCloseRe.lastIndex = 0;                          // reset shared global regex
    return html.replace(selfCloseRe, (_m, tag, attrs) => `<${tag}${attrs}></${tag}>`);
  }

  // The core two-pass transform — shared by render() (a registered component) and
  // renderPage() (an arbitrary HTML document that may contain component tags).
  async function transform(
    rawTpl: string, data: any, props: Record<string, string>, name: string, bindAttrs: string[],
  ): Promise<string> {
    const tpl = expandSelfClosing(rawTpl);
    const r = (p: string) => resolvePath(data, p);

    // PASS 1 — text via data-field, literal text via prop-text, attributes via data-bind-<attr>.
    let rw = new HTMLRewriter().on("[prop-text]", {
      element(el) {
        const propName = el.getAttribute("prop-text")!;
        el.removeAttribute("prop-text");
        const v = props[propName];
        if (v != null) el.setInnerContent(v);          // literal prop → escaped text content
      },
    }).on("[data-field]", {
      element(el) {
        const path = el.getAttribute("data-field")!;
        const res = r(path);
        if (!res.found) onMissing(name, path);
        el.setInnerContent(format(res.value));
      },
    });
    for (const attr of bindAttrs) {
      rw = rw.on(`[data-bind-${attr}]`, {
        element(el) {
          const path = el.getAttribute(`data-bind-${attr}`)!;
          const res = r(path);
          if (!res.found) onMissing(name, path);
          const v = safeAttr(attr, format(res.value));   // scheme guard for URL attrs
          // empty/absent value → omit the attribute entirely (e.g. no inert hx-post="")
          if (v !== "") el.setAttribute(attr, v);
        },
      });
    }
    let html = await rw.transform(new Response(tpl)).text();

    // PASS 2 — expand every known component tag.
    const jobs: Array<Promise<string>> = [];
    let rw2 = new HTMLRewriter();
    for (const comp of names) {
      rw2 = rw2.on(comp, {
        element(el) {
          const eachPath = el.getAttribute("each");
          const dataPath = el.getAttribute("data");
          const childProps: Record<string, string> = {};
          for (const [n, v] of el.attributes) if (n !== "each" && n !== "data") childProps[n] = v;
          const idx = jobs.length;
          if (eachPath != null) {
            const eachRes = r(eachPath);
            if (!eachRes.found) onMissing(name, eachPath);     // typo'd each= is a dev signal, not silent ""
            const arr = eachRes.value;
            jobs.push(Array.isArray(arr)
              ? Promise.all(arr.map(d => render(comp, d, childProps))).then(a => a.join(""))
              : Promise.resolve(""));                          // found-but-null/empty → intentional blank
          } else {
            const slice = dataPath != null ? r(dataPath).value : data;
            jobs.push(render(comp, slice, childProps));
          }
          el.replace(`<!--slot:${idx}-->`, { html: true });
        },
      });
    }
    html = await rw2.transform(new Response(html)).text();
    const parts = await Promise.all(jobs);
    // function replacement: child HTML may contain $& / $` / $' / $$ — a string
    // replacement would treat those as patterns and corrupt the output.
    parts.forEach((p, i) => { html = html.replace(`<!--slot:${i}-->`, () => p); });
    return html;
  }

  async function render(name: string, data: any, props: Record<string, string> = {}): Promise<string> {
    const { html: rawTpl, bindAttrs } = await template(name);
    const tpl = applyProps(rawTpl, props);             // PASS 0 — config
    return transform(tpl, data, props, name, bindAttrs);
  }

  // Render an arbitrary HTML document (a page), expanding any component tags it
  // contains. Pages carry no props of their own; component tags inside supply theirs.
  async function renderPage(html: string, data: any = {}): Promise<string> {
    const bindAttrs = [...new Set([...html.matchAll(/data-bind-([\w-]+)=/g)].map(m => m[1]))];
    return transform(html, data, {}, "page", bindAttrs);
  }

  refresh();
  return { render, renderPage, refresh };
}
