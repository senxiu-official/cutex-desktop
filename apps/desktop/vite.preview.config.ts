// Browser-only preview of the renderer with the mock bridge (no Electron, no daemon).
//   pnpm --filter @cutex-desktop/app preview:web
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import { buildOfflinePageDocument } from "@cutex-desktop/opaque-frame/page";
import { defineConfig, type Plugin } from "vite";

/**
 * Agent pages in the preview (dev/mockFrames.ts): main's one-use frame documents, played by this
 * server — the same offline document, served once with the same CSP + `sandbox allow-scripts`. The
 * preview page's CSP gets `frame-src 'self'` for it (the Electron app keeps `frame-src cutex-plugin:`).
 */
function mockFrames(): Plugin {
  const docs = new Map<string, { html: string; csp: string }>();
  return {
    name: "mock-frames",
    transformIndexHtml: (html) => html.replace("frame-src cutex-plugin:", "frame-src cutex-plugin: 'self'"),
    configureServer(server) {
      server.middlewares.use("/__mock-frame", (req, res) => {
        const id = (req.url ?? "/").replace(/^\//, "").split(/[?#]/)[0]!;
        if (req.method === "POST" && !id) {
          let body = "";
          req.setEncoding("utf8");
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const doc = buildOfflinePageDocument(body);
              const key = randomUUID();
              docs.set(key, doc);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ id: key, url: `/__mock-frame/${key}` }));
            } catch (e) {
              res.statusCode = 413;
              res.end(String(e));
            }
          });
          return;
        }
        const doc = docs.get(id);
        if (req.method === "DELETE") {
          docs.delete(id);
          res.end();
          return;
        }
        if (req.method !== "GET" || !doc) {
          res.statusCode = 404;
          res.end("Frame document unavailable");
          return;
        }
        docs.delete(id); // one use, like main
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", `${doc.csp}; sandbox allow-scripts`);
        res.setHeader("Cache-Control", "no-store");
        res.end(doc.html);
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react(), tailwindcss(), mockFrames()],
  resolve: { alias: { "@": resolve(__dirname, "src/renderer/src") } },
  // Polling: the native Windows watcher kept missing edits made by tools (stale modules served).
  server: { port: 5199, strictPort: true, host: "127.0.0.1", watch: { usePolling: true, interval: 300 } },
});
