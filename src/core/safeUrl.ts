/**
 * Shared URL safety helpers used by markdown rendering, link cards, and
 * window.open. Keep these conservative — local-first apps still execute
 * untrusted vault content in the browser origin.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;
const SAFE_IMG_SRC = /^(https?:\/\/|data:image\/[a-z0-9.+-]+;base64,|blob:)/i;

export function isSafeHref(url: string | null | undefined): boolean {
  if (!url || !url.trim()) {
    return false;
  }
  // Block scheme-relative and embedded credentials tricks that browsers
  // sometimes treat oddly when opening via window.open.
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) {
    return false;
  }
  return SAFE_HREF.test(trimmed);
}

export function isSafeImageSrc(url: string | null | undefined): boolean {
  if (!url || !url.trim()) {
    return false;
  }
  return SAFE_IMG_SRC.test(url.trim());
}

/** Only plain http(s) — used for opening link cards and outbound meta fetches. */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url || !url.trim()) {
    return false;
  }
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalize a user-typed link into an absolute http(s) URL, or null if unsafe.
 * Accepts bare hostnames by prepending https:// (same as link preview).
 */
export function normalizeSafeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const direct = new URL(trimmed);
    if (direct.protocol === "http:" || direct.protocol === "https:") {
      return direct.href;
    }
    return null;
  } catch {
    try {
      const withScheme = new URL(`https://${trimmed}`);
      if (withScheme.protocol === "https:") {
        return withScheme.href;
      }
    } catch {
      // fall through
    }
    return null;
  }
}
