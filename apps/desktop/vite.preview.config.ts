// Browser-only preview of the renderer with the mock bridge (no Electron, no daemon).
//   pnpm --filter @cutex-desktop/app preview:web
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import { buildOfflinePageDocument } from "@cutex-desktop/opaque-frame/page";
import { defineConfig, type Plugin } from "vite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

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

/**
 * Module packs in the preview (dev/mockModulePacks.ts): `/__mock-pack/<id>/<version>/index.js` is the
 * real pack of that module, built on first request with scripts/module-packs/build.mjs (the version in
 * the URL is the mock's; the code is this checkout's). Same origin, so the page CSP's 'self' admits it.
 */
function mockModulePacks(): Plugin {
  const built = new Map<string, Promise<Buffer>>();
  return {
    name: "mock-module-packs",
    configureServer(server) {
      server.middlewares.use("/__mock-pack", (req, res) => {
        const m = /^\/([a-z][a-z0-9-]*)\/\d+\.\d+\.\d+\/index\.js$/.exec((req.url ?? "").split("?")[0]!);
        if (req.method !== "GET" || !m) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const id = m[1]!;
        if (!built.has(id)) {
          built.set(id, (async () => {
            // A runtime import (not bundled into the config): the builder resolves the app from its own location.
            const { buildPack } = (await import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, "scripts/module-packs/build.mjs")).href)) as typeof import("./scripts/module-packs/build.mjs");
            const { files } = await buildPack(id, mkdtempSync(resolve(tmpdir(), "cutex-preview-pack-")), { logLevel: "warn" });
            return files.find((f) => f.path === "index.js")!.data;
          })());
        }
        built.get(id)!.then(
          (js) => {
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(js);
          },
          (error: unknown) => {
            built.delete(id);
            res.statusCode = 404;
            res.end(String(error));
          },
        );
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react(), tailwindcss(), mockFrames(), mockModulePacks()],
  resolve: { alias: { "@": resolve(__dirname, "src/renderer/src") } },
  // Polling: the native Windows watcher kept missing edits made by tools (stale modules served).
  server: { port: 5199, strictPort: true, host: "127.0.0.1", watch: { usePolling: true, interval: 300 } },
});
