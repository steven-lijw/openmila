import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { formatFileSize, getFilePreviewMeta } from "../core/filePreview";
import { createId } from "../core/ids";
import { LinkPreviewDisplay } from "./LinkPreviewDisplay";
import { renderMarkdown } from "../core/markdown";
import { parseTodoMarkdown, stringifyTodoMarkdown } from "../core/todoMarkdown";
import { CARD_COLORS, BOARD_COLORS } from "../core/model";
import type { BoardBundle, CardMeta, DragCardPayload, DragToolPayload, Point } from "../types";

interface CanvasBoardProps {
  boardBundle: BoardBundle;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  readAssetUrl: (boardId: string, assetPath: string) => Promise<string>;
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
  onStartResize: (card: CardMeta, event: MouseEvent<HTMLElement>) => void;
  editingCardId: string | null;
  onStartEditing: () => void;
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
  aspectRatio: number;
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
  return Boolean(target.closest("input, textarea, a, .connection-dot, .resize-handle, .color-bar, .edge-menu, .format-btn"));
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
  onTextareaRef?: (ref: HTMLTextAreaElement | null) => void;
}) {
  const { card, markdown, assetUrl, isEditable, onUpdateCard, onUpdateMarkdown, onUpdateBoardCardTitle } = input;

  if (card.type === "note") {
    return isEditable ? (
      <NoteEditor
        card={card}
        markdown={markdown}
        onUpdateMarkdown={onUpdateMarkdown}
        onUpdateCard={onUpdateCard}
        onTextareaRef={input.onTextareaRef ?? (() => {})}
      />
    ) : markdown ? (
      <div
        className="card-preview markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    ) : (
      <div className="card-preview card-preview-empty">Start writing…</div>
    );
  }

  if (card.type === "todo") {
    const items = parseTodoMarkdown(markdown);
    if (!isEditable) {
      return (
        <div className="todo-list todo-list-preview">
          {items.map((item, index) => (
            <div key={`todo-preview-${index}`} className="todo-item todo-item-preview">
              <span className={`todo-checkbox-preview${item.checked ? " checked" : ""}`} />
              <span className={`todo-text-preview${item.text ? "" : " empty"}`}>{item.text || "New task"}</span>
            </div>
          ))}
        </div>
      );
    }
    return <TodoList card={card} items={items} onUpdateMarkdown={onUpdateMarkdown} onUpdateCard={onUpdateCard} />;
  }

  if (card.type === "link") {
    if (isEditable) {
      return (
        <input
          className="link-url-input"
          value={card.url}
          placeholder="https://example.com"
          onChange={(e) =>
            onUpdateCard((c) => (c.type === "link" ? { ...c, url: e.target.value } : c))
          }
        />
      );
    }
    return <LinkPreviewDisplay url={card.url} />;
  }

  if (card.type === "image") {
    return (
      <div className="image-card-body">
        {card.assetPath && assetUrl ? (
          <img src={assetUrl} alt={card.title} className="image-preview" draggable="false" />
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
        <div className="board-icon-shell" style={card.cardColor ? { backgroundColor: card.cardColor } : undefined}>
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
  onTextareaRef: (ref: HTMLTextAreaElement | null) => void;
}) {
  const { card, markdown, onUpdateMarkdown, onTextareaRef } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const wrapSelection = (before: string, after: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = markdown.slice(start, end);
    const next = markdown.slice(0, start) + before + selected + after + markdown.slice(end);
    onUpdateMarkdown(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "b") {
      event.preventDefault();
      wrapSelection("**", "**");
    } else if (mod && event.key === "i") {
      event.preventDefault();
      wrapSelection("*", "*");
    } else if (mod && event.shiftKey && event.key === "x") {
      event.preventDefault();
      wrapSelection("~~", "~~");
    }
  };

  return (
    <textarea
      ref={(el) => {
        textareaRef.current = el;
        onTextareaRef(el);
      }}
      className="card-textarea"
      value={markdown}
      placeholder="Start writing…"
      onChange={(event) => onUpdateMarkdown(event.target.value)}
      onKeyDown={handleKeyDown}
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

  // Stable per-slot React keys. `parseTodoMarkdown` derives ids from the text
  // content, which would change the key on every keystroke and unmount/remount
  // the input (losing focus and IME state). Instead we keep an array of opaque
  // keys positioned by index; they only change on insert/remove.
  const slotKeysRef = useRef<string[]>(items.map(() => createId("todoslot")));
  if (slotKeysRef.current.length < items.length) {
    // Items were added outside of a handler we instrumented (e.g. initial mount
    // of a multi-line todo). Append fresh keys for the new tail.
    const next = slotKeysRef.current.slice();
    while (next.length < items.length) {
      next.push(createId("todoslot"));
    }
    slotKeysRef.current = next;
  } else if (slotKeysRef.current.length > items.length) {
    slotKeysRef.current = slotKeysRef.current.slice(0, items.length);
  }
  const slotKeys = slotKeysRef.current;

  const requestFocus = (index: number) => {
    pendingFocusIndexRef.current = index;
    focusRetryRef.current = 0;
    setFocusNonce((current) => current + 1);
  };

  // NoteEditor, TodoList: auto-resize disabled to prevent render loops
  // Card heights grow via user resize handle only

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
        <label key={slotKeys[index]} className="todo-item">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(event) => {
              const nextItems = items.slice();
              nextItems[index] = { ...item, checked: event.target.checked };
              onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
            }}
          />
          <input
            className="todo-text-input"
            value={item.text}
            placeholder="New task"
            onChange={(event) => {
              const nextItems = items.slice();
              nextItems[index] = { ...item, text: event.target.value };
              onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const nextItems = items.slice();
                nextItems.splice(index + 1, 0, { id: createId("todo"), checked: false, text: "" });
                // Insert a fresh slot key at the same position so existing
                // inputs keep their DOM identity (and focus).
                slotKeysRef.current = [
                  ...slotKeys.slice(0, index + 1),
                  createId("todoslot"),
                  ...slotKeys.slice(index + 1),
                ];
                requestFocus(index + 1);
                onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
                return;
              }

              if ((event.key === "Delete" || event.key === "Backspace") && item.text.trim() === "") {
                event.preventDefault();
                const nextItems = items.filter((_, i) => i !== index);
                const normalizedItems =
                  nextItems.length === 0 ? [{ id: createId("todo"), checked: false, text: "" }] : nextItems;
                // Drop the slot key at this index.
                if (nextItems.length === 0) {
                  slotKeysRef.current = [createId("todoslot")];
                } else {
                  slotKeysRef.current = slotKeys.filter((_, i) => i !== index);
                }
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
  const ignoreNextCanvasClickRef = useRef(false);
  const mountedRef = useRef(true);
  const propsRef = useRef(props);
  propsRef.current = props;
  const { onDeleteEdge } = props;
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const assetUrlsRef = useRef<Record<string, string>>({});
  assetUrlsRef.current = assetUrls;
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [draggingCard, setDraggingCard] = useState<DraggingCardState | null>(null);
  const pendingDragRef = useRef<{
    cardIds: string[];
    startPointer: Point;
    startPositions: Record<string, Point>;
  } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreviewState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [committedPositions, setCommittedPositions] = useState<Record<string, Point>>({});
  const [resizingCard, setResizingCard] = useState<ResizingCardState | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [edgeMenuPos, setEdgeMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [localEdgeStyles, setLocalEdgeStyles] = useState<Record<string, { arrowDirection?: string; lineStyle?: string }>>({});

  const getMinSize = (card: CardMeta | undefined) => {
    if (!card) {
      return { width: 160, height: 120 };
    }
    switch (card.type) {
      case "note":
      case "todo":
        return { width: 304, height: 64 };
      case "link":
        return { width: 304, height: 64 };
      case "board":
        return { width: 180, height: 120 };
      case "image":
        return { width: 280, height: 210 };
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
        x: position.x + 20,
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
      ? { x: cardPosition.x + 20, y: cardPosition.y + 20 }
      : { x: cardPosition.x + getDisplaySize(card).width / 2, y: cardPosition.y + getDisplaySize(card).height / 2 };

    const dx = center.x - fromX;
    const dy = center.y - fromY;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;

    // Use visual bounding box: board cards show as 40x40 icon
    const halfW = card.type === "board" ? 20 : getDisplaySize(card).width / 2;
    const halfH = card.type === "board" ? 20 : getDisplaySize(card).height / 2;

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

  const loadedAssetIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadedAssetIdsRef.current.clear();
  }, [props.boardBundle.board.id]);

  useEffect(() => {
    const boardId = props.boardBundle.board.id;
    for (const card of props.boardBundle.board.cards) {
      if ((card.type !== "image" && card.type !== "file") || !card.assetPath || loadedAssetIdsRef.current.has(card.id)) {
        continue;
      }
      loadedAssetIdsRef.current.add(card.id);
      void props.readAssetUrl(boardId, card.assetPath).then((url) => {
        // Component unmounted, or the user navigated to a different board:
        // release the blob URL so it doesn't leak, and don't touch state.
        if (!mountedRef.current || propsRef.current.boardBundle.board.id !== boardId) {
          if (url) {
            URL.revokeObjectURL(url);
          }
          return;
        }
        setAssetUrls((current) => ({ ...current, [card.id]: url }));
      }).catch(() => {
        // Asset read failed (file deleted, permission revoked, etc.). Leave
        // the slot empty — the card will render its placeholder.
      });
    }
  }, [props.boardBundle.board.cards, props.boardBundle.board.id, props.readAssetUrl]);

  useEffect(() => {
    setAssetUrls((current) => {
      const next: Record<string, string> = {};
      for (const url of Object.values(current)) {
        URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [props.boardBundle.board.id]);

  // Mark the component unmounted so in-flight asset promises don't setState.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Revoke all blob URLs on unmount to prevent memory leaks.
      for (const url of Object.values(assetUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  // When the user navigates to a different board, clear local UI state that is
  // scoped to the previous board. Otherwise a stale editingCardId / selectedEdgeId
  // could happen to match a different card in the new board, silently putting it
  // into edit or selected mode.
  useEffect(() => {
    setEditingCardId(null);
    setSelectedEdgeId(null);
    setLocalEdgeStyles({});
    setCommittedPositions({});
  }, [props.boardBundle.board.id]);

  useEffect(() => {
    const activeAssetIds = new Set(
      props.boardBundle.board.cards
        .filter((card) => (card.type === "image" || card.type === "file") && card.assetPath)
        .map((card) => card.id),
    );

    setAssetUrls((current) => {
      let changed = false;
      const next = { ...current };
      for (const [cardId, url] of Object.entries(current)) {
        if (!activeAssetIds.has(cardId)) {
          URL.revokeObjectURL(url);
          delete next[cardId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.boardBundle.board.cards]);

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
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - props.boardBundle.board.viewport.x) / props.boardBundle.board.viewport.zoom,
      y: (clientY - rect.top - props.boardBundle.board.viewport.y) / props.boardBundle.board.viewport.zoom,
    };
  };
  const screenToCanvasRef = useRef(screenToCanvas);
  screenToCanvasRef.current = screenToCanvas;

  const fitToView = useCallback(() => {
    const cards = rootCards;
    if (cards.length === 0) {
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const card of cards) {
      const pos = committedPositions[card.id] ?? card.position;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + card.size.width);
      maxY = Math.max(maxY, pos.y + card.size.height);
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const padding = 40;
    const availW = rect.width - padding * 2;
    const availH = rect.height - padding * 2;
    const contentW = maxX - minX;
    const contentH = maxY - minY;

    if (contentW <= 0 || contentH <= 0) {
      return;
    }

    const zoom = Math.min(availW / contentW, availH / contentH, 1.8);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const x = rect.width / 2 - cx * zoom;
    const y = rect.height / 2 - cy * zoom;

    propsRef.current.onViewportChange({ x, y, zoom });
  }, [committedPositions, rootCards]);

  const focusSelected = useCallback(() => {
    const p = propsRef.current;
    if (p.selectedCardIds.length === 0) {
      return;
    }
    const cardId = p.selectedCardIds[0];
    const card = rootCardMap[cardId];
    if (!card) {
      return;
    }
    const pos = committedPositions[card.id] ?? card.position;

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const padding = 60;
    const availW = rect.width - padding * 2;
    const availH = rect.height - padding * 2;
    const zoom = Math.min(availW / card.size.width, availH / card.size.height, 1.8);
    const cx = pos.x + card.size.width / 2;
    const cy = pos.y + card.size.height / 2;
    const x = rect.width / 2 - cx * zoom;
    const y = rect.height / 2 - cy * zoom;

    propsRef.current.onViewportChange({ x, y, zoom });
  }, [committedPositions, rootCardMap]);

  const draggingCardRef = useRef(draggingCard);
  const connectionPreviewRef = useRef(connectionPreview);
  const selectionBoxRef = useRef(selectionBox);
  const resizingCardRef = useRef(resizingCard);
  const committedPositionsRef = useRef(committedPositions);
  const rootCardsRef = useRef(rootCards);
  draggingCardRef.current = draggingCard;
  connectionPreviewRef.current = connectionPreview;
  selectionBoxRef.current = selectionBox;
  resizingCardRef.current = resizingCard;
  committedPositionsRef.current = committedPositions;
  rootCardsRef.current = rootCards;

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!draggingCardRef.current && !connectionPreviewRef.current &&
          !selectionBoxRef.current && !resizingCardRef.current &&
          !pendingDragRef.current) return;
      // Promote pending drag on first mouse movement
      if (pendingDragRef.current && !draggingCardRef.current) {
        const pending = pendingDragRef.current;
        pendingDragRef.current = null;
        setDraggingCard({
          ...pending,
          positions: { ...pending.startPositions },
        });
        return;
      }

      const point = screenToCanvasRef.current(event.clientX, event.clientY);
      const dc = draggingCardRef.current;

      if (dc) {
        const deltaX = point.x - dc.startPointer.x;
        const deltaY = point.y - dc.startPointer.y;

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

      if (connectionPreviewRef.current) {
        setConnectionPreview((current) => (current ? { ...current, pointer: point } : null));
      }

      if (selectionBoxRef.current) {
        setSelectionBox((current) => (current ? { ...current, current: point } : null));
      }

      const rc = resizingCardRef.current;
      if (rc) {
        const card = rootCardMap[rc.cardId];
        const minSize = getMinSize(card);
        const dx = point.x - rc.startPointer.x;
        const dy = point.y - rc.startPointer.y;

        if (card?.type === "image") {
          const ar = rc.aspectRatio;
          let nextWidth: number;
          let nextHeight: number;
          if (Math.abs(dx) / ar >= Math.abs(dy)) {
            nextWidth = rc.startSize.width + dx;
            nextHeight = nextWidth / ar;
          } else {
            nextHeight = rc.startSize.height + dy;
            nextWidth = nextHeight * ar;
          }
          nextWidth = Math.max(minSize.width, nextWidth);
          nextHeight = Math.max(minSize.height, nextHeight);
          if (nextWidth / nextHeight > ar) {
            nextWidth = nextHeight * ar;
          } else {
            nextHeight = nextWidth / ar;
          }
          setResizingCard((current) =>
            current ? { ...current, size: { width: nextWidth, height: nextHeight } } : null,
          );
        } else {
          const nextWidth = Math.max(minSize.width, rc.startSize.width + dx);
          const nextHeight = Math.max(minSize.height, rc.startSize.height + dy);
          setResizingCard((current) =>
            current ? { ...current, size: { width: nextWidth, height: nextHeight } } : null,
          );
        }
      }
    };

    const handleMouseUp = () => {
      if (!draggingCardRef.current && !connectionPreviewRef.current &&
          !selectionBoxRef.current && !resizingCardRef.current &&
          !pendingDragRef.current) return;

      // Promote pending drag (click with no movement) so it gets cleaned up
      if (pendingDragRef.current && !draggingCardRef.current) {
        const pending = pendingDragRef.current;
        pendingDragRef.current = null;
        setDraggingCard({ ...pending, positions: { ...pending.startPositions } });
      }
      pendingDragRef.current = null;

      const dc = draggingCardRef.current;
      const sb = selectionBoxRef.current;
      const cp = connectionPreviewRef.current;
      const rc = resizingCardRef.current;

      if (dc) {
        const didMove = Object.entries(dc.positions).some(
          ([cardId, pos]) => !pointsEqual(pos, dc.startPositions[cardId]),
        );
        if (didMove) {
          setCommittedPositions((current) => ({ ...current, ...dc.positions }));
          for (const [cardId, position] of Object.entries(dc.positions)) {
            propsRef.current.onUpdateCard(cardId, (card) => ({ ...card, position }));
          }
        }
      }

      if (sb) {
        const minX = Math.min(sb.start.x, sb.current.x);
        const maxX = Math.max(sb.start.x, sb.current.x);
        const minY = Math.min(sb.start.y, sb.current.y);
        const maxY = Math.max(sb.start.y, sb.current.y);

        const selectedIds = rootCardsRef.current
          .filter((card) => {
            const displayPosition =
              dc?.positions[card.id] ?? committedPositionsRef.current[card.id] ?? card.position;
            const displaySize = rc?.cardId === card.id ? rc.size : card.size;
            const right = displayPosition.x + displaySize.width;
            const bottom = displayPosition.y + displaySize.height;
            return right >= minX && displayPosition.x <= maxX && bottom >= minY && displayPosition.y <= maxY;
          })
          .map((card) => card.id);

        propsRef.current.onClearSelection();
        selectedIds.forEach((cardId, index) => propsRef.current.onSelectCard(cardId, index > 0));
        setSelectionBox(null);
      }

      if (cp) {
        propsRef.current.onCancelConnection();
        setConnectionPreview(null);
      }

      if (rc) {
        propsRef.current.onUpdateCard(rc.cardId, (card) => ({ ...card, size: rc.size }));
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
  }, [rootCardMap]);

  // Escape to exit edit mode
  useEffect(() => {
    if (!editingCardId) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditingCardId(null);
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingCardId]);

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
      onDeleteEdge?.(selectedEdgeId);
      setSelectedEdgeId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEdgeId, onDeleteEdge]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = propsRef.current;

      if (event.ctrlKey) {
        const rect = canvas.getBoundingClientRect();
        const worldX =
          (event.clientX - rect.left - p.boardBundle.board.viewport.x) / p.boardBundle.board.viewport.zoom;
        const worldY =
          (event.clientY - rect.top - p.boardBundle.board.viewport.y) / p.boardBundle.board.viewport.zoom;
        const nextZoom = Math.max(
          0.4,
          Math.min(1.8, p.boardBundle.board.viewport.zoom - event.deltaY * 0.01),
        );
        const nextX = event.clientX - rect.left - worldX * nextZoom;
        const nextY = event.clientY - rect.top - worldY * nextZoom;
        p.onViewportChange({
          ...p.boardBundle.board.viewport,
          x: nextX,
          y: nextY,
          zoom: nextZoom,
        });
        return;
      }

      p.onViewportChange({
        ...p.boardBundle.board.viewport,
        x: p.boardBundle.board.viewport.x - event.deltaX,
        y: p.boardBundle.board.viewport.y - event.deltaY,
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const edges = useMemo(() => {
    const result = props.boardBundle.board.edges
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
          label: edge.label,
          midX: (fromCenter.x + toCenter.x) / 2,
          midY: (fromCenter.y + toCenter.y) / 2,
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
        label: undefined,
        midX: (connectionPreview.start.x + connectionPreview.pointer.x) / 2,
        midY: (connectionPreview.start.y + connectionPreview.pointer.y) / 2,
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
            setEditingCardId(null);
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
          setEditingCardId(null);
          setSelectedEdgeId(null);
          setEdgeMenuPos(null);
          ignoreNextCanvasClickRef.current = true;
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
                  {/* Edge label */}
                  {edge.label && edge.id !== "preview-edge" ? (
                    <g pointerEvents="none">
                      <rect
                        x={edge.midX - 50}
                        y={edge.midY - 12}
                        width={100}
                        height={24}
                        rx={4}
                        fill="rgba(255,255,255,0.92)"
                        stroke={selectedEdgeId === edge.id ? "#4a6cf7" : "#ccc"}
                        strokeWidth={0.5}
                      />
                      <text
                        x={edge.midX}
                        y={edge.midY + 5}
                        textAnchor="middle"
                        fill="#555"
                        fontSize={13}
                        fontFamily="sans-serif"
                      >
                        {edge.label}
                      </text>
                    </g>
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
                editingCardId={editingCardId}
                onStartEditing={() => setEditingCardId(card.id)}
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

                  props.onBringCardsToFront(movableIds);

                  pendingDragRef.current = {
                    cardIds: movableIds,
                    startPointer: screenToCanvas(event.clientX, event.clientY),
                    startPositions: Object.fromEntries(
                      movableIds.map((selectedId) => [
                        selectedId,
                        committedPositions[selectedId] ?? rootCardMap[selectedId].position,
                      ]),
                    ),
                  };
                }}
                onStartResize={(cardMeta, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setResizingCard({
                    cardId: cardMeta.id,
                    startPointer: screenToCanvas(event.clientX, event.clientY),
                    startSize: cardMeta.size,
                    size: cardMeta.size,
                    aspectRatio: cardMeta.size.width / cardMeta.size.height,
                  });
                }}
              />
            );
          })}
        </div>
      </div>
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
              left: edgeMenuPos.x - 8,
              top: edgeMenuPos.y - 10,
              transform: "translate(-100%, 0)",
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
            <div className="edge-menu-section">
              <span className="edge-menu-label">Label</span>
              <input
                className="edge-menu-input"
                value={edgeDef?.label ?? ""}
                placeholder="Add label…"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const val = e.target.value;
                  props.onUpdateEdge(selectedEdgeId, (edge) => ({ ...edge, label: val || undefined }));
                }}
              />
            </div>
          </div>
        );
      })() : null}
      <div className="canvas-actions">
        <button type="button" className="canvas-action-btn" title="Fit all content" onClick={fitToView}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10v4h4M14 6V2h-4M2 6V2h4M14 10v4h-4" />
          </svg>
        </button>
        <button type="button" className="canvas-action-btn" title="Focus selected" onClick={focusSelected} disabled={props.selectedCardIds.length === 0}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="3" />
            <circle cx="8" cy="8" r="7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CardRenderer(props: CardRendererProps) {
  const { boardBundle, card } = props;
  const markdown = boardBundle.documents[card.id] ?? "";
  const isSelected = props.selectedCardIds.includes(card.id);
  const isEditing = props.editingCardId === card.id;
  const isBoardCard = card.type === "board";
  const cardRef = useRef<HTMLDivElement | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      hoverTimeoutRef.current = null;
    }, 300);
  };

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing && cardRef.current) {
      const el = cardRef.current.querySelector<HTMLElement>(".card-textarea, .todo-text-input, .link-url-input");
      el?.focus();
    }
  }, [isEditing]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={cardRef}
      className={`canvas-card ${isSelected ? "selected" : ""} ${isBoardCard ? "type-board" : `type-${card.type}`} ${props.isDragging ? "dragging" : ""}`}
      style={{
        left: props.displayPosition.x,
        top: props.displayPosition.y,
        ...(isBoardCard ? {} : { width: props.displaySize.width, height: props.displaySize.height }),
        ...(card.cardColor && card.type !== "image" && card.type !== "link" && card.type !== "board" ? { backgroundColor: card.cardColor } : {}),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
        if (card.type === "link" && !event.shiftKey) {
          if (isSelected) {
            if (card.url) {
              window.open(card.url, "_blank");
            } else {
              props.onStartEditing();
            }
          } else {
            props.onSelectCard(card.id, false);
          }
          return;
        }
        if (isSelected && !event.shiftKey) {
          props.onStartEditing();
        } else {
          props.onSelectCard(card.id, event.shiftKey);
        }
      }}
      onMouseUp={(event) => {
        if (props.connectFromCardId && props.connectFromCardId !== card.id) {
          props.onFinishConnection(card.id);
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        // In connection mode, a double-click should NOT open a child board —
        // the user is mid-connection and an accidental navigation would drop
        // them out of the board they're connecting in.
        if (props.connectFromCardId) {
          return;
        }
        if (card.type === "board" && !isInteractiveElement(event.target)) {
          props.onOpenBoard(card.childBoardId);
        }
      }}
    >
      {isHovered && !isEditing && card.type !== "image" && card.type !== "link" ? (
        <div className="color-bar">
          {(isBoardCard ? BOARD_COLORS : CARD_COLORS).map((colorDef) => (
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
      {isEditing && (card.type === "note" || card.type === "todo") ? (
        <FormatBar
          markdown={markdown}
          onUpdateMarkdown={(nextMarkdown) => props.onUpdateMarkdown(card.id, nextMarkdown)}
          textareaRef={noteTextareaRef}
        />
      ) : null}
      <div className="canvas-card-content">
      {renderEditableContent({
        card,
        markdown,
        assetUrl: props.assetUrls[card.id],
        isEditable: (card.type === "board" || card.type === "note" || card.type === "link" || card.type === "todo") ? isEditing : (isSelected || isEditing),
        onUpdateCard: (updater) => props.onUpdateCard(card.id, updater),
        onUpdateMarkdown: (nextMarkdown) => props.onUpdateMarkdown(card.id, nextMarkdown),
        onUpdateBoardCardTitle: (title) => props.onUpdateBoardCardTitle(props.boardBundle.board.id, card.id, title),
        onTextareaRef: (ref) => { noteTextareaRef.current = ref; },
      })}
      </div>

      {!isBoardCard && isSelected ? (
        <div
          className="connect-handle"
          onMouseDown={(event) => {
            event.stopPropagation();
            props.onStartConnection(card.id, {
              x: props.displayPosition.x + props.displaySize.width - 10,
              y: props.displayPosition.y + 10,
            });
          }}
        />
      ) : null}

      {!isBoardCard && isHovered && !isSelected ? (
        <div
          className="hover-resize-indicator"
          onMouseDown={(event) => {
            event.stopPropagation();
            props.onStartResize(card, event);
          }}
        />
      ) : null}

      {!isBoardCard && isSelected ? (
        <div
          className="resize-handle"
          onMouseDown={(event) => {
            event.stopPropagation();
            props.onStartResize(card, event);
          }}
        />
      ) : null}
    </div>
  );
}

function FormatBar(props: {
  markdown: string;
  onUpdateMarkdown: (markdown: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { markdown, onUpdateMarkdown, textareaRef } = props;

  const wrapSelection = (before: string, after: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = markdown.slice(start, end);
    const next = markdown.slice(0, start) + before + selected + after + markdown.slice(end);
    onUpdateMarkdown(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const start = textarea.selectionStart;
    const lineStart = markdown.lastIndexOf("\n", start - 1) + 1;
    const next = markdown.slice(0, lineStart) + prefix + markdown.slice(lineStart);
    onUpdateMarkdown(next);
  };

  return (
    <div className="color-bar" style={{ top: "-34px", gap: "2px" }}>
      <button type="button" className="format-btn" title="Bold" onClick={() => wrapSelection("**", "**")}><strong>B</strong></button>
      <button type="button" className="format-btn" title="Italic" onClick={() => wrapSelection("*", "*")}><em>I</em></button>
      <button type="button" className="format-btn" title="Strikethrough" onClick={() => wrapSelection("~~", "~~")}><s>S</s></button>
      <button type="button" className="format-btn" title="Underline" onClick={() => wrapSelection("++", "++")}><u>U</u></button>
      <button type="button" className="format-btn" title="Bullet list" onClick={() => insertLinePrefix("- ")}>•</button>
      <button type="button" className="format-btn" title="Numbered list" onClick={() => insertLinePrefix("1. ")}>1.</button>
    </div>
  );
}
