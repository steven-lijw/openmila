import type { ToolDefinition } from "../types";

const TOOLS: ToolDefinition[] = [
  { type: "note", title: "Note", subtitle: "Markdown note card" },
  { type: "todo", title: "To-do", subtitle: "Checklist card" },
  { type: "link", title: "Link", subtitle: "URL with local metadata" },
  { type: "image", title: "Image", subtitle: "Import local image file" },
  { type: "file", title: "File", subtitle: "Upload PDF, Word, PPT and more" },
  { type: "board", title: "Board", subtitle: "Nested canvas board" },
];

function ToolIcon(props: { type: ToolDefinition["type"] }) {
  switch (props.type) {
    case "note":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="7" y1="16" x2="13" y2="16" />
        </svg>
      );
    case "link":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "todo":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <line x1="4" y1="7" x2="9" y2="7" />
          <line x1="4" y1="12" x2="9" y2="12" />
          <line x1="4" y1="17" x2="9" y2="17" />
          <line x1="13" y1="17" x2="22" y2="17" />
        </svg>
      );
    case "image":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <polyline points="9 15 12 12 15 15" />
        </svg>
      );
    case "board":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    default:
      return null;
  }
}

function ToolButton(props: { tool: ToolDefinition; highlighted?: boolean }) {
  const { tool, highlighted = false } = props;

  return (
    <button
      type="button"
      key={tool.type}
      className={`sidebar-item ${highlighted ? "active" : ""}`}
      draggable
      title={tool.subtitle}
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
      <ToolIcon type={tool.type} />
      <span className="label">{tool.title}</span>
    </button>
  );
}

export function Toolbar() {
  const primaryTools = TOOLS.filter((tool) => ["note", "link", "todo", "board"].includes(tool.type));
  const libraryTools = TOOLS.filter((tool) => ["image", "file"].includes(tool.type));

  return (
    <aside className="toolbar">
      <div className="toolbar-group">
        {primaryTools.map((tool) => (
          <ToolButton key={tool.type} tool={tool} highlighted={tool.type === "board"} />
        ))}
      </div>
      <div className="toolbar-footer">
        <div className="sidebar-divider" />
        <div className="toolbar-group toolbar-group-bottom">
          {libraryTools.map((tool) => (
            <ToolButton key={tool.type} tool={tool} />
          ))}
        </div>
      </div>
    </aside>
  );
}
