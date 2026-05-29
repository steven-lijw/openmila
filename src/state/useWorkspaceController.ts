import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFileExtension } from "../core/filePreview";
import { addCardToBoard, createCardCreationResult, getBoard, getCard, moveCardToRoot, moveCardsToFront, patchCard, removeEdge, removeCardFromBoard, replaceBoardBundle, setBoardTitle, setCardDocument, updateEdgeList } from "../core/boardOperations";
import { createId } from "../core/ids";
import { BrowserFsVault } from "../storage/fsVault";
import type { AppState, BoardBundle, CardMeta, CardType, DragCardPayload, Edge, Point, WorkspaceFile } from "../types";

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

const UNDO_LIMIT = 10;

type UndoSnapshot = {
  workspace: AppState["workspace"];
  boards: Record<string, BoardBundle>;
  currentBoardId: string | null;
  trashEntries?: string[];
};

function buildBoardPathMap(
  boards: Record<string, BoardBundle>,
  workspace: WorkspaceFile,
): Record<string, string> {
  const map: Record<string, string> = {};
  const resolving = new Set<string>();

  const resolve = (boardId: string): string => {
    if (map[boardId]) {
      return map[boardId];
    }
    if (resolving.has(boardId)) {
      return "";
    }
    resolving.add(boardId);
    const bundle = boards[boardId];
    if (!bundle) {
      resolving.delete(boardId);
      return "";
    }
    if (boardId === workspace.rootBoardId) {
      map[boardId] = workspace.rootBoardPath;
      resolving.delete(boardId);
      return map[boardId];
    }

    const parentId = bundle.board.parentBoardId;
    if (!parentId) {
      map[boardId] = boardId === workspace.rootBoardId
        ? workspace.rootBoardPath
        : `boards/${bundle.board.slug}`;
      resolving.delete(boardId);
      return map[boardId];
    }

    const parentPath = resolve(parentId);
    if (!parentPath) {
      resolving.delete(boardId);
      return "";
    }

    map[boardId] = `${parentPath}/boards/${bundle.board.slug}`;
    resolving.delete(boardId);
    return map[boardId];
  };

  for (const boardId of Object.keys(boards)) {
    resolve(boardId);
  }

  return map;
}

function collectBoardDescendants(boards: Record<string, BoardBundle>, rootId: string): string[] {
  const results: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (!boards[current]) {
      continue;
    }
    results.push(current);
    for (const [boardId, bundle] of Object.entries(boards)) {
      if (bundle.board.parentBoardId === current) {
        stack.push(boardId);
      }
    }
  }

  return results;
}

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
  const undoStackRef = useRef<UndoSnapshot[]>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const pushUndo = useCallback((trashEntries?: string[]) => {
    const current = stateRef.current;
    if (!current.workspace) {
      return;
    }
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(UNDO_LIMIT - 1)),
      {
        workspace: current.workspace,
        boards: current.boards,
        currentBoardId: current.currentBoardId,
        trashEntries,
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
      undoStackRef.current = [];
      const nextCurrentBoardId = initialized.boards[initialized.workspace.recentBoardId]
        ? initialized.workspace.recentBoardId
        : initialized.workspace.rootBoardId;
      setState({
        vaultName: vault.vaultName,
        workspace: initialized.workspace,
        boards: initialized.boards,
        currentBoardId: nextCurrentBoardId,
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
        const boardPaths = buildBoardPathMap(state.boards, state.workspace!);
        await vaultRef.current!.saveWorkspace(state.workspace!);
        for (const [boardId, bundle] of Object.entries(state.boards)) {
          const boardPath = boardPaths[boardId];
          if (!boardPath) {
            continue;
          }
          await vaultRef.current!.saveBoardBundle(boardPath, bundle);
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
    const boardPaths = buildBoardPathMap(input.boards, input.workspace);
    await vaultRef.current.saveWorkspace(input.workspace);
    for (const [boardId, bundle] of Object.entries(input.boards)) {
      const boardPath = boardPaths[boardId];
      if (!boardPath) {
        continue;
      }
      await vaultRef.current.saveBoardBundle(boardPath, bundle);
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

    const boardPaths = buildBoardPathMap(latestState.boards, latestState.workspace);
    const boardPath = boardPaths[input.boardId];
    if (!boardPath) {
      return;
    }

    const bundle = getBoard(latestState, input.boardId);
    const creation = createCardCreationResult(latestState.workspace, bundle, input.type, input.position);
    const assetPath = await vaultRef.current.importAsset(boardPath, input.file);

    let imageSize: { width: number; height: number } | undefined;
    if (input.type === "image") {
      const bitmap = await createImageBitmap(input.file);
      const maxW = 800, maxH = 600;
      let w = bitmap.width, h = bitmap.height;
      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      bitmap.close();
      imageSize = { width: w, height: h };
    }

    const nextBundle = replaceBoardBundle(
      creation.boardBundle,
      patchCard(creation.boardBundle.board, creation.createdCardId, (card) =>
        card.type === "image"
          ? {
              ...card,
              assetPath,
              title: input.file.name,
              ...(imageSize ? { size: imageSize } : {}),
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
      activeCardId: null,
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
      const activeCardId = null;
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
      const oldSlug = childBoard.board.slug;
      const newSlug = updatedChild.board.slug;
      if (oldSlug !== newSlug && vaultRef.current) {
        const boardPaths = buildBoardPathMap(latestState.boards, latestState.workspace);
        const parentPath = boardPaths[boardId];
        if (parentPath) {
          const oldPath = `${parentPath}/boards/${oldSlug}`;
          const newPath = `${parentPath}/boards/${newSlug}`;
          void vaultRef.current.moveDirectory(oldPath, newPath).catch(setError);
        }
      }
      nextBundle = {
        ...nextBundle,
        documents: {
          ...nextBundle.documents,
          ...updatedChild.documents,
        },
      };
      setState((current) => ({
        ...current,
        workspace: latestState.workspace,
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
  }, [setError, updateBoardBundle]);

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

  const deleteSelectedCards = useCallback(async () => {
    const latestState = stateRef.current;
    if (!latestState.currentBoardId || latestState.selectedCardIds.length === 0 || !latestState.workspace) {
      return;
    }
    const boardPaths = buildBoardPathMap(latestState.boards, latestState.workspace);
    const currentBoardPath = boardPaths[latestState.currentBoardId];
    if (!currentBoardPath) {
      return;
    }

    let nextBundle = getBoard(latestState, latestState.currentBoardId);
    let nextWorkspace = latestState.workspace;
    const nextBoards = { ...latestState.boards };
    const trashItems: Array<{ path: string; kind: "file" | "directory" }> = [];
    const deletedBoardIds = new Set<string>();

    for (const cardId of latestState.selectedCardIds) {
      const card = nextBundle.board.cards.find((item) => item.id === cardId);
      if (!card) {
        continue;
      }

      if (card.type === "board") {
        const toRemove = collectBoardDescendants(latestState.boards, card.childBoardId);
        const rootBoardPath = boardPaths[card.childBoardId];
        if (rootBoardPath) {
          trashItems.push({ path: rootBoardPath, kind: "directory" });
        }
        for (const boardId of toRemove) {
          if (deletedBoardIds.has(boardId)) {
            continue;
          }
          deletedBoardIds.add(boardId);
        }
      }

      if ((card.type === "note" || card.type === "todo") && currentBoardPath) {
        trashItems.push({ path: `${currentBoardPath}/cards/${card.id}.md`, kind: "file" });
      }

      if ((card.type === "image" || card.type === "file") && card.assetPath) {
        trashItems.push({ path: `${currentBoardPath}/${card.assetPath}`, kind: "file" });
      }

      nextBundle = removeCardFromBoard(nextBundle, cardId);
    }

    for (const boardId of deletedBoardIds) {
      delete nextBoards[boardId];
    }

    if (deletedBoardIds.has(nextWorkspace.recentBoardId)) {
      nextWorkspace = {
        ...nextWorkspace,
        recentBoardId: latestState.currentBoardId ?? nextWorkspace.rootBoardId,
      };
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

    // Move files to trash asynchronously so the UI updates immediately
    if (vaultRef.current && trashItems.length > 0) {
      void vaultRef.current.createTrashEntry(trashItems).catch(setError);
    }
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
      void deleteSelectedCards();
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

  const updateEdge = useCallback((edgeId: string, updater: (edge: Edge) => Edge) => {
    const latestState = stateRef.current;
    if (!latestState.currentBoardId) {
      return;
    }
    const bundle = getBoard(latestState, latestState.currentBoardId);
    updateBoardBundle(latestState.currentBoardId, replaceBoardBundle(bundle, {
      ...bundle.board,
      edges: bundle.board.edges.map((e) => (e.id === edgeId ? updater(e) : e)),
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
    if (snapshot.trashEntries && vaultRef.current) {
      void Promise.all(snapshot.trashEntries.map((entryId) => vaultRef.current!.restoreTrashEntry(entryId))).catch(setError);
    }
  }, [setError]);

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
    const oldSlug = currentBoard.board.slug;
    const newSlug = nextBundle.board.slug;
    let nextWorkspace = state.workspace;
    if (currentBoard.board.id === state.workspace.rootBoardId) {
      nextWorkspace = {
        ...state.workspace,
        rootBoardPath: `boards/${newSlug}`,
      };
    }
    if (oldSlug !== newSlug && vaultRef.current) {
      const boardPaths = buildBoardPathMap(state.boards, state.workspace);
      const oldPath = boardPaths[currentBoard.board.id] ?? state.workspace.rootBoardPath;
      const parentPath = currentBoard.board.parentBoardId
        ? boardPaths[currentBoard.board.parentBoardId]
        : null;
      const newPath = parentPath ? `${parentPath}/boards/${newSlug}` : `boards/${newSlug}`;
      void vaultRef.current.moveDirectory(oldPath, newPath).catch(setError);
    }
    updateWorkspaceAndBoards({
      workspace: nextWorkspace,
      bundles: {
        [currentBoard.board.id]: nextBundle,
      },
    });
  }, [currentBoard, setError, state.boards, state.workspace, updateWorkspaceAndBoards]);

  const setViewport = useCallback((boardId: string, position: { x: number; y: number; zoom: number }) => {
    const bundle = getBoard(stateRef.current, boardId);
    updateBoardBundle(boardId, replaceBoardBundle(bundle, {
      ...bundle.board,
      viewport: position,
    }));
  }, [updateBoardBundle]);

  const readAssetUrl = useCallback(async (boardId: string, assetPath: string) => {
    const latestState = stateRef.current;
    if (!vaultRef.current || !latestState.workspace) {
      return "";
    }
    const boardPaths = buildBoardPathMap(latestState.boards, latestState.workspace);
    const boardPath = boardPaths[boardId];
    if (!boardPath) {
      return "";
    }
    return vaultRef.current.readAssetUrl(boardPath, assetPath);
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
    updateEdge,
    undo,
    openChildBoard,
    goToParentBoard,
    updateCurrentBoardTitle,
    setViewport,
    readAssetUrl,
    importExternalFiles,
  };
}
