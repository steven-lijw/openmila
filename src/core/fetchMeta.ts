export interface PageMeta {
  title: string | null;
  description: string | null;
  image: string | null;
}

const CACHE_PREFIX = "meta:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const memoryCache = new Map<string, PageMeta>();

export async function fetchPageMeta(url: string): Promise<PageMeta | null> {
  const cached = memoryCache.get(url);
  if (cached) return cached;

  // Check localStorage
  try {
    const stored = localStorage.getItem(CACHE_PREFIX + url);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cachedAt && Date.now() - parsed.cachedAt < TTL_MS) {
        const meta: PageMeta = {
          title: parsed.title ?? null,
          description: parsed.description ?? null,
          image: parsed.image ?? null,
        };
        memoryCache.set(url, meta);
        return meta;
      }
    }
  } catch {
    // Ignore
  }

  // Fetch from server
  try {
    const res = await fetch(`/api/meta?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const meta: PageMeta = await res.json();

    memoryCache.set(url, meta);

    try {
      localStorage.setItem(
        CACHE_PREFIX + url,
        JSON.stringify({ ...meta, cachedAt: Date.now() }),
      );
    } catch {
      evictOldEntries();
      try {
        localStorage.setItem(
          CACHE_PREFIX + url,
          JSON.stringify({ ...meta, cachedAt: Date.now() }),
        );
      } catch {
        // Give up
      }
    }

    return meta;
  } catch {
    return null;
  }
}

function evictOldEntries(): void {
  const now = Date.now();
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;

    try {
      const entry = JSON.parse(localStorage.getItem(key) ?? "");
      if (!entry.cachedAt || now - entry.cachedAt > TTL_MS) {
        keysToRemove.push(key);
      }
    } catch {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}
