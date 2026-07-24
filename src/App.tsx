import { useMemo } from "react";
import { Toolbar } from "./components/Toolbar";
import { CanvasBoard } from "./components/CanvasBoard";
import { getBrowserSupport } from "./core/browserSupport";
import { useWorkspaceController } from "./state/useWorkspaceController";
import type { BoardBundle } from "./types";

export default function App() {
  const controller = useWorkspaceController();
  const support = useMemo(() => getBrowserSupport(), []);
  const saveStatus = controller.state.isSaving
    ? "Saving..."
    : controller.state.hasUnsavedChanges
      ? "Unsaved"
      : "Saved";

  const openPrimaryVault = () => {
    if (support.preferredBackend === "folder") {
      void controller.openVault("picker");
    } else if (support.preferredBackend === "opfs") {
      void controller.openVault("opfs");
    }
  };
  const boardPath = useMemo(() => {
    if (!controller.currentBoard) {
      return [] as { id: string; title: string }[];
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
  }, [controller.currentBoard, controller.state.boards]);

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
            <button
              type="button"
              className="nav-button"
              onClick={openPrimaryVault}
              disabled={!support.canOpenVault}
              title={
                support.folderPicker
                  ? "Open a local vault folder"
                  : support.opfs
                    ? "Open the browser-local vault (Safari-compatible)"
                    : (support.message ?? "Vault storage unavailable")
              }
            >
              Open vault
            </button>
            <span className="nav-divider" />
            <span className="status-pill">{controller.state.vaultName ?? "No vault"}</span>
            <span className="status-pill status-pill-save">{saveStatus}</span>
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
              <h1 id="empty-state-title">
                {support.folderPicker ? "Open a workspace folder" : "Open your workspace"}
              </h1>
              <p>
                {support.folderPicker
                  ? "Pick a local folder to load your boards, notes, files, and nested canvases."
                  : support.opfs
                    ? "Safari stores your vault privately in this browser (Origin Private File System). Everything stays on your device — no cloud account."
                    : "This browser cannot open a vault yet. Use Chrome, Edge, or a recent Safari."}
              </p>
              <div className="empty-state-actions">
                {support.folderPicker ? (
                  <button
                    type="button"
                    className="empty-state-primary"
                    onClick={() => void controller.openVault("picker")}
                    title="Pick a local folder on disk"
                  >
                    Choose vault folder
                  </button>
                ) : null}
                {support.opfs ? (
                  <button
                    type="button"
                    className={support.folderPicker ? "empty-state-secondary" : "empty-state-primary"}
                    onClick={() => void controller.openVault("opfs")}
                    title="Store the vault inside this browser (works in Safari)"
                  >
                    {support.folderPicker ? "Use browser vault" : "Open browser vault"}
                  </button>
                ) : null}
              </div>
              {support.canOpenVault ? (
                <p className="empty-state-hint">
                  {support.folderPicker && support.opfs
                    ? "Chrome/Edge: disk folder · Safari: browser vault · data stays on this device"
                    : support.folderPicker
                      ? "Chrome or Edge · open via localhost · data stays in your folder"
                      : "Safari-compatible browser vault · data stays on this device"}
                </p>
              ) : null}
              {!support.canOpenVault && support.message ? (
                <div className="empty-state-error empty-state-warning" role="status">
                  <strong>Browser requirement</strong>
                  <p>{support.message}</p>
                </div>
              ) : null}
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

        {controller.currentBoard ? (
          <CanvasBoard
            boardBundle={controller.currentBoard}
            selectedCardIds={controller.state.selectedCardIds}
            activeCardId={controller.state.activeCardId}
            connectFromCardId={controller.state.connectFromCardId}
            readAssetUrl={controller.readAssetUrl}
            onCanvasCreate={(toolType, position) => {
              const currentBoardId = controller.currentBoard!.board.id;
              void controller.createCardFromTool(toolType, position, {
                boardId: currentBoardId,
              });
            }}
            onSelectCard={controller.selectCard}
            onClearSelection={controller.clearSelection}
            onUpdateCard={(cardId, updater) =>
              controller.updateCard(controller.currentBoard!.board.id, cardId, updater)
            }
            onUpdateCards={(updates) =>
              controller.updateCards(controller.currentBoard!.board.id, updates)
            }
            onUpdateMarkdown={(cardId, markdown) =>
              controller.updateCardMarkdown(controller.currentBoard!.board.id, cardId, markdown)
            }
            onUpdateBoardCardTitle={(boardId, cardId, title) =>
              controller.updateBoardCardTitle(boardId, cardId, title)
            }
            onBringCardsToFront={(cardIds) =>
              controller.bringCardsToFront(controller.currentBoard!.board.id, cardIds)
            }
            onMoveToBoard={(payload, boardId, position) =>
              void controller.moveCardByDrag(payload, { boardId, position })
            }
            onStartConnection={controller.startConnection}
            onCancelConnection={controller.cancelConnection}
            onFinishConnection={(cardId) =>
              controller.finishConnection(controller.currentBoard!.board.id, cardId)
            }
            onDeleteEdge={(edgeId) => controller.deleteEdge(edgeId)}
            onUpdateEdge={(edgeId, updater) => controller.updateEdge(edgeId, updater)}
            onOpenBoard={controller.openChildBoard}
            onViewportChange={(viewport) =>
              controller.setViewport(controller.currentBoard!.board.id, viewport)
            }
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
