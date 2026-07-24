interface FileSystemPermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  // Some TS lib versions don't include the async iteration helpers on
  // FileSystemDirectoryHandle. Declare them so the rest of the codebase can
  // use `.entries()` without per-call type errors.
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  keys(): AsyncIterableIterator<string>;
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: "read" | "readwrite";
  }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker(options?: {
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }): Promise<FileSystemFileHandle[]>;
}

interface Navigator {
  storage: StorageManager;
}

interface StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
}
