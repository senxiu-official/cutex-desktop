// First-use tips (owner 2026-10-24): the anchored guides of the registry (lib/guides, kind "tip"). One at a time, small,
// beside its anchor, never modal; recorded as seen when it shows (so closing the window does not bring it back), each
// replayable from Settings → 帮助. `appear` tips: a cheap check every few seconds, only while an unseen one is left and
// nothing else is open; `hover` tips: the pointer rests on the anchor or it gets keyboard focus. The first guide on a
// device first asks 「要看引导和提示吗？」 in place (components/GuidesAsk).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { useGuidesHostSync } from "../lib/guidesHost";
import { getGuides, guideById, guideSeen, guidesHostPending, liveGuides, markGuideSeen, onGuideReplay, replayGuide, skipAllGuides, useGuideState, type Guide } from "../lib/guides";
import { useOnboardingView } from "../lib/onboarding";
import { anyOverlayOpen } from "../lib/openOverlays";
import { useUpdateStatus } from "../lib/update";
import { useApp } from "../store";
import { GuidesAskButtons } from "./GuidesAsk";
import { GuideActionButton } from "./GuideActionButton";
import { OwnerPortal } from "./OwnerLayer";
import { settingsAction } from "../lib/guideActions";
import { isElement, isNode, ownerWindowOf } from "../lib/ownerWindow";
import { onEveryAppWindow, queryAllAppWindows, queryAppWindows } from "../lib/appWindowSet";

/** How often `appear` tips look for their anchor, and the quiet time after one closes before the next. */
export const TIP_POLL_MS = 2000;
export const TIP_GAP_MS = 6000;

interface Shown {
  guide: Guide;
  anchor: HTMLElement;
}

/** Whether `el` can be seen: inside the window and not scrolled out of a clipping ancestor (e.g. a sidebar row below the fold). */
function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const view = ownerWindowOf(el);
  if (r.bottom > view.innerHeight + 1 || r.right > view.innerWidth + 1 || r.top < -1 || r.left < -1) return false;
  for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowY)) continue;
    const box = p.getBoundingClientRect();
    if (r.top < box.top - 1 || r.bottom > box.bottom + 1) return false;
  }
  return true;
}

/** The tip's anchor if it is on screen and usable now. */
export function findAnchor(guide: Guide): HTMLElement | null {
  if (!guide.anchor) return null;
  for (const el of queryAllAppWindows<HTMLElement>(guide.anchor)) {
    if (el.closest("[inert], [hidden], [aria-hidden=true]") || !el.getClientRects().length || !inView(el)) continue;
    if (guide.when && !guide.when(el)) continue;
    return el;
  }
  return null;
}

function busy(): boolean {
  return anyOverlayOpen() || !!queryAppWindows('[role="dialog"], [role="menu"]');
}

export function FirstUseTips() {
  const { t } = useI18n();
  useGuidesHostSync();
  const view = useOnboardingView();
  const host = useApp((s) => s.hosts?.active);
  const status = useUpdateStatus();
  const version = status?.current?.version ?? null;
  const state = useGuideState();
  const [shown, setShown] = useState<Shown | null>(null);
  const closedAt = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const tips = liveGuides(version).filter((g) => g.kind === "tip");
  const unseen = tips.filter((g) => !state.seen.includes(g.id));
  const appearIds = unseen.filter((g) => g.trigger !== "hover").map((g) => g.id).join(" ");
  const hoverIds = unseen.filter((g) => g.trigger === "hover").map((g) => g.id).join(" ");

  const show = (guide: Guide, anchor: HTMLElement) => {
    // Recorded once its text is on screen; while the question is open it is not yet.
    setShown({ guide, anchor });
  };
  const close = () => {
    closedAt.current = Date.now();
    setShown(null);
  };

  // `appear`: poll for the anchors of the unseen ones (stops when none is left).
  useEffect(() => {
    if (view || shown || !appearIds) return;
    const ids = appearIds.split(" ");
    const tick = () => {
      if (Date.now() - closedAt.current < TIP_GAP_MS || busy() || (!getGuides().asked && guidesHostPending())) return;
      for (const id of ids) {
        const guide = guideById(id);
        const anchor = guide && !guideSeen(id) ? findAnchor(guide) : null;
        if (guide && anchor) return show(guide, anchor);
      }
    };
    const timer = setInterval(tick, TIP_POLL_MS);
    return () => clearInterval(timer);
  }, [view, shown, appearIds]);

  // `hover`: dwell or keyboard focus on the anchor.
  useEffect(() => {
    if (view || shown || !hoverIds) return;
    const guides = hoverIds.split(" ").map(guideById).filter((g): g is Guide => !!g);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => clearTimeout(timer);
    const enter = (event: Event) => {
      cancel();
      if (!isElement(event.target)) return;
      for (const guide of guides) {
        const anchor = event.target.closest<HTMLElement>(guide.anchor!);
        if (!anchor || guideSeen(guide.id) || anchor.closest("[inert], [hidden], [aria-hidden=true]") || (guide.when && !guide.when(anchor))) continue;
        const go = () => {
          if (anchor.isConnected && anchor.getClientRects().length && !busy()) show(guide, anchor);
        };
        if (event.type === "focusin") go();
        else timer = setTimeout(go, 650);
        return;
      }
    };
    // In every app window (a desk window's anchors too, multi-window).
    const stop = onEveryAppWindow((win) => {
      const doc = win.document;
      doc.addEventListener("pointerover", enter);
      doc.addEventListener("focusin", enter);
      doc.addEventListener("pointerout", cancel);
      doc.addEventListener("pointerdown", cancel);
      return () => {
        doc.removeEventListener("pointerover", enter);
        doc.removeEventListener("focusin", enter);
        doc.removeEventListener("pointerout", cancel);
        doc.removeEventListener("pointerdown", cancel);
      };
    });
    return () => {
      cancel();
      stop();
    };
  }, [view, shown, hoverIds]);

  // 帮助 → 再看一次: show it now if its anchor is on screen (otherwise the next time it is).
  useEffect(
    () =>
      onGuideReplay((id) => {
        const guide = guideById(id);
        if (guide?.kind !== "tip") return;
        const anchor = findAnchor(guide);
        if (anchor) {
          closedAt.current = 0;
          show(guide, anchor);
        }
      }),
    [],
  );

  useEffect(() => setShown(null), [view, host]);
  const asking = !!shown && !state.asked;
  useEffect(() => {
    if (shown && state.asked) markGuideSeen(shown.guide.id);
  }, [shown, state.asked]);

  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    // The anchor's window (a desk window's, multi-window).
    const win = ownerWindowOf(shown.anchor);
    const place = () => {
      if (!shown.anchor.isConnected || !box.current) return close();
      const a = shown.anchor.getBoundingClientRect();
      const r = box.current.getBoundingClientRect();
      // In the sidebar: beside it, so the rows under the anchor stay readable; elsewhere below (above near the bottom).
      const side = shown.anchor.closest("[data-sidebar-mode]")?.getBoundingClientRect();
      const beside = !!side && side.right + 8 + r.width <= win.innerWidth - 8;
      const below = a.bottom + 8;
      const top = beside ? a.top : below + r.height <= win.innerHeight - 8 ? below : a.top - r.height - 8;
      const left = beside ? side!.right + 8 : a.left;
      const next = { left: Math.max(8, Math.min(left, win.innerWidth - r.width - 8)), top: Math.max(8, Math.min(top, win.innerHeight - r.height - 8)) };
      setPosition((p) => (p.left === next.left && p.top === next.top ? p : next));
    };
    place();
    let frame = 0;
    const again = () => {
      win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(place);
    };
    win.addEventListener("resize", again);
    win.document.addEventListener("scroll", again, true);
    return () => {
      win.cancelAnimationFrame(frame);
      win.removeEventListener("resize", again);
      win.document.removeEventListener("scroll", again, true);
    };
  }, [shown, asking]);

  useEffect(() => {
    if (!shown) return;
    const outside = (event: Event) => {
      if (isNode(event.target) && !box.current?.contains(event.target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const doc = shown.anchor.ownerDocument;
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", key, true);
    return () => {
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("keydown", key, true);
    };
  }, [shown]);

  if (!shown || view) return null;
  const { guide } = shown;
  const link = "rounded-ctl text-meta text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <OwnerPortal doc={shown.anchor.ownerDocument}>
    <div ref={box} role="note" aria-label={t(guide.title)} data-first-use-tip={guide.id} className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-inner border border-border bg-surface p-3 text-ui shadow-e2" style={position}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-medium text-foreground">{t(asking ? "onboarding.guide.ask.title" : guide.title)}</p>
        <button type="button" className="shrink-0 rounded-ctl p-1 text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" aria-label={t("onboarding.tips.dismiss")} onClick={close}>
          <X size={14} />
        </button>
      </div>
      {asking ? (
        <div data-guides-ask="tip">
          <p className="mt-1 whitespace-pre-line text-meta text-muted">{t("onboarding.guide.ask.body")}</p>
          <div className="mt-2">
            <GuidesAskButtons version={version} onSkip={close} />
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-line text-meta text-muted">{t(guide.text)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {guide.settings && (
              <GuideActionButton id={`settings.${guide.settings}`} action={settingsAction(guide.settings)} before={close} className={link}>
                {t("onboarding.guide.openSettings")}
              </GuideActionButton>
            )}
            {guide.related && guideById(guide.related) && (
              <button type="button" className={link} onClick={() => (close(), replayGuide(guide.related!))}>
                {t("onboarding.guide.related", { title: t(guideById(guide.related)!.title) })}
              </button>
            )}
            <button type="button" data-guides-skip="" className={`${link} ml-auto text-muted`} onClick={() => (skipAllGuides(version), close())}>
              {t("onboarding.guide.skipAll")}
            </button>
          </div>
        </>
      )}
    </div>
    </OwnerPortal>
  );
}
