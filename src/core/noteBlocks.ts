/**
 * Note block model for Typora-style live editing.
 *
 * Invariant: each block is *content only* — never carries inter-block
 * separators. Separators (`\n\n`) exist only in serialize/parse.
 *
 *   parse("a\n\n## b\n\nc")  →  ["a", "## b", "c"]
 *   serialize(["a", "## b", "c"])  →  "a\n\n## b\n\nc"
 *
 * Soft breaks inside a block use a single `\n` (marked `breaks: true`).
 */

/** Split stored markdown into editable content blocks (no trailing blank lines). */
export function parseNoteBlocks(markdown: string): string[] {
  if (markdown === "") {
    return [""];
  }

  // Split on blank lines; keep single newlines inside a block as soft breaks.
  const raw = markdown.split(/\n{2,}/).map(stripBlockEdges);

  // Drop trailing empty blocks from storage artifacts; keep a single "" for empty docs.
  while (raw.length > 1 && raw[raw.length - 1] === "") {
    raw.pop();
  }

  return raw.length > 0 ? raw : [""];
}

/** Join content blocks into stored markdown. */
export function serializeNoteBlocks(blocks: string[]): string {
  if (blocks.length === 0) {
    return "";
  }

  const normalized = blocks.map(stripBlockEdges);

  // Avoid persisting a dangling empty tail (except a fully empty note).
  while (normalized.length > 1 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }

  if (normalized.length === 1 && normalized[0] === "") {
    return "";
  }

  return normalized.join("\n\n");
}

/** Trim only leading/trailing newlines — preserve intentional spaces. */
function stripBlockEdges(text: string): string {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}
