/**
 * Server-side link metadata fetcher.
 *
 * Fetches a URL, parses Open Graph / <title> tags from the HTML head,
 * and returns structured metadata.  Designed for use in both the
 * production static server (bin/openmila.js) and the Vite dev plugin.
 */

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
  /^localhost$/i,
];

/**
 * @param {string} url
 * @returns {Promise<{ title: string|null, description: string|null, image: string|null }>}
 */
export async function fetchPageMeta(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are supported");
  }

  if (PRIVATE_RANGES.some((re) => re.test(parsed.hostname))) {
    throw new Error("Fetching private/internal addresses is not allowed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenMila/1.0; +https://github.com/openmila)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // Read at most 50 KB — enough for <head>, avoids downloading huge pages.
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const chunks = [];
    let received = 0;
    const maxBytes = 50 * 1024;

    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    reader.cancel();

    // Concatenate Uint8Arrays without relying on Node's Buffer
    const totalLen = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const html = decoder.decode(merged);

    return parseHtml(html, url);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract og:title, og:description, og:image, and <title> from an HTML string.
 * @param {string} html
 * @param {string} baseUrl  — used to resolve relative image URLs
 */
function parseHtml(html, baseUrl) {
  const ogTitle = extractMeta(html, "og:title");
  const ogDesc = extractMeta(html, "og:description");
  const ogImage = extractMeta(html, "og:image");
  const titleTag = extractTitle(html);

  let image = ogImage;
  if (image) {
    try {
      image = new URL(image, baseUrl).href;
    } catch {
      // keep as-is
    }
  }

  return {
    title: ogTitle || titleTag || null,
    description: ogDesc || null,
    image: image || null,
  };
}

/**
 * Extract content from <meta property="..." content="..."> or <meta name="..." content="...">
 */
function extractMeta(html, property) {
  // Match both property="..." and name="..." forms, case-insensitive
  const re = new RegExp(
    `<meta\\s+[^>]*(?:property|name)\\s*=\\s*["']${escapeRegex(property)}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;

  const content = tag.match(/content\s*=\s*["']([^"']*?)["']/i);
  return content?.[1]?.trim() || null;
}

/**
 * Extract the text content of the <title> element.
 */
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
