import { createWorkspace } from "../core/model";
import { loadRecentVaultHandle, saveRecentVaultHandle } from "./indexedDb";
import type { BoardBundle, BoardFile, WorkspaceFile } from "../types";

const TRASH_DIRECTORY = ".trash";
const TRASH_LIMIT = 10;

async function ensureDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

function splitPath(path: string): string[] {
  return path.split("/").filter((part) => part.trim().length > 0);
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

async function readJsonFileAtPath<T>(root: FileSystemDirectoryHandle, path: string): Promise<T | null> {
  try {
    const handle = await getFileHandleByPath(root, path, false);
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
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
  for await (const [name, handle] of sourceDir.entries()) {
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
  const permission = await handle.queryPermission?.({ mode: "readwrite" });
  if (permission === "granted") {
    return true;
  }
  const requested = await handle.requestPermission?.({ mode: "readwrite" });
  return requested === "granted";
}

export class BrowserFsVault {
  private writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly rootHandle: FileSystemDirectoryHandle) {}

  static async openVaultPicker(): Promise<BrowserFsVault> {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const hasPermission = await verifyPermission(handle);
    if (!hasPermission) {
      throw new Error("Vault permission was not granted.");
    }
    await saveRecentVaultHandle(handle);
    return new BrowserFsVault(handle);
  }

  static async reopenRecentVault(): Promise<BrowserFsVault | null> {
    const handle = await loadRecentVaultHandle();
    if (!handle) {
      return null;
    }
    const hasPermission = await verifyPermission(handle);
    if (!hasPermission) {
      return null;
    }
    return new BrowserFsVault(handle);
  }

  get vaultName(): string {
    return this.rootHandle.name;
  }

  async initialize(): Promise<{ workspace: WorkspaceFile; boards: Record<string, BoardBundle> }> {
    await ensureDirectory(this.rootHandle, "boards");
    await ensureDirectory(this.rootHandle, TRASH_DIRECTORY);

    const workspace = await readJsonFileAtPath<WorkspaceFile>(this.rootHandle, "workspace.json");
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

    for await (const [name, handle] of directory.entries()) {
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
    const next = prev.then(() => this._saveBoardBundle(boardPath, bundle));
    this.writeQueues.set(boardPath, next);
    await next;
  }

  private async _saveBoardBundle(boardPath: string, bundle: BoardBundle): Promise<void> {
    await getDirectoryHandleByPath(this.rootHandle, boardPath, true);
    await writeJsonFileAtPath(this.rootHandle, `${boardPath}/board.json`, bundle.board);
    await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/cards`, true);
    await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/assets`, true);
    await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/boards`, true);

    for (const [cardId, markdown] of Object.entries(bundle.documents)) {
      await writeTextFileAtPath(this.rootHandle, `${boardPath}/cards/${cardId}.md`, markdown);
    }
  }

  async importAsset(boardPath: string, file: File, preferredName?: string): Promise<string> {
    const assetsDirectory = await getDirectoryHandleByPath(this.rootHandle, `${boardPath}/assets`, true);
    const name = preferredName ?? `${Date.now()}-${file.name}`;
    const handle = await assetsDirectory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return `assets/${name}`;
  }

  async readAssetUrl(boardPath: string, assetPath: string): Promise<string> {
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
      } catch (err) {
        errors.push(item.path);
      }
    }

    const meta: TrashEntry = {
      version: 1,
      deletedAt: new Date().toISOString(),
      items: metaItems,
    };
    if (metaItems.length === 0 && errors.length > 0) {
      throw new Error(`Failed to trash all ${errors.length} item(s): ${errors[0]}`);
    }
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
    for await (const [name, handle] of trashRoot.entries()) {
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
