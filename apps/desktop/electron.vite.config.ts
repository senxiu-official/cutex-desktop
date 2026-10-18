import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Workspace packages are TS sources; bundle them instead of externalizing.
const workspace = ["@cutex-desktop/protocol", "@cutex-desktop/plugin-sdk", "@cutex-desktop/cutex-client", "@cutex-desktop/plugin-sandbox", "@cutex-desktop/opaque-frame", "@cutex-desktop/browser-protocol", "@cutex-desktop/browser-cdp"];
const isPreviewMock = (id: string) => /[\\/]src[\\/]renderer[\\/]src[\\/](dev[\\/]|modules[\\/][^\\/]+[\\/]mock\.ts$)/.test(id);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspace })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspace })],
    build: {
      rollupOptions: {
        // The big alert window (main/ownerAlert.ts) has its own narrow preload.
        input: { index: resolve(__dirname, "src/preload/index.ts"), ownerAlert: resolve(__dirname, "src/preload/ownerAlert.ts") },
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": resolve(__dirname, "src/renderer/src") },
    },
    build: {
      // pdf.js CMaps / fonts / wasm (lib/pdfjs.ts) stay separate files, read only when a PDF needs one.
      assetsInlineLimit: (file: string) => (/[\\/]pdfjs-dist[\\/]/.test(file) ? false : undefined),
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html"), ownerAlert: resolve(__dirname, "src/renderer/owner-alert.html") },
        // The browser-preview mocks (dev/, modules/<id>/mock.ts) only run from installMockBridge(),
        // which bridge.ts calls under import.meta.env.DEV: declare them side-effect free so a
        // production build drops them entirely (their top-level data would otherwise be kept).
        treeshake: { moduleSideEffects: (id) => !isPreviewMock(id) },
      },
    },
  },
});
