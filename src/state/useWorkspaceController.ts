import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFileExtension } from "../core/filePreview";
import { addCardToBoard, createCardCreationResult, getBoard, getCard, moveCardToRoot, moveCardsToFront, patchCard, removeEdge, removeCardFromBoard, replaceBoardBundle, setBoardTitle, setCardDocument, updateEdgeList } from "../core/boardOperations";
import { createId, createSlug } from "../core/ids";
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
const BOARD_TITLE_DEBOUNCE_MS = 600;

type PendingBoardRename = {
  boardId: string;
  newTitle: string;
  oldSlug: string;
  newSlug: string;
};

type BoardRenameBarrier = {
  /** Resolves once the in-flight directory rename has settled. */
  promise: Promise<void>;
  resolve: () => void;
};

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

/**
 * Returns a copy of `boards` where each board's slug is replaced with the last
 * slug actually committed to disk (the on-disk directory name). Used when
 * computing file paths for reads/writes so they hit the real directory while a
 * title rename is still debounced (the in-memory slug may be ahead of disk).
 */
function boardsAtCommittedSlugs(
  boards: Record<string, BoardBundle>,
  committedSlugs: Map<string, string>,
): Record<string, BoardBundle> {
  let result = boards;
  for (const [boardId, committedSlug] of committedSlugs) {
    const b = boards[boardId];
    if (b && b.board.slug !== committedSlug) {
      if (result === boards) {
        result = { ...boards };
      }
      result[boardId] = { ...b, board: { ...b.board, slug: committedSlug } };
    }
  }
  return result;
}

function bundleAtCommittedSlug(
  bundle: BoardBundle,
  committedSlugs: Map<string, string>,
): BoardBundle {
  const committedSlug = committedSlugs.get(bundle.board.id);
  if (!committedSlug || committedSlug === bundle.board.slug) {
    return bundle;
  }
  return {
    ...bundle,
    board: {
      ...bundle.board,
      slug: committedSlug,
    },
  };
}

function workspaceAtCommittedRootPath(
  workspace: WorkspaceFile,
  boards: Record<string, BoardBundle>,
  committedSlugs: Map<string, string>,
): WorkspaceFile {
  const rootBoard = boards[workspace.rootBoardId];
  const committedRootSlug = rootBoard ? committedSlugs.get(rootBoard.board.id) : null;
  if (!rootBoard || !committedRootSlug || committedRootSlug === rootBoard.board.slug) {
    return workspace;
  }
  return {
    ...workspace,
    rootBoardPath: `boards/${committedRootSlug}`,
  };
}

function createUniqueBoardSlug(
  boards: Record<string, BoardBundle>,
  boardId: string,
  parentBoardId: string | null,
  title: string,
): string {
  const baseSlug = createSlug(title);
  const siblingSlugs = new Set(
    Object.values(boards)
      .filter((bundle) => bundle.board.id !== boardId && bundle.board.parentBoardId === parentBoardId)
      .map((bundle) => bundle.board.slug),
  );

  if (!siblingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (siblingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseSlug}-${suffix}`;
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
  // Per-board debounced title commits. Keyed by boardId so that renaming a
  // board while another rename is pending for a different board doesn't reset it.
  const pendingTitleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Tracks the last slug that was actually committed to disk per board.
  const committedSlugRef = useRef<Map<string, string>>(new Map());
  // Barrier that resolves once any in-flight directory rename finishes. The
  // autosave effect awaits this so it never persists a board.json whose slug
  // doesn't match the on-disk directory.
  const renameBarrierRef = useRef<BoardRenameBarrier | null>(null);

  // Keep committedSlugRef in sync when a vault is opened or a board is created.
  // Also drop entries for boards that have been removed from state (e.g. after
  // a delete or undo), and resync when an undo reverts a slug back to a value
  // that matches disk (we can't detect that precisely, so on undo we simply
  // resync any entry whose committed slug no longer corresponds to a real disk
  // dir — but the safest cheap invariant is: if a board's in-memory slug equals
  // a slug that has NEVER been moved, treat committed == in-memory).
  useEffect(() => {
    const live = new Set(Object.keys(state.boards));
    for (const boardId of committedSlugRef.current.keys()) {
      if (!live.has(boardId)) {
        committedSlugRef.current.delete(boardId);
      }
    }
    for (const [boardId, bundle] of Object.entries(state.boards)) {
      if (!committedSlugRef.current.has(boardId)) {
        committedSlugRef.current.set(boardId, bundle.board.slug);
      }
    }
  }, [state.boards]);

  // Clear any pending rename timers on unmount.
  useEffect(() => {
    return () => {
      for (const timer of pendingTitleTimersRef.current.values()) {
        clearTimeout(timer);
      }
      pendingTitleTimersRef.current.clear();
    };
  }, []);

  // These foundational callbacks are declared early because later callbacks
  // (commitBoardRename, openVault, etc.) depend on them.
  const setError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setState((current) => ({ ...current, error: message }));
  }, []);

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

  const commitBoardRename = useCallback(async (boardId: string) => {
    const latestState = stateRef.current;
    if (!latestState.workspace || !vaultRef.current) {
      return;
    }
    const bundle = latestState.boards[boardId];
    if (!bundle) {
      return;
    }
    // The slug currently in memory reflects the typed title. The on-disk
    // directory is still named after the LAST committed slug (tracked in
    // committedSlugRef). We must move the dir from oldSlug -> newSlug.
    const newSlug = bundle.board.slug;
    const oldSlug = committedSlugRef.current.get(boardId) ?? newSlug;
    if (oldSlug === newSlug) {
      return;
    }

    const boardPaths = buildBoardPathMap(
      // Use the OLD (committed) slug so the path map points at the existing dir.
      boardsAtCommittedSlugs(latestState.boards, committedSlugRef.current),
      latestState.workspace,
    );
    const oldPath = boardPaths[boardId];
    const parentBoardId = bundle.board.parentBoardId;
    const parentPath = parentBoardId ? boardPaths[parentBoardId] : null;
    if (!oldPath) {
      return;
    }
    const newPath = parentPath ? `${parentPath}/boards/${newSlug}` : `boards/${newSlug}`;

    // Install the barrier so the autosave effect waits for the rename.
    let releaseBarrier = () => {};
    const barrierPromise = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    renameBarrierRef.current = { promise: barrierPromise, resolve: releaseBarrier };

    try {
      await vaultRef.current.moveDirectory(oldPath, newPath);
      committedSlugRef.current.set(boardId, newSlug);
      setState((current) => ({
        ...current,
        hasUnsavedChanges: true,
      }));
    } catch (err) {
      setError(err);
      // Revert the slug in memory so it matches the still-present on-disk dir
      // at oldPath. Only touch boards if the in-memory bundle still carries
      // the newSlug we tried to commit (the user may have typed something
      // else in the meantime — in that case we leave their input alone).
      setState((current) => {
        const currentBundle = current.boards[boardId];
        if (!currentBundle || currentBundle.board.slug !== newSlug) {
          return current;
        }
        const nextWorkspace =
          current.workspace && currentBundle.board.id === current.workspace.rootBoardId
            ? { ...current.workspace, rootBoardPath: `boards/${oldSlug}` }
            : current.workspace;
        return {
          ...current,
          workspace: nextWorkspace,
          boards: {
            ...current.boards,
            [boardId]: {
              ...currentBundle,
              board: { ...currentBundle.board, slug: oldSlug },
            },
          },
        };
      });
    } finally {
      releaseBarrier();
      if (renameBarrierRef.current?.resolve === releaseBarrier) {
        renameBarrierRef.current = null;
      }
    }
  }, [setError]);

  const scheduleDirectoryRename = useCallback((boardId: string) => {
    // Reset any existing timer for this board (debounce).
    const existing = pendingTitleTimersRef.current.get(boardId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      pendingTitleTimersRef.current.delete(boardId);
      void commitBoardRename(boardId);
    }, BOARD_TITLE_DEBOUNCE_MS);
    pendingTitleTimersRef.current.set(boardId, timer);
  }, [commitBoardRename]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      committedSlugRef.current = new Map(
        Object.entries(initialized.boards).map(([id, b]) => [id, b.board.slug]),
      );
      for (const timer of pendingTitleTimersRef.current.values()) {
        clearTimeout(timer);
      }
      pendingTitleTimersRef.current.clear();
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
    // Don't schedule a new debounce while a save is already in flight — its
    // completion handler will re-check for newer edits and re-save if needed.
    if (state.isSaving) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const latest = stateRef.current;
        if (!latest.workspace) return;
        // If a board directory rename is in flight, wait for it to settle
        // before persisting — otherwise we'd write board.json to the wrong
        // (old) path, or with a slug that doesn't match the on-disk directory.
        const barrier = renameBarrierRef.current;
        if (barrier) {
          await barrier.promise;
        }
        // Snapshot the boards reference we are about to persist. If the user
        // edits again while the awaits below are in flight, `state.boards`
        // will get a NEW reference — we then must NOT flip hasUnsavedChanges
        // to false, or those mid-save edits would be treated as "saved" and
        // could be lost if the user closes the tab.
        const savedBoards = stateRef.current.boards;
        const savedWorkspace = stateRef.current.workspace ?? latest.workspace;
        if (!savedWorkspace) return;
        const diskWorkspace = workspaceAtCommittedRootPath(
          savedWorkspace,
          savedBoards,
          committedSlugRef.current,
        );
        const diskBoards = boardsAtCommittedSlugs(savedBoards, committedSlugRef.current);
        setState((current) => ({ ...current, isSaving: true }));
        // Build the path map using the LAST COMMITTED slug per board (i.e. the
        // actual on-disk directory name). The in-memory slug may be ahead of
        // disk while a rename is debounced; writing to the committed path keeps
        // disk consistent. The pending rename (if any) will re-save when it fires.
        const boardPaths = buildBoardPathMap(diskBoards, diskWorkspace);
        await vaultRef.current!.saveWorkspace(diskWorkspace);
        for (const [boardId, bundle] of Object.entries(savedBoards)) {
          const boardPath = boardPaths[boardId];
          if (!boardPath) {
            continue;
          }
          await vaultRef.current!.saveBoardBundle(
            boardPath,
            bundleAtCommittedSlug(bundle, committedSlugRef.current),
          );
        }

        setState((current) => {
          const untouched = current.boards === savedBoards;
          return {
            ...current,
            isSaving: false,
            // Only clear the dirty flag if nothing changed during the awaits.
            // If something did change, keep hasUnsavedChanges true; the
            // isSaving transition (true -> false) re-triggers this effect and
            // schedules a follow-up save of the newer state.
            hasUnsavedChanges: untouched ? false : current.hasUnsavedChanges,
          };
        });
      } catch (error) {
        setError(error);
        setState((current) => ({ ...current, isSaving: false }));
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [setError, state.hasUnsavedChanges, state.isSaving, state.workspace]);

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
    const diskWorkspace = workspaceAtCommittedRootPath(
      input.workspace,
      input.boards,
      committedSlugRef.current,
    );
    const diskBoards = boardsAtCommittedSlugs(input.boards, committedSlugRef.current);
    const boardPaths = buildBoardPathMap(diskBoards, diskWorkspace);
    await vaultRef.current.saveWorkspace(diskWorkspace);
    for (const [boardId, bundle] of Object.entries(input.boards)) {
      const boardPath = boardPaths[boardId];
      if (!boardPath) {
        continue;
      }
      await vaultRef.current.saveBoardBundle(
        boardPath,
        bundleAtCommittedSlug(bundle, committedSlugRef.current),
      );
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

    const boardPaths = buildBoardPathMap(
      boardsAtCommittedSlugs(latestState.boards, committedSlugRef.current),
      latestState.workspace,
    );
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
      const uniqueSlug = createUniqueBoardSlug(
        latestState.boards,
        creation.createdBoard.board.id,
        creation.createdBoard.board.parentBoardId,
        creation.createdBoard.board.title,
      );
      nextBundles[creation.createdBoard.board.id] = replaceBoardBundle(creation.createdBoard, {
        ...creation.createdBoard.board,
        slug: uniqueSlug,
      });
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
    const nextBundle = replaceBoardBundle(bundle, patchCard(bundle.board, cardId, (c) =>
      c.type === "board" ? { ...c, title } : c,
    ));
    // Update child board title + slug in memory immediately (UI responsive).
    const childBoard = latestState.boards[card.childBoardId];
    if (childBoard) {
      const titledChild = setBoardTitle(childBoard, title);
      const updatedChild = replaceBoardBundle(titledChild, {
        ...titledChild.board,
        slug: createUniqueBoardSlug(
          latestState.boards,
          titledChild.board.id,
          titledChild.board.parentBoardId,
          title,
        ),
      });
      const oldSlug = childBoard.board.slug;
      const newSlug = updatedChild.board.slug;
      pushUndo();
      setState((current) => {
        const currentWorkspace = current.workspace;
        const nextWorkspace = currentWorkspace && card.childBoardId === currentWorkspace.rootBoardId
          ? { ...currentWorkspace, rootBoardPath: `boards/${newSlug}` }
          : currentWorkspace;
        return {
          ...current,
          workspace: nextWorkspace,
          boards: {
            ...current.boards,
            [boardId]: nextBundle,
            [card.childBoardId]: updatedChild,
          },
          hasUnsavedChanges: true,
        };
      });
      // Defer the disk directory rename of the CHILD board until typing settles.
      if (oldSlug !== newSlug && vaultRef.current) {
        scheduleDirectoryRename(card.childBoardId);
      }
    } else {
      updateBoardBundle(boardId, nextBundle);
    }
  }, [pushUndo, scheduleDirectoryRename, updateBoardBundle]);

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
    const boardPaths = buildBoardPathMap(
      boardsAtCommittedSlugs(latestState.boards, committedSlugRef.current),
      latestState.workspace,
    );
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

    // Move files to trash BEFORE updating state or persisting the post-delete
    // board.json, so undo can restore the physical files/directories too.
    const trashEntries: string[] = [];
    if (vaultRef.current && trashItems.length > 0) {
      try {
        trashEntries.push(await vaultRef.current.createTrashEntry(trashItems));
      } catch (error) {
        setError(error);
        return;
      }
    }

    nextBoards[latestState.currentBoardId] = nextBundle;

    pushUndo(trashEntries.length > 0 ? trashEntries : undefined);
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
    // After restoring a snapshot, resync committed slugs to the in-memory
    // slugs: the snapshot's slug is what we want on disk, and the next save
    // will write to (and, if needed, a rename will reconcile) that path.
    // Pending rename timers for boards whose slug reverted become no-ops
    // because commitBoardRename compares against committedSlugRef.
    committedSlugRef.current = new Map(
      Object.entries(snapshot.boards).map(([id, b]) => [id, b.board.slug]),
    );
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
    const boardId = currentBoard.board.id;
    const oldSlug = currentBoard.board.slug;
    // Update title + slug in memory immediately so the UI is responsive.
    const titledBundle = setBoardTitle(currentBoard, title);
    const nextBundle = replaceBoardBundle(titledBundle, {
      ...titledBundle.board,
      slug: createUniqueBoardSlug(
        state.boards,
        titledBundle.board.id,
        titledBundle.board.parentBoardId,
        title,
      ),
    });
    const newSlug = nextBundle.board.slug;
    let nextWorkspace = state.workspace;
    if (boardId === state.workspace.rootBoardId) {
      nextWorkspace = {
        ...state.workspace,
        rootBoardPath: `boards/${newSlug}`,
      };
    }
    updateWorkspaceAndBoards({
      workspace: nextWorkspace,
      bundles: {
        [boardId]: nextBundle,
      },
    });
    // Defer the disk directory rename until the user stops typing. The
    // rename barrier (commitBoardRename) prevents autosave from persisting a
    // board.json whose slug doesn't match the on-disk directory.
    if (oldSlug !== newSlug && vaultRef.current) {
      scheduleDirectoryRename(boardId);
    }
  }, [currentBoard, scheduleDirectoryRename, state.boards, state.workspace, updateWorkspaceAndBoards]);

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
    const boardPaths = buildBoardPathMap(
      boardsAtCommittedSlugs(latestState.boards, committedSlugRef.current),
      latestState.workspace,
    );
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
