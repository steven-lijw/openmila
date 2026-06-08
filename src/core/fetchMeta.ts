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
    const data = await res.json();
    const meta: PageMeta = {
      title: typeof data?.title === "string" ? data.title : null,
      description: typeof data?.description === "string" ? data.description : null,
      image: typeof data?.image === "string" ? data.image : null,
    };

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
  const entries: Array<{ key: string; cachedAt: number }> = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;

    try {
      const entry = JSON.parse(localStorage.getItem(key) ?? "");
      entries.push({ key, cachedAt: entry.cachedAt ?? 0 });
    } catch {
      localStorage.removeItem(key);
    }
  }

  // Remove expired entries first
  const expired = entries.filter((e) => now - e.cachedAt > TTL_MS);
  for (const e of expired) {
    localStorage.removeItem(e.key);
  }

  // If still full, remove the oldest entries
  const remaining = entries.filter((e) => !expired.includes(e));
  remaining.sort((a, b) => a.cachedAt - b.cachedAt);
  for (const e of remaining.slice(0, Math.ceil(remaining.length / 4))) {
    localStorage.removeItem(e.key);
  }
}
