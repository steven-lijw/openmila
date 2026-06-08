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
    if (!controller.currentBoard) {
      return [];
    }

    const path: { id: string; title: string }[] = [];
    let boardId: string | null = controller.currentBoard.board.id;

    while (boardId) {
      const bundle = controller.state.boards[boardId];
      if (!bundle) {
        break;
      }
      path.unshift({ id: bundle.board.id, title: bundle.board.title });
      boardId = bundle.board.parentBoardId;
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
                {boardPath.length > 0
                  ? boardPath.map((item, index) => {
                      const isLast = index === boardPath.length - 1;
                      return (
                        <span key={item.id} className="breadcrumb-item">
                          <button
                            type="button"
                            className="breadcrumb-link"
                            onClick={() => controller.openChildBoard(item.id)}
                            disabled={isLast}
                          >
                            {item.title}
                          </button>
                          {!isLast ? <span className="breadcrumb-separator">/</span> : null}
                        </span>
                      );
                    })
                  : "Workspace"}
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

        {controller.currentBoard ? (() => {
          const currentBoardId = controller.currentBoard.board.id;
          return (
          <CanvasBoard
            boardBundle={controller.currentBoard}
            selectedCardIds={controller.state.selectedCardIds}
            activeCardId={controller.state.activeCardId}
            connectFromCardId={controller.state.connectFromCardId}
            readAssetUrl={controller.readAssetUrl}
            onCanvasCreate={(toolType, position) => {
              void controller.createCardFromTool(toolType, position, {
                boardId: currentBoardId,
              });
            }}
            onSelectCard={controller.selectCard}
            onClearSelection={controller.clearSelection}
            onUpdateCard={(cardId, updater) => controller.updateCard(currentBoardId, cardId, updater)}
            onUpdateMarkdown={(cardId, markdown) =>
              controller.updateCardMarkdown(currentBoardId, cardId, markdown)
            }
            onUpdateBoardCardTitle={(boardId, cardId, title) =>
              controller.updateBoardCardTitle(boardId, cardId, title)
            }
            onBringCardsToFront={(cardIds) =>
              controller.bringCardsToFront(currentBoardId, cardIds)
            }
            onMoveToBoard={(payload, boardId, position) =>
              controller.moveCardByDrag(payload, {
                boardId,
                position,
              })
            }
            onStartConnection={controller.startConnection}
            onCancelConnection={controller.cancelConnection}
            onFinishConnection={(cardId) => controller.finishConnection(currentBoardId, cardId)}
            onDeleteEdge={(edgeId) => controller.deleteEdge(edgeId)}
            onUpdateEdge={(edgeId, updater) => controller.updateEdge(edgeId, updater)}
            onOpenBoard={controller.openChildBoard}
            onViewportChange={(viewport) => controller.setViewport(currentBoardId, viewport)}
            onDropExternalFiles={(files, position) =>
              controller.importExternalFiles({
                boardId: currentBoardId,
                files,
                startPosition: position,
              })
            }
          />
          );
        })() : null}
      </main>
    </div>
  );
}
