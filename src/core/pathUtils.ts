/**
 * Path helpers shared by vault I/O. All vault-relative paths are treated as
 * POSIX-style segments (File System Access API uses string names, not OS paths).
 */

/**
 * Split a vault-relative path into segments, rejecting empty parts, `.`, and `..`.
 * Throws if the path would escape the vault root.
 */
export function splitSafePath(path: string): string[] {
  const parts = path.split("/").filter((part) => part.length > 0);
  for (const part of parts) {
    if (part === "." || part === ".." || part.includes("\0")) {
      throw new Error(`Invalid path segment in "${path}"`);
    }
  }
  return parts;
}

/**
 * Sanitize a user-supplied filename for use under `assets/`.
 * Strips directories, control chars, and path separators.
 */
export function sanitizeAssetFileName(name: string): string {
  const base = name
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() ?? "file";

  // Remove control characters and characters that break FS Access names.
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();

  const limited = cleaned.slice(0, 180);
  return limited || "file";
}
