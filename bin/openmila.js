#!/usr/bin/env node

/**
 * openmila — CLI launcher for OpenMila
 *
 * Starts a local HTTP server serving the pre-built app and opens it
 * in the default browser.
 *
 * Usage:
 *   openmila            # launch on a random available port
 *   openmila --port 3456
 *   openmila --no-open  # start server without opening browser
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

// ── Simple static file server ─────────────────────────────────────────────
function createServer() {
  return http.createServer(async (req, res) => {
    // Basic security: refuse paths with ".."
    let safePath = req.url?.split("?")[0].split("#")[0] ?? "/";
    if (safePath.includes("..")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // ── /api/meta — link metadata endpoint ────────────────────────────────
    if (req.method === "GET" && safePath === "/api/meta") {
      const urlParam = new URL(req.url, "http://localhost").searchParams.get("url");
      if (!urlParam || !/^https?:\/\//.test(urlParam)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid url parameter" }));
        return;
      }
      try {
        const meta = await fetchPageMeta(urlParam);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(JSON.stringify(meta));
      } catch {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch target URL" }));
      }
      return;
    }

    let filePath = path.join(distDir, safePath === "/" ? "index.html" : safePath);

    // If the file doesn't exist, serve index.html (SPA fallback)
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDir, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME[ext] ?? "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Internal Server Error");
        return;
      }
      res.writeHead(200, { "Content-Type": mimeType });
      res.end(data);
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
      flags.port = parseInt(argv[++i], 10) || 30142;
    } else if (arg === "--no-open") {
      flags.open = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: openmila [options]

Options:
  --port, -p <number>   Port to listen on (default: 30142)
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

  // Listen on the given port (or 0 = random available)
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
