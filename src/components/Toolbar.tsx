import type { ToolDefinition } from "../types";

const TOOLS: ToolDefinition[] = [
  { type: "note", title: "Note", subtitle: "Markdown note card" },
  { type: "todo", title: "To-do", subtitle: "Checklist card" },
  { type: "link", title: "Link", subtitle: "URL with local metadata" },
  { type: "image", title: "Image", subtitle: "Import local image file" },
  { type: "board", title: "Board", subtitle: "Nested canvas board" },
];

export function Toolbar() {
  return (
    <aside className="toolbar">
      <h2 className="toolbar-title">Components</h2>
      <div className="toolbar-list">
        {TOOLS.map((tool) => (
          <div
            key={tool.type}
            className="tool-card"
            draggable
            onDragStart={(event) => {
              const payload = JSON.stringify({
                kind: "tool",
                toolType: tool.type,
              });
              event.dataTransfer.setData("application/json", payload);
              event.dataTransfer.setData("text/plain", payload);
              event.dataTransfer.effectAllowed = "copyMove";
            }}
          >
            <div className="tool-name">{tool.title}</div>
            <div className="tool-subtitle">{tool.subtitle}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
