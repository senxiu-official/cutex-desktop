// The action buttons of the onboarding flow (试一试, 添加 Profile, 已发布版本记录), the 新功能 cards, the guide tips
// (打开相关设置) and 帮助 (owner 2026-10-24: each must visibly do what it says). Every one is an id here, run by the
// app's own command — the Settings Shelf (store openSettings, as Settings' nav and ⌘K), the Shelf (the pane
// header's 「Shelf」 button: expandAll, and Ctrl+Shift+N newPage for an empty one). A precondition is run first
// (no conversation on screen: the last one opens) or, when it cannot be, the button is disabled with the reason
// (`guideActionBlocked`); never a silent no-op. Afterwards what opened flashes once.
import type { MessageKey } from "../i18n";
import { useApp, type SettingsTab } from "../store";
import { queryAppWindows } from "./appWindowSet";

export type GuideAction =
  /** A Settings page in the Settings Shelf; `create`: Profiles opens its 添加 form. */
  | { kind: "settings"; tab: SettingsTab; create?: boolean }
  /** The focused conversation's Shelf on screen: expanded, or a first (empty) page with the launchers. */
  | { kind: "shelf" };

/** The named actions of the flow, the 新版本 dialog and 帮助 (tips and 新功能 cards use `settingsAction`). */
export const GUIDE_ACTIONS = {
  "tour.groups": { kind: "settings", tab: "tray" },
  "tour.pages": { kind: "shelf" },
  "tour.more": { kind: "settings", tab: "whats-new" },
  "profile.add": { kind: "settings", tab: "profiles", create: true },
  "tour.allChanges": { kind: "settings", tab: "about" },
  "whatsNew.more": { kind: "settings", tab: "about" },
  "help.features": { kind: "settings", tab: "whats-new" },
} as const satisfies Record<string, GuideAction>;

export type GuideActionId = keyof typeof GUIDE_ACTIONS;

export const settingsAction = (tab: SettingsTab): GuideAction => ({ kind: "settings", tab });

/** The conversation the Shelf belongs to: the open one, else the last selected, else the first listed agent. */
function conversationTarget(): { sessionId: string; hostId: string | undefined } | null {
  const app = useApp.getState();
  if (app.selectedId) return { sessionId: app.selectedId, hostId: app.selectedHost ?? undefined };
  const first = app.sidebar?.active[0];
  return first ? { sessionId: first.cutexSessionId, hostId: app.hosts?.active ?? undefined } : null;
}

/** Why `action` cannot run now (shown under the disabled button), or null. */
export function guideActionBlocked(action: GuideAction): MessageKey | null {
  if (action.kind === "shelf" && !conversationTarget()) return "onboarding.action.needsAgent";
  return null;
}

/** Selectors of what an action shows, flashed once it is on screen. */
const SHOWN: Record<GuideAction["kind"], string> = {
  settings: "[data-settings-shelf]",
  shelf: "[data-shelf]:not([data-shelf-collapsed]), [data-side-box]",
};

/** Marks what opened for a moment (an accent ring), so the owner sees where it went. */
export function flashShown(selector: string, ms = 1800): void {
  let tries = 0;
  const find = () => {
    const el = queryAppWindows<HTMLElement>(selector);
    if (!el) return void (++tries < 20 && setTimeout(find, 50));
    el.setAttribute("data-guide-flash", "");
    if (typeof el.animate === "function") {
      el.animate([{ boxShadow: "0 0 0 3px var(--color-accent)" }, { boxShadow: "0 0 0 3px var(--color-accent)", offset: 0.6 }, { boxShadow: "0 0 0 0 transparent" }], { duration: ms, easing: "ease-out" });
    }
    setTimeout(() => el.removeAttribute("data-guide-flash"), ms);
  };
  setTimeout(find, 0);
}

/**
 * Runs `action` (its precondition first). False: it could not (the reason is `guideActionBlocked`'s, which the
 * button shows; it is not pressed then).
 */
export async function runGuideAction(action: GuideAction): Promise<boolean> {
  if (guideActionBlocked(action)) return false;
  if (action.kind === "settings") {
    if (action.create) useApp.getState().openSettings(action.tab, { create: true });
    else useApp.getState().openSettings(action.tab);
  } else {
    const app = useApp.getState();
    const target = conversationTarget()!;
    // The Shelf sits beside a conversation: back to it (or the last one) first.
    if (app.view.kind !== "conversation" || app.selectedId !== target.sessionId) await app.select(target.sessionId, target.hostId);
    (await import("./guideShelf")).showLiveShelf();
  }
  flashShown(SHOWN[action.kind]);
  return true;
}
