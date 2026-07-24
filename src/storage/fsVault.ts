import { assertFolderPickerSupported, assertOpfsSupported } from "../core/browserSupport";
import { createWorkspace } from "../core/model";
import { sanitizeAssetFileName, splitSafePath } from "../core/pathUtils";
import { loadRecentVaultHandle, saveRecentVaultHandle } from "./indexedDb";
import {
  loadOpfsVaultDisplayName,
  loadRecentVaultBackend,
  saveOpfsVaultDisplayName,
  saveRecentVaultBackend,
} from "./vaultSession";
import type { BoardBundle, BoardFile, WorkspaceFile } from "../types";

const TRASH_DIRECTORY = ".trash";
const TRASH_LIMIT = 10;
/** Subdirectory under OPFS root so we never pollute the storage root. */
const OPFS_VAULT_DIR = "openmila-vault";

export type VaultKind = "folder" | "opfs";

/**
 * Iterate directory children in a way that works on Chromium and Safari OPFS.
 * Safari may lack `entries()` and only expose async iteration via `values()`.
 */
async function* iterateDirectory(
  dir: FileSystemDirectoryHandle,
): AsyncGenerator<[string, FileSystemHandle]> {
  const anyDir = dir as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    values?: () => AsyncIterableIterator<FileSystemHandle>;
  };

  if (typeof anyDir.entries === "function") {
    for await (const entry of anyDir.entries()) {
      yield entry;
    }
    return;
  }

  if (typeof anyDir.values === "function") {
    for await (const handle of anyDir.values()) {
      yield [handle.name, handle];
    }
    return;
  }

  // Last resort: some environments only support Symbol.asyncIterator yielding handles.
  if (typeof anyDir[Symbol.asyncIterator] === "function") {
    for await (const handle of anyDir as unknown as AsyncIterable<FileSystemHandle>) {
      yield [handle.name, handle];
    }
  }
}

async function ensureDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

function splitPath(path: string): string[] {
  return splitSafePath(path);
}

async function getDirectoryHandleByPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of splitPath(path)) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function getFileHandleByPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = splitPath(path);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error("Invalid file path.");
  }
  const directory = await getDirectoryHandleByPath(root, parts.join("/"), create);
  return directory.getFileHandle(fileName, { create });
}

/**
 * Returns the parsed JSON, or `null` when the file does not exist.
 * Any other failure (corrupt JSON, permission denied, IO error) is re-thrown
 * with context so callers can distinguish "absent" (legitimate new-vault path)
 * from "corrupt" (must not be silently overwritten — would lose data).
 */
async function readJsonFileAtPath<T>(root: FileSystemDirectoryHandle, path: string): Promise<T | null> {
  let file: File;
  try {
    const handle = await getFileHandleByPath(root, path, false);
    file = await handle.getFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw new Error(`Failed to read "${path}": ${describeError(error)}`, { cause: error });
  }
  const text = await file.text();
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Corrupt JSON at "${path}": ${describeError(error)}`, { cause: error });
  }
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "NotFoundError";
  }
  // Some browsers/polyfills throw TypeError with a message; treat any "not found" wording as absent.
  const name = (error as { name?: string } | null)?.name;
  const message = (error as { message?: string } | null)?.message ?? "";
  return name === "NotFoundError" || /not found/i.test(message);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function writeJsonFileAtPath(root: FileSystemDirectoryHandle, path: string, data: unknown): Promise<void> {
  const handle = await getFileHandleByPath(root, path, true);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function readTextFileAtPath(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  try {
    const handle = await getFileHandleByPath(root, path, false);
    const file = await handle.getFile();
    return file.text();
  } catch {
    return null;
  }
}

async function writeTextFileAtPath(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const handle = await getFileHandleByPath(root, path, true);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function copyFileHandle(source: FileSystemFileHandle, destinationDir: FileSystemDirectoryHandle, name: string) {
  const file = await source.getFile();
  const destHandle = await destinationDir.getFileHandle(name, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(file);
  await writable.close();
}

async function copyDirectoryContents(
  sourceDir: FileSystemDirectoryHandle,
  destinationDir: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of iterateDirectory(sourceDir)) {
    if (handle.kind === "file") {
      await copyFileHandle(handle as FileSystemFileHandle, destinationDir, name);
    } else if (handle.kind === "directory") {
      const childDestination = await destinationDir.getDirectoryHandle(name, { create: true });
      await copyDirectoryContents(handle as FileSystemDirectoryHandle, childDestination);
    }
  }
}

async function removeEntryByPath(root: FileSystemDirectoryHandle, path: string, recursive: boolean): Promise<void> {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) {
    return;
  }
  const directory = await getDirectoryHandleByPath(root, parts.join("/"), false);
  await directory.removeEntry(name, { recursive });
}

type TrashItem = {
  originalPath: string;
  payloadName: string;
  kind: "file" | "directory";
};

type TrashEntry = {
  version: 1;
  deletedAt: string;
  items: TrashItem[];
};

async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // OPFS and some polyfills have no permission methods — treat as granted.
  if (typeof handle.queryPermission !== "function" && typeof handle.requestPermission !== "function") {
    return true;
  }
  const permission = await handle.queryPermission?.({ mode: "readwrite" });
  if (permission === "granted") {
    return true;
  }
  // `prompt` / undefined → try request
  if (permission === "denied") {
    return false;
  }
  const requested = await handle.requestPermission?.({ mode: "readwrite" });
  // If requestPermission is missing after query was undefined, allow.
  if (requested === undefined && typeof handle.requestPermission !== "function") {
    return true;
  }
  return requested === "granted";
}

export class BrowserFsVault {
  private writeQueues = new Map<string, Promise<void>>();

  private displayName: string | undefined;

  constructor(
    private readonly rootHandle: FileSystemDirectoryHandle,
    private readonly options: { kind: VaultKind; displayName?: string } = { kind: "folder" },
  ) {
    this.displayName = options.displayName;
  }

  get kind(): VaultKind {
    return this.options.kind;
  }

  /** Open a user-chosen folder (Chrome / Edge File System Access API). */
  static async openVaultPicker(): Promise<BrowserFsVault> {
    assertFolderPickerSupported();
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const hasPermission = await verifyPermission(handle);
    if (!hasPermission) {
      throw new Error("Vault permission was not granted.");
    }
    await saveRecentVaultHandle(handle);
    await saveRecentVaultBackend("folder");
    return new BrowserFsVault(handle, { kind: "folder" });
  }

  /**
   * Open (or create) a vault inside the Origin Private File System.
   * Works in Safari 15.2+ and other browsers without showDirectoryPicker.
   * Data stays local to the origin — not a user-visible Finder folder.
   */
  static async openOpfsVault(): Promise<BrowserFsVault> {
    assertOpfsSupported();
    const root = await navigator.storage.getDirectory();
    const vaultRoot = await root.getDirectoryHandle(OPFS_VAULT_DIR, { create: true });
    const displayName = await loadOpfsVaultDisplayName();
    await saveRecentVaultBackend("opfs");
    // Do not overwrite a real folder handle with nothing — just mark backend.
    return new BrowserFsVault(vaultRoot, { kind: "opfs", displayName });
  }

  static async reopenRecentVault(): Promise<BrowserFsVault | null> {
    const backend = await loadRecentVaultBackend();

    // Prefer the last-used backend when known.
    if (backend === "opfs") {
      try {
        return await BrowserFsVault.openOpfsVault();
      } catch {
        return null;
      }
    }

    // Folder backend, or legacy sessions with only a stored handle.
    try {
      const handle = await loadRecentVaultHandle();
      if (handle) {
        const hasPermission = await verifyPermission(handle);
        if (hasPermission) {
          await saveRecentVaultBackend("folder");
          return new BrowserFsVault(handle, { kind: "folder" });
        }
      }
    } catch {
      // IndexedDB may not restore handles (e.g. Safari) — ignore.
    }

    return null;
  }

  get vaultName(): string {
    if (this.options.kind === "opfs") {
      return this.displayName ?? "Browser vault";
    }
    return this.rootHandle.name || "Vault";
  }

  /** Optional: rename the OPFS vault label shown in the UI. */
  async setDisplayName(name: string): Promise<void> {
    if (this.options.kind !== "opfs") {
      return;
    }
    this.displayName = name.trim() || "Browser vault";
    await saveOpfsVaultDisplayName(this.displayName);
  }

  async initialize(): Promise<{ workspace: WorkspaceFile; boards: Record<string, BoardBundle> }> {
    await ensureDirectory(this.rootHandle, "boards");
    await ensureDirectory(this.rootHandle, TRASH_DIRECTORY);

    let workspace: WorkspaceFile;
    try {
      workspace = (await readJsonFileAtPath<WorkspaceFile>(this.rootHandle, "workspace.json")) as WorkspaceFile;
    } catch (error) {
      // workspace.json is present but corrupt/unreadable — must NOT silently overwrite it
      // (would orphan every board on disk). Surface the error to the user.
      throw new Error(
        "workspace.json in this vault appears to be corrupt or unreadable and could not be loaded. " +
        "To protect your data, OpenMila will not overwrite it. " +
        `Details: ${describeError(error)}`,
        { cause: error },
      );
    }
    if (!workspace) {
      const created = createWorkspace();
      await writeJsonFileAtPath(this.rootHandle, "workspace.json", created.workspace);
      await this.saveBoardBundle(created.workspace.rootBoardPath, created.rootBoard);
      return {
        workspace: created.workspace,
        boards: {
          [created.rootBoard.board.id]: created.rootBoard,
        },
      };
    }

    if (!workspace.rootBoardPath) {
      throw new Error(
        "This vault was created with an older version of the app and the storage format has changed. " +
        "Please create a new vault or delete workspace.json to start fresh.",
      );
    }

    const boards = await this.loadBoardTree(workspace.rootBoardPath);
    return { workspace, boards };
  }

  private async loadBoardTree(rootBoardPath: string): Promise<Record<string, BoardBundle>> {
    const boards: Record<string, BoardBundle> = {};
    const rootBundle = await this.loadBoardBundle(rootBoardPath);
    boards[rootBundle.board.id] = rootBundle;
    await this.loadChildBoards(rootBoardPath, boards);
    return boards;
  }

  private async loadChildBoards(parentPath: string, boards: Record<string, BoardBundle>): Promise<void> {
    const childBoardsPath = `${parentPath}/boards`;
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await getDirectoryHandleByPath(this.rootHandle, childBoardsPath, false);
    } catch {
      return;
    }

    for await (const [name, handle] of iterateDirectory(directory)) {
      if (handle.kind !== "directory") {
        continue;
      }
      const childPath = `${childBoardsPath}/${name}`;
      const childBundle = await this.loadBoardBundle(childPath);
      boards[childBundle.board.id] = childBundle;
      await this.loadChildBoards(childPath, boards);
    }
  }

  async loadBoardBundle(boardPath: string): Promise<BoardBundle> {
    const board = await readJsonFileAtPath<BoardFile>(this.rootHandle, `${boardPath}/board.json`);
    if (!board) {
      throw new Error(`Missing board.json for board path "${boardPath}".`);
    }

    const documents: Record<string, string> = {};
    for (const card of board.cards) {
      if (card.type === "note" || card.type === "todo") {
        const docPath = `${boardPath}/cards/${card.id}.md`;
        documents[card.id] = (await readTextFileAtPath(this.rootHandle, docPath)) ?? "";
      }
    }

    return { board, documents };
  }

  async saveWorkspace(workspace: WorkspaceFile): Promise<void> {
    await writeJsonFileAtPath(this.rootHandle, "workspace.json", workspace);
  }

  async saveBoardBundle(boardPath: string, bundle: BoardBundle): Promise<void> {
    const prev = this.writeQueues.get(boardPath) ?? Promise.resolve();
    // Swallow the previous attempt's rejection so a single failure doesn't
    // permanently poison this board's save queue (every later save would
    // short-circuit to the same rejected promise). We still surface *this*
    // attempt's own errors to the caller via `await next`.
    const next = prev
      .catch(() => {
        /* previous save failed — allow this one to retry */
      })
      .then(() => this._saveBoardBundle(boardPath, bundle));
    this.writeQueues.set(boardPath, next);
    // Clean up the Map entry once the write settles so it can't grow unbounded
    // and the next save starts from a fresh resolved promise.
    void next.finally(() => {
      if (this.writeQueues.get(boardPath) === next) {
        this.writeQueues.delete(boardPath);
      }
    });
    await next;
  }

  private async _saveBoardBundle(boardPath: string, bundle: BoardBundle): Promise<void> {
    await getDirectoryHandleByPath(this.rootHandle, boardPath, true);
    await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/cards`, true);
    await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/assets`, true);
    await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/boards`, true);

    // Write documents first; board.json is written last as a "commit point".
    // If we fail partway, the on-disk board.json still matches the previous
    // (older) documents, so loading yields a consistent state rather than
    // referencing cards whose .md is missing/empty.
    for (const [cardId, markdown] of Object.entries(bundle.documents)) {
      await writeTextFileAtPath(this.rootHandle, `${boardPath}/cards/${cardId}.md`, markdown);
    }
    await writeJsonFileAtPath(this.rootHandle, `${boardPath}/board.json`, bundle.board);
  }

  async importAsset(boardPath: string, file: File, preferredName?: string): Promise<string> {
    const assetsDirectory = await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/assets`, true);
    const safePreferred = preferredName ? sanitizeAssetFileName(preferredName) : null;
    const name = safePreferred ?? `${Date.now()}-${sanitizeAssetFileName(file.name)}`;
    const handle = await assetsDirectory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return `assets/${name}`;
  }

  /**
   * Copy an asset file from one board folder to another. Returns the new
   * vault-relative asset path (`assets/<name>`) under the destination board.
   * Used when moving image/file cards across boards so previews keep working.
   */
  async copyAssetBetweenBoards(
    sourceBoardPath: string,
    destBoardPath: string,
    assetPath: string,
  ): Promise<string> {
    // assetPath is typically "assets/foo.png" relative to the source board.
    const sourceFull = `${sourceBoardPath}/${assetPath}`;
    const sourceFile = await getFileHandleByPath(this.rootHandle, sourceFull, false);
    const file = await sourceFile.getFile();
    const baseName = sanitizeAssetFileName(assetPath.split("/").pop() ?? file.name);
    return this.importAsset(destBoardPath, file, `${Date.now()}-${baseName}`);
  }

  async readAssetUrl(boardPath: string, assetPath: string): Promise<string> {
    // Reject absolute-looking or parent-escaping asset paths before join.
    if (!assetPath || assetPath.startsWith("/") || assetPath.includes("..")) {
      throw new Error("Invalid asset path.");
    }
    const fullPath = `${boardPath}/${assetPath}`;
    const handle = await getFileHandleByPath(this.rootHandle, fullPath, false);
    const file = await handle.getFile();
    return URL.createObjectURL(file);
  }

  async moveDirectory(fromPath: string, toPath: string): Promise<void> {
    if (fromPath === toPath) {
      return;
    }
    const sourceDir = await getDirectoryHandleByPath(this.rootHandle, fromPath, false);
    const destDir = await getDirectoryHandleByPath(this.rootHandle, toPath, true);
    try {
      await copyDirectoryContents(sourceDir, destDir);
    } catch (err) {
      // Copy failed — do not remove the source directory to avoid data loss
      throw err;
    }
    await removeEntryByPath(this.rootHandle, fromPath, true);
  }

  /**
   * Atomically move the given items into a new trash entry.
   *
   * Semantics: all-or-nothing. If ANY item fails to move, the items already
   * moved into this entry's payload are restored to their original paths and
   * the entry directory is removed, then an aggregate error is thrown. This
   * lets callers (e.g. deleteSelectedCards) treat the operation as atomic and
   * roll back the in-memory UI state on failure rather than leaving the disk
   * in a half-deleted, unrecoverable state.
   */
  async createTrashEntry(items: Array<{ path: string; kind: "file" | "directory" }>): Promise<string> {
    const trashRoot = await ensureDirectory(this.rootHandle, TRASH_DIRECTORY);
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entryDir = await ensureDirectory(trashRoot, entryId);
    const payloadDir = await ensureDirectory(entryDir, "payload");
    const metaItems: TrashItem[] = [];
    const errors: string[] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const payloadName = String(index);
      try {
        if (item.kind === "directory") {
          const sourceDir = await getDirectoryHandleByPath(this.rootHandle, item.path, false);
          const destDir = await payloadDir.getDirectoryHandle(payloadName, { create: true });
          await copyDirectoryContents(sourceDir, destDir);
          await removeEntryByPath(this.rootHandle, item.path, true);
        } else {
          const sourceFile = await getFileHandleByPath(this.rootHandle, item.path, false);
          await copyFileHandle(sourceFile, payloadDir, payloadName);
          await removeEntryByPath(this.rootHandle, item.path, false);
        }
        metaItems.push({
          originalPath: item.path,
          payloadName,
          kind: item.kind,
        });
      } catch {
        errors.push(item.path);
      }
    }

    if (errors.length > 0) {
      // Roll back: restore whatever we DID move into payload, then drop the entry.
      await this.restoreTrashEntry(entryId).catch(() => {
        /* best-effort; the entry may still be partially populated */
      });
      try {
        await trashRoot.removeEntry(entryId, { recursive: true });
      } catch {
        /* ignore — leaving an empty-ish entry is harmless and pruned later */
      }
      throw new Error(
        `Failed to move ${errors.length} of ${items.length} item(s) to trash. ` +
        `Rollback attempted. First failing path: ${errors[0]}`,
      );
    }

    const meta: TrashEntry = {
      version: 1,
      deletedAt: new Date().toISOString(),
      items: metaItems,
    };
    await writeJsonFileAtPath(this.rootHandle, `${TRASH_DIRECTORY}/${entryId}/meta.json`, meta);
    await this.pruneTrash(TRASH_LIMIT);
    return entryId;
  }

  async restoreTrashEntry(entryId: string): Promise<void> {
    const meta = await readJsonFileAtPath<TrashEntry>(this.rootHandle, `${TRASH_DIRECTORY}/${entryId}/meta.json`);
    if (!meta) {
      return;
    }

    const payloadDir = await getDirectoryHandleByPath(
      this.rootHandle,
      `${TRASH_DIRECTORY}/${entryId}/payload`,
      false,
    );

    for (const item of meta.items) {
      if (item.kind === "directory") {
        const sourceDir = await payloadDir.getDirectoryHandle(item.payloadName, { create: false });
        const destDir = await getDirectoryHandleByPath(this.rootHandle, item.originalPath, true);
        await copyDirectoryContents(sourceDir, destDir);
      } else {
        const sourceFile = await payloadDir.getFileHandle(item.payloadName, { create: false });
        const parts = splitPath(item.originalPath);
        const name = parts.pop();
        if (!name) {
          continue;
        }
        const destinationDir = await getDirectoryHandleByPath(this.rootHandle, parts.join("/"), true);
        await copyFileHandle(sourceFile, destinationDir, name);
      }
    }

    await removeEntryByPath(this.rootHandle, `${TRASH_DIRECTORY}/${entryId}`, true);
  }

  private async pruneTrash(limit: number): Promise<void> {
    const trashRoot = await ensureDirectory(this.rootHandle, TRASH_DIRECTORY);
    const entries: string[] = [];
    for await (const [name, handle] of iterateDirectory(trashRoot)) {
      if (handle.kind === "directory") {
        entries.push(name);
      }
    }

    entries.sort();
    const excess = entries.length - limit;
    if (excess <= 0) {
      return;
    }

    for (const entry of entries.slice(0, excess)) {
      await trashRoot.removeEntry(entry, { recursive: true });
    }
  }
}
