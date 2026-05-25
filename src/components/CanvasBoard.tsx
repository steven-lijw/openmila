import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { parseTodoMarkdown, stringifyTodoMarkdown } from "../core/todoMarkdown";
import type { BoardBundle, CardMeta, DragCardPayload, DragToolPayload, Point } from "../types";

interface CanvasBoardProps {
  boardBundle: BoardBundle;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  readAssetUrl: (assetPath: string) => Promise<string>;
  onCanvasCreate: (toolType: DragToolPayload["toolType"], position: Point) => void;
  onCreateInColumn: (toolType: DragToolPayload["toolType"], columnId: string) => void;
  onCreateInBoard: (toolType: DragToolPayload["toolType"], boardId: string, position: Point) => void;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onClearSelection: () => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onMoveCard: (payload: DragCardPayload, destination: { position?: Point; columnId?: string; index?: number }) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string) => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
}

function readDragPayload(event: DragEvent): DragToolPayload | DragCardPayload | null {
  try {
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as DragToolPayload | DragCardPayload;
  } catch {
    return null;
  }
}

export function CanvasBoard(props: CanvasBoardProps) {
  const { boardBundle, connectFromCardId } = props;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  useEffect(() => {
    for (const card of boardBundle.board.cards) {
      if (card.type !== "image" || !card.assetPath || imageUrls[card.id]) {
        continue;
      }
      void props.readAssetUrl(card.assetPath).then((url) => {
        setImageUrls((current) => ({ ...current, [card.id]: url }));
      });
    }
  }, [boardBundle.board.cards, imageUrls, props.readAssetUrl]);

  const rootCards = useMemo(
    () => boardBundle.board.cards.filter((card) => card.parentId === null),
    [boardBundle.board.cards],
  );

  const edges = useMemo(() => {
    return boardBundle.board.edges
      .map((edge) => {
        const from = boardBundle.board.cards.find((card) => card.id === edge.fromCardId);
        const to = boardBundle.board.cards.find((card) => card.id === edge.toCardId);
        if (!from || !to || from.parentId || to.parentId || !("position" in from) || !("position" in to)) {
          return null;
        }
        return {
          id: edge.id,
          x1: from.position.x + from.size.width / 2,
          y1: from.position.y + from.size.height / 2,
          x2: to.position.x + to.size.width / 2,
          y2: to.position.y + to.size.height / 2,
        };
      })
      .filter(Boolean);
  }, [boardBundle.board.cards, boardBundle.board.edges]);

  const viewportStyle = {
    transform: `translate(${boardBundle.board.viewport.x}px, ${boardBundle.board.viewport.y}px) scale(${boardBundle.board.viewport.zoom})`,
    transformOrigin: "0 0",
  };

  const getCanvasPoint = (event: DragEvent | MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - boardBundle.board.viewport.x) / boardBundle.board.viewport.zoom,
      y: (event.clientY - rect.top - boardBundle.board.viewport.y) / boardBundle.board.viewport.zoom,
    };
  };

  return (
    <div
      className="canvas-shell"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClearSelection();
        }
      }}
    >
      <div
        className="canvas-board"
        ref={canvasRef}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const payload = readDragPayload(event);
          if (!payload) {
            return;
          }
          const point = getCanvasPoint(event);
          if (payload.kind === "tool") {
            props.onCanvasCreate(payload.toolType, point);
            return;
          }
          props.onMoveCard(payload, { position: point });
        }}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          setIsPanning(true);
          setPanStart({
            x: event.clientX - boardBundle.board.viewport.x,
            y: event.clientY - boardBundle.board.viewport.y,
          });
        }}
        onMouseMove={(event) => {
          if (!isPanning || !panStart) {
            return;
          }
          props.onViewportChange({
            ...boardBundle.board.viewport,
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
          const nextZoom = Math.max(0.4, Math.min(1.8, boardBundle.board.viewport.zoom - event.deltaY * 0.001));
          props.onViewportChange({
            ...boardBundle.board.viewport,
            zoom: nextZoom,
          });
        }}
      >
        <div className="canvas-inner" style={viewportStyle}>
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
                  strokeWidth="2"
                />
              ) : null,
            )}
          </svg>

          {rootCards.map((card) => (
            <CardRenderer
              key={card.id}
              card={card}
              boardBundle={boardBundle}
              imageUrls={imageUrls}
              isSelected={props.selectedCardIds.includes(card.id)}
              isActive={props.activeCardId === card.id}
              isConnectTarget={connectFromCardId === card.id}
              connectFromCardId={connectFromCardId}
              onSelectCard={props.onSelectCard}
              onUpdateCard={props.onUpdateCard}
              onUpdateMarkdown={props.onUpdateMarkdown}
              onMoveCard={props.onMoveCard}
              onMoveToBoard={props.onMoveToBoard}
              onCanvasCreate={props.onCanvasCreate}
              onCreateInColumn={props.onCreateInColumn}
              onCreateInBoard={props.onCreateInBoard}
              onStartConnection={props.onStartConnection}
              onFinishConnection={props.onFinishConnection}
              onOpenBoard={props.onOpenBoard}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface CardRendererProps {
  boardBundle: BoardBundle;
  card: CardMeta;
  imageUrls: Record<string, string>;
  isSelected: boolean;
  isActive: boolean;
  isConnectTarget: boolean;
  connectFromCardId: string | null;
  onCanvasCreate: (toolType: DragToolPayload["toolType"], position: Point) => void;
  onCreateInColumn: (toolType: DragToolPayload["toolType"], columnId: string) => void;
  onCreateInBoard: (toolType: DragToolPayload["toolType"], boardId: string, position: Point) => void;
  onSelectCard: (cardId: string, multi: boolean) => void;
  onUpdateCard: (cardId: string, updater: (card: CardMeta) => CardMeta) => void;
  onUpdateMarkdown: (cardId: string, markdown: string) => void;
  onMoveCard: (payload: DragCardPayload, destination: { position?: Point; columnId?: string; index?: number }) => void;
  onMoveToBoard: (payload: DragCardPayload, boardId: string, position: Point) => void;
  onStartConnection: (cardId: string) => void;
  onFinishConnection: (cardId: string) => void;
  onOpenBoard: (childBoardId: string) => void;
}

function CardRenderer(props: CardRendererProps) {
  const { card, boardBundle } = props;
  const childCards = card.type === "column"
    ? card.childCardIds
        .map((childId) => boardBundle.board.cards.find((item) => item.id === childId))
        .filter(Boolean) as CardMeta[]
    : [];
  const markdown = boardBundle.documents[card.id] ?? "";

  return (
    <div
      className={`canvas-card ${props.isSelected ? "selected" : ""}`}
      style={{
        left: card.position.x,
        top: card.position.y,
        width: card.size.width,
        minHeight: card.size.height,
      }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            kind: "card",
            sourceBoardId: boardBundle.board.id,
            cardId: card.id,
          }),
        );
        event.dataTransfer.effectAllowed = "move";
      }}
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
        <input
          className="card-title-input"
          value={card.title}
          onChange={(event) => {
            const title = event.target.value;
            props.onUpdateCard(card.id, (currentCard) => ({ ...currentCard, title }));
          }}
        />
        <div className="card-actions">
          <button type="button" onClick={() => props.onStartConnection(card.id)}>
            Link
          </button>
          {card.type === "board" ? (
            <button type="button" onClick={() => props.onOpenBoard(card.childBoardId)}>
              Enter
            </button>
          ) : null}
        </div>
      </div>

      {card.type === "note" ? (
        props.isActive ? (
          <textarea
            className="card-textarea"
            value={markdown}
            onChange={(event) => props.onUpdateMarkdown(card.id, event.target.value)}
          />
        ) : (
          <div className="card-preview">{markdown || "Empty note"}</div>
        )
      ) : null}

      {card.type === "todo" ? (
        <div className="todo-list">
          {parseTodoMarkdown(markdown).map((item, index, items) => (
            <label key={item.id} className="todo-item">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(event) => {
                  const nextItems = items.map((entry) =>
                    entry.id === item.id ? { ...entry, checked: event.target.checked } : entry,
                  );
                  props.onUpdateMarkdown(card.id, stringifyTodoMarkdown(nextItems));
                }}
              />
              <input
                className="todo-text-input"
                value={item.text}
                onChange={(event) => {
                  const nextItems = items.map((entry) =>
                    entry.id === item.id ? { ...entry, text: event.target.value } : entry,
                  );
                  props.onUpdateMarkdown(card.id, stringifyTodoMarkdown(nextItems));
                }}
              />
              {index === items.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    const nextItems = [...items, { id: `${item.id}_new`, checked: false, text: "New item" }];
                    props.onUpdateMarkdown(card.id, stringifyTodoMarkdown(nextItems));
                  }}
                >
                  +
                </button>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}

      {card.type === "link" ? (
        <div className="link-fields">
          <input
            placeholder="https://example.com"
            value={card.url}
            onChange={(event) =>
              props.onUpdateCard(card.id, (currentCard) =>
                currentCard.type === "link" ? { ...currentCard, url: event.target.value } : currentCard,
              )
            }
          />
          <textarea
            placeholder="Description"
            value={card.description}
            onChange={(event) =>
              props.onUpdateCard(card.id, (currentCard) =>
                currentCard.type === "link" ? { ...currentCard, description: event.target.value } : currentCard,
              )
            }
          />
        </div>
      ) : null}

      {card.type === "image" ? (
        <div className="image-card-body">
          {card.assetPath && props.imageUrls[card.id] ? (
            <img src={props.imageUrls[card.id]} alt={card.title} className="image-preview" />
          ) : (
            <div className="image-placeholder">Drop created an empty image card. Recreate with a file to fill it.</div>
          )}
        </div>
      ) : null}

      {card.type === "board" ? <div className="board-preview">Nested board destination</div> : null}

      {card.type === "board" ? (
        <div
          className="board-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
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
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const payload = readDragPayload(event);
            if (!payload) {
              return;
            }
            if (payload.kind === "tool") {
              props.onCreateInColumn(payload.toolType, card.id);
              return;
            }
            props.onMoveCard(payload, { columnId: card.id });
          }}
        >
          {childCards.map((childCard) => (
            <div key={childCard.id} className="column-item">
              <div className="column-item-label">{childCard.title}</div>
              <div className="column-item-type">{childCard.type}</div>
            </div>
          ))}
          {childCards.length === 0 ? <div className="column-empty">Drop cards here</div> : null}
        </div>
      ) : null}
    </div>
  );
}
