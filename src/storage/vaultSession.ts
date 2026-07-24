/**
 * Persist which vault backend was last used so Safari can reopen OPFS
 * and Chromium can reopen a stored directory handle.
 */

import { openDatabaseForAppState } from "./indexedDb";

export type VaultBackendKind = "folder" | "opfs";

const RECENT_BACKEND_KEY = "recent-vault-backend";
const OPFS_VAULT_NAME_KEY = "opfs-vault-display-name";

export async function saveRecentVaultBackend(kind: VaultBackendKind): Promise<void> {
  const db = await openDatabaseForAppState();
  await idbPut(db, RECENT_BACKEND_KEY, kind);
}

export async function loadRecentVaultBackend(): Promise<VaultBackendKind | null> {
  const db = await openDatabaseForAppState();
  const value = await idbGet<string>(db, RECENT_BACKEND_KEY);
  if (value === "folder" || value === "opfs") {
    return value;
  }
  return null;
}

export async function saveOpfsVaultDisplayName(name: string): Promise<void> {
  const db = await openDatabaseForAppState();
  await idbPut(db, OPFS_VAULT_NAME_KEY, name);
}

export async function loadOpfsVaultDisplayName(): Promise<string> {
  const db = await openDatabaseForAppState();
  const value = await idbGet<string>(db, OPFS_VAULT_NAME_KEY);
  return value && value.trim() ? value : "Browser vault";
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("app-state", "readwrite");
    transaction.objectStore("app-state").put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("app-state", "readonly");
    const request = transaction.objectStore("app-state").get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}
