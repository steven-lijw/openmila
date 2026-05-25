import { Toolbar } from "./components/Toolbar";
import { CanvasBoard } from "./components/CanvasBoard";
import { useWorkspaceController } from "./state/useWorkspaceController";

export default function App() {
  const controller = useWorkspaceController();

  return (
    <div className="app-shell">
      <Toolbar />

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              onClick={() => controller.goToParentBoard()}
              disabled={!controller.currentBoard?.board.parentBoardId}
            >
              Back
            </button>
            <button type="button" onClick={() => void controller.openVault("picker")}>
              Open vault
            </button>
          </div>

          <div className="topbar-center">
            <input
              className="board-title-input"
              value={controller.currentBoard?.board.title ?? ""}
              onChange={(event) => controller.updateCurrentBoardTitle(event.target.value)}
              placeholder="Board title"
            />
          </div>

          <div className="topbar-right">
            <span>{controller.state.vaultName ?? "No vault"}</span>
            <span>{controller.state.isSaving ? "Saving..." : controller.state.hasUnsavedChanges ? "Unsaved" : "Saved"}</span>
          </div>
        </header>

        {!controller.state.isReady ? <div className="empty-state">Loading vault...</div> : null}
        {controller.state.error ? <div className="error-banner">{controller.state.error}</div> : null}

        {!controller.currentBoard && controller.state.isReady ? (
          <div className="empty-state">
            <p>No vault is open yet.</p>
            <button type="button" onClick={() => void controller.openVault("picker")}>
              Choose local vault folder
            </button>
          </div>
        ) : null}

        {controller.currentBoard ? (
          <CanvasBoard
            boardBundle={controller.currentBoard}
            selectedCardIds={controller.state.selectedCardIds}
            activeCardId={controller.state.activeCardId}
            connectFromCardId={controller.state.connectFromCardId}
            readAssetUrl={controller.readAssetUrl}
            onCanvasCreate={(toolType, position) => {
              void controller.createCardFromTool(toolType, position, {
                boardId: controller.currentBoard!.board.id,
              });
            }}
            onCreateInColumn={(toolType, columnId) => {
              void controller.createCardFromTool(toolType, { x: 80, y: 80 }, {
                boardId: controller.currentBoard!.board.id,
                columnId,
              });
            }}
            onCreateInBoard={(toolType, boardId, position) => {
              void controller.createCardFromTool(toolType, position, {
                boardId,
              });
            }}
            onSelectCard={controller.selectCard}
            onClearSelection={controller.clearSelection}
            onUpdateCard={(cardId, updater) => controller.updateCard(controller.currentBoard!.board.id, cardId, updater)}
            onUpdateMarkdown={(cardId, markdown) =>
              controller.updateCardMarkdown(controller.currentBoard!.board.id, cardId, markdown)
            }
            onMoveCard={(payload, destination) =>
              controller.moveCardByDrag(payload, {
                boardId: controller.currentBoard!.board.id,
                ...destination,
              })
            }
            onMoveToBoard={(payload, boardId, position) =>
              controller.moveCardByDrag(payload, {
                boardId,
                position,
              })
            }
            onStartConnection={controller.startConnection}
            onFinishConnection={(cardId) => controller.finishConnection(controller.currentBoard!.board.id, cardId)}
            onOpenBoard={controller.openChildBoard}
            onViewportChange={(viewport) => controller.setViewport(controller.currentBoard!.board.id, viewport)}
          />
        ) : null}
      </main>
    </div>
  );
}
