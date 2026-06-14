/**
 * Server-side link metadata fetcher.
 *
 * Fetches a URL, parses Open Graph / <title> tags from the HTML head,
 * and returns structured metadata.  Designed for use in both the
 * production static server (bin/openmila.js) and the Vite dev plugin.
 *
 * Security: this accepts user-supplied URLs (link cards) and runs on the
 * user's own machine, so we harden against SSRF — including DNS rebinding —
 * by resolving the hostname to IPs and verifying ALL resolved IPs are
 * outside private/reserved ranges, both before the request AND after each
 * redirect hop. Redirects are followed manually so cross-host jumps back to
 * private ranges are rejected.
 */

import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 50 * 1024;

/**
 * Returns true if the IP literal is private, loopback, link-local,
 * multicast, reserved, or otherwise unsuitable as a fetch target.
 */
function isPrivateIp(ip) {
  // IPv6 in mapped form → normalize to the embedded IPv4.
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    ip = v4Mapped[1];
  }

  if (net.isIPv4(ip)) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    if (a === 0) return true;                       // 0.0.0.0/8 ("this network")
    if (a === 10) return true;                      // 10.0.0.0/8
    if (a === 127) return true;                     // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true;        // 169.254.0.0/16 (link-local + cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;        // 192.168.0.0/16
    if (a >= 224) return true;                      // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255 broadcast
    // CGNAT 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;       // loopback / unspecified
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique-local
    if (lower.startsWith("fe80")) return true;                // link-local
    if (lower.startsWith("fe00")) return true;                // reserved
    if (lower === "::ffff:0:0" || /::ffff:0\.0\.0\.0$/.test(lower)) return true;
    return false;
  }

  // Unknown family — treat as private (fail closed).
  return true;
}

async function assertHostSafe(hostname) {
  // Reject obvious local hostnames first (cheap path).
  const bare = hostname.replace(/\.$/, ""); // tolerate trailing dot
  if (/^localhost$/i.test(bare)) {
    throw new Error("Fetching localhost is not allowed");
  }

  // If hostname is already an IP literal, validate it directly.
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) {
      throw new Error("Fetching private/internal addresses is not allowed");
    }
    return;
  }

  // Resolve and require EVERY resolved address to be public. This closes the
  // DNS-rebinding window where validation-time and connect-time differ.
  let addresses;
  try {
    const result = await dns.lookup(bare, { all: true });
    addresses = result;
  } catch (error) {
    throw new Error(`Could not resolve "${hostname}": ${error.message}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Could not resolve "${hostname}"`);
  }
  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) {
      throw new Error("Fetching private/internal addresses is not allowed");
    }
  }
}

/**
 * Fetch a URL with manual redirect handling. Each hop's hostname is
 * re-validated against private ranges before the request is made.
 */
async function fetchWithSafeRedirects(url, signal) {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http/https URLs are supported");
    }
    await assertHostSafe(parsed.hostname);

    const res = await fetch(currentUrl, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenMila/1.0; +https://github.com/openmila)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "manual",
    });

    // 3xx with a Location → follow, but only to http/https and re-validated next loop.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`Redirect (${res.status}) without Location`);
      }
      const nextUrl = new URL(location, currentUrl).href;
      currentUrl = nextUrl;
      // Drain to allow connection reuse, then continue.
      try { await res.body?.cancel(); } catch { /* ignore */ }
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  }
  throw new Error("Too many redirects");
}

/**
 * @param {string} url
 * @returns {Promise<{ title: string|null, description: string|null, image: string|null }>}
 */
export async function fetchPageMeta(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are supported");
  }
  // Validate the initial host up front so rebinding-style inputs are rejected
  // even before we open a socket.
  await assertHostSafe(parsed.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetchWithSafeRedirects(url, controller.signal);

    // Read at most MAX_BODY_BYTES — enough for <head>, avoids huge downloads.
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const chunks = [];
    let received = 0;

    while (received < MAX_BODY_BYTES) {
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

    return parseHtml(html, res.url || url);
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
