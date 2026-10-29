// An HTML artifact version as a page (docs/desktop-modules.md §10.2): main prepares a one-use, offline
// document from the host's bytes and we mount it in the shared opaque frame — scripts run, nothing
// loads or leaves (no network, loopback included), no app / preload access. Its only channels are the
// three fixed page messages (own storage, submit after the owner confirms, copy during a click), which
// pageBroker.ts accepts from this frame alone and main decides. In a desk window (multi-window P4) main
// leases the document to that window only and the broker listens there. A page that navigates itself (a link,
// a refresh) is stopped; 「重新加载」 mounts a fresh document.
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { applyOpaqueFrame, onFrameNavigatedAway } from "@cutex-desktop/opaque-frame";
import type { ArtifactPageRefusal } from "../../../../shared/frames";
import { bridge } from "../../bridge";
import { appSchemeNow, watchAppScheme } from "../../lib/theme";
import { useI18n } from "../../i18n";
import { services } from "../app";
import { attachPageBroker, frameGestureActive } from "./pageBroker";
import { useDeskId } from "../../lib/deskContext";

export type PageProblem = ArtifactPageRefusal | "unavailable" | "failed" | "navigated";

/** `large`: the owner chose to show a page over ARTIFACT_PAGE_PROMPT_BYTES (main reads it in windows). */
export function PageFrame({ hostId, artifactId, version, title, large = false, onProblem }: { hostId: string; artifactId: string; version: number; title: string; large?: boolean; onProblem?(problem: PageProblem): void }) {
  const { t } = useI18n();
  // Main leases the document to this desk window only (null = the main window).
  const deskId = useDeskId();
  const box = useRef<HTMLDivElement>(null);
  const [navigated, setNavigated] = useState(false);
  const [mount, setMount] = useState(0);
  const report = useRef(onProblem);
  report.current = onProblem;
  const copiedText = useRef("");
  copiedText.current = t("artifacts.page.copied");
  useEffect(() => {
    const frames = bridge?.frames;
    const container = box.current;
    if (!container) return;
    if (!frames) {
      report.current?.("unavailable");
      return;
    }
    setNavigated(false);
    // The frame belongs to the window it is drawn in (multi-window P4: a desk is another document of this renderer):
    // created there, its messages arrive at that window, and the copy gesture is that document's. A document with
    // no window (a desk already gone) gets no page: never a broker on some other window.
    const doc = container.ownerDocument;
    const view = doc.defaultView;
    if (!view) {
      report.current?.("failed");
      return;
    }
    let live = true;
    let release: (() => void) | null = null;
    let detach: (() => void) | null = null;
    const frame = applyOpaqueFrame(doc.createElement("iframe"), title);
    frame.className = "block h-full w-full border-0";
    // An artifact is our page: it takes the app's light / dark (owner 2026-10-23). The frame element's colour
    // scheme is what the page's `prefers-color-scheme` reports, and its own background is that scheme's Canvas.
    // A page that follows (`color-scheme: light dark`, dark styles) matches the element and shows its own
    // colours on that canvas; a light-only page differs from a dark element, so Chromium paints the page's own
    // opaque white canvas (CSS Color Adjust) — black on white, never dark on dark or white on white.
    const paint = () => {
      frame.style.colorScheme = appSchemeNow();
      frame.style.background = "Canvas";
    };
    paint();
    const unwatch = watchAppScheme(paint);
    const off = onFrameNavigatedAway(frame, () => {
      if (!live) return;
      detach?.();
      frame.remove();
      setNavigated(true);
    });
    void frames.prepareArtifactPage({ hostId, artifactId, version, ...(large ? { large } : {}) }, deskId ?? undefined).then(
      (result) => {
        if (result.ok) release = () => void frames.release(result.frame.id).catch(() => {});
        if (!live) return release?.();
        if (!result.ok) return report.current?.(result.reason);
        detach = attachPageBroker({ frame, frameId: result.frame.id, forward: (id, call) => frames.page(id, call), gesture: () => frameGestureActive(frame, frame.ownerDocument), copied: () => services.ui.notice(copiedText.current), host: view });
        frame.src = result.frame.url;
        container.append(frame);
      },
      () => live && report.current?.("failed"),
    );
    return () => {
      live = false;
      unwatch();
      off();
      detach?.();
      frame.remove();
      release?.();
    };
  }, [hostId, artifactId, version, title, large, mount, deskId]);
  return (
    <div className="relative min-h-72 flex-1">
      <div ref={box} className="absolute inset-0" />
      {navigated && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface p-4 text-center text-xs text-subtle">
          <p>{t("artifacts.page.navigated")}</p>
          <button onClick={() => setMount((n) => n + 1)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover">
            <RotateCw size={12} />
            {t("artifacts.page.reload")}
          </button>
        </div>
      )}
    </div>
  );
}
