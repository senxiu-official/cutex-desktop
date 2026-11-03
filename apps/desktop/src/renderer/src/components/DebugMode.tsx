import { useOwnerWindow } from "../lib/ownerContext";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { useDebug, setDebugReporter, receiveDebugError, captureDebugError, registerDebugFlush, flushDebugReports } from "../lib/debugState";
import { debugShortcut, debugErrorText, type DebugState } from "../../../shared/debug";
import { useI18n } from "../i18n";

/** One controller per app document (desks use this document's React tree and bridge). */
export function DebugMode() {
  useEffect(() => {
    const debug = bridge.debug;
    if (!debug) return;
    const adopt = (state: DebugState) => {
      useDebug.setState({ state, ...(!state.enabled ? { errors: [] } : {}) });
      try { localStorage.setItem("cutex-desktop.debugMode", String(state.enabled)); } catch { /* optional mock bootstrap mirror */ }
    };
    const off = bridge.on("debug", event => { if ("state" in event) adopt(event.state); else receiveDebugError(event.error); });
    void debug.state().then(adopt, () => {});
    return off;
  }, []);
  return <><DebugWindow /><DebugErrors /><DebugSaved /></>;
}

export function DebugWindow() {
  const win = useOwnerWindow();
  const enabled = useDebug(s => s.state.enabled);
  useEffect(() => {
    if (!enabled || !bridge.debug) return;
    let unflush: (() => void) | undefined;
    let cancelled = false, stop: (() => void) | undefined;
    const send = (entries: Parameters<NonNullable<typeof bridge.debug>["report"]>[0]) => { if (entries.some(e => e.kind === "react-commit") && !useDebug.getState().reactReady) useDebug.setState({ reactReady: true }); return bridge.debug!.report(entries).catch(() => {}); };
    if (win === window) {
      setDebugReporter(send);
      window.__cutexDebugFlush = flushDebugReports;
    }
    void import("../lib/debugObserver").then(({ observeDebug }) => {
      if (cancelled) return;
      const observer = observeDebug(win, send); stop = observer.stop; unflush = registerDebugFlush(observer.flush);
      if (win === window) useDebug.setState({ reactReady: observer.reactReady });
    });
    const error = (e: ErrorEvent) => captureDebugError(e.error ?? e.message, "renderer.error");
    const rejection = (e: PromiseRejectionEvent) => captureDebugError(e.reason, "renderer.unhandledrejection");
    const keydown = (e: KeyboardEvent) => {
      const action = debugShortcut(bridge.platform ?? "linux", { type: "keyDown", key: e.key, code: e.code, control: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, isAutoRepeat: e.repeat });
      if (!action) return;
      e.preventDefault(); e.stopPropagation();
      void (action === "save" ? flushDebugReports().then(() => bridge.debug!.save()) : bridge.debug!.devtools()).catch(error => captureDebugError(error, `debug.${action}`));
    };
    win.addEventListener("keydown", keydown, true);
    win.addEventListener("error", error); win.addEventListener("unhandledrejection", rejection);
    return () => { cancelled = true; stop?.(); unflush?.(); if (win === window) { setDebugReporter(null); delete window.__cutexDebugFlush; } win.removeEventListener("keydown", keydown, true); win.removeEventListener("error", error); win.removeEventListener("unhandledrejection", rejection); };
  }, [enabled, win]);
  return null;
}

export function DebugErrors() {
  const win = useOwnerWindow();
  const [copied, setCopied] = useState<number | null>(null);
  const { t } = useI18n();
  const enabled = useDebug(s => s.state.enabled), errors = useDebug(s => s.errors);
  if (!enabled || !errors.length) return null;
  return <div className="fixed right-4 bottom-16 z-[99] flex max-h-[50vh] w-[min(36rem,calc(100vw-2rem))] flex-col gap-2 overflow-auto" data-debug-errors>
    {errors.map((error, i) => <div key={`${error.time}-${i}`} role="alert" className="rounded-lg border border-danger/40 bg-background p-3 text-xs shadow-e2">
      <div className="mb-2 flex gap-3"><strong className="flex-1">{t("debug.rawError")}</strong><button className="text-accent" onClick={() => void win.navigator.clipboard.writeText(debugErrorText(error)).then(() => setCopied(error.time), e => captureDebugError(e, "debug.copy"))}>{t(copied === error.time ? "reply.copied" : "debug.copyError")}</button><button aria-label={t("common.close")} onClick={() => useDebug.setState(s => ({ errors: s.errors.filter(e => e !== error) }))}>×</button></div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-danger">{debugErrorText(error)}</pre>
    </div>)}
  </div>;
}

/** Saving from the global app shortcut still shows its path when Settings is closed. */
export function DebugSaved() {
  const win = useOwnerWindow(), { t } = useI18n();
  const state = useDebug(s => s.state);
  const [dismissed, setDismissed] = useState<string | null>(null), [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [state.lastBundle]);
  if (!state.enabled || !state.lastBundle || state.lastBundle === dismissed) return null;
  const path = state.lastBundle;
  return <div role="status" data-debug-saved-toast className="fixed bottom-4 left-1/2 z-[98] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-background p-3 text-xs shadow-e2">
    <div className="flex gap-3"><strong className="flex-1">{t("debug.saved")}</strong><button aria-label={t("common.close")} onClick={() => setDismissed(path)}>×</button></div>
    <pre className="my-2 max-h-20 overflow-auto whitespace-pre-wrap break-all">{path}</pre>
    <div className="flex gap-4 text-accent"><button onClick={() => void win.navigator.clipboard.writeText(path).then(() => setCopied(true), e => captureDebugError(e, "debug.copyPath"))}>{t(copied ? "reply.copied" : "debug.copyPath")}</button><button onClick={() => void bridge.debug?.reveal().catch(e => captureDebugError(e, "debug.reveal"))}>{t(bridge.platform === "darwin" ? "debug.finder" : bridge.platform === "win32" ? "debug.explorer" : "debug.reveal")}</button></div>
  </div>;
}
