import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fetchPageMeta } from "./lib/fetchMeta.js";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "link-meta-api",
      configureServer(server) {
        server.middlewares.use("/api/meta", async (req, res) => {
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
