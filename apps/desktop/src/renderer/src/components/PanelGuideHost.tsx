// The panel guides' card (lib/panelGuides; design .claude/previews/panel-guides-design.md): the first-use tips' card
// (components/FirstUseTips — surface, border, title, muted text) with the onboarding flow's step count and 上一步 /
// 下一步, 320–360 px beside the panel it was asked from; under 640 px a sheet along the bottom. Non-modal: a
// `role=dialog` without aria-modal — no backdrop, no focus trap, a click outside does not close it (the user may try
// things in the panel). Each step outlines its real control in that panel instance (an accent frame over it, pointer
// events go through); a control not on screen now says so instead (it never opens / switches anything to show it).
// Esc closes it after whatever is on top (a menu, a dialog, a drag) has had it. It closes when its panel goes (another
// host, the pane closed, another agent in that pane) and gives the focus back to where it was asked from.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useOverlayState } from "../lib/contextMenu";
import { anyOverlayOpen } from "../lib/openOverlays";
import { paneBinding } from "../lib/paneLayout";
import { usePanes } from "../lib/paneStore";
import {
  closePanelGuide,
  dragInProgress,
  finishPanelGuide,
  guideContext,
  PANEL_GUIDES,
  panelScope,
  setPanelGuideStep,
  setPanelGuideTrying,
  stepText,
  rendered,
  shownBox,
  usable,
  usePanelGuide,
  visibleBox,
  type Box,
  type PanelGuideRequest,
} from "../lib/panelGuides";
import { useApp } from "../store";
import { btn } from "./Button";
import { OwnerPortal } from "./OwnerLayer";
import { windowOfDocument } from "../lib/ownerWindow";

/** Below this window width (or when no side has room) the card is a sheet along the bottom. */
export const PANEL_GUIDE_NARROW = 640;
const CARD_W = 340;
const GAP = 10;

const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/**
 * Where the card goes beside `target` (else beside the panel): the side with room (right, left, below, above);
 * null = no side fits → the bottom sheet.
 */
export function placeCard(target: Box, card: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } | null {
  if (view.width < PANEL_GUIDE_NARROW) return null;
  const clampTop = (top: number) => Math.max(8, Math.min(top, view.height - card.height - 8));
  const clampLeft = (left: number) => Math.max(8, Math.min(left, view.width - card.width - 8));
  const right = target.left + target.width + GAP;
  if (right + card.width <= view.width - 8) return { left: right, top: clampTop(target.top) };
  const left = target.left - GAP - card.width;
  if (left >= 8) return { left, top: clampTop(target.top) };
  const below = target.top + target.height + GAP;
  if (below + card.height <= view.height - 8) return { left: clampLeft(target.left), top: below };
  const above = target.top - GAP - card.height;
  if (above >= 8) return { left: clampLeft(target.left), top: above };
  return null;
}

/** The element to give the focus to for `el`: itself when focusable, else its nearest focusable ancestor. */
function focusableFor(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  return el.closest<HTMLElement>("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])") ?? el.querySelector<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])");
}

function sameBox(a: Box | null, b: Box | null): boolean {
  return a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
}

export function PanelGuideHost() {
  const { t } = useI18n();
  const open = usePanelGuide();
  // The window the guide was asked from (a desk window's panel, multi-window): the card, its keys and frames there.
  const doc = open?.request.opener?.ownerDocument ?? document;
  const win = windowOfDocument(doc);
  const overlays = useOverlayState();
  const host = useApp((s) => s.hosts?.active ?? null);
  // The agent's capabilities can change while it is open (a host's features arrive): re-read with its host data.
  useApp((s) => s.byHost);
  const ctx = open ? guideContext(open.request) : null;
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const openedOn = useRef<{ nonce: number; host: string | null; request: PanelGuideRequest } | null>(null);
  const [target, setTarget] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const def = open ? PANEL_GUIDES[open.request.panel] : null;
  const steps = def?.steps ?? [];
  const at = open?.step ?? 0;
  const current = steps[at] ?? null;

  // Where it was opened: the host then, the request (for the focus to go back to).
  useEffect(() => {
    if (!open) return;
    if (openedOn.current?.nonce !== open.nonce) openedOn.current = { nonce: open.nonce, host, request: open.request };
  }, [open, host]);

  // Another host: the panel it is about is gone.
  useEffect(() => {
    if (open && openedOn.current?.nonce === open.nonce && openedOn.current.host !== host) closePanelGuide();
  }, [host, open]);

  // A new guide starts beside its own panel, not where the last one was.
  useEffect(() => setTarget(null), [open?.nonce]);

  // Its panel instance: measured on every frame that matters (resize, scroll, layout changes — a light poll), closes
  // when it is gone or the pane shows another agent now. The frame outlines the part of the target that can be seen
  // (lib/panelGuides shownBox: never over the toolbar for a row scrolled out of the list, nor over the Shelf drawn on
  // top of it). A target that is there but scrolled out (no match in view: lib/panelGuides pick) is scrolled in once
  // per step — a list position, not a layout or a panel; scrolled out again by the user, the step says it is not on
  // screen instead of pulling it back.
  useEffect(() => {
    if (!open || !current) return;
    let frame = 0;
    let scrolled = false;
    const measure = () => {
      const request = open.request;
      const scope = panelScope(request);
      if (!scope) return closePanelGuide();
      if (request.panel === "conversation" && request.paneId && request.sessionId) {
        const b = paneBinding(usePanes.getState().layout, request.paneId);
        if (b && b.sessionId !== request.sessionId) return closePanelGuide();
      }
      setDragging(dragInProgress());
      const el = current.target?.(scope, request) ?? null;
      if (el && !scrolled && rendered(el) && !visibleBox(el)) {
        scrolled = true;
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const next = shownBox(el);
      setMissing(!next);
      // Not on screen: the card stays where it was (on open: beside the whole panel).
      setTarget((prev) => {
        const box = next ?? prev ?? rectOf(scope);
        return sameBox(prev, box) ? prev : box;
      });
    };
    const again = () => {
      win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(measure);
    };
    measure();
    const timer = setInterval(measure, 400);
    win.addEventListener("resize", again);
    doc.addEventListener("scroll", again, true);
    return () => {
      win.cancelAnimationFrame(frame);
      clearInterval(timer);
      win.removeEventListener("resize", again);
      doc.removeEventListener("scroll", again, true);
    };
  }, [open, current, win, doc]);

  // The card beside the target (or the bottom sheet).
  useLayoutEffect(() => {
    if (!open || !target || !card.current) return;
    // Its width is fixed beside a panel (the sheet's is not: measured as a sheet it would never fit beside anything).
    const r = card.current.getBoundingClientRect();
    const width = Math.min(CARD_W, win.innerWidth - 16);
    const next = placeCard(target, { width, height: r.height }, { width: win.innerWidth, height: win.innerHeight });
    setPlace((p) => (p === next || (p && next && p.left === next.left && p.top === next.top) ? p : next));
  }, [open, target, at, open?.trying, place, missing, win]);

  // Focus: the title on open and on each step (not while trying: the panel has it).
  useEffect(() => {
    if (!open || open.trying) return;
    heading.current?.focus({ preventScroll: true });
  }, [open?.nonce, at, open?.trying]);

  // Closing: the focus goes back to where it was asked from (gone: the panel's first control).
  useEffect(() => {
    if (open) return;
    const was = openedOn.current;
    if (!was) return;
    openedOn.current = null;
    const opener = was.request.opener;
    if (opener && usable(opener)) return opener.focus({ preventScroll: true });
    const scope = panelScope(was.request);
    focusableFor(scope?.querySelector<HTMLElement>("button, input, [tabindex]") ?? null)?.focus({ preventScroll: true });
  }, [open]);

  // Esc: after menus, dialogs and drags (they listen first and stop it, or are still open).
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (dragInProgress() || anyOverlayOpen() || doc.querySelector('[role="menu"], [aria-modal="true"]')) return;
      closePanelGuide();
    };
    doc.addEventListener("keydown", key);
    return () => doc.removeEventListener("keydown", key);
  }, [open, doc]);

  if (!open || !def || !current || !ctx) return null;
  // A confirm / prompt dialog (a high-risk action): the guide steps back until it is answered.
  if (overlays.dialog) return null;
  const text = stepText(current, ctx);
  const vars = { mod: ctx.mod };
  const last = at === steps.length - 1;
  const live = t("onboarding.panel.live", { n: at + 1, total: steps.length, title: t(text.title) });
  const backToPanel = () => {
    const scope = panelScope(open.request);
    const el = scope ? (current.target?.(scope, open.request) ?? null) : null;
    focusableFor(el && usable(el) ? el : null)?.focus({ preventScroll: true }) ?? focusableFor(scope)?.focus({ preventScroll: true });
  };
  const tryIt = () => {
    setPanelGuideTrying(true);
    win.requestAnimationFrame(backToPanel);
  };
  const sheet = !place;
  const frame = target && !missing && !dragging && (
    <div aria-hidden data-panel-guide-frame="" className="pointer-events-none fixed z-[49] rounded-md border-2 border-accent bg-accent/8" style={{ left: target.left - 3, top: target.top - 3, width: target.width + 6, height: target.height + 6 }} />
  );
  const position = sheet ? { left: 8, right: 8, bottom: 8 } : { left: place.left, top: place.top, width: `min(${CARD_W}px, calc(100vw - 16px))` };

  if (open.trying) {
    return (
      <OwnerPortal doc={doc}>
      <>
        {frame}
        <div
          ref={card}
          role="dialog"
          aria-labelledby={titleId}
          data-panel-guide={def.id}
          data-panel-guide-step={current.id}
          data-panel-guide-trying=""
          className="float fixed z-[160] flex items-center gap-2 px-3 py-2 text-ui"
          style={sheet ? position : { left: place.left, top: place.top }}
        >
          <Lightbulb size={14} className="shrink-0 text-accent" aria-hidden />
          <span id={titleId} className="min-w-0 truncate text-meta text-muted">
            {t("onboarding.panel.watching", { label: current.tryIt ? t(current.tryIt) : t(text.title) })}
          </span>
          <button type="button" data-panel-guide-resume="" className={btn({ variant: "secondary", size: "sm" })} onClick={() => setPanelGuideTrying(false)}>
            {t("onboarding.panel.resume")}
          </button>
          <button type="button" className="shrink-0 rounded-ctl p-1 text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" aria-label={t("onboarding.panel.close", { title: t(def.title) })} onClick={closePanelGuide}>
            <X size={14} />
          </button>
        </div>
      </>
      </OwnerPortal>
    );
  }

  return (
    <OwnerPortal doc={doc}>
    <>
      {frame}
      <div
        ref={card}
        role="dialog"
        aria-labelledby={titleId}
        data-panel-guide={def.id}
        data-panel-guide-step={current.id}
        data-panel-guide-sheet={sheet ? "" : undefined}
        className="float fixed z-[160] flex max-h-[min(420px,70dvh)] flex-col text-ui data-[panel-guide-sheet]:max-h-[min(60dvh,420px)]"
        style={position}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
          <Lightbulb size={14} className="shrink-0 text-accent" aria-hidden />
          <p id={titleId} className="min-w-0 flex-1 truncate text-meta font-semibold text-accent">
            {t(def.title)}
          </p>
          <span className="shrink-0 text-meta text-subtle tabular-nums" data-panel-guide-count="">
            {t("onboarding.panel.count", { n: at + 1, total: steps.length })}
          </span>
          <button type="button" className="shrink-0 rounded-ctl p-1 text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" aria-label={t("onboarding.panel.close", { title: t(def.title) })} onClick={closePanelGuide}>
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1.5 pb-2">
          <h2 ref={heading} tabIndex={-1} className="font-medium text-foreground outline-none">
            {t(text.title)}
          </h2>
          <p className="mt-1 whitespace-pre-line text-meta text-muted">{t(text.body, vars)}</p>
          {text.note && <p className="mt-1.5 whitespace-pre-line text-meta text-subtle" data-panel-guide-note="">{t(text.note, vars)}</p>}
          {missing && (
            <p className="mt-2 rounded-ctl border border-dashed border-border px-2 py-1 text-meta text-subtle" data-panel-guide-missing="">
              {t("onboarding.panel.notShown")}
            </p>
          )}
          {text.detail && (
            <details className="mt-2 text-meta" data-panel-guide-detail="">
              <summary className="cursor-pointer rounded-ctl text-accent focus-visible:outline-2 focus-visible:outline-accent">{t(current.detailLabel ?? "onboarding.panel.more")}</summary>
              <p className="mt-1 whitespace-pre-line text-muted">{t(text.detail, vars)}</p>
            </details>
          )}
          {current.tryIt && !missing && (
            <button type="button" data-panel-guide-try="" className="mt-2 rounded-ctl border border-accent/50 px-2.5 py-1 text-meta text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent" onClick={tryIt}>
              {t("onboarding.panel.try", { label: t(current.tryIt) })}
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <button type="button" data-panel-guide-return="" className="rounded-ctl text-meta text-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent" onClick={backToPanel}>
            {t("onboarding.panel.return")}
          </button>
          <span className="ml-auto" />
          {at > 0 && (
            <button type="button" data-panel-guide-back="" className={btn({ variant: "secondary", size: "sm" })} onClick={() => setPanelGuideStep(at - 1)}>
              {t("onboarding.back")}
            </button>
          )}
          <button type="button" data-panel-guide-next="" className={btn({ variant: "primary", size: "sm" })} onClick={() => (last ? finishPanelGuide() : setPanelGuideStep(at + 1))}>
            {t(last ? "onboarding.panel.done" : "onboarding.next")}
          </button>
        </div>
        <p className="sr-only" aria-live="polite" data-panel-guide-live="">
          {live}
        </p>
      </div>
    </>
    </OwnerPortal>
  );
}
