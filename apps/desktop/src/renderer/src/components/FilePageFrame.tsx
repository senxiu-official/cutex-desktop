// An HTML file of a workspace / the host as a page (the file view's 预览, owner 2026-10-24): main reads the
// bytes from that host and prepares a one-use offline document; we mount it in the shared opaque frame
// (docs/desktop-modules.md §10.2) — `sandbox="allow-scripts"` only (opaque origin: no same-origin, popups,
// forms or top navigation), the document's strict CSP, no network (loopback included), no preload / Node.
// Unlike an artifact page it has NO channels: no storage, no submit, no copy — no broker is attached.
// Inline-only: files next to it never load (main counts the references, the view says so). A page that
// navigates itself is stopped; the caller offers a fresh mount. No strings here: the caller passes them.
import { useEffect, useRef } from "react";
import { applyOpaqueFrame, onFrameNavigatedAway } from "@cutex-desktop/opaque-frame";
import type { FilePageRefusal } from "../../../shared/frames";
import type { WorkspaceScope } from "../../../shared/ipc";
import { bridge } from "../bridge";
import { appSchemeNow, watchAppScheme } from "../lib/theme";
import { useDeskId } from "../lib/deskContext";

export type FilePageProblem = FilePageRefusal | "unavailable" | "failed";

export interface FilePageFrameProps {
  hostId: string;
  path: string;
  /** A workspace-relative path; none = an absolute path on the host. */
  scope: WorkspaceScope | null;
  title: string;
  /** The owner chose to show a file over FILE_PAGE_PROMPT_BYTES. */
  large?: boolean;
  /** Bump to mount a fresh document (after the page navigated itself). */
  mount?: number;
  onProblem?(problem: FilePageProblem, totalBytes?: number): void;
  onReady?(externalRefs: number): void;
  onNavigated?(): void;
}

export function FilePageFrame({ hostId, path, scope, title, large = false, mount = 0, onProblem, onReady, onNavigated }: FilePageFrameProps) {
  // Main leases the document to this desk window only (multi-window P4; null = the main window).
  const deskId = useDeskId();
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef({ onProblem, onReady, onNavigated });
  cb.current = { onProblem, onReady, onNavigated };
  const scopeKind = scope?.kind ?? null;
  const scopeId = scope?.id ?? null;
  useEffect(() => {
    const frames = bridge?.frames;
    const container = box.current;
    if (!container) return;
    if (!frames?.prepareFilePage) {
      cb.current.onProblem?.("unavailable");
      return;
    }
    let live = true;
    let release: (() => void) | null = null;
    // Created in the document it is drawn in (a desk window is another document of this renderer).
    const frame = applyOpaqueFrame(container.ownerDocument.createElement("iframe"), title);
    frame.className = "block h-full w-full border-0";
    // As an artifact page: the frame takes the app's light / dark; a light-only page gets its own white canvas.
    const paint = () => {
      frame.style.colorScheme = appSchemeNow();
      frame.style.background = "Canvas";
    };
    paint();
    const unwatch = watchAppScheme(paint);
    const off = onFrameNavigatedAway(frame, () => {
      if (!live) return;
      frame.remove();
      cb.current.onNavigated?.();
    });
    const input = { hostId, path, ...(scopeKind && scopeId ? { scope: { kind: scopeKind, id: scopeId } } : {}), ...(large ? { large } : {}) };
    void frames.prepareFilePage(input, deskId ?? undefined).then(
      (result) => {
        if (result.ok) release = () => void frames.release(result.frame.id).catch(() => {});
        if (!live) return release?.();
        if (!result.ok) return cb.current.onProblem?.(result.reason, result.totalBytes);
        frame.src = result.frame.url;
        container.append(frame);
        cb.current.onReady?.(result.externalRefs);
      },
      () => live && cb.current.onProblem?.("failed"),
    );
    return () => {
      live = false;
      unwatch();
      off();
      frame.remove();
      release?.();
    };
  }, [hostId, path, scopeKind, scopeId, title, large, mount, deskId]);
  return <div ref={box} data-file-page="" className="absolute inset-0" />;
}
