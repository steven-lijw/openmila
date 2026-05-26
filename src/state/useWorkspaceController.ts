import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFileExtension } from "../core/filePreview";
import { addCardToBoard, createCardCreationResult, getBoard, getCard, moveCardToRoot, moveCardsToFront, patchCard, removeEdge, removeCardFromBoard, replaceBoardBundle, setBoardTitle, setCardDocument, updateEdgeList } from "../core/boardOperations";
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
    return "- [ ] ";
  }
  if (type === "note") {
    return "";
  }
  return "";
}

export function useWorkspaceController() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const vaultRef = useRef<BrowserFsVault | null>(null);
  const stateRef = useRef<AppState>(EMPTY_STATE);
  const undoStackRef = useRef<Array<{ workspace: AppState["workspace"]; boards: Record<string, BoardBundle>; currentBoardId: string | null }>>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const pushUndo = useCallback(() => {
    const current = stateRef.current;
    if (!current.workspace) {
      return;
    }
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      {
        workspace: current.workspace,
        boards: current.boards,
        currentBoardId: current.currentBoardId,
      },
    ];
  }, []);

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
    pushUndo();
    setState((current) => ({
      ...current,
      boards: {
        ...current.boards,
        [boardId]: nextBundle,
      },
      hasUnsavedChanges: true,
    }));
  }, [pushUndo]);

  const updateWorkspaceAndBoards = useCallback((input: { workspace?: AppState["workspace"]; bundles?: Record<string, BoardBundle> }) => {
    pushUndo();
    setState((current) => ({
      ...current,
      workspace: input.workspace ?? current.workspace,
      boards: input.bundles ? { ...current.boards, ...input.bundles } : current.boards,
      hasUnsavedChanges: true,
    }));
  }, [pushUndo]);

  const persistStateSnapshot = useCallback(async (input: {
    workspace: AppState["workspace"];
    boards: Record<string, BoardBundle>;
  }) => {
    if (!input.workspace || !vaultRef.current) {
      return;
    }

    await vaultRef.current.saveWorkspace(input.workspace);
    for (const bundle of Object.values(input.boards)) {
      await vaultRef.current.saveBoardBundle(bundle);
    }
  }, []);

  const createAssetCardFromFile = useCallback(async (input: {
    boardId: string;
    file: File;
    position: Point;
    type: "image" | "file";
  }) => {
    const latestState = stateRef.current;
    if (!latestState.workspace || !vaultRef.current) {
      return;
    }

    const bundle = getBoard(latestState, input.boardId);
    const creation = createCardCreationResult(latestState.workspace, bundle, input.type, input.position);
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
          : card.type === "file"
            ? {
                ...card,
                assetPath,
                title: input.file.name,
                mimeType: input.file.type,
                extension: getFileExtension(input.file.name),
                sizeBytes: input.file.size,
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

    if (type === "image" || type === "file") {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          excludeAcceptAllOption: false,
          multiple: false,
          types: [
            ...(type === "image"
              ? [
                  {
                    description: "Images",
                    accept: {
                      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
                    },
                  },
                ]
              : [
                  {
                    description: "Documents and files",
                    accept: {
                      "application/pdf": [".pdf"],
                      "application/msword": [".doc"],
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
                      "application/vnd.ms-powerpoint": [".ppt"],
                      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
                      "application/vnd.ms-excel": [".xls"],
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                      "application/rtf": [".rtf"],
                      "video/*": [".mp4", ".webm"],
                      "audio/*": [".mp3", ".wav", ".ogg"],
                      "text/plain": [".txt", ".md", ".csv", ".json", ".html"],
                    },
                  },
                ]),
          ],
        });
        const file = await fileHandle.getFile();
        await createAssetCardFromFile({
          boardId: target.boardId,
          file,
          position,
          type,
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

    setState((current) => ({
      ...current,
      selectedCardIds: [creation.createdCardId],
      activeCardId: creation.createdCardId,
    }));
  }, [createAssetCardFromFile, updateWorkspaceAndBoards]);

  const selectCard = useCallback((cardId: string, multi: boolean) => {
    setState((current) => {
      const isAlreadySelected = current.selectedCardIds.includes(cardId);
      const selectedCardIds = multi
        ? isAlreadySelected
          ? current.selectedCardIds.filter((id) => id !== cardId)
          : [...current.selectedCardIds, cardId]
        : [cardId];
      const activeCardId = multi
        ? null
        : isAlreadySelected
          ? cardId
          : null;
      return {
        ...current,
        selectedCardIds,
        activeCardId,
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

  const updateBoardCardTitle = useCallback((boardId: string, cardId: string, title: string) => {
    const latestState = stateRef.current;
    if (!latestState.workspace) {
      return;
    }
    const bundle = getBoard(latestState, boardId);
    const card = getCard(bundle.board, cardId);
    if (card.type !== "board") {
      return;
    }
    // Update card title
    let nextBundle = replaceBoardBundle(bundle, patchCard(bundle.board, cardId, (c) =>
      c.type === "board" ? { ...c, title } : c,
    ));
    // Update child board title
    const childBoard = latestState.boards[card.childBoardId];
    if (childBoard) {
      const updatedChild = setBoardTitle(childBoard, title);
      nextBundle = {
        ...nextBundle,
        documents: {
          ...nextBundle.documents,
          ...updatedChild.documents,
        },
      };
      const nextWorkspace = {
        ...latestState.workspace,
        boards: latestState.workspace.boards.map((boardItem) =>
          boardItem.id === card.childBoardId
            ? {
                ...boardItem,
                title,
                slug: updatedChild.board.slug,
              }
            : boardItem,
        ),
      };
      setState((current) => ({
        ...current,
        workspace: nextWorkspace,
        boards: {
          ...current.boards,
          [boardId]: nextBundle,
          [card.childBoardId]: updatedChild,
        },
        hasUnsavedChanges: true,
      }));
    } else {
      updateBoardBundle(boardId, nextBundle);
    }
  }, [updateBoardBundle]);

  const bringCardsToFront = useCallback((boardId: string, cardIds: string[]) => {
    if (cardIds.length === 0) {
      return;
    }
    const bundle = getBoard(stateRef.current, boardId);
    updateBoardBundle(boardId, replaceBoardBundle(bundle, moveCardsToFront(bundle.board, cardIds)));
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

    pushUndo();
    setState((current) => ({
      ...current,
      boards: {
        ...current.boards,
        [payload.sourceBoardId]: sourceAfterRemoval,
        [destination.boardId]: destinationBundle,
      },
      hasUnsavedChanges: true,
    }));
  }, [pushUndo]);

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

    pushUndo();
    setState((current) => ({
      ...current,
      boards: nextBoards,
      workspace: nextWorkspace,
      selectedCardIds: [],
      activeCardId: null,
      connectFromCardId: null,
      hasUnsavedChanges: true,
    }));

    void persistStateSnapshot({
      workspace: nextWorkspace,
      boards: nextBoards,
    }).catch(setError);
  }, [persistStateSnapshot, pushUndo, setError]);

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

  const deleteEdge = useCallback((edgeId: string) => {
    const latestState = stateRef.current;
    if (!latestState.currentBoardId) {
      return;
    }
    const bundle = getBoard(latestState, latestState.currentBoardId);
    updateBoardBundle(latestState.currentBoardId, replaceBoardBundle(bundle, removeEdge(bundle.board, edgeId)));
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

  const undo = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    setState((current) => ({
      ...current,
      workspace: snapshot.workspace,
      boards: snapshot.boards,
      currentBoardId: snapshot.currentBoardId,
      selectedCardIds: [],
      activeCardId: null,
      connectFromCardId: null,
      hasUnsavedChanges: true,
    }));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          return;
        }
        event.preventDefault();
        undo();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo]);

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

  const importExternalFiles = useCallback(async (input: {
    boardId: string;
    files: File[];
    startPosition: Point;
  }) => {
    let offsetIndex = 0;
    for (const file of input.files) {
      const nextType = file.type.startsWith("image/") ? "image" : "file";
      await createAssetCardFromFile({
        boardId: input.boardId,
        file,
        position: {
          x: input.startPosition.x + offsetIndex * 24,
          y: input.startPosition.y + offsetIndex * 24,
        },
        type: nextType,
      });
      offsetIndex += 1;
    }
  }, [createAssetCardFromFile]);

  return {
    state,
    currentBoard,
    openVault,
    createCardFromTool,
    selectCard,
    clearSelection,
    updateCard,
    updateCardMarkdown,
    updateBoardCardTitle,
    bringCardsToFront,
    moveCardByDrag,
    deleteSelectedCards,
    startConnection,
    cancelConnection,
    finishConnection,
    deleteEdge,
    undo,
    openChildBoard,
    goToParentBoard,
    updateCurrentBoardTitle,
    setViewport,
    readAssetUrl,
    importExternalFiles,
  };
}
