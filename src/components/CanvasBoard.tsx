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
  onCreateInColumn: (toolType: DragToolPayload["toolType"], columnId: string, index?: number) => void;
  onCreateInBoard: (toolType: DragToolPayload["toolType"], boardId: string, position: Point) => void;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onClearSelection: () => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onMoveCard: (payload: DragCardPayload, destination: { position?: Point; columnId?: string; index?: number }) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string) => void;
  onCancelConnection: () => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
}

interface CardRendererProps {
  boardBundle: BoardBundle;
  card: CardMeta;
  imageUrls: Record<string, string>;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  dragPreviewPosition: Point | null;
  onCanvasCreate: (toolType: DragToolPayload["toolType"], position: Point) => void;
  onCreateInColumn: (toolType: DragToolPayload["toolType"], columnId: string, index?: number) => void;
  onCreateInBoard: (toolType: DragToolPayload["toolType"], boardId: string, position: Point) => void;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onMoveCard: (payload: DragCardPayload, destination: { position?: Point; columnId?: string; index?: number }) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string) => void;
  onCancelConnection: () => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
  onStartPointerDrag: (card: CardMeta, event: MouseEvent<HTMLDivElement>) => void;
}

interface DraggingCardState {
  cardId: string;
  pointerOffset: Point;
  position: Point;
}

interface ConnectionPreviewState {
  sourceCardId: string;
  pointer: Point;
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

function writeCardDragPayload(event: DragEvent, boardId: string, cardId: string) {
  const payload = JSON.stringify({
    kind: "card",
    sourceBoardId: boardId,
    cardId,
  });
  event.dataTransfer.setData("application/json", payload);
  event.dataTransfer.setData("text/plain", payload);
  event.dataTransfer.effectAllowed = "move";
}

function setDropEffect(event: DragEvent) {
  const payload = readDragPayload(event);
  event.dataTransfer.dropEffect = payload?.kind === "tool" ? "copy" : "move";
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
            />
            {index === items.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  const nextItems = [...items, { id: `${item.id}_new`, checked: false, text: "New item" }];
                  onUpdateMarkdown(stringifyTodoMarkdown(nextItems));
                }}
              >
                +
              </button>
            ) : null}
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
        <textarea
          placeholder="Description"
          value={card.description}
          onChange={(event) =>
            onUpdateCard((currentCard) =>
              currentCard.type === "link" ? { ...currentCard, description: event.target.value } : currentCard,
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
          <div className="image-placeholder">Drop created an empty image card. Recreate with a file to fill it.</div>
        )}
      </div>
    );
  }

  if (card.type === "board") {
    return <div className="board-preview">Nested board destination</div>;
  }

  return null;
}

function ColumnInsertionSlot(props: {
  columnId: string;
  index: number;
  onCreateInColumn: (toolType: DragToolPayload["toolType"], columnId: string, index?: number) => void;
  onMoveCard: (payload: DragCardPayload, destination: { columnId?: string; index?: number }) => void;
}) {
  return (
    <div
      className="column-insert-slot"
      onDragOver={(event) => {
        event.preventDefault();
        setDropEffect(event);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const payload = readDragPayload(event);
        if (!payload) {
          return;
        }
        if (payload.kind === "tool") {
          props.onCreateInColumn(payload.toolType, props.columnId, props.index);
          return;
        }
        props.onMoveCard(payload, { columnId: props.columnId, index: props.index });
      }}
    />
  );
}

function ColumnChildCard(props: {
  boardBundle: BoardBundle;
  card: CardMeta;
  imageUrls: Record<string, string>;
  activeCardId: string | null;
  selectedCardIds: string[];
  connectFromCardId: string | null;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
}) {
  const markdown = props.boardBundle.documents[props.card.id] ?? "";
  const isSelected = props.selectedCardIds.includes(props.card.id);
  const isEditable = props.activeCardId === props.card.id;
  const boardChildId = props.card.type === "board" ? props.card.childBoardId : null;

  return (
    <div className={`column-item-surface ${isSelected ? "selected" : ""}`}>
      <div className="column-item-drag" draggable onDragStart={(event) => writeCardDragPayload(event, props.boardBundle.board.id, props.card.id)}>
        Drag
      </div>
      <div
        className="column-item-body"
        onClick={(event) => {
          event.stopPropagation();
          if (props.connectFromCardId && props.connectFromCardId !== props.card.id) {
            props.onFinishConnection(props.card.id);
            return;
          }
          props.onSelectCard(props.card.id, event.shiftKey);
        }}
      >
        <input
          className="card-title-input"
          value={props.card.title}
          onChange={(event) => props.onUpdateCard(props.card.id, (currentCard) => ({ ...currentCard, title: event.target.value }))}
        />
        {renderEditableContent({
          card: props.card,
          markdown,
          imageUrl: props.imageUrls[props.card.id],
          isEditable,
          onUpdateCard: (updater) => props.onUpdateCard(props.card.id, updater),
          onUpdateMarkdown: (nextMarkdown) => props.onUpdateMarkdown(props.card.id, nextMarkdown),
        })}
        {boardChildId ? (
          <div className="column-board-actions">
            <button type="button" onClick={() => props.onOpenBoard(boardChildId)}>
              Enter
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CanvasBoard(props: CanvasBoardProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [draggingCard, setDraggingCard] = useState<DraggingCardState | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreviewState | null>(null);

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

  const screenToCanvas = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - props.boardBundle.board.viewport.x) / props.boardBundle.board.viewport.zoom,
      y: (clientY - rect.top - props.boardBundle.board.viewport.y) / props.boardBundle.board.viewport.zoom,
    };
  };

  useEffect(() => {
    if (!draggingCard && !connectionPreview) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (draggingCard) {
        const point = screenToCanvas(event.clientX, event.clientY);
        setDraggingCard((current) =>
          current
            ? {
                ...current,
                position: {
                  x: point.x - current.pointerOffset.x,
                  y: point.y - current.pointerOffset.y,
                },
              }
            : null,
        );
      }

      if (connectionPreview) {
        setConnectionPreview((current) =>
          current
            ? {
                ...current,
                pointer: screenToCanvas(event.clientX, event.clientY),
              }
            : null,
        );
      }
    };

    const handleMouseUp = () => {
      if (draggingCard) {
        props.onUpdateCard(draggingCard.cardId, (card) => ({
          ...card,
          position: draggingCard.position,
        }));
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
  }, [connectionPreview, draggingCard, props]);

  const edges = useMemo(() => {
    const result = props.boardBundle.board.edges
      .map((edge) => {
        const from = props.boardBundle.board.cards.find((card) => card.id === edge.fromCardId);
        const to = props.boardBundle.board.cards.find((card) => card.id === edge.toCardId);
        if (!from || !to || from.parentId || to.parentId) {
          return null;
        }
        const fromPosition = draggingCard?.cardId === from.id ? draggingCard.position : from.position;
        const toPosition = draggingCard?.cardId === to.id ? draggingCard.position : to.position;
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
      const from = props.boardBundle.board.cards.find((card) => card.id === connectionPreview.sourceCardId);
      if (from && !from.parentId) {
        const fromPosition = draggingCard?.cardId === from.id ? draggingCard.position : from.position;
        result.push({
          id: "preview-edge",
          x1: fromPosition.x + from.size.width / 2,
          y1: fromPosition.y + from.size.height / 2,
          x2: connectionPreview.pointer.x,
          y2: connectionPreview.pointer.y,
        });
      }
    }

    return result;
  }, [connectionPreview, draggingCard, props.boardBundle.board.cards, props.boardBundle.board.edges]);

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
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }
    const point = screenToCanvas(event.clientX, event.clientY);
    if (payload.kind === "tool") {
      props.onCanvasCreate(payload.toolType, point);
      return;
    }
    props.onMoveCard(payload, { position: point });
  };

  return (
    <div className="canvas-shell" onClick={() => props.onClearSelection()}>
      <div
        className="canvas-board"
        ref={canvasRef}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          setIsPanning(true);
          setPanStart({
            x: event.clientX - props.boardBundle.board.viewport.x,
            y: event.clientY - props.boardBundle.board.viewport.y,
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
        <div className="canvas-inner" style={viewportStyle} onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}>
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

          {rootCards.map((card) => (
            <CardRenderer
              key={card.id}
              boardBundle={props.boardBundle}
              card={card}
              imageUrls={imageUrls}
              selectedCardIds={props.selectedCardIds}
              activeCardId={props.activeCardId}
              connectFromCardId={props.connectFromCardId}
              dragPreviewPosition={draggingCard?.cardId === card.id ? draggingCard.position : null}
              onCanvasCreate={props.onCanvasCreate}
              onCreateInColumn={props.onCreateInColumn}
              onCreateInBoard={props.onCreateInBoard}
              onSelectCard={props.onSelectCard}
              onUpdateCard={props.onUpdateCard}
              onUpdateMarkdown={props.onUpdateMarkdown}
              onMoveCard={props.onMoveCard}
              onMoveToBoard={props.onMoveToBoard}
              onStartConnection={(cardId) => {
                props.onStartConnection(cardId);
                const sourceCard = props.boardBundle.board.cards.find((item) => item.id === cardId);
                if (!sourceCard || sourceCard.parentId) {
                  return;
                }
                setConnectionPreview({
                  sourceCardId: cardId,
                  pointer: {
                    x: sourceCard.position.x + sourceCard.size.width / 2,
                    y: sourceCard.position.y + sourceCard.size.height / 2,
                  },
                });
              }}
              onCancelConnection={props.onCancelConnection}
              onFinishConnection={(cardId) => {
                props.onFinishConnection(cardId);
                setConnectionPreview(null);
              }}
              onOpenBoard={props.onOpenBoard}
              onStartPointerDrag={(cardMeta, event) => {
                const target = event.target as HTMLElement;
                if (target.closest("input, textarea, button, a, .connection-handle, .board-dropzone, .column-dropzone, .drag-handle")) {
                  return;
                }
                event.stopPropagation();
                props.onSelectCard(cardMeta.id, event.shiftKey);
                setDraggingCard({
                  cardId: cardMeta.id,
                  pointerOffset: {
                    x: screenToCanvas(event.clientX, event.clientY).x - cardMeta.position.x,
                    y: screenToCanvas(event.clientX, event.clientY).y - cardMeta.position.y,
                  },
                  position: cardMeta.position,
                });
              }}
            />
          ))}
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
  const childCards =
    card.type === "column"
      ? (card.childCardIds
          .map((childId) => boardBundle.board.cards.find((item) => item.id === childId))
          .filter(Boolean) as CardMeta[])
      : [];
  const position = props.dragPreviewPosition ?? card.position;

  return (
    <div
      className={`canvas-card ${isSelected ? "selected" : ""} ${props.dragPreviewPosition ? "dragging" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: card.size.width,
        minHeight: card.size.height,
      }}
      onMouseDown={(event) => props.onStartPointerDrag(card, event)}
      onClick={(event) => {
        event.stopPropagation();
        if (props.connectFromCardId && props.connectFromCardId !== card.id) {
          props.onFinishConnection(card.id);
          return;
        }
        props.onSelectCard(card.id, event.shiftKey);
      }}
    >
      <div className="card-header">
        <div className="card-header-left">
          <div
            className="drag-handle"
            draggable
            onDragStart={(event) => writeCardDragPayload(event, boardBundle.board.id, card.id)}
          >
            Drag
          </div>
          <input
            className="card-title-input"
            value={card.title}
            onChange={(event) => props.onUpdateCard(card.id, (currentCard) => ({ ...currentCard, title: event.target.value }))}
          />
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="connection-handle"
            onMouseDown={(event) => {
              event.stopPropagation();
              props.onStartConnection(card.id);
            }}
          >
            Connect
          </button>
          {card.type === "board" ? (
            <button type="button" onClick={() => props.onOpenBoard(card.childBoardId)}>
              Enter
            </button>
          ) : null}
        </div>
      </div>

      {card.type !== "column"
        ? renderEditableContent({
            card,
            markdown,
            imageUrl: props.imageUrls[card.id],
            isEditable,
            onUpdateCard: (updater) => props.onUpdateCard(card.id, updater),
            onUpdateMarkdown: (nextMarkdown) => props.onUpdateMarkdown(card.id, nextMarkdown),
          })
        : null}

      {card.type === "board" ? (
        <div
          className="board-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            setDropEffect(event);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const payload = readDragPayload(event);
            if (!payload) {
              return;
            }
            if (payload.kind === "tool") {
              props.onCreateInBoard(payload.toolType, card.childBoardId, { x: 120, y: 120 });
              return;
            }
            props.onMoveToBoard(payload, card.childBoardId, { x: 120, y: 120 });
          }}
        >
          Drop into nested board
        </div>
      ) : null}

      {card.type === "column" ? (
        <div
          className="column-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            setDropEffect(event);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const payload = readDragPayload(event);
            if (!payload) {
              return;
            }
            if (payload.kind === "tool") {
              props.onCreateInColumn(payload.toolType, card.id, childCards.length);
              return;
            }
            props.onMoveCard(payload, { columnId: card.id, index: childCards.length });
          }}
        >
          <ColumnInsertionSlot columnId={card.id} index={0} onCreateInColumn={props.onCreateInColumn} onMoveCard={props.onMoveCard} />
          {childCards.map((childCard, index) => (
            <div key={childCard.id} className="column-item-card">
              <ColumnChildCard
                boardBundle={boardBundle}
                card={childCard}
                imageUrls={props.imageUrls}
                activeCardId={props.activeCardId}
                selectedCardIds={props.selectedCardIds}
                connectFromCardId={props.connectFromCardId}
                onSelectCard={props.onSelectCard}
                onUpdateCard={props.onUpdateCard}
                onUpdateMarkdown={props.onUpdateMarkdown}
                onFinishConnection={props.onFinishConnection}
                onOpenBoard={props.onOpenBoard}
              />
              <ColumnInsertionSlot columnId={card.id} index={index + 1} onCreateInColumn={props.onCreateInColumn} onMoveCard={props.onMoveCard} />
            </div>
          ))}
          {childCards.length === 0 ? <div className="column-empty">Drop cards here</div> : null}
        </div>
      ) : null}
    </div>
  );
}
