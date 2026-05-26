import { Toolbar } from "./components/Toolbar";
import { CanvasBoard } from "./components/CanvasBoard";
import { useWorkspaceController } from "./state/useWorkspaceController";

export default function App() {
  const controller = useWorkspaceController();
  const saveStatus = controller.state.isSaving
    ? "Saving..."
    : controller.state.hasUnsavedChanges
      ? "Unsaved"
      : "Saved";
  const boardPath = (() => {
    if (!controller.currentBoard || !controller.state.workspace) {
      return [];
    }

    const path: string[] = [];
    let boardId: string | null = controller.currentBoard.board.id;

    while (boardId) {
      const boardItem = controller.state.workspace.boards.find((item) => item.id === boardId);
      if (!boardItem) {
        break;
      }
      path.unshift(boardItem.title);
      boardId = boardItem.parentBoardId;
    }

    return path;
  })();

  return (
    <div className="app-shell">
      <Toolbar />

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="breadcrumb-bar">
              <span className="breadcrumb-logo">M</span>
              <span className="breadcrumb">
                {boardPath.length > 0 ? boardPath.join(" / ") : "Workspace"}
              </span>
            </div>
          </div>

          <div className="topbar-center">
            <div className="board-title-shell">
              <input
                className="board-title-input"
                value={controller.currentBoard?.board.title ?? ""}
                onChange={(event) => controller.updateCurrentBoardTitle(event.target.value)}
                placeholder="Board title"
              />
            </div>
          </div>

          <div className="topbar-right">
            <button
              type="button"
              className="nav-button"
              onClick={() => controller.goToParentBoard()}
              disabled={!controller.currentBoard?.board.parentBoardId}
            >
              Back
            </button>
            <button type="button" className="nav-button" onClick={() => void controller.openVault("picker")}>
              Open vault
            </button>
            <span className="nav-divider" />
            <span className="status-pill">{controller.state.vaultName ?? "No vault"}</span>
            <span className="status-pill">{saveStatus}</span>
          </div>
        </header>

        {!controller.state.isReady ? <div className="loading-state">Loading vault...</div> : null}
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
            onSelectCard={controller.selectCard}
            onClearSelection={controller.clearSelection}
            onUpdateCard={(cardId, updater) => controller.updateCard(controller.currentBoard!.board.id, cardId, updater)}
            onUpdateMarkdown={(cardId, markdown) =>
              controller.updateCardMarkdown(controller.currentBoard!.board.id, cardId, markdown)
            }
            onMoveToBoard={(payload, boardId, position) =>
              controller.moveCardByDrag(payload, {
                boardId,
                position,
              })
            }
            onStartConnection={controller.startConnection}
            onCancelConnection={controller.cancelConnection}
            onFinishConnection={(cardId) => controller.finishConnection(controller.currentBoard!.board.id, cardId)}
            onOpenBoard={controller.openChildBoard}
            onViewportChange={(viewport) => controller.setViewport(controller.currentBoard!.board.id, viewport)}
            onDropExternalFiles={(files, position) =>
              controller.importExternalFiles({
                boardId: controller.currentBoard!.board.id,
                files,
                startPosition: position,
              })
            }
          />
        ) : null}
      </main>
    </div>
  );
}
