import "./lib/debugReact";
import { DebugMode } from "./components/DebugMode";
// First: the pane layout starts loading (IndexedDB) while the rest of the app loads.
import { panesLoaded } from "./lib/paneDbBoot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { I18nProvider, startLocaleReady } from "./i18n";
import "./styles.css";
import "./motion.css";
import { startMotion } from "./lib/motion";
import { applyContrast, applyDarkPalette, applyLightPalette, applyTheme, loadContrast, loadDarkPalette, loadLightPalette, loadTheme } from "./lib/theme";
import { bridge } from "./bridge";
import { startProfileAccountLinks } from "./lib/profileAccountLinks";
import { startProfileLinkAppearanceSync } from "./lib/profileLinkAppearance";
import { applyAppearance, zoomShortcut } from "./lib/appearance";
import { installCopyFeedback } from "./lib/copyFeedback";
import { installOverlayScrollbars } from "./lib/overlayScrollbarManager";
import { installAnimationPhase } from "./lib/animationPhase";
import { installLoopPause } from "./lib/loopPause";
import { installPerfMode } from "./lib/perfMode";
import { startAppModules } from "./modules/app";
import { MODULES } from "./modules/registry";
import { startModulePacks } from "./modules/packs";
import { BUNDLED_PACK_VERSIONS } from "./modules/packVersions";
import { followActingUsers } from "./lib/actingUsers";
import { startIdentitySync } from "./lib/identitySync";
import { startPortraitSave } from "./lib/portraitSave";
import { startAutoEmojiCleanup } from "./lib/autoEmojiCleanup";
import { installImeGuards } from "./lib/ime";
import { installContentSelection } from "./lib/contentSelection";

// Overlay scrollbars first: their capture listeners must run before the app's outside-click handlers.
installOverlayScrollbars();
installImeGuards(document);
installContentSelection(document);
applyTheme(loadTheme());
applyLightPalette(loadLightPalette());
applyDarkPalette(loadDarkPalette());
applyContrast(loadContrast());
applyAppearance();
installCopyFeedback();
// Looping animations (spinners, running rings) in one phase: one main-thread frame per loop, not one per element.
installAnimationPhase();
// …and rest while the window is not in front (lib/loopPause; after the phase, whose alignment would restart them).
installLoopPause();
// 性能 (Settings → 通用): 流畅优先 keeps the loops running and preloads the rarely used pages (lib/perfMode).
installPerfMode();
// Motion tokens (docs/design/021): nothing animates into the first paint.
startMotion();
// The rest starts once the UI language is loaded (i18n: only zh-CN is bundled; another start-up language — en
// included — is its own chunk), so nothing they note or draw comes out in zh-CN first. zh-CN: at once.
void startLocaleReady.then(() => {
  // Built-in modules (docs/desktop-modules.md): gated on the active host, before the first render.
  const moduleHost = startAppModules(MODULES);
  // Signed first-party module packs (§23): a verified newer pack replaces its bundled copy once loaded.
  startModulePacks(moduleHost, MODULES, BUNDLED_PACK_VERSIONS, bridge.modulePacks);
  followActingUsers();
  // 「你」 (Settings → 用户): publish name + picture to hosts with users-self-profile.
  startIdentitySync();
  startProfileAccountLinks();
  startProfileLinkAppearanceSync();
  startPortraitSave();
  // Once per device: emoji defaults stored before fix/no-avatar-fallback go back to no avatar (lib/autoEmojiCleanup).
  startAutoEmojiCleanup();
});
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

const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider>
        <DebugMode />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </I18nProvider>
    </StrictMode>,
  );
// The first render waits for the pane layout (lib/paneDbBoot; not loaded — no IndexedDB, or it failed: it stays in
// localStorage as before) and the UI language (after the modules started, above).
const panesSettled = panesLoaded.then(() => undefined, () => undefined);
void Promise.all([panesSettled, startLocaleReady]).then(render);
