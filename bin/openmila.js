#!/usr/bin/env node

/**
 * openmila — CLI launcher for OpenMila
 *
 * Starts a local HTTP server serving the pre-built app and opens it
 * in the default browser.
 *
 * Usage:
 *   openmila                  # launch on the default port (30142)
 *   openmila --port 3456
 *   openmila --port 0         # let the OS pick a free port
 *   openmila --no-open        # start server without opening browser
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { fetchPageMeta } from "../lib/fetchMeta.js";

// ── Resolve the dist directory ────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

// ── MIME types ────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

// Security headers applied to every response. CSP only forbids remote
// scripts and frame ancestors — the app itself is fully self-hosted.
const CSP = [
  "default-src 'self'",
  // The app builds <img src="data:..."> for some previews and uses blob: for
  // local file assets. We allow both plus https: for link-card og:image.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  // Inline styles are used by React (styled objects) and styles.css; scripts must be self only.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function setSecurityHeaders(res, { includeCsp }) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (includeCsp) {
    res.setHeader("Content-Security-Policy", CSP);
  }
}

/**
 * Resolve a request path to an absolute file inside distDir, rejecting any
 * traversal outside distDir. Returns null if the path escapes distDir.
 */
function resolveSafeFilePath(requestPath) {
  // Strip query and fragment, then URL-decode (handles %2e%2e etc.).
  const raw = requestPath.split("?")[0].split("#")[0] ?? "/";
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Normalize to a posix-style relative path, then resolve under distDir.
  const normalized = path.posix.normalize("/" + decoded);
  const resolved = path.resolve(distDir, "." + normalized);
  if (resolved !== distDir && !resolved.startsWith(distDir + path.sep)) {
    return null;
  }
  return resolved;
}

// ── Simple static file server ─────────────────────────────────────────────
function createServer() {
  return http.createServer(async (req, res) => {
    // ── /api/meta — link metadata endpoint ────────────────────────────────
    if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/api/meta") {
      const urlParam = new URL(req.url, "http://localhost").searchParams.get("url");
      if (!urlParam || !/^https?:\/\//.test(urlParam)) {
        setSecurityHeaders(res, { includeCsp: false });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid url parameter" }));
        return;
      }
      try {
        const meta = await fetchPageMeta(urlParam);
        setSecurityHeaders(res, { includeCsp: false });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(JSON.stringify(meta));
      } catch {
        // Deliberately generic message + status so the endpoint can't be used
        // to probe for the presence of internal services.
        setSecurityHeaders(res, { includeCsp: false });
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch target URL" }));
      }
      return;
    }

    const filePath = resolveSafeFilePath(req.url);
    if (!filePath) {
      setSecurityHeaders(res, { includeCsp: false });
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // SPA fallback: anything that isn't a real file becomes index.html.
    let resolvedPath = filePath;
    const isIndex = filePath === path.join(distDir, "index.html");
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      resolvedPath = path.join(distDir, "index.html");
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = MIME[ext] ?? "application/octet-stream";
    setSecurityHeaders(res, { includeCsp: resolvedPath === path.join(distDir, "index.html") });

    // Stream the file with Range support so large media attachments (mp4,
    // webm, mp3, ...) can be seeked without buffering the whole file.
    fs.stat(resolvedPath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : 0;
          let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
            res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
            res.end();
            return;
          }
          if (end >= stat.size) end = stat.size - 1;
          res.writeHead(206, {
            "Content-Type": mimeType,
            "Content-Length": end - start + 1,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
          });
          fs.createReadStream(resolvedPath, { start, end }).pipe(res);
          return;
        }
      }
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(resolvedPath).pipe(res);
    });
  });
}

// ── Open browser (cross-platform) ─────────────────────────────────────────
function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;

  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", url];
  } else {
    // Linux / others
    cmd = "xdg-open";
    args = [url];
  }

  const child = spawn(cmd, args, {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

// ── CLI ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { port: 30142, open: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      const raw = argv[++i];
      const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
        console.error(`Invalid --port value: ${String(raw)} (expected 0-65535)`);
        process.exit(2);
      }
      flags.port = parsed;
    } else if (arg === "--no-open") {
      flags.open = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: openmila [options]

Options:
  --port, -p <number>   Port to listen on (default: 30142, 0 = random)
  --no-open             Start the server without opening the browser
  --help, -h            Show this help message
      `.trim());
      process.exit(0);
    }
  }
  return flags;
}

// ── Entry point ───────────────────────────────────────────────────────────
function main() {
  // Verify dist exists
  if (!fs.existsSync(distDir)) {
    console.error(
      "❌  Build not found. Run 'npm run build' first, or install this package via:\n" +
        "    npm install -g openmila\n" +
        "  to get a pre-built version."
    );
    process.exit(1);
  }

  const flags = parseArgs(process.argv);
  const server = createServer();

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(
        `❌  Port ${flags.port} is already in use.\n` +
        `    Try a different one: openmila --port <other-port>\n` +
        `    Or let the OS choose:  openmila --port 0`
      );
    } else {
      console.error("❌  Server error:", err && err.message ? err.message : err);
    }
    process.exit(1);
  });

  // Listen on the given port (0 = let the OS assign a free one)
  server.listen(flags.port, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : "?";
    const url = `http://127.0.0.1:${port}`;

    console.log(`
  ╔══════════════════════════════════════╗
  ║             OpenMila                 ║
  ║                                      ║
  ║   ${url.padEnd(34)}║
  ║                                      ║
  ╚══════════════════════════════════════╝
    `);

    if (flags.open) {
      openBrowser(url);
      console.log("  🌐  Opened in your default browser\n");
    } else {
      console.log("  🌐  Open the URL above in Chrome or Edge\n");
    }
  });
}

main();
