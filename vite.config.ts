import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fetchPageMeta } from "./lib/fetchMeta.js";

const META_RATE_WINDOW_MS = 60_000;
const META_RATE_MAX = 60;
const metaRateHits: number[] = [];

function allowMetaRequest(): boolean {
  const now = Date.now();
  while (metaRateHits.length > 0 && now - metaRateHits[0]! > META_RATE_WINDOW_MS) {
    metaRateHits.shift();
  }
  if (metaRateHits.length >= META_RATE_MAX) {
    return false;
  }
  metaRateHits.push(now);
  return true;
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "link-meta-api",
      configureServer(server) {
        server.middlewares.use("/api/meta", async (req, res) => {
          if (!allowMetaRequest()) {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Too many requests" }));
            return;
          }
          const url = new URL(req.url ?? "/", "http://localhost").searchParams.get("url");
          if (!url || !/^https?:\/\//.test(url)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing or invalid url parameter" }));
            return;
          }
          try {
            const meta = await fetchPageMeta(url);
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600",
            });
            res.end(JSON.stringify(meta));
          } catch {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to fetch target URL" }));
          }
        });
      },
    },
  ],
  base: "./",
});
