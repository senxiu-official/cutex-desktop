// Module activation: Ctrl+K (⌘K on macOS) anywhere opens the palette over everything; again (or Esc)
// closes it. The palette is its own small React root on <body> (no slot is needed for a window-level
// overlay: it mounts on open and unmounts on close, so it reads the current locale each time).
// A focused terminal keeps Ctrl+K (readline kill-line): xterm handles the key first and we skip
// handled keys (lib/browserCapture shortcutKeyUsed).
import { isImeComposing } from "../../lib/ime";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider, type MessageKey } from "../../i18n";
import { shortcutKeyUsed } from "../../lib/browserCapture";
import { isMac } from "../../lib/openModifiers";
import { isFullWindowPage } from "../../lib/paneKinds";
import { usePanes } from "../../lib/paneStore";
import { openServiceExternal } from "../../lib/services";
import { sideShowsHost } from "../../lib/sideServices";
import { openRef, screenOf } from "../../lib/workspaces";
import { agentEffect, refEffect } from "../../lib/workspaceEffects";
import type { Foretell } from "../../lib/foretell";
import type { AppModuleContext } from "../slots";
import { isQuickSwitchKey, parseRecent, planOpen, pushRecent, type OpenPlan, type QsItem, type QsScreen } from "./model";
import { runOpen } from "./open";
import { Palette } from "./Palette";
import { showShelfPage } from "./shelfPages";
import { activeAppWindow, onEveryAppWindow } from "../../lib/appWindowSet";
import { OwnerDocumentContext } from "../../lib/ownerContext";
import { isHTMLElement } from "../../lib/ownerWindow";

const RECENT_PREF = "recent";

let mounted: { root: Root; el: HTMLElement; opener: Element | null } | null = null;
let current: AppModuleContext | null = null;

export function isQuickSwitchOpen(): boolean {
  return mounted !== null;
}

/** Closes the palette; `restoreFocus`: back to what had the focus before (Esc / a click outside). */
export function closeQuickSwitch(restoreFocus = true): void {
  const m = mounted;
  if (!m) return;
  mounted = null;
  m.root.unmount();
  m.el.remove();
  if (restoreFocus && isHTMLElement(m.opener) && m.opener.isConnected) m.opener.focus({ preventScroll: true });
}

/** The workspaces on screen now (what Ctrl/⌘+↵ does depends on them; the palette is modal, so read once per open). */
function paletteScreen(): QsScreen {
  const screen = screenOf(usePanes.getState().layout);
  const other = screen.panes.length >= 2 ? screen.panes.find((p) => p.paneId !== screen.focused) : undefined;
  return { workspaces: screen.panes.length, otherHostId: other?.sessionId ? other.hostId : null, fullWindowPage: isFullWindowPage };
}

/**
 * What opening `item` does, computed once for the selected row's preview AND its open (docs/design/008-foretell.md):
 * an agent = lib/workspaceEffects agentEffect (替换 / 并排); a service / artifact / page going through lib/workspaces
 * openRef (beside) = refEffect (`onFail`: nothing opened). The plan runs that effect's `run`. Other opens (a Shelf
 * tab in place, the system browser, a Shelf page) foretell nothing and keep their plan.
 */
export function itemEffect(item: QsItem, beside: boolean, onFail?: (reason: string) => void): { foretell: Foretell | null; plan: OpenPlan } {
  const t = item.target;
  if (t.kind === "agent") {
    const e = agentEffect({ hostId: t.hostId, key: t.sessionId, title: item.title }, beside ? "beside" : "replace");
    return { foretell: e.foretell, plan: { via: "run", run: () => e.run() } };
  }
  const plan = planOpen(t, beside, sideShowsHost, item.title);
  if (plan.via !== "workspace") return { foretell: null, plan };
  const e = refEffect(plan.ref, plan.mode, { ...(plan.pageParams ? { pageParams: plan.pageParams } : {}), ...(onFail ? { onFail } : {}) });
  return { foretell: e.foretell, plan: { via: "run", run: () => e.run() } };
}

const itemForetell = (item: QsItem, beside: boolean): Foretell | null => itemEffect(item, beside).foretell;

/** Opens in `view`: the app window the owner is in (a desk window too, multi-window). */
export function openQuickSwitch(view: Window = activeAppWindow()): void {
  const ctx = current;
  if (mounted || !ctx || typeof document === "undefined") return;
  const doc = view.document;
  const el = doc.createElement("div");
  el.dataset.quickSwitch = "";
  doc.body.appendChild(el);
  const root = createRoot(el);
  mounted = { root, el, opener: doc.activeElement };
  const recent = parseRecent(ctx.prefs.get(RECENT_PREF, []));
  // Its subtree's window is `view` (lib/ownerContext): popovers, listeners and frames there too.
  root.render(createElement(OwnerDocumentContext.Provider, { value: doc }, createElement(I18nProvider, null, createElement(Palette, { recent, mac: isMac(), screen: paletteScreen(), showsHost: sideShowsHost, onClose: () => closeQuickSwitch(), onOpen: (item: QsItem, beside: boolean) => void openItem(ctx, item, beside), onDragOut: () => closeQuickSwitch(false), foretellOf: itemForetell, view }))));
}

async function openItem(ctx: AppModuleContext, item: QsItem, beside: boolean): Promise<void> {
  closeQuickSwitch(false);
  if (item.disabled) return;
  try {
    ctx.prefs.set(RECENT_PREF, pushRecent(parseRecent(ctx.prefs.get(RECENT_PREF, [])), item.id, Date.now()).map((r) => ({ id: r.id, at: r.at })));
  } catch {
    // storage full / off: recents are a convenience
  }
  // refEffect's open reports "unavailable" when nothing opened (lib/workspaces openRef false).
  const failed = (reason: string) => void (ctx.signal.aborted || notifyFailed(ctx, item, reason === "unavailable" ? "not-opened" : reason));
  const outcome = await runOpen(itemEffect(item, beside, failed).plan, {
    panesOpen: (kind, params, opts) => ctx.services.panes.open(kind, params, opts),
    refsOpen: (ref) => ctx.services.refs.open(ref),
    openServiceExternal: (slug, hostId) => openServiceExternal({ slug }, hostId),
    openShelfPage: (pageId) => showShelfPage(pageId),
    openRef: (ref, mode, opts) => openRef(ref, mode, opts),
  });
  if (outcome.ok || ctx.signal.aborted) return;
  notifyFailed(ctx, item, outcome.reason);
}

/** 「打不开 X：原因」 (`why`: "not-opened", a `side.reason.*` id, or an error message). */
function notifyFailed(ctx: AppModuleContext, item: QsItem, why: string): void {
  if (why === "not-opened") {
    ctx.services.ui.notice(ctx.t("quick-switch.failed", { name: item.title, reason: ctx.t("quick-switch.notOpened") }), "error");
    return;
  }
  const known = `side.reason.${why}`;
  const reason = /^[a-z-]+$/.test(why) ? ctx.t(known as MessageKey) : why;
  ctx.services.ui.notice(ctx.t("quick-switch.failed", { name: item.title, reason: reason === known ? why : reason }), "error");
}

export function startQuickSwitch(ctx: AppModuleContext): void {
  current = ctx;
  if (typeof window === "undefined") return;
  const onKey = (e: KeyboardEvent) => {
    if (mounted || isImeComposing(e) || shortcutKeyUsed(e) || !isQuickSwitchKey(e)) return;
    e.preventDefault();
    openQuickSwitch((e.currentTarget as Window | null) ?? window);
  };
  // Every app window (multi-window: desk windows too, lib/appWindowSet).
  const stopKeys = onEveryAppWindow((win) => {
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  });
  ctx.signal.addEventListener(
    "abort",
    () => {
      stopKeys();
      if (current === ctx) {
        current = null;
        closeQuickSwitch(false);
      }
    },
    { once: true },
  );
}
