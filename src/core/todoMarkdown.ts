export interface TodoItem {
  id: string;
  checked: boolean;
  text: string;
}

function stableId(text: string, index: number): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  hash ^= index;
  hash = (hash * 0x01000193) >>> 0;
  return `todo_${hash.toString(16).padStart(8, "0")}`;
}

export function parseTodoMarkdown(markdown: string): TodoItem[] {
  const lines = markdown.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    const match = line.match(/^- \[( |x)\] (.*)$/i);
    if (!match) {
      return {
        id: stableId(line.trim(), index),
        checked: false,
        text: line.trim(),
      };
    }
    return {
      id: stableId(match[2], index),
      checked: match[1].toLowerCase() === "x",
      text: match[2],
    };
  });
}

export function stringifyTodoMarkdown(items: TodoItem[]): string {
  return items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`).join("\n");
}
