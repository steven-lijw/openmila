const DATABASE_NAME = "milanote-local";
const STORE_NAME = "app-state";
const RECENT_VAULT_KEY = "recent-vault-handle";

// Cache the open database connection so we don't repeatedly call
// `indexedDB.open`. Multiple concurrent connections to the same DB can cause
// `versionchange`/`blocked` events when one tab upgrades the schema, so we
// keep a single shared handle per page.
let dbPromise: Promise<IDBDatabase> | null = null;

/** Shared app-state IndexedDB (vault handle, backend kind, etc.). */
export function openDatabaseForAppState(): Promise<IDBDatabase> {
  return openDatabase();
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the DB, close our handle so the upgrade can
      // proceed and let the next call re-open.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      // Don't reset dbPromise here — the request is still pending and may yet
      // succeed once the other tab closes. But surface a rejection so callers
      // don't hang indefinitely.
      dbPromise = null;
      reject(new Error("IndexedDB open was blocked (another tab may be upgrading the database)"));
    };
  });
  // If opening fails, allow a fresh attempt next time.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

export async function saveRecentVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, RECENT_VAULT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    // Quota exceeded / disk full surfaces as abort, not error — handle it so
    // the promise doesn't hang.
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}

export async function loadRecentVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDatabase();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(RECENT_VAULT_KEY);
    request.onsuccess = () => {
      resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}
