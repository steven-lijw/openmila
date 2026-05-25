import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addCardToBoard, createCardCreationResult, getBoard, getCard, moveCardToRoot, patchCard, removeCardFromBoard, replaceBoardBundle, setBoardTitle, setCardDocument, updateEdgeList } from "../core/boardOperations";
import { createId } from "../core/ids";
import { BrowserFsVault } from "../storage/fsVault";
import type { AppState, BoardBundle, CardMeta, CardType, DragCardPayload, Edge, Point } from "../types";

const EMPTY_STATE: AppState = {
  vaultName: null,
  workspace: null,
  boards: {},
  currentBoardId: null,
  selectedCardIds: [],
  activeCardId: null,
  connectFromCardId: null,
  isReady: false,
  isSaving: false,
  hasUnsavedChanges: false,
  error: null,
};

function createDefaultMarkdown(type: CardType): string {
  if (type === "todo") {
    return "- [ ] First task";
  }
  if (type === "note") {
    return "Start writing here.";
  }
  return "";
}

export function useWorkspaceController() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const vaultRef = useRef<BrowserFsVault | null>(null);
  const stateRef = useRef<AppState>(EMPTY_STATE);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setState((current) => ({ ...current, error: message }));
  }, []);

  const openVault = useCallback(async (mode: "picker" | "recent") => {
    try {
      const vault = mode === "picker" ? await BrowserFsVault.openVaultPicker() : await BrowserFsVault.reopenRecentVault();
      if (!vault) {
        setState((current) => ({
          ...current,
          isReady: true,
          error: mode === "recent" ? null : current.error,
        }));
        return;
      }

      const initialized = await vault.initialize();
      vaultRef.current = vault;
      setState({
        vaultName: vault.vaultName,
        workspace: initialized.workspace,
        boards: initialized.boards,
        currentBoardId: initialized.workspace.recentBoardId,
        selectedCardIds: [],
        activeCardId: null,
        connectFromCardId: null,
        isReady: true,
        isSaving: false,
        hasUnsavedChanges: false,
        error: null,
      });
    } catch (error) {
      setError(error);
      setState((current) => ({ ...current, isReady: true }));
    }
  }, [setError]);

  useEffect(() => {
    void openVault("recent");
  }, [openVault]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [state.hasUnsavedChanges]);

  useEffect(() => {
    if (!state.hasUnsavedChanges || !state.workspace || !vaultRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setState((current) => ({ ...current, isSaving: true }));
        await vaultRef.current!.saveWorkspace(state.workspace!);
        for (const bundle of Object.values(state.boards)) {
          await vaultRef.current!.saveBoardBundle(bundle);
        }
        setState((current) => ({
          ...current,
          isSaving: false,
          hasUnsavedChanges: false,
        }));
      } catch (error) {
        setError(error);
        setState((current) => ({ ...current, isSaving: false }));
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [setError, state.boards, state.hasUnsavedChanges, state.workspace]);

  const currentBoard = useMemo(() => {
    if (!state.currentBoardId) {
      return null;
    }
    return state.boards[state.currentBoardId] ?? null;
  }, [state.boards, state.currentBoardId]);

  const updateBoardBundle = useCallback((boardId: string, nextBundle: BoardBundle) => {
    setState((current) => ({
      ...current,
      boards: {
        ...current.boards,
        [boardId]: nextBundle,
      },
      hasUnsavedChanges: true,
    }));
  }, []);

  const updateWorkspaceAndBoards = useCallback((input: { workspace?: AppState["workspace"]; bundles?: Record<string, BoardBundle> }) => {
    setState((current) => ({
      ...current,
      workspace: input.workspace ?? current.workspace,
      boards: input.bundles ? { ...current.boards, ...input.bundles } : current.boards,
      hasUnsavedChanges: true,
    }));
  }, []);

  const createImageCardFromFile = useCallback(async (input: { boardId: string; file: File; position: Point }) => {
    const latestState = stateRef.current;
    if (!latestState.workspace || !vaultRef.current) {
      return;
    }

    const bundle = getBoard(latestState, input.boardId);
    const creation = createCardCreationResult(latestState.workspace, bundle, "image", input.position);
    const assetPath = await vaultRef.current.importAsset(input.file);
    const nextBundle = replaceBoardBundle(
      creation.boardBundle,
      patchCard(creation.boardBundle.board, creation.createdCardId, (card) =>
        card.type === "image"
          ? {
              ...card,
              assetPath,
              title: input.file.name,
            }
          : card,
      ),
    );

    updateWorkspaceAndBoards({
      workspace: {
        ...creation.workspace,
        recentBoardId: latestState.currentBoardId ?? creation.workspace.rootBoardId,
      },
      bundles: {
        [bundle.board.id]: nextBundle,
      },
    });
  }, [updateWorkspaceAndBoards]);

  const createCardFromTool = useCallback(async (type: CardType, position: Point, target?: { boardId: string }) => {
    const latestState = stateRef.current;
    if (!latestState.workspace || !target?.boardId) {
      return;
    }

    if (type === "image") {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          excludeAcceptAllOption: false,
          multiple: false,
          types: [
            {
              description: "Images",
              accept: {
                "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
              },
            },
          ],
        });
        const file = await fileHandle.getFile();
        await createImageCardFromFile({
          boardId: target.boardId,
          file,
          position,
        });
      } catch {
        // User cancelled file selection.
      }
      return;
    }

    const bundle = getBoard(latestState, target.boardId);
    const creation = createCardCreationResult(latestState.workspace, bundle, type, position);
    let nextBundle = creation.boardBundle;
    const nextBundles: Record<string, BoardBundle> = {};

    if (type === "note" || type === "todo") {
      nextBundle = setCardDocument(nextBundle, creation.createdCardId, createDefaultMarkdown(type));
    }

    nextBundles[bundle.board.id] = nextBundle;
    if (creation.createdBoard) {
      nextBundles[creation.createdBoard.board.id] = creation.createdBoard;
    }

    updateWorkspaceAndBoards({
      workspace: {
        ...creation.workspace,
        recentBoardId: latestState.currentBoardId ?? creation.workspace.rootBoardId,
      },
      bundles: nextBundles,
    });
  }, [createImageCardFromFile, updateWorkspaceAndBoards]);

  const selectCard = useCallback((cardId: string, multi: boolean) => {
    setState((current) => {
      const selectedCardIds = multi
        ? current.selectedCardIds.includes(cardId)
          ? current.selectedCardIds.filter((id) => id !== cardId)
          : [...current.selectedCardIds, cardId]
        : [cardId];
      return {
        ...current,
        selectedCardIds,
        activeCardId: cardId,
      };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState((current) => ({
      ...current,
      selectedCardIds: [],
      activeCardId: null,
      connectFromCardId: null,
    }));
  }, []);

  const updateCard = useCallback((boardId: string, cardId: string, updater: (card: CardMeta) => CardMeta) => {
    const bundle = getBoard(stateRef.current, boardId);
    updateBoardBundle(boardId, replaceBoardBundle(bundle, patchCard(bundle.board, cardId, updater)));
  }, [updateBoardBundle]);

  const updateCardMarkdown = useCallback((boardId: string, cardId: string, markdown: string) => {
    const bundle = getBoard(stateRef.current, boardId);
    updateBoardBundle(boardId, setCardDocument(bundle, cardId, markdown));
  }, [updateBoardBundle]);

  const moveCardByDrag = useCallback((payload: DragCardPayload, destination: { boardId: string; position?: Point }) => {
    const latestState = stateRef.current;
    const sourceBundle = getBoard(latestState, payload.sourceBoardId);
    const movingCard = getCard(sourceBundle.board, payload.cardId);
    const sourceAfterRemoval = payload.sourceBoardId === destination.boardId ? sourceBundle : removeCardFromBoard(sourceBundle, payload.cardId);
    let destinationBundle = payload.sourceBoardId === destination.boardId ? sourceAfterRemoval : getBoard(latestState, destination.boardId);
    if (payload.sourceBoardId !== destination.boardId) {
      destinationBundle = addCardToBoard(destinationBundle, {
        ...movingCard,
        parentId: null,
      });
      if (sourceBundle.documents[payload.cardId]) {
        destinationBundle = {
          ...destinationBundle,
          documents: {
            ...destinationBundle.documents,
            [payload.cardId]: sourceBundle.documents[payload.cardId],
          },
        };
      }
    }

    if (destination.position) {
      destinationBundle = moveCardToRoot(destinationBundle, payload.cardId, destination.position);
    }

    setState((current) => ({
      ...current,
      boards: {
        ...current.boards,
        [payload.sourceBoardId]: sourceAfterRemoval,
        [destination.boardId]: destinationBundle,
      },
      hasUnsavedChanges: true,
    }));
  }, []);

  const deleteSelectedCards = useCallback(() => {
    const latestState = stateRef.current;
    if (!latestState.currentBoardId || latestState.selectedCardIds.length === 0 || !latestState.workspace) {
      return;
    }

    let nextBundle = getBoard(latestState, latestState.currentBoardId);
    let nextWorkspace = latestState.workspace;
    const nextBoards = { ...latestState.boards };

    for (const cardId of latestState.selectedCardIds) {
      const card = nextBundle.board.cards.find((item) => item.id === cardId);
      if (!card) {
        continue;
      }

      if (card.type === "board") {
        delete nextBoards[card.childBoardId];
        nextWorkspace = {
          ...nextWorkspace,
          boards: nextWorkspace.boards.filter((boardItem) => boardItem.id !== card.childBoardId),
          recentBoardId:
            nextWorkspace.recentBoardId === card.childBoardId
              ? latestState.currentBoardId
              : nextWorkspace.recentBoardId,
        };
      }

      nextBundle = removeCardFromBoard(nextBundle, cardId);
    }

    nextBoards[latestState.currentBoardId] = nextBundle;

    setState((current) => ({
      ...current,
      boards: nextBoards,
      workspace: nextWorkspace,
      selectedCardIds: [],
      activeCardId: null,
      connectFromCardId: null,
      hasUnsavedChanges: true,
    }));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }

      if (stateRef.current.selectedCardIds.length === 0) {
        return;
      }

      event.preventDefault();
      deleteSelectedCards();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelectedCards]);

  const startConnection = useCallback((cardId: string) => {
    setState((current) => ({
      ...current,
      connectFromCardId: cardId,
    }));
  }, []);

  const cancelConnection = useCallback(() => {
    setState((current) => ({
      ...current,
      connectFromCardId: null,
    }));
  }, []);

  const finishConnection = useCallback((boardId: string, toCardId: string) => {
    const latestState = stateRef.current;
    if (!latestState.connectFromCardId) {
      return;
    }
    const bundle = getBoard(latestState, boardId);
    const edge: Edge = {
      id: createId("edge"),
      fromCardId: latestState.connectFromCardId,
      toCardId,
    };
    updateBoardBundle(boardId, replaceBoardBundle(bundle, updateEdgeList(bundle.board, edge)));
    setState((current) => ({
      ...current,
      connectFromCardId: null,
    }));
  }, [updateBoardBundle]);

  const openChildBoard = useCallback((childBoardId: string) => {
    setState((current) => {
      if (!current.workspace) {
        return current;
      }
      return {
        ...current,
        currentBoardId: childBoardId,
        workspace: {
          ...current.workspace,
          recentBoardId: childBoardId,
        },
        selectedCardIds: [],
        activeCardId: null,
      };
    });
  }, []);

  const goToParentBoard = useCallback(() => {
    if (!currentBoard?.board.parentBoardId) {
      return;
    }
    setState((current) => ({
      ...current,
      currentBoardId: currentBoard.board.parentBoardId,
      selectedCardIds: [],
      activeCardId: null,
    }));
  }, [currentBoard]);

  const updateCurrentBoardTitle = useCallback((title: string) => {
    if (!currentBoard || !state.workspace) {
      return;
    }
    const nextBundle = setBoardTitle(currentBoard, title);
    const nextWorkspace = {
      ...state.workspace,
      boards: state.workspace.boards.map((boardItem) =>
        boardItem.id === currentBoard.board.id
          ? {
              ...boardItem,
              title,
              slug: nextBundle.board.slug,
            }
          : boardItem,
      ),
    };
    updateWorkspaceAndBoards({
      workspace: nextWorkspace,
      bundles: {
        [currentBoard.board.id]: nextBundle,
      },
    });
  }, [currentBoard, state.workspace, updateWorkspaceAndBoards]);

  const setViewport = useCallback((boardId: string, position: { x: number; y: number; zoom: number }) => {
    const bundle = getBoard(stateRef.current, boardId);
    updateBoardBundle(boardId, replaceBoardBundle(bundle, {
      ...bundle.board,
      viewport: position,
    }));
  }, [updateBoardBundle]);

  const readAssetUrl = useCallback(async (assetPath: string) => {
    if (!vaultRef.current) {
      return "";
    }
    return vaultRef.current.readAssetUrl(assetPath);
  }, []);

  const importImageFiles = useCallback(async (input: {
    boardId: string;
    files: File[];
    startPosition: Point;
  }) => {
    let offsetIndex = 0;
    for (const file of input.files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }

      await createImageCardFromFile({
        boardId: input.boardId,
        file,
        position: {
          x: input.startPosition.x + offsetIndex * 24,
          y: input.startPosition.y + offsetIndex * 24,
        },
      });
      offsetIndex += 1;
    }
  }, [createImageCardFromFile]);

  return {
    state,
    currentBoard,
    openVault,
    createCardFromTool,
    selectCard,
    clearSelection,
    updateCard,
    updateCardMarkdown,
    moveCardByDrag,
    deleteSelectedCards,
    startConnection,
    cancelConnection,
    finishConnection,
    openChildBoard,
    goToParentBoard,
    updateCurrentBoardTitle,
    setViewport,
    readAssetUrl,
    importImageFiles,
  };
}
