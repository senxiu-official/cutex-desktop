import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { I18nProvider } from "./i18n";
import "./styles.css";
import { applyContrast, applyDarkPalette, applyLightPalette, applyTheme, loadContrast, loadDarkPalette, loadLightPalette, loadTheme } from "./lib/theme";
import { bridge } from "./bridge";
import { applyAppearance, zoomShortcut } from "./lib/appearance";
import { installCopyFeedback } from "./lib/copyFeedback";
import { installOverlayScrollbars } from "./lib/overlayScrollbarManager";
import { startAppModules } from "./modules/app";
import { MODULES } from "./modules/registry";
import { startModulePacks } from "./modules/packs";
import { BUNDLED_PACK_VERSIONS } from "./modules/packVersions";
import { followActingUsers } from "./lib/actingUsers";
import { startIdentitySync } from "./lib/identitySync";

// Overlay scrollbars first: their capture listeners must run before the app's outside-click handlers.
installOverlayScrollbars();
applyTheme(loadTheme());
applyLightPalette(loadLightPalette());
applyDarkPalette(loadDarkPalette());
applyContrast(loadContrast());
applyAppearance();
installCopyFeedback();
// Built-in modules (docs/desktop-modules.md): gated on the active host, before the first render.
const moduleHost = startAppModules(MODULES);
// Signed first-party module packs (§23): a verified newer pack replaces its bundled copy once loaded.
startModulePacks(moduleHost, MODULES, BUNDLED_PACK_VERSIONS, bridge.modulePacks);
followActingUsers();
// 「你」 (Settings → 用户): publish name + picture to hosts with users-self-profile.
startIdentitySync();
// Ctrl/Cmd + = / - / 0: window zoom (Settings → 外观 → 界面缩放).
window.addEventListener("keydown", (e) => {
  if (zoomShortcut(e)) e.preventDefault();
});
// Renderer crashes and unhandled rejections go to the desktop error log (Settings → 通用 → 错误日志).
window.addEventListener("error", (e) => void bridge.shell?.logError({ kind: "error", message: e.message, stack: e.error instanceof Error ? e.error.stack : undefined }).catch(() => {}));
window.addEventListener("unhandledrejection", (e) => {
  const reason: unknown = e.reason;
  void bridge.shell?.logError({ kind: "unhandledrejection", message: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined }).catch(() => {});
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
