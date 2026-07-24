import { marked } from "marked";
import { isSafeHref, isSafeImageSrc } from "./safeUrl";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Tags allowed in rendered note previews after sanitization. */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
  "div",
]);

const GLOBAL_ATTRS = new Set(["class"]);

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "title"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  code: new Set(["class"]),
  span: new Set(["class"]),
  div: new Set(["class"]),
};

/**
 * Strip scripts, event handlers, and unsafe URLs from marked output.
 * Runs in the browser via DOMParser; if unavailable (SSR/tests), falls back
 * to a conservative regex strip of script/style/iframe tags.
 */
export function sanitizeHtml(html: string): string {
  if (!html) {
    return "";
  }

  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) {
    return "";
  }

  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed element with its text content only.
        const text = doc.createTextNode(el.textContent ?? "");
        el.replaceWith(text);
        return;
      }

      // Drop every attribute that isn't on the allow-list, then re-check URLs.
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const allowedForTag = TAG_ATTRS[tag] ?? GLOBAL_ATTRS;
        if (name.startsWith("on") || (!GLOBAL_ATTRS.has(name) && !allowedForTag.has(name))) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === "href" && !isSafeHref(attr.value)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === "src" && !isSafeImageSrc(attr.value)) {
          el.removeAttribute(attr.name);
          continue;
        }
      }

      if (tag === "a") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }

      // Snapshot children first — walk may replace siblings.
      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }
      return;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      node.parentNode?.removeChild(node);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }

  return root.innerHTML;
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const attr = title ? ` title="${escapeAttr(title)}"` : "";
      const safeHref = isSafeHref(href) ? escapeAttr(href) : "";
      if (!safeHref) {
        return text;
      }
      return `<a href="${safeHref}"${attr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ href, title, text }) {
      if (!isSafeImageSrc(href)) {
        return escapeText(text || "");
      }
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text || "")}"${titleAttr}>`;
    },
    // Reject raw HTML blocks/inline that authors paste into notes.
    html() {
      return "";
    },
  },
});

export function renderMarkdown(src: string): string {
  if (!src) {
    return "";
  }
  const raw = marked(src, { async: false }) as string;
  return sanitizeHtml(raw);
}
