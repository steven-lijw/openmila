export interface TodoItem {
  id: string;
  checked: boolean;
  text: string;
}

export function parseTodoMarkdown(markdown: string): TodoItem[] {
  const lines = markdown.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    const match = line.match(/^- \[( |x)\] (.*)$/i);
    if (!match) {
      return {
        id: `todo_${index}`,
        checked: false,
        text: line.trim(),
      };
    }
    return {
      id: `todo_${index}`,
      checked: match[1].toLowerCase() === "x",
      text: match[2],
    };
  });
}

export function stringifyTodoMarkdown(items: TodoItem[]): string {
  return items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`).join("\n");
}
