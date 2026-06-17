import { Toolbar } from "./components/Toolbar";
import { CanvasBoard } from "./components/CanvasBoard";
import { useWorkspaceController } from "./state/useWorkspaceController";
import type { BoardBundle } from "./types";

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

    while (boardId !== null) {
      const bundle: BoardBundle | undefined = controller.state.boards[boardId];
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
            <div className={`board-title-shell${controller.currentBoard ? "" : " is-idle"}`}>
              <input
                className="board-title-input"
                value={controller.currentBoard?.board.title ?? ""}
                onChange={(event) => controller.updateCurrentBoardTitle(event.target.value)}
                placeholder={controller.currentBoard ? "Board title" : "No board open"}
                disabled={!controller.currentBoard}
              />
            </div>
          </div>

          <div className="topbar-right">
            {controller.currentBoard ? (
              <button
                type="button"
                className="nav-button"
                onClick={() => controller.goToParentBoard()}
                disabled={!controller.currentBoard.board.parentBoardId}
              >
                Back
              </button>
            ) : null}
            <button type="button" className="nav-button" onClick={() => void controller.openVault("picker")}>
              Open vault
            </button>
            <span className="nav-divider" />
            <span className="status-pill">{controller.state.vaultName ?? "No vault"}</span>
            <span className="status-pill">{saveStatus}</span>
          </div>
        </header>

        {!controller.state.isReady ? <div className="loading-state">Loading vault...</div> : null}
        {controller.state.error && controller.currentBoard ? (
          <div className="error-banner">{controller.state.error}</div>
        ) : null}

        {!controller.currentBoard && controller.state.isReady ? (
          <div className="empty-state">
            <section className="empty-state-copy" aria-labelledby="empty-state-title">
              <span className="empty-state-kicker">Local vault</span>
              <h1 id="empty-state-title">Open a workspace folder</h1>
              <p>
                Pick a local folder to load your boards, notes, files, and nested canvases.
              </p>
              <div className="empty-state-actions">
                <button
                  type="button"
                  className="empty-state-primary"
                  onClick={() => void controller.openVault("picker")}
                >
                  Choose vault folder
                </button>
              </div>
              {controller.state.error ? (
                <div className="empty-state-error" role="status">
                  {controller.state.error}
                </div>
              ) : null}
            </section>

            <section className="empty-state-preview" aria-hidden="true">
              <div className="empty-preview-board">
                <div className="empty-preview-toolbar">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="empty-preview-card empty-preview-card-note">
                  <strong>Research map</strong>
                  <span>Ideas, links, and files live together.</span>
                </div>
                <div className="empty-preview-card empty-preview-card-board">
                  <span className="empty-preview-board-icon">M</span>
                  <strong>Project board</strong>
                </div>
                <div className="empty-preview-card empty-preview-card-file">
                  <strong>Draft.pdf</strong>
                  <span>Local asset</span>
                </div>
                <svg className="empty-preview-lines" viewBox="0 0 420 300">
                  <path d="M126 112 C170 74 222 68 268 96" />
                  <path d="M282 142 C246 184 198 196 154 168" />
                </svg>
              </div>
            </section>
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
