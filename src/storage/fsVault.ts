import { createWorkspace } from "../core/model";
import { loadRecentVaultHandle, saveRecentVaultHandle } from "./indexedDb";
import type { BoardBundle, BoardFile, WorkspaceFile } from "../types";

async function ensureDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function readJsonFile<T>(directory: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(directory: FileSystemDirectoryHandle, name: string, data: unknown): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function readTextFile(directory: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return file.text();
  } catch {
    return null;
  }
}

async function writeTextFile(directory: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const permission = await handle.queryPermission?.({ mode: "readwrite" });
  if (permission === "granted") {
    return true;
  }
  const requested = await handle.requestPermission?.({ mode: "readwrite" });
  return requested === "granted";
}

export class BrowserFsVault {
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
    await ensureDirectory(this.rootHandle, "assets");

    const workspace = await readJsonFile<WorkspaceFile>(this.rootHandle, "workspace.json");
    if (!workspace) {
      const created = createWorkspace();
      await writeJsonFile(this.rootHandle, "workspace.json", created.workspace);
      await this.saveBoardBundle(created.rootBoard);
      return {
        workspace: created.workspace,
        boards: {
          [created.rootBoard.board.id]: created.rootBoard,
        },
      };
    }

    const boards: Record<string, BoardBundle> = {};
    for (const boardItem of workspace.boards) {
      boards[boardItem.id] = await this.loadBoardBundle(boardItem.slug);
    }

    return { workspace, boards };
  }

  async loadBoardBundle(slug: string): Promise<BoardBundle> {
    const boardsDirectory = await ensureDirectory(this.rootHandle, "boards");
    const boardDirectory = await ensureDirectory(boardsDirectory, slug);
    const cardsDirectory = await ensureDirectory(boardDirectory, "cards");
    const board = await readJsonFile<BoardFile>(boardDirectory, "board.json");
    if (!board) {
      throw new Error(`Missing board.json for board "${slug}".`);
    }

    const documents: Record<string, string> = {};
    for (const card of board.cards) {
      if (card.type === "note" || card.type === "todo") {
        documents[card.id] = (await readTextFile(cardsDirectory, `${card.id}.md`)) ?? "";
      }
    }

    return { board, documents };
  }

  async saveWorkspace(workspace: WorkspaceFile): Promise<void> {
    await writeJsonFile(this.rootHandle, "workspace.json", workspace);
  }

  async saveBoardBundle(bundle: BoardBundle): Promise<void> {
    const boardsDirectory = await ensureDirectory(this.rootHandle, "boards");
    const boardDirectory = await ensureDirectory(boardsDirectory, bundle.board.slug);
    const cardsDirectory = await ensureDirectory(boardDirectory, "cards");
    await writeJsonFile(boardDirectory, "board.json", bundle.board);

    for (const [cardId, markdown] of Object.entries(bundle.documents)) {
      await writeTextFile(cardsDirectory, `${cardId}.md`, markdown);
    }
  }

  async deleteBoardBySlug(slug: string): Promise<void> {
    const boardsDirectory = await ensureDirectory(this.rootHandle, "boards");
    try {
      await boardsDirectory.removeEntry(slug, { recursive: true });
    } catch {
      // Ignore missing folders or permission errors during cleanup.
    }
  }

  async importAsset(file: File, preferredName?: string): Promise<string> {
    const assetsDirectory = await ensureDirectory(this.rootHandle, "assets");
    const name = preferredName ?? `${Date.now()}-${file.name}`;
    const handle = await assetsDirectory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return `assets/${name}`;
  }

  async readAssetUrl(assetPath: string): Promise<string> {
    const [directoryName, fileName] = assetPath.split("/");
    const directory = await ensureDirectory(this.rootHandle, directoryName);
    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();
    return URL.createObjectURL(file);
  }
}
