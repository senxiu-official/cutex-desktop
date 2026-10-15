// An HTML artifact version as a page (docs/desktop-modules.md §10.2): main prepares a one-use, offline
// document from the host's bytes and we mount it in the shared opaque frame — scripts run, nothing
// loads or leaves (no network, loopback included), no bridge, no app / preload access. A page that
// navigates itself (a link, a refresh) is stopped; 「重新加载」 mounts a fresh document.
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { createOpaqueFrame, onFrameNavigatedAway } from "@cutex-desktop/opaque-frame";
import type { ArtifactPageRefusal } from "../../../../shared/frames";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";

export type PageProblem = ArtifactPageRefusal | "unavailable" | "failed" | "navigated";

export function PageFrame({ hostId, artifactId, version, title, onProblem }: { hostId: string; artifactId: string; version: number; title: string; onProblem?(problem: PageProblem): void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [navigated, setNavigated] = useState(false);
  const [mount, setMount] = useState(0);
  const report = useRef(onProblem);
  report.current = onProblem;
  useEffect(() => {
    const frames = bridge?.frames;
    const container = box.current;
    if (!container) return;
    if (!frames) {
      report.current?.("unavailable");
      return;
    }
    setNavigated(false);
    let live = true;
    let release: (() => void) | null = null;
    const frame = createOpaqueFrame(title);
    frame.className = "block h-full w-full border-0 bg-white";
    const off = onFrameNavigatedAway(frame, () => {
      if (!live) return;
      frame.remove();
      setNavigated(true);
    });
    void frames.prepareArtifactPage({ hostId, artifactId, version }).then(
      (result) => {
        if (result.ok) release = () => void frames.release(result.frame.id).catch(() => {});
        if (!live) return release?.();
        if (!result.ok) return report.current?.(result.reason);
        frame.src = result.frame.url;
        container.append(frame);
      },
      () => live && report.current?.("failed"),
    );
    return () => {
      live = false;
      off();
      frame.remove();
      release?.();
    };
  }, [hostId, artifactId, version, title, mount]);
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
