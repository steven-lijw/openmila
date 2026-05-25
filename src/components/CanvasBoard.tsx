import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
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
  imageUrls: Record<string, string>;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  displayPosition: Point;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string, anchorPoint: Point) => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
  onStartPointerDrag: (card: CardMeta, event: MouseEvent<HTMLDivElement>) => void;
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
  return Boolean(target.closest("input, textarea, a, .connection-anchor"));
}

function pointsEqual(a: Point | undefined, b: Point | undefined) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function renderEditableContent(input: {
  card: CardMeta;
  markdown: string;
  imageUrl?: string;
  isEditable: boolean;
  onUpdateCard: (updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (markdown: string) => void;
}) {
  const { card, markdown, imageUrl, isEditable, onUpdateCard, onUpdateMarkdown } = input;

  if (card.type === "note") {
    return isEditable ? (
      <textarea className="card-textarea" value={markdown} onChange={(event) => onUpdateMarkdown(event.target.value)} />
    ) : (
      <div className="card-preview">{markdown || "Empty note"}</div>
    );
  }

  if (card.type === "todo") {
    const items = parseTodoMarkdown(markdown);
    return (
      <div className="todo-list">
        {items.map((item) => (
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
            />
          </label>
        ))}
      </div>
    );
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
        {card.assetPath && imageUrl ? (
          <img src={imageUrl} alt={card.title} className="image-preview" />
        ) : (
          <div className="image-placeholder">Drop or create with a file to show the image here.</div>
        )}
      </div>
    );
  }

  if (card.type === "board") {
    return <div className="board-preview">Double-click to open nested board</div>;
  }

  return <div className="removed-card">Column has been removed</div>;
}

export function CanvasBoard(props: CanvasBoardProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextCanvasClickRef = useRef(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [draggingCard, setDraggingCard] = useState<DraggingCardState | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreviewState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [committedPositions, setCommittedPositions] = useState<Record<string, Point>>({});

  useEffect(() => {
    for (const card of props.boardBundle.board.cards) {
      if (card.type !== "image" || !card.assetPath || imageUrls[card.id]) {
        continue;
      }
      void props.readAssetUrl(card.assetPath).then((url) => {
        setImageUrls((current) => ({ ...current, [card.id]: url }));
      });
    }
  }, [props.boardBundle.board.cards, imageUrls, props.readAssetUrl]);

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
    if (!draggingCard && !connectionPreview && !selectionBox) {
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
            const right = displayPosition.x + card.size.width;
            const bottom = displayPosition.y + card.size.height;
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

      setDraggingCard(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [committedPositions, connectionPreview, draggingCard, props, rootCards, selectionBox]);

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

        return {
          id: edge.id,
          x1: fromPosition.x + from.size.width / 2,
          y1: fromPosition.y + from.size.height / 2,
          x2: toPosition.x + to.size.width / 2,
          y2: toPosition.y + to.size.height / 2,
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
  }, [committedPositions, connectionPreview, draggingCard, props.boardBundle.board.edges, rootCardMap]);

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
        className="canvas-board"
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
        onWheel={(event) => {
          event.preventDefault();
          const nextZoom = Math.max(0.4, Math.min(1.8, props.boardBundle.board.viewport.zoom - event.deltaY * 0.001));
          props.onViewportChange({
            ...props.boardBundle.board.viewport,
            zoom: nextZoom,
          });
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

            return (
              <CardRenderer
                key={card.id}
                boardBundle={props.boardBundle}
                card={card}
                imageUrls={imageUrls}
                selectedCardIds={props.selectedCardIds}
                activeCardId={props.activeCardId}
                connectFromCardId={props.connectFromCardId}
                displayPosition={displayPosition}
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
        width: card.size.width,
        minHeight: card.size.height,
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
      <ConnectionAnchors
        card={card}
        position={props.displayPosition}
        connectFromCardId={props.connectFromCardId}
        onStartConnection={props.onStartConnection}
        onFinishConnection={props.onFinishConnection}
      />

      {renderEditableContent({
        card,
        markdown,
        imageUrl: props.imageUrls[card.id],
        isEditable,
        onUpdateCard: (updater) => props.onUpdateCard(card.id, updater),
        onUpdateMarkdown: (nextMarkdown) => props.onUpdateMarkdown(card.id, nextMarkdown),
      })}
    </div>
  );
}

function ConnectionAnchors(props: {
  card: CardMeta;
  position: Point;
  connectFromCardId: string | null;
  onStartConnection: (cardId: string, anchorPoint: Point) => void;
  onFinishConnection: (cardId: string) => void;
}) {
  const { width, height } = props.card.size;
  const anchors = [
    { key: "top", className: "anchor-top", point: { x: props.position.x + width / 2, y: props.position.y } },
    {
      key: "right",
      className: "anchor-right",
      point: { x: props.position.x + width, y: props.position.y + height / 2 },
    },
    {
      key: "bottom",
      className: "anchor-bottom",
      point: { x: props.position.x + width / 2, y: props.position.y + height },
    },
    { key: "left", className: "anchor-left", point: { x: props.position.x, y: props.position.y + height / 2 } },
  ];

  return (
    <>
      {anchors.map((anchor) => (
        <div
          key={anchor.key}
          className={`connection-anchor ${anchor.className}`}
          onMouseDown={(event) => {
            event.stopPropagation();
            props.onStartConnection(props.card.id, anchor.point);
          }}
          onMouseUp={(event) => {
            event.stopPropagation();
            if (props.connectFromCardId && props.connectFromCardId !== props.card.id) {
              props.onFinishConnection(props.card.id);
            }
          }}
        />
      ))}
    </>
  );
}
