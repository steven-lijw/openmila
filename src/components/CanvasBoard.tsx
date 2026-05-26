import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { formatFileSize, getFilePreviewMeta } from "../core/filePreview";
import { createId } from "../core/ids";
import { getLinkPreview } from "../core/linkPreview";
import { parseTodoMarkdown, stringifyTodoMarkdown } from "../core/todoMarkdown";
import { CARD_COLORS } from "../core/model";
import { marked } from "marked";
import type { BoardBundle, CardMeta, DragCardPayload, DragToolPayload, Point } from "../types";

interface CanvasBoardProps {
  boardBundle: BoardBundle;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  readAssetUrl: (assetPath: string) => Promise<string>;
  onCanvasCreate: (toolType: DragToolPayload["toolType"], position: Point) => void;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onClearSelection: () => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onUpdateBoardCardTitle: (boardId: string, cardId: string, title: string) => void;
  onBringCardsToFront: (cardIds: string[]) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string) => void;
  onCancelConnection: () => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
  onUpdateEdge: (edgeId: string, updater: (edge: import("../types").Edge) => import("../types").Edge) => void;
  onDeleteEdge: (edgeId: string) => void;
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
  onDropExternalFiles: (files: File[], position: Point) => void | Promise<void>;
}

interface CardRendererProps {
  boardBundle: BoardBundle;
  card: CardMeta;
  assetUrls: Record<string, string>;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  displayPosition: Point;
  displaySize: { width: number; height: number };
  isDragging: boolean;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onUpdateBoardCardTitle: (boardId: string, cardId: string, title: string) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string, anchorPoint: Point) => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
  onStartPointerDrag: (card: CardMeta, event: MouseEvent<HTMLDivElement>) => void;
  onStartResize: (card: CardMeta, event: MouseEvent<HTMLButtonElement>) => void;
}

interface DraggingCardState {
  cardIds: string[];
  startPointer: Point;
  startPositions: Record<string, Point>;
  positions: Record<string, Point>;
}

interface ConnectionPreviewState {
  sourceCardId: string;
  start: Point;
  pointer: Point;
}

interface SelectionBoxState {
  start: Point;
  current: Point;
}

interface ResizingCardState {
  cardId: string;
  startPointer: Point;
  startSize: { width: number; height: number };
  size: { width: number; height: number };
}

function readDragPayload(event: DragEvent): DragToolPayload | DragCardPayload | null {
  try {
    const raw = event.dataTransfer.getData("application/json") || event.dataTransfer.getData("text/plain");
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as DragToolPayload | DragCardPayload;
  } catch {
    return null;
  }
}

function setDropEffect(event: DragEvent) {
  const payload = readDragPayload(event);
  event.dataTransfer.dropEffect = payload?.kind === "tool" ? "copy" : "move";
}

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, a, .connection-dot, .resize-handle"));
}

function pointsEqual(a: Point | undefined, b: Point | undefined) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function renderEditableContent(input: {
  card: CardMeta;
  markdown: string;
  assetUrl?: string;
  isEditable: boolean;
  onUpdateCard: (updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (markdown: string) => void;
  onUpdateBoardCardTitle?: (title: string) => void;
}) {
  const { card, markdown, assetUrl, isEditable, onUpdateCard, onUpdateMarkdown, onUpdateBoardCardTitle } = input;

  if (card.type === "note") {
    return isEditable ? (
      <NoteEditor
        card={card}
        markdown={markdown}
        onUpdateMarkdown={onUpdateMarkdown}
        onUpdateCard={onUpdateCard}
      />
    ) : (
      <div
        className="card-preview markdown-body"
        dangerouslySetInnerHTML={{ __html: markdown ? marked.parse(markdown) : "" }}
      />
    );
  }

  if (card.type === "todo") {
    const items = parseTodoMarkdown(markdown);
    return <TodoList card={card} items={items} onUpdateMarkdown={onUpdateMarkdown} onUpdateCard={onUpdateCard} />;
  }

  if (card.type === "link") {
    const preview = getLinkPreview(card.url);
    return (
      <div className="link-fields">
        <input
          placeholder="https://example.com"
          value={card.url}
          onChange={(event) =>
            onUpdateCard((currentCard) =>
              currentCard.type === "link" ? { ...currentCard, url: event.target.value } : currentCard,
            )
          }
        />
        {preview ? (
          <a className="link-preview" href={preview.href} target="_blank" rel="noreferrer">
            {preview.imageUrl ? <img src={preview.imageUrl} alt={preview.title} className="link-preview-image" /> : null}
            <div className="link-preview-copy">
              <div className="link-preview-title">{preview.title}</div>
              <div className="link-preview-subtitle">{preview.subtitle}</div>
            </div>
          </a>
        ) : null}
      </div>
    );
  }

  if (card.type === "image") {
    return (
      <div className="image-card-body">
        {card.assetPath && assetUrl ? (
          <img src={assetUrl} alt={card.title} className="image-preview" />
        ) : (
          <div className="image-placeholder">Drop or create with a file to show the image here.</div>
        )}
      </div>
    );
  }

  if (card.type === "file") {
    const preview = getFilePreviewMeta({ fileName: card.title, mimeType: card.mimeType });

    return (
      <div className="file-card-body">
        <div className="file-meta-row">
          <span className="file-type-badge">{preview.label}</span>
          <span className="file-size-text">{formatFileSize(card.sizeBytes)}</span>
        </div>

        {card.assetPath && assetUrl ? (
          <>
            <div className="file-preview-area">
              {preview.kind === "pdf" ? (
                <iframe src={assetUrl} title={card.title} className="file-preview-frame" />
              ) : null}
              {preview.kind === "media" && card.mimeType.startsWith("video/") ? (
                <video src={assetUrl} controls className="file-preview-media" />
              ) : null}
              {preview.kind === "media" && card.mimeType.startsWith("audio/") ? (
                <audio src={assetUrl} controls className="file-preview-audio" />
              ) : null}
              {preview.kind !== "pdf" && preview.kind !== "media" && preview.canRenderInline ? (
                <iframe src={assetUrl} title={card.title} className="file-preview-frame" />
              ) : null}
              {preview.kind !== "pdf" && preview.kind !== "media" ? (
                <div className="file-preview-fallback">
                  <div className="file-preview-title">{card.title}</div>
                  <div className="file-preview-copy">
                    Some formats depend on browser-native preview support. If this area looks empty, open the original file.
                  </div>
                </div>
              ) : null}
            </div>
            <a className="file-open-link" href={assetUrl} target="_blank" rel="noreferrer">
              Open file
            </a>
          </>
        ) : (
          <div className="image-placeholder">Choose a file to show it here.</div>
        )}
      </div>
    );
  }

  if (card.type === "board") {
    return (
      <div className="board-card">
        <div className="board-icon-shell">
          <svg
            className="board-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
          </svg>
        </div>
        <input
          className="board-title-input"
          value={card.title}
          onChange={(event) => {
            const newTitle = event.target.value;
            onUpdateCard((currentCard) =>
              currentCard.type === "board" ? { ...currentCard, title: newTitle } : currentCard,
            );
            onUpdateBoardCardTitle?.(newTitle);
          }}
          readOnly={!isEditable}
        />
      </div>
    );
  }

  return <div className="removed-card">Column has been removed</div>;
}

function NoteEditor(props: {
  card: CardMeta;
  markdown: string;
  onUpdateMarkdown: (markdown: string) => void;
  onUpdateCard: (updater: (card: CardMeta) => CardMeta) => void;
}) {
  const { card, markdown, onUpdateMarkdown, onUpdateCard } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const contentHeight = textarea.scrollHeight;
    const padding = 24;
    const desiredHeight = Math.ceil(contentHeight + padding);
    if (desiredHeight <= card.size.height) {
      return;
    }
    onUpdateCard((currentCard) => ({
      ...currentCard,
      size: {
        ...currentCard.size,
        height: Math.max(currentCard.size.height, desiredHeight),
      },
    }));
  }, [card.size.height, markdown, onUpdateCard]);

  return (
    <textarea
      ref={textareaRef}
      className="card-textarea"
      value={markdown}
      placeholder="Start writing…"
      onChange={(event) => onUpdateMarkdown(event.target.value)}
    />
  );
}

function TodoList(props: {
  card: CardMeta;
  items: ReturnType<typeof parseTodoMarkdown>;
  onUpdateMarkdown: (markdown: string) => void;
  onUpdateCard: (updater: (card: CardMeta) => CardMeta) => void;
}) {
  const { card, items, onUpdateMarkdown, onUpdateCard } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const focusRetryRef = useRef(0);

  const requestFocus = (index: number) => {
    pendingFocusIndexRef.current = index;
    focusRetryRef.current = 0;
    setFocusNonce((current) => current + 1);
  };

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const contentHeight = list.scrollHeight;
    const padding = 24;
    const desiredHeight = Math.ceil(contentHeight + padding);
    if (desiredHeight <= card.size.height) {
      return;
    }
    onUpdateCard((currentCard) => ({
      ...currentCard,
      size: {
        ...currentCard.size,
        height: Math.max(currentCard.size.height, desiredHeight),
      },
    }));
  }, [card.size.height, items, onUpdateCard]);

  useLayoutEffect(() => {
    const pendingIndex = pendingFocusIndexRef.current;
    if (pendingIndex === null) {
      return;
    }
    const list = listRef.current;
    if (!list) {
      return;
    }
    const inputs = list.querySelectorAll<HTMLInputElement>(".todo-text-input");
    const target = inputs[pendingIndex];
    if (target) {
      target.focus();
      pendingFocusIndexRef.current = null;
      focusRetryRef.current = 0;
      return;
    }

    if (focusRetryRef.current < 2) {
      focusRetryRef.current += 1;
      requestAnimationFrame(() => setFocusNonce((current) => current + 1));
    }
  }, [focusNonce, items.length, card.size.height]);

  return (
    <div ref={listRef} className="todo-list">
      {items.map((item, index) => (
        <label key={item.id} className="todo-item">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(event) => {
              const nextItems = items.map((entry) =>
                entry.id === item.id ? { ...entry, checked: event.target.checked } : entry,
              );
              onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
            }}
          />
          <input
            className="todo-text-input"
            value={item.text}
            placeholder="New task"
            onChange={(event) => {
              const nextItems = items.map((entry) =>
                entry.id === item.id ? { ...entry, text: event.target.value } : entry,
              );
              onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const nextItems = [...items];
                nextItems.splice(index + 1, 0, { id: createId("todo"), checked: false, text: "" });
                requestFocus(index + 1);
                onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
                return;
              }

              if ((event.key === "Delete" || event.key === "Backspace") && item.text.trim() === "") {
                event.preventDefault();
                const nextItems = items.filter((entry) => entry.id !== item.id);
                const normalizedItems =
                  nextItems.length === 0 ? [{ id: createId("todo"), checked: false, text: "" }] : nextItems;
                requestFocus(Math.max(index - 1, 0));
                onUpdateMarkdown(stringifyTodoMarkdown(normalizedItems));
              }
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function CanvasBoard(props: CanvasBoardProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextCanvasClickRef = useRef(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [draggingCard, setDraggingCard] = useState<DraggingCardState | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreviewState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [committedPositions, setCommittedPositions] = useState<Record<string, Point>>({});
  const [resizingCard, setResizingCard] = useState<ResizingCardState | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeMenuPos, setEdgeMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [localEdgeStyles, setLocalEdgeStyles] = useState<Record<string, { arrowDirection?: string; lineStyle?: string }>>({});

  const getMinSize = (card: CardMeta | undefined) => {
    if (!card) {
      return { width: 160, height: 120 };
    }
    switch (card.type) {
      case "note":
      case "todo":
      case "link":
        return { width: 304, height: 64 };
      case "board":
        return { width: 180, height: 120 };
      case "image":
        return { width: 280, height: 220 };
      case "file":
        return { width: 320, height: 260 };
      case "column":
        return { width: 300, height: 360 };
      default:
        return { width: 160, height: 120 };
    }
  };

  const getDisplaySize = (card: CardMeta) => {
    if (resizingCard?.cardId === card.id) {
      return resizingCard.size;
    }
    return card.size;
  };

  const getEdgeCenter = (card: CardMeta, position: Point) => {
    if (card.type === "board") {
      return {
        x: position.x + 50,
        y: position.y + 20,
      };
    }
    const size = getDisplaySize(card);
    return {
      x: position.x + size.width / 2,
      y: position.y + size.height / 2,
    };
  };

  // Returns where a line from (fromX, fromY) to the card center hits the card's edge
  const getEdgeEndpoint = (card: CardMeta, cardPosition: Point, fromX: number, fromY: number) => {
    const center = card.type === "board"
      ? { x: cardPosition.x + 50, y: cardPosition.y + 20 }
      : { x: cardPosition.x + getDisplaySize(card).width / 2, y: cardPosition.y + getDisplaySize(card).height / 2 };
    const size = getDisplaySize(card);

    const dx = center.x - fromX;
    const dy = center.y - fromY;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;

    // Determine which edge the line enters first using a stable clamp approach
    const halfW = size.width / 2;
    const halfH = size.height / 2;

    // Extend the line from center backward to find where it hits the bounding box
    // Line: P = center - t * (dx, dy), find smallest t > 0 where P is on the box edge
    let t = Infinity;
    if (dx > 0) t = Math.min(t, halfW / dx);   // left edge
    if (dx < 0) t = Math.min(t, -halfW / dx);  // right edge
    if (dy > 0) t = Math.min(t, halfH / dy);   // top edge
    if (dy < 0) t = Math.min(t, -halfH / dy);  // bottom edge

    return {
      x: center.x - dx * t,
      y: center.y - dy * t,
    };
  };

  useEffect(() => {
    for (const card of props.boardBundle.board.cards) {
      if ((card.type !== "image" && card.type !== "file") || !card.assetPath || assetUrls[card.id]) {
        continue;
      }
      void props.readAssetUrl(card.assetPath).then((url) => {
        setAssetUrls((current) => ({ ...current, [card.id]: url }));
      });
    }
  }, [assetUrls, props.boardBundle.board.cards, props.readAssetUrl]);

  const rootCards = useMemo(
    () => props.boardBundle.board.cards.filter((card) => card.parentId === null),
    [props.boardBundle.board.cards],
  );

  const rootCardMap = useMemo(
    () => Object.fromEntries(rootCards.map((card) => [card.id, card])),
    [rootCards],
  );

  useEffect(() => {
    setCommittedPositions((current) => {
      const next = { ...current };
      let changed = false;

      for (const [cardId, position] of Object.entries(current)) {
        const card = rootCardMap[cardId];
        if (!card || pointsEqual(card.position, position)) {
          delete next[cardId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [rootCardMap]);

  const screenToCanvas = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - props.boardBundle.board.viewport.x) / props.boardBundle.board.viewport.zoom,
      y: (clientY - rect.top - props.boardBundle.board.viewport.y) / props.boardBundle.board.viewport.zoom,
    };
  };

  useEffect(() => {
    if (!draggingCard && !connectionPreview && !selectionBox && !resizingCard) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const point = screenToCanvas(event.clientX, event.clientY);

      if (draggingCard) {
        const deltaX = point.x - draggingCard.startPointer.x;
        const deltaY = point.y - draggingCard.startPointer.y;

        setDraggingCard((current) =>
          current
            ? {
                ...current,
                positions: Object.fromEntries(
                  Object.entries(current.startPositions).map(([cardId, startPosition]) => [
                    cardId,
                    {
                      x: startPosition.x + deltaX,
                      y: startPosition.y + deltaY,
                    },
                  ]),
                ),
              }
            : null,
        );
      }

      if (connectionPreview) {
        setConnectionPreview((current) => (current ? { ...current, pointer: point } : null));
      }

      if (selectionBox) {
        setSelectionBox((current) => (current ? { ...current, current: point } : null));
      }

      if (resizingCard) {
        const minSize = getMinSize(rootCardMap[resizingCard.cardId]);
        const nextWidth = Math.max(minSize.width, resizingCard.startSize.width + (point.x - resizingCard.startPointer.x));
        const nextHeight = Math.max(minSize.height, resizingCard.startSize.height + (point.y - resizingCard.startPointer.y));
        setResizingCard((current) =>
          current ? { ...current, size: { width: nextWidth, height: nextHeight } } : null,
        );
      }
    };

    const handleMouseUp = () => {
      if (draggingCard) {
        setCommittedPositions((current) => ({ ...current, ...draggingCard.positions }));
        for (const [cardId, position] of Object.entries(draggingCard.positions)) {
          props.onUpdateCard(cardId, (card) => ({ ...card, position }));
        }
      }

      if (selectionBox) {
        const minX = Math.min(selectionBox.start.x, selectionBox.current.x);
        const maxX = Math.max(selectionBox.start.x, selectionBox.current.x);
        const minY = Math.min(selectionBox.start.y, selectionBox.current.y);
        const maxY = Math.max(selectionBox.start.y, selectionBox.current.y);

        const selectedIds = rootCards
          .filter((card) => {
            const displayPosition =
              draggingCard?.positions[card.id] ?? committedPositions[card.id] ?? card.position;
            const displaySize = resizingCard?.cardId === card.id ? resizingCard.size : card.size;
            const right = displayPosition.x + displaySize.width;
            const bottom = displayPosition.y + displaySize.height;
            return right >= minX && displayPosition.x <= maxX && bottom >= minY && displayPosition.y <= maxY;
          })
          .map((card) => card.id);

        ignoreNextCanvasClickRef.current = true;
        props.onClearSelection();
        selectedIds.forEach((cardId, index) => props.onSelectCard(cardId, index > 0));
        setSelectionBox(null);
      }

      if (connectionPreview) {
        props.onCancelConnection();
        setConnectionPreview(null);
      }

      if (resizingCard) {
        props.onUpdateCard(resizingCard.cardId, (card) => ({ ...card, size: resizingCard.size }));
        setResizingCard(null);
      }

      setDraggingCard(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [committedPositions, connectionPreview, draggingCard, props, resizingCard, rootCards, selectionBox]);

  // Delete selected edge via keyboard
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (!selectedEdgeId) {
        return;
      }
      event.preventDefault();
      props.onDeleteEdge?.(selectedEdgeId);
      setSelectedEdgeId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEdgeId, props]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (event.ctrlKey) {
        const rect = canvas.getBoundingClientRect();
        const worldX =
          (event.clientX - rect.left - props.boardBundle.board.viewport.x) / props.boardBundle.board.viewport.zoom;
        const worldY =
          (event.clientY - rect.top - props.boardBundle.board.viewport.y) / props.boardBundle.board.viewport.zoom;
        const nextZoom = Math.max(
          0.4,
          Math.min(1.8, props.boardBundle.board.viewport.zoom - event.deltaY * 0.01),
        );
        const nextX = event.clientX - rect.left - worldX * nextZoom;
        const nextY = event.clientY - rect.top - worldY * nextZoom;
        props.onViewportChange({
          ...props.boardBundle.board.viewport,
          x: nextX,
          y: nextY,
          zoom: nextZoom,
        });
        return;
      }

      props.onViewportChange({
        ...props.boardBundle.board.viewport,
        x: props.boardBundle.board.viewport.x - event.deltaX,
        y: props.boardBundle.board.viewport.y - event.deltaY,
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [props]);

  const edges = useMemo(() => {
    return props.boardBundle.board.edges
      .map((edge) => {
        const from = rootCardMap[edge.fromCardId];
        const to = rootCardMap[edge.toCardId];
        if (!from || !to) {
          return null;
        }

        const fromPosition = draggingCard?.positions[from.id] ?? committedPositions[from.id] ?? from.position;
        const toPosition = draggingCard?.positions[to.id] ?? committedPositions[to.id] ?? to.position;
        const fromSize = resizingCard?.cardId === from.id ? resizingCard.size : from.size;
        const toSize = resizingCard?.cardId === to.id ? resizingCard.size : to.size;
        const fromCenter = from.type === "board"
          ? getEdgeCenter(from, fromPosition)
          : { x: fromPosition.x + fromSize.width / 2, y: fromPosition.y + fromSize.height / 2 };
        const toCenter = to.type === "board"
          ? getEdgeCenter(to, toPosition)
          : { x: toPosition.x + toSize.width / 2, y: toPosition.y + toSize.height / 2 };
        const fromEndpoint = getEdgeEndpoint(from, fromPosition, toCenter.x, toCenter.y);
        const toEndpoint = getEdgeEndpoint(to, toPosition, fromCenter.x, fromCenter.y);
        // Arrow positions: extend outside card edges
        const toDx = toCenter.x - toEndpoint.x;
        const toDy = toCenter.y - toEndpoint.y;
        const toDist = Math.sqrt(toDx * toDx + toDy * toDy) || 1;
        const fromDx = fromCenter.x - fromEndpoint.x;
        const fromDy = fromCenter.y - fromEndpoint.y;
        const fromDist = Math.sqrt(fromDx * fromDx + fromDy * fromDy) || 1;
        const dir = localEdgeStyles[edge.id]?.arrowDirection ?? edge.arrowDirection ?? "right";
        const style = localEdgeStyles[edge.id]?.lineStyle ?? edge.lineStyle ?? "solid";

        return {
          id: edge.id,
          x1: fromCenter.x,
          y1: fromCenter.y,
          x2: toCenter.x,
          y2: toCenter.y,
          ax: toEndpoint.x,
          ay: toEndpoint.y,
          arrowFromX: toEndpoint.x - (toDx / toDist) * 10,
          arrowFromY: toEndpoint.y - (toDy / toDist) * 10,
          // Source side arrow
          fromAx: fromEndpoint.x,
          fromAy: fromEndpoint.y,
          arrowFromSrcX: fromEndpoint.x - (fromDx / fromDist) * 10,
          arrowFromSrcY: fromEndpoint.y - (fromDy / fromDist) * 10,
          arrowDirection: dir,
          lineStyle: style,
        };
      })
      .filter(Boolean);

    if (connectionPreview) {
      result.push({
        id: "preview-edge",
        x1: connectionPreview.start.x,
        y1: connectionPreview.start.y,
        x2: connectionPreview.pointer.x,
        y2: connectionPreview.pointer.y,
        ax: connectionPreview.pointer.x,
        ay: connectionPreview.pointer.y,
        arrowFromX: connectionPreview.pointer.x,
        arrowFromY: connectionPreview.pointer.y,
        fromAx: connectionPreview.pointer.x,
        fromAy: connectionPreview.pointer.y,
        arrowFromSrcX: connectionPreview.pointer.x,
        arrowFromSrcY: connectionPreview.pointer.y,
        arrowDirection: "right" as const,
        lineStyle: "solid" as const,
      });
    }

    return result;
  }, [committedPositions, connectionPreview, draggingCard, localEdgeStyles, props.boardBundle, props.boardBundle.board.edges, resizingCard, rootCardMap]);

  const viewportStyle = {
    transform: `translate(${props.boardBundle.board.viewport.x}px, ${props.boardBundle.board.viewport.y}px) scale(${props.boardBundle.board.viewport.zoom})`,
    transformOrigin: "0 0",
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropEffect(event);
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      ignoreNextCanvasClickRef.current = true;
      void props.onDropExternalFiles(droppedFiles, screenToCanvas(event.clientX, event.clientY));
      return;
    }

    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    const point = screenToCanvas(event.clientX, event.clientY);
    if (payload.kind === "tool") {
      ignoreNextCanvasClickRef.current = true;
      props.onCanvasCreate(payload.toolType, point);
    }
  };

  return (
    <div className="canvas-shell">
      <div
        className={`canvas-board ${draggingCard ? "is-dragging" : ""} ${resizingCard ? "is-resizing" : ""}`}
        ref={canvasRef}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onClick={(event) => {
          if (ignoreNextCanvasClickRef.current) {
            ignoreNextCanvasClickRef.current = false;
            return;
          }

          const target = event.target as HTMLElement;
          if (!target.closest(".canvas-card") && !target.closest(".edge-layer line")) {
            props.onClearSelection();
            setSelectedEdgeId(null);
            setEdgeMenuPos(null);
          }
        }}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".canvas-card") || target.closest(".edge-layer line") || target.closest(".edge-menu")) {
            return;
          }

          if (event.altKey) {
            setIsPanning(true);
            setPanStart({
              x: event.clientX - props.boardBundle.board.viewport.x,
              y: event.clientY - props.boardBundle.board.viewport.y,
            });
            return;
          }

          const startPoint = screenToCanvas(event.clientX, event.clientY);
          props.onClearSelection();
          setSelectedEdgeId(null);
          setEdgeMenuPos(null);
          setSelectionBox({
            start: startPoint,
            current: startPoint,
          });
        }}
        onMouseMove={(event) => {
          if (!isPanning || !panStart) {
            return;
          }

          props.onViewportChange({
            ...props.boardBundle.board.viewport,
            x: event.clientX - panStart.x,
            y: event.clientY - panStart.y,
          });
        }}
        onMouseUp={() => {
          setIsPanning(false);
          setPanStart(null);
        }}
        onMouseLeave={() => {
          setIsPanning(false);
          setPanStart(null);
        }}
      >
        <div
          className="canvas-inner"
          ref={canvasInnerRef}
          style={viewportStyle}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          <svg className="edge-layer">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#7f776d" />
              </marker>
              <marker id="arrowhead-selected" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#4a6cf7" />
              </marker>
            </defs>
            {edges.map((edge) =>
              edge ? (
                <g key={edge.id}>
                  {/* Invisible wider line for easier clicking */}
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke="transparent"
                    strokeWidth="12"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (edge.id !== "preview-edge") {
                        setSelectedEdgeId(edge.id);
                        setEdgeMenuPos({ x: e.clientX, y: e.clientY });
                        props.onClearSelection();
                      }
                    }}
                  />
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.ax ?? edge.x2}
                    y2={edge.ay ?? edge.y2}
                    stroke={selectedEdgeId === edge.id ? "#4a6cf7" : "#7f776d"}
                    strokeWidth={edge.id === "preview-edge" ? "3" : selectedEdgeId === edge.id ? "3" : "2"}
                    strokeDasharray={edge.id === "preview-edge" ? "6 4" : edge.lineStyle === "dashed" ? "6 4" : undefined}
                    pointerEvents="none"
                  />
                  {/* Right arrow: at target card edge */}
                  {(edge.arrowDirection === "right" || edge.arrowDirection === "both") && edge.id !== "preview-edge" ? (
                    <line
                      x1={edge.arrowFromX}
                      y1={edge.arrowFromY}
                      x2={edge.ax}
                      y2={edge.ay}
                      stroke={selectedEdgeId === edge.id ? "#4a6cf7" : "#7f776d"}
                      strokeWidth={selectedEdgeId === edge.id ? "3" : "2"}
                      markerEnd={selectedEdgeId === edge.id ? "url(#arrowhead-selected)" : "url(#arrowhead)"}
                      pointerEvents="none"
                    />
                  ) : null}
                  {/* Left arrow: at source card edge */}
                  {(edge.arrowDirection === "left" || edge.arrowDirection === "both") && edge.id !== "preview-edge" ? (
                    <line
                      x1={edge.arrowFromSrcX}
                      y1={edge.arrowFromSrcY}
                      x2={edge.fromAx}
                      y2={edge.fromAy}
                      stroke={selectedEdgeId === edge.id ? "#4a6cf7" : "#7f776d"}
                      strokeWidth={selectedEdgeId === edge.id ? "3" : "2"}
                      markerEnd={selectedEdgeId === edge.id ? "url(#arrowhead-selected)" : "url(#arrowhead)"}
                      pointerEvents="none"
                    />
                  ) : null}
                </g>
              ) : null,
            )}
          </svg>

          {selectionBox ? (
            <div
              className="selection-box"
              style={{
                left: Math.min(selectionBox.start.x, selectionBox.current.x),
                top: Math.min(selectionBox.start.y, selectionBox.current.y),
                width: Math.abs(selectionBox.current.x - selectionBox.start.x),
                height: Math.abs(selectionBox.current.y - selectionBox.start.y),
              }}
            />
          ) : null}

          {/* Edge style popup menu */}
          {edgeMenuPos && selectedEdgeId ? (() => {
            const edgeDef = props.boardBundle.board.edges.find((e) => e.id === selectedEdgeId);
            const dir = edgeDef?.arrowDirection ?? "right";
            const style = edgeDef?.lineStyle ?? "solid";
            return (
              <div
                className="edge-menu"
                style={{
                  position: "fixed",
                  left: edgeMenuPos.x,
                  top: edgeMenuPos.y - 10,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="edge-menu-section">
                  <span className="edge-menu-label">Arrow</span>
                  <div className="edge-menu-options">
                    {(["left", "right", "both"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`edge-menu-btn ${dir === d ? "active" : ""}`}
                        onClick={() => {
                          setLocalEdgeStyles((s) => ({ ...s, [selectedEdgeId]: { ...s[selectedEdgeId], arrowDirection: d } }));
                          props.onUpdateEdge(selectedEdgeId, (e) => ({ ...e, arrowDirection: d }));
                        }}
                      >
                        {d === "left" ? "←" : d === "right" ? "→" : "↔"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="edge-menu-section">
                  <span className="edge-menu-label">Style</span>
                  <div className="edge-menu-options">
                    {(["solid", "dashed"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`edge-menu-btn ${style === s ? "active" : ""}`}
                        onClick={() => {
                          setLocalEdgeStyles((s2) => ({ ...s2, [selectedEdgeId]: { ...s2[selectedEdgeId], lineStyle: s } }));
                          props.onUpdateEdge(selectedEdgeId, (e) => ({ ...e, lineStyle: s }));
                        }}
                      >
                        {s === "solid" ? "─" : "┈"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })() : null}

          {rootCards.map((card) => {
            const displayPosition =
              draggingCard?.positions[card.id] ?? committedPositions[card.id] ?? card.position;
            const displaySize = getDisplaySize(card);

            return (
              <CardRenderer
                key={card.id}
                boardBundle={props.boardBundle}
                card={card}
                assetUrls={assetUrls}
                selectedCardIds={props.selectedCardIds}
                activeCardId={props.activeCardId}
                connectFromCardId={props.connectFromCardId}
                displayPosition={displayPosition}
                displaySize={displaySize}
                isDragging={draggingCard?.cardIds.includes(card.id) ?? false}
                onSelectCard={props.onSelectCard}
                onUpdateCard={props.onUpdateCard}
                onUpdateMarkdown={props.onUpdateMarkdown}
                onUpdateBoardCardTitle={props.onUpdateBoardCardTitle}
                onMoveToBoard={props.onMoveToBoard}
                onStartConnection={(cardId, anchorPoint) => {
                  props.onStartConnection(cardId);
                  setConnectionPreview({
                    sourceCardId: cardId,
                    start: anchorPoint,
                    pointer: anchorPoint,
                  });
                }}
                onFinishConnection={(cardId) => {
                  props.onFinishConnection(cardId);
                  setConnectionPreview(null);
                }}
                onOpenBoard={props.onOpenBoard}
                onStartPointerDrag={(cardMeta, event) => {
                  const target = event.target as HTMLElement;
                  if (isInteractiveElement(target)) {
                    return;
                  }

                  event.stopPropagation();

                  const shouldKeepSelection = props.selectedCardIds.includes(cardMeta.id);
                  const movableIds =
                    shouldKeepSelection && props.selectedCardIds.length > 1
                      ? props.selectedCardIds.filter((selectedId) => rootCardMap[selectedId])
                      : [cardMeta.id];

                  if (!shouldKeepSelection || props.selectedCardIds.length <= 1) {
                    props.onSelectCard(cardMeta.id, event.shiftKey);
                  }

                  props.onBringCardsToFront(movableIds);

                  setDraggingCard({
                    cardIds: movableIds,
                    startPointer: screenToCanvas(event.clientX, event.clientY),
                    startPositions: Object.fromEntries(
                      movableIds.map((selectedId) => [
                        selectedId,
                        committedPositions[selectedId] ?? rootCardMap[selectedId].position,
                      ]),
                    ),
                    positions: Object.fromEntries(
                      movableIds.map((selectedId) => [
                        selectedId,
                        committedPositions[selectedId] ?? rootCardMap[selectedId].position,
                      ]),
                    ),
                  });
                }}
                onStartResize={(cardMeta, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setResizingCard({
                    cardId: cardMeta.id,
                    startPointer: screenToCanvas(event.clientX, event.clientY),
                    startSize: cardMeta.size,
                    size: cardMeta.size,
                  });
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CardRenderer(props: CardRendererProps) {
  const { boardBundle, card } = props;
  const markdown = boardBundle.documents[card.id] ?? "";
  const isSelected = props.selectedCardIds.includes(card.id);
  const isEditable = props.activeCardId === card.id;
  const isBoardCard = card.type === "board";

  return (
    <div
      className={`canvas-card ${isSelected ? "selected" : ""} ${isBoardCard ? "type-board" : ""} ${props.isDragging ? "dragging" : ""}`}
      style={{
        left: props.displayPosition.x,
        top: props.displayPosition.y,
        ...(isBoardCard ? {} : { width: props.displaySize.width, height: props.displaySize.height }),
        ...(card.cardColor ? { backgroundColor: card.cardColor } : {}),
      }}
      onDragOver={(event) => {
        if (card.type !== "board") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setDropEffect(event);
      }}
      onDrop={(event) => {
        if (card.type !== "board") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const payload = readDragPayload(event);
        if (!payload || payload.kind !== "card") {
          return;
        }
        props.onMoveToBoard(payload, card.childBoardId, { x: 120, y: 120 });
      }}
      onMouseDown={(event) => {
        if (isBoardCard && props.connectFromCardId && props.connectFromCardId !== card.id) {
          return;
        }
        props.onStartPointerDrag(card, event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelectCard(card.id, event.shiftKey);
      }}
      onMouseUp={(event) => {
        if (props.connectFromCardId && props.connectFromCardId !== card.id) {
          props.onFinishConnection(card.id);
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (card.type === "board" && !isInteractiveElement(event.target)) {
          props.onOpenBoard(card.childBoardId);
        }
      }}
    >
      {isSelected && !isBoardCard ? (
        <div className="color-bar">
          {CARD_COLORS.map((colorDef) => (
            <button
              key={colorDef.key}
              type="button"
              className={`color-swatch ${card.cardColor === colorDef.bg || (!card.cardColor && colorDef.key === "default") ? "active" : ""}`}
              style={{ backgroundColor: colorDef.bg }}
              title={colorDef.label}
              onClick={(e) => {
                e.stopPropagation();
                props.onUpdateCard(card.id, (c) => ({
                  ...c,
                  cardColor: colorDef.key === "default" ? undefined : colorDef.bg,
                }));
              }}
            />
          ))}
        </div>
      ) : null}
      {!isBoardCard ? (
        <div
          className="connection-dot"
          onMouseDown={(event) => {
            event.stopPropagation();
            props.onStartConnection(card.id, {
              x: props.displayPosition.x + props.displaySize.width - 10,
              y: props.displayPosition.y + 10,
            });
          }}
        />
      ) : null}

      {renderEditableContent({
        card,
        markdown,
        assetUrl: props.assetUrls[card.id],
        isEditable,
        onUpdateCard: (updater) => props.onUpdateCard(card.id, updater),
        onUpdateMarkdown: (nextMarkdown) => props.onUpdateMarkdown(card.id, nextMarkdown),
        onUpdateBoardCardTitle: (title) => props.onUpdateBoardCardTitle(props.boardBundle.board.id, card.id, title),
      })}

      {!isBoardCard ? (
        <button
          type="button"
          className="resize-handle"
          aria-label="Resize card"
          onMouseDown={(event) => props.onStartResize(card, event)}
        />
      ) : null}
    </div>
  );
}
