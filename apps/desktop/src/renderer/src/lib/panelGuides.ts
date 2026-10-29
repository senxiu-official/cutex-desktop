// Panel guides (owner 2026-10-25; design .claude/previews/panel-guides-design.md): 「使用小指南」 for the Shelf, the
// tray, the sidebar and the conversation — opened ONLY on request (the panel's right-click / ⋯ menu, or Settings → 帮助),
// never by itself. A small step card beside the panel it was asked from (components/PanelGuideHost), in the onboarding /
// first-use tips' look; each step outlines the real control it is about in THAT instance (two conversations, two
// Shelves, the tray's overflow copy: the request's scope, never the first match in the document). Read only: it never
// drags, sends, starts / stops, grants or changes a layout for the user (「试一试」 only hands the focus back).
//
// State: one guide at a time, its step in memory only. Finishing it records `panel.<id>@<version>` in the guides' seen
// list (lib/guides) for 帮助's 「已看过」; closing early records nothing. It never touches the onboarding, the other tips,
// guides.asked or the host's 全部跳过 (lib/guides keeps panel guides out of those).
import type { AgentRuntime } from "./agentFeatures";
import { useSyncExternalStore } from "react";
import type { MessageKey } from "../i18n";
import { featuresOf, sidebarOf, useApp } from "../store";
import { agentFeaturesOf, lacks } from "./agentFeatures";
import { runtimeOf } from "./agentList";
import { agentPauseSupported } from "./agentPause";
import { getGuides, markGuideSeen } from "./guides";
import { newInstanceKey } from "./openModifiers";
import { sideDragging } from "./sideDnd";
import { STOP_HOLD_FEATURE } from "./stopHold";
import { isHTMLElement, ownerWindowOf } from "./ownerWindow";
import { queryAppWindows } from "./appWindowSet";

export type PanelId = "shelf" | "tray" | "sidebar" | "conversation";
export const PANEL_IDS: readonly PanelId[] = ["shelf", "tray", "sidebar", "conversation"];

/** Bump when a guide's steps change in meaning: 帮助 shows 「已看过」 only for the current version. */
export const PANEL_GUIDE_VERSION: Record<PanelId, number> = { shelf: 1, tray: 1, sidebar: 1, conversation: 1 };

/** Where the guide was asked for: its panel instance, and the element to give the focus back to. */
export interface PanelGuideRequest {
  panel: PanelId;
  hostId?: string | null;
  sessionId?: string | null;
  paneId?: string | null;
  shelfId?: string | null;
  opener?: HTMLElement | null;
  /** Start at this step (0-based; the 「接下来」 menu opens the conversation guide at its queue step). */
  step?: number;
}

/** What a step's text may depend on: the agent / host it is about (capabilities, runtime). */
export interface PanelGuideContext {
  steer: boolean;
  stopHold: boolean;
  agentPause: boolean;
  runtime: AgentRuntime | null;
  mod: string;
}

export interface PanelStep {
  id: string;
  title: MessageKey;
  body: MessageKey;
  /** A line under the body that always shows (a name to tell apart, a rule not to miss). */
  note?: MessageKey;
  /** Folded details (「查看区别」 / 「详细说明」). */
  detail?: MessageKey;
  detailLabel?: MessageKey;
  /** The real control it is about, inside the request's panel (null: not on screen now → the card says so). */
  target?(scope: HTMLElement, request: PanelGuideRequest): HTMLElement | null;
  /** 「试一试：…」: the card steps aside (focus to the target) until 「继续指南」. */
  tryIt?: MessageKey;
  /** Text for what this agent / host can do. */
  variant?(ctx: PanelGuideContext): Partial<Pick<PanelStep, "body" | "detail" | "note">>;
}

export interface PanelGuideDef {
  id: PanelId;
  /** 「Shelf 小指南」 */
  title: MessageKey;
  /** 帮助's line. */
  text: MessageKey;
  steps: readonly PanelStep[];
}

// ── Finding things in the request's panel ─────────────────────────────────────────────────────────

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Laid out and not inert / hidden — on screen or not (scrolled out of a list counts). */
export function rendered(el: Element | null | undefined): el is HTMLElement {
  if (!isHTMLElement(el) || !el.isConnected) return false;
  if (el.closest("[inert], [hidden], [aria-hidden=true], [data-tray-overflow], [data-tray-overflow-hide]")) return false;
  if (!el.getClientRects().length) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * The part of `el` that can be seen: its box cut by the window and by every ancestor that clips it (the sidebar's
 * scrolled list, a panel). null: none of it. A row scrolled out of the list still has a box inside the window — above
 * the list, under the toolbar — so the window alone is not enough (owner 2026-10-27: the sidebar guide's frame sat over
 * the blank strip above the search box).
 */
export function visibleBox(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  let left = Math.max(r.left, 0);
  let top = Math.max(r.top, 0);
  const view = ownerWindowOf(el);
  let right = Math.min(r.right, view.innerWidth);
  let bottom = Math.min(r.bottom, view.innerHeight);
  // A fixed element is clipped by none of its ancestors (none of the guides' targets has a transformed one).
  if (getComputedStyle(el).position !== "fixed") {
    for (let p = el.parentElement; p && p !== view.document.body && p !== view.document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      const x = s.overflowX && s.overflowX !== "visible";
      const y = s.overflowY && s.overflowY !== "visible";
      if (x || y) {
        const b = p.getBoundingClientRect();
        if (x) (left = Math.max(left, b.left), (right = Math.min(right, b.right)));
        if (y) (top = Math.max(top, b.top), (bottom = Math.min(bottom, b.bottom)));
      }
      if (s.position === "fixed") break;
    }
  }
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** Hit-test grid over a target's visible box (columns × rows): enough for a row half under the Shelf drawer. */
const GRID = { cols: 5, rows: 3 };

/**
 * The part of `seen` (el's visible box) not under something else — the Shelf drawn over the conversation in a narrow
 * window, a menu: the cells of a hit-test grid whose middle hits `el` (or what it is in), as one box. null: all of it is
 * under something. The guide's own card does not count; pointer-events: none layers are not hit; an empty aria-hidden
 * layer only dims (the drawer's scrim: what is under it can still be seen).
 */
export function uncoveredBox(el: Element, seen: Box): Box | null {
  if (typeof document.elementsFromPoint !== "function") return seen;
  const dims = (e: Element) => e.getAttribute("aria-hidden") === "true" && !e.childElementCount && !e.textContent?.trim();
  // A layer the pointer goes through (the queue's insert slot over its header) is never hit: what it lies on counts.
  const own = getComputedStyle(el).pointerEvents === "none" ? (el.parentElement ?? el) : el;
  const w = seen.width / GRID.cols;
  const h = seen.height / GRID.rows;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < GRID.cols; i++) {
    for (let j = 0; j < GRID.rows; j++) {
      const x = seen.left + (i + 0.5) * w;
      const y = seen.top + (j + 0.5) * h;
      const hit = own.ownerDocument.elementsFromPoint(x, y).find((e) => !e.closest("[data-panel-guide]") && !dims(e));
      if (hit && !own.contains(hit) && !hit.contains(own)) continue;
      left = Math.min(left, seen.left + i * w);
      right = Math.max(right, seen.left + (i + 1) * w);
      top = Math.min(top, seen.top + j * h);
      bottom = Math.max(bottom, seen.top + (j + 1) * h);
    }
  }
  return left === Infinity ? null : { left, top, width: right - left, height: bottom - top };
}

/** What the frame outlines: the part of `el` in view and not under something else (null: none — not on screen now). */
export function shownBox(el: Element | null | undefined): Box | null {
  if (!rendered(el)) return null;
  const seen = visibleBox(el);
  return seen && uncoveredBox(el, seen);
}

/** Laid out, not inert / hidden, at least partly in view (window and clipping ancestors) and not under something else. */
export function usable(el: Element | null | undefined): el is HTMLElement {
  return !!shownBox(el);
}

/** Whether all of `el` shows (`shown` = its shownBox). */
function whole(el: HTMLElement, shown: Box): boolean {
  const r = el.getBoundingClientRect();
  return shown.width >= r.width - 1 && shown.height >= r.height - 1;
}

/**
 * The best match of `selectors` (in order: a later selector only when an earlier one has no match at all) inside
 * `scope`: one wholly in view, else one partly in view, else one scrolled out (the card scrolls it in: PanelGuideHost).
 * One all under something else is no match (the next selector, else the card says it is not on screen).
 */
export function pick(scope: ParentNode, ...selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    let partly: HTMLElement | null = null;
    let out: HTMLElement | null = null;
    for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
      if (!rendered(el)) continue;
      const seen = visibleBox(el);
      const shown = seen && uncoveredBox(el, seen);
      if (shown && whole(el, shown)) return el;
      if (shown) partly ??= el;
      else if (!seen) out ??= el;
    }
    if (partly || out) return partly ?? out;
  }
  return null;
}

const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));

/** The conversation pane `paneId`: its header's nearest ancestor that also holds its composer. */
function conversationRoot(paneId: string | null | undefined): HTMLElement | null {
  const header = paneId ? queryAppWindows<HTMLElement>(`[data-conv-header="${esc(paneId)}"]`) : null;
  if (!header) return null;
  for (let el = header.parentElement; el && el !== header.ownerDocument.body; el = el.parentElement) {
    if (el.querySelector("[data-composer-block]")) return el;
    if (el.matches("[data-conv-pane]")) return el;
  }
  return header.parentElement;
}

/** The panel instance the request is about (null: it is gone → the guide closes). */
export function panelScope(request: PanelGuideRequest): HTMLElement | null {
  switch (request.panel) {
    case "shelf": {
      const id = request.shelfId;
      if (id) return queryAppWindows<HTMLElement>(`[data-shelf="${esc(id)}"]`);
      if (request.paneId) {
        const empty = queryAppWindows<HTMLElement>(`[data-shelf-rail-empty][data-ws-shelf="${esc(request.paneId)}"]`);
        if (empty) return empty;
      }
      return pick(document, "[data-shelf]", "[data-shelf-rail-empty]");
    }
    case "tray":
      return queryAppWindows<HTMLElement>("[data-tray-frame]");
    case "sidebar":
      return queryAppWindows<HTMLElement>("[data-sidebar-mode]");
    case "conversation":
      return conversationRoot(request.paneId);
  }
}

// ── The four guides ───────────────────────────────────────────────────────────────────────────────

const k = (s: string) => s as MessageKey;
const step = (panel: PanelId, id: string, rest: Omit<PanelStep, "id" | "title" | "body"> = {}): PanelStep => ({
  id,
  title: k(`onboarding.panel.${panel}.${id}.title`),
  body: k(`onboarding.panel.${panel}.${id}.body`),
  ...rest,
});

const SHELF: PanelGuideDef = {
  id: "shelf",
  title: k("onboarding.panel.shelf.title"),
  text: k("onboarding.panel.shelf.text"),
  steps: [
    step("shelf", "home", { target: (s) => pick(s, "[data-shelf-avatar]", "[data-shelf-page-on]", "[data-shelf-page]", "[data-shelf-rail-launch]") }),
    step("shelf", "drag", {
      detail: k("onboarding.panel.shelf.drag.detail"),
      tryIt: k("onboarding.panel.shelf.drag.try"),
      target: (s) => pick(s, "[data-side-tab-row]", "[data-side-card-head]"),
    }),
    step("shelf", "size", { target: (s) => pick(s, "[data-guide-target=shelf-width]", "[data-side-gap]") }),
    step("shelf", "pages", { target: (s) => pick(s, "[data-shelf-add]", "[data-shelf-page]") }),
    step("shelf", "pin", { target: (s) => pick(s, "[data-shelf-page-pin]", "[data-shelf-page-on]", "[data-shelf-page]") }),
  ],
};

const TRAY: PanelGuideDef = {
  id: "tray",
  title: k("onboarding.panel.tray.title"),
  text: k("onboarding.panel.tray.text"),
  steps: [
    step("tray", "back", {
      note: k("onboarding.panel.tray.back.note"),
      target: (s) => pick(s, "[data-tray-slot=agent] [data-tray-item]:not([data-mark=pinned])", "[data-tray-item]", "[data-pane-tray]"),
    }),
    step("tray", "minimize", {
      // The conversation's 「—」 (not pressed for the user), else the tray item it comes back to.
      target: (s) => pick(document, "[data-pane-minimize]") ?? pick(s, "[data-tray-slot=agent] [data-tray-item]"),
    }),
    step("tray", "pin", { target: (s) => pick(s, "[data-tray-pin]", "[data-tray-slot] [data-tray-item][data-mark=pinned]", "[data-tray-item]") }),
    step("tray", "place", { target: (s) => pick(s, "[data-tray-grip]", "[data-tray-handle]") ?? pick(document, "[data-tray-handle]") }),
    step("tray", "more", { target: (s) => pick(s, "[data-tray-more]") }),
  ],
};

const SIDEBAR: PanelGuideDef = {
  id: "sidebar",
  title: k("onboarding.panel.sidebar.title"),
  text: k("onboarding.panel.sidebar.text"),
  steps: [
    step("sidebar", "find", { target: (s) => pick(s, "[data-sidebar-search]", "section[data-group-key] > div:first-child") }),
    // The row itself (Ctrl+click, its 「在旁边打开」 button, dragging it): the button shows only while the row is hovered,
    // so outlining it made the frame jump from row to row under the pointer.
    step("sidebar", "beside", { target: (s) => pick(s, "[data-row-selectable]") }),
    step("sidebar", "status", { detail: k("onboarding.panel.sidebar.status.detail"), target: (s) => pick(s, "[data-row-selectable]") }),
    step("sidebar", "pause", {
      detail: k("onboarding.panel.sidebar.pause.detail"),
      detailLabel: k("onboarding.panel.compare"),
      target: (s) => pick(s, "[data-row-selectable]"),
      variant: (c) => (c.agentPause ? {} : { body: k("onboarding.panel.sidebar.pause.bodyNoPause") }),
    }),
    step("sidebar", "runtime", {
      note: k("onboarding.panel.sidebar.runtime.note"),
      detail: k("onboarding.panel.sidebar.runtime.detail"),
      detailLabel: k("onboarding.panel.compare"),
      target: (s) => pick(s, "[data-row-selectable]"),
    }),
  ],
};

const CONVERSATION: PanelGuideDef = {
  id: "conversation",
  title: k("onboarding.panel.conversation.title"),
  text: k("onboarding.panel.conversation.text"),
  steps: [
    step("conversation", "move", { tryIt: k("onboarding.panel.conversation.move.try"), target: (s) => pick(s, "[data-conv-header]") }),
    step("conversation", "queue", { target: (s) => pick(s, "[data-testid=queue-header]") }),
    step("conversation", "steer", {
      detail: k("onboarding.panel.conversation.steer.detail"),
      target: (s) => pick(s, "[data-testid=queue-header]", "[data-composer-block]"),
      variant: (c) => (c.steer ? {} : { body: k("onboarding.panel.conversation.steer.bodyNoSteer") }),
    }),
    step("conversation", "order", { detail: k("onboarding.panel.conversation.order.detail"), target: (s) => pick(s, "[data-insert-slot]", "[data-testid=queue-header]") }),
    step("conversation", "stop", {
      target: (s) => pick(s, "[data-testid=queue-header-resume]", "[data-testid=paused-section]", "[data-composer-block]"),
      variant: (c) => (c.stopHold ? {} : { body: k("onboarding.panel.conversation.stop.bodyNoHold") }),
    }),
    step("conversation", "mode", {
      target: (s) => pick(s, "[data-guide-target=composer-mode]")?.closest("button") ?? null,
      variant: (c) => (c.runtime === "claude" ? { body: k("onboarding.panel.conversation.mode.bodyClaude") } : {}),
    }),
    step("conversation", "rules", {
      detail: k("onboarding.panel.conversation.rules.detail"),
      target: (s) => pick(s, "[data-testid=claude-rules-chip]")?.closest("button") ?? null,
      variant: (c) => (c.runtime === "claude" ? { body: k("onboarding.panel.conversation.rules.bodyClaude"), detail: k("onboarding.panel.conversation.rules.detailClaude") } : {}),
    }),
  ],
};

export const PANEL_GUIDES: Record<PanelId, PanelGuideDef> = { shelf: SHELF, tray: TRAY, sidebar: SIDEBAR, conversation: CONVERSATION };

/** The step as it reads for this agent / host. */
export function stepText(s: PanelStep, ctx: PanelGuideContext): Pick<PanelStep, "title" | "body" | "note" | "detail"> {
  return { title: s.title, body: s.body, note: s.note, detail: s.detail, ...(s.variant?.(ctx) ?? {}) };
}

/** Capabilities of the request's agent (the conversation's, else the open one's). Unknown = the newer behaviour. */
export function guideContext(request: PanelGuideRequest, app = useApp.getState()): PanelGuideContext {
  const hostId = request.hostId ?? app.selectedHost ?? app.hosts?.active ?? null;
  const sessionId = request.sessionId ?? app.selectedId ?? null;
  const sidebar = hostId ? sidebarOf(app, hostId) : null;
  const session = sidebar && sessionId ? [...sidebar.active, ...sidebar.retired].find((r) => r.cutexSessionId === sessionId) ?? null : null;
  const features = hostId ? featuresOf(app, hostId) : new Set<string>();
  return {
    steer: !session || !lacks(agentFeaturesOf(session), "turnSteer"),
    stopHold: features.has(STOP_HOLD_FEATURE),
    agentPause: agentPauseSupported(app, hostId),
    runtime: session ? runtimeOf(session) : null,
    mod: newInstanceKey().replace(/\+$/, ""),
  };
}

// ── The open guide ────────────────────────────────────────────────────────────────────────────────

export interface PanelGuideState {
  request: PanelGuideRequest;
  step: number;
  /** 「试一试」: the card is a one-line strip until 「继续指南」. */
  trying: boolean;
  /** Changes with every open (a new open of the same guide starts over). */
  nonce: number;
}

let open: PanelGuideState | null = null;
let nonce = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePanelGuide(): PanelGuideState | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => open,
    () => open,
  );
}

export function panelGuideNow(): PanelGuideState | null {
  return open;
}

/** Opens a guide (another one open: replaced — one at a time); from step 1 unless `step`. */
export function openPanelGuide(request: PanelGuideRequest): void {
  const steps = PANEL_GUIDES[request.panel].steps.length;
  const at = Math.max(0, Math.min(steps - 1, request.step ?? 0));
  open = { request, step: at, trying: false, nonce: ++nonce };
  emit();
}

export function closePanelGuide(): void {
  if (!open) return;
  open = null;
  emit();
}

export function setPanelGuideStep(step: number): void {
  if (!open) return;
  const steps = PANEL_GUIDES[open.request.panel].steps.length;
  open = { ...open, step: Math.max(0, Math.min(steps - 1, step)), trying: false };
  emit();
}

export function setPanelGuideTrying(trying: boolean): void {
  if (!open || open.trying === trying) return;
  open = { ...open, trying };
  emit();
}

/** 「知道了」 on the last step: recorded for 帮助, then closed. */
export function finishPanelGuide(): void {
  if (!open) return;
  markGuideSeen(panelSeenId(open.request.panel));
  closePanelGuide();
}

export const panelSeenId = (panel: PanelId): string => `panel.${panel}@${PANEL_GUIDE_VERSION[panel]}`;

export function panelGuideDone(panel: PanelId, seen: readonly string[] = getGuides().seen): boolean {
  return seen.includes(panelSeenId(panel));
}

/** Drags in progress (a real one the guide must not close under: Esc is theirs first). */
export function dragInProgress(): boolean {
  return sideDragging() || !!queryAppWindows("[data-tray-drop]");
}
