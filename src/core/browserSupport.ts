/**
 * Browser capability checks for OpenMila storage.
 *
 * - Chrome / Edge: File System Access API (folder picker) preferred.
 * - Safari / Firefox: no showDirectoryPicker; use Origin Private File System
 *   (navigator.storage.getDirectory) as a local browser vault fallback.
 * - File pickers: showOpenFilePicker when present, else <input type="file">.
 */

export type VaultBackend = "folder" | "opfs" | "none";

export type BrowserSupport = {
  secureContext: boolean;
  /** User can pick a real disk folder (Chromium). */
  folderPicker: boolean;
  /** Origin Private File System is available (Safari 15.2+, modern Chromium/Firefox). */
  opfs: boolean;
  /** Any backend that can host a vault. */
  canOpenVault: boolean;
  /** Preferred vault open mode for the primary CTA. */
  preferredBackend: VaultBackend;
  /** Short reason when nothing works. */
  reason: "ok" | "insecure-context" | "no-storage";
  message: string | null;
};

const INSECURE_MESSAGE =
  "This page is not a secure context, so storage APIs are blocked. " +
  "Open OpenMila at http://127.0.0.1 or https:// (not a plain http:// LAN address).";

const NO_STORAGE_MESSAGE =
  "This browser cannot store an OpenMila vault. " +
  "Try Chrome, Edge, or a recent Safari (15.2+) / Firefox with Origin Private File System support.";

export function getBrowserSupport(): BrowserSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      secureContext: false,
      folderPicker: false,
      opfs: false,
      canOpenVault: false,
      preferredBackend: "none",
      reason: "no-storage",
      message: NO_STORAGE_MESSAGE,
    };
  }

  const secureContext = window.isSecureContext === true;
  if (!secureContext) {
    return {
      secureContext: false,
      folderPicker: false,
      opfs: false,
      canOpenVault: false,
      preferredBackend: "none",
      reason: "insecure-context",
      message: INSECURE_MESSAGE,
    };
  }

  const folderPicker = typeof window.showDirectoryPicker === "function";
  const opfs =
    typeof navigator.storage?.getDirectory === "function";

  const canOpenVault = folderPicker || opfs;
  const preferredBackend: VaultBackend = folderPicker ? "folder" : opfs ? "opfs" : "none";

  return {
    secureContext: true,
    folderPicker,
    opfs,
    canOpenVault,
    preferredBackend,
    reason: canOpenVault ? "ok" : "no-storage",
    message: canOpenVault ? null : NO_STORAGE_MESSAGE,
  };
}

/** @deprecated Use getBrowserSupport() — kept for call sites that only need folder API. */
export type FsAccessSupport = {
  supported: boolean;
  reason: "ok" | "insecure-context" | "api-missing";
  message: string | null;
};

/** @deprecated Prefer getBrowserSupport(). */
export function getFsAccessSupport(): FsAccessSupport {
  const s = getBrowserSupport();
  if (s.reason === "insecure-context") {
    return { supported: false, reason: "insecure-context", message: s.message };
  }
  // "supported" historically meant folder picker only.
  if (s.folderPicker) {
    return { supported: true, reason: "ok", message: null };
  }
  return {
    supported: false,
    reason: "api-missing",
    message: s.message,
  };
}

export function assertFolderPickerSupported(): void {
  const s = getBrowserSupport();
  if (!s.folderPicker) {
    throw new Error(
      s.message ??
        "Folder picker is not available in this browser. Use the browser vault instead, or open in Chrome/Edge.",
    );
  }
}

export function assertOpfsSupported(): void {
  const s = getBrowserSupport();
  if (!s.opfs) {
    throw new Error(s.message ?? "Origin Private File System is not available in this browser.");
  }
}

/** True when the user dismissed the system folder/file picker (not a real failure). */
export function isUserCancelError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "NotAllowedError";
}
