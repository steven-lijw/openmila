import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { formatFileSize, getFilePreviewMeta } from "../core/filePreview";
import { createId } from "../core/ids";
import { getLinkPreview } from "../core/linkPreview";
import { parseTodoMarkdown, stringifyTodoMarkdown } from "../core/todoMarkdown";
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
  onBringCardsToFront: (cardIds: string[]) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string) => void;
  onCancelConnection: () => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
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
  onSelectCard: (cardId: string, multi: boolean) => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
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
}) {
  const { card, markdown, assetUrl, isEditable, onUpdateCard, onUpdateMarkdown } = input;

  if (card.type === "note") {
    return isEditable ? (
      <NoteEditor
        card={card}
        markdown={markdown}
        onUpdateMarkdown={onUpdateMarkdown}
        onUpdateCard={onUpdateCard}
      />
    ) : (
      <div className="card-preview">{markdown || "Empty note"}</div>
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
            {preview.kind === "pdf" ? <iframe src={assetUrl} title={card.title} className="file-preview-frame" /> : null}
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
    return <div className="board-preview">Double-click to open nested board</div>;
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

  const getMinSize = (card: CardMeta | undefined) => {
    if (!card) {
      return { width: 160, height: 120 };
    }
    switch (card.type) {
      case "note":
      case "todo":
      case "link":
      case "board":
        return { width: 304, height: 64 };
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
        props.onBringCardsToFront(draggingCard.cardIds);
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

        return {
          id: edge.id,
          x1: fromPosition.x + fromSize.width / 2,
          y1: fromPosition.y + fromSize.height / 2,
          x2: toPosition.x + toSize.width / 2,
          y2: toPosition.y + toSize.height / 2,
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
      });
    }

    return result;
  }, [committedPositions, connectionPreview, draggingCard, props.boardBundle.board.edges, resizingCard, rootCardMap]);

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
        className={`canvas-board ${draggingCard ? "is-dragging" : ""}`}
        ref={canvasRef}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onClick={(event) => {
          if (ignoreNextCanvasClickRef.current) {
            ignoreNextCanvasClickRef.current = false;
            return;
          }

          if (event.target === event.currentTarget || event.target === canvasInnerRef.current) {
            props.onClearSelection();
          }
        }}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget && event.target !== canvasInnerRef.current) {
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
            {edges.map((edge) =>
              edge ? (
                <line
                  key={edge.id}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke="#7f776d"
                  strokeWidth={edge.id === "preview-edge" ? "3" : "2"}
                  strokeDasharray={edge.id === "preview-edge" ? "6 4" : undefined}
                />
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
                onSelectCard={props.onSelectCard}
                onUpdateCard={props.onUpdateCard}
                onUpdateMarkdown={props.onUpdateMarkdown}
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

  return (
    <div
      className={`canvas-card ${isSelected ? "selected" : ""} ${props.selectedCardIds.includes(card.id) ? "" : ""}`}
      style={{
        left: props.displayPosition.x,
        top: props.displayPosition.y,
        width: props.displaySize.width,
        height: props.displaySize.height,
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
      onMouseDown={(event) => props.onStartPointerDrag(card, event)}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelectCard(card.id, event.shiftKey);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (card.type === "board" && !isInteractiveElement(event.target)) {
          props.onOpenBoard(card.childBoardId);
        }
      }}
    >
      <div
        className="connection-dot"
        onMouseDown={(event) => {
          event.stopPropagation();
          props.onStartConnection(card.id, {
            x: props.displayPosition.x + props.displaySize.width - 10,
            y: props.displayPosition.y + 10,
          });
        }}
        onMouseUp={(event) => {
          event.stopPropagation();
          if (props.connectFromCardId && props.connectFromCardId !== card.id) {
            props.onFinishConnection(card.id);
          }
        }}
      />

      {renderEditableContent({
        card,
        markdown,
        assetUrl: props.assetUrls[card.id],
        isEditable,
        onUpdateCard: (updater) => props.onUpdateCard(card.id, updater),
        onUpdateMarkdown: (nextMarkdown) => props.onUpdateMarkdown(card.id, nextMarkdown),
      })}

      <button
        type="button"
        className="resize-handle"
        aria-label="Resize card"
        onMouseDown={(event) => props.onStartResize(card, event)}
      />
    </div>
  );
}
