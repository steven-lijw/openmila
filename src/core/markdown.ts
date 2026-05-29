import { marked } from "marked";

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const attr = title ? ` title="${title}"` : "";
      return `<a href="${href}"${attr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export function renderMarkdown(src: string): string {
  if (!src) return "";
  return marked(src, { async: false }) as string;
}
