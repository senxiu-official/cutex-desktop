// Opening what a tile points at, as a pane (panes-20261019.md §5: 点磁贴 = 打开对应窗格): an agent → its
// conversation pane (the empty pane behind the desktop takes it); a service → the in-app browser on that
// service (or a template action's path inside it); an artifact → its tab; a link → a browser tab; a page →
// through the module that owns it (lib/pagePins, e.g. a project's overview pane). Each
// goes through the module services (refs / panes), never another module's code.
import type { HomePin } from "../../../../shared/home";
import { translate, type MessageKey } from "../../i18n";
import { openServiceExternal } from "../../lib/services";
import { showShelfToast } from "../../lib/shelves";
import { sideShowsHost } from "../../lib/sideServices";
import { services } from "../app";
import { openRefWhy } from "../../lib/workspaces";
import { pagePinKindNow } from "../../lib/pagePins";
import { parsePagePinKey } from "../../../../shared/home";
import { dockRef, type OpenMode } from "./dockModes";

const BROWSER_TAB = "browser.tab";

// A refs reason (lib/refServices, lib/sideServices) → the words for it; the rest share one.
const REASONS: Readonly<Record<string, string>> = {
  gone: "gone",
  reverted: "reverted",
  "module-off": "module-off",
  "unknown-kind": "module-off",
  capability: "capability",
  "agent-feature": "capability",
  "host-offline": "host-offline",
  "host-changed": "host-changed",
  "bad-ref": "bad-ref",
  "bad-params": "bad-ref",
  stale: "stale",
};

/**
 * 「打不开（…）」 with the reason in words (owner 2026-10-25: 「unavailable」 told nothing). A refs reason code
 * gets its sentence; any other text (an error's message) is shown as it is.
 */
export function openFailedText(reason: string): string {
  const code = /^[a-z][a-z-]*$/.test(reason) ? (REASONS[reason] ?? "unknown") : null;
  return translate("home.openFailed", { reason: code ? translate(`home.openFailed.${code}` as MessageKey) : reason });
}

/**
 * A tray / desktop open that failed: the toast above the tray (lib/shelves), where the click was — not the
 * composer's notice (owner 2026-10-25: it showed as a red chip inside the input box, next to 发送).
 */
export function showOpenFailed(text: string): void {
  showShelfToast(text);
}

/**
 * A service pin of a host the Shelf does not show now: the open agent is another host's (lib/sideServices
 * sideShowsHost), so an in-app tab bound to the pin's host would land out of view and the open is refused
 * (owner 2026-10-25: 「打不开（unavailable）」 on the 看板 pin while a remote agent was open). It opens in the
 * system browser instead, like the 服务 page's 打开 (cutex starts an on-demand service first).
 */
export function serviceOutOfView(pin: HomePin): boolean {
  return pin.kind === "service" && !sideShowsHost(pin.hostId);
}

/** Opens a pin; a failure is a toast above the tray (`explain` turns a reason into text). */
export async function openPin(pin: HomePin, explain: (reason: string) => string, path = "/"): Promise<void> {
  try {
    if (serviceOutOfView(pin)) return await openServiceExternal({ slug: pin.key }, pin.hostId, path);
    switch (pin.kind) {
      case "agent": {
        const r = services.panes.open("core.conversation", { sessionId: pin.key, hostId: pin.hostId }, { focus: true });
        if (r.status !== "opened") showOpenFailed(explain(r.status === "unavailable" ? r.reason : r.status));
        return;
      }
      case "service": {
        const r = await services.refs.open({ hostId: pin.hostId, kind: "service", key: `${pin.key}${path === "/" ? "" : path}`, title: pin.title ?? pin.key, params: {} }, { how: "page" });
        if (r.status !== "opened") showOpenFailed(explain(r.status === "unavailable" ? r.reason : r.status));
        return;
      }
      case "artifact": {
        const r = await services.refs.open({ hostId: pin.hostId, kind: "artifact", key: pin.key, title: pin.title ?? pin.key, params: {} }, { how: "page" });
        if (r.status !== "opened") showOpenFailed(explain(r.status === "unavailable" ? r.reason : r.status));
        return;
      }
      case "page": {
        // The page's owner opens it (lib/pagePins); its module off: unavailable.
        const page = parsePagePinKey(pin.key);
        const kind = page ? pagePinKindNow(page.pageId) : undefined;
        if (!page || !kind || !(await kind.open(pin.hostId, page.arg))) showOpenFailed(explain(!page ? "bad-ref" : !kind ? "module-off" : "unavailable"));
        return;
      }
      case "url": {
        const r = services.side.open(BROWSER_TAB, { url: pin.key }, { binding: { kind: "host", hostId: pin.hostId }, reveal: true, focus: true });
        if (r.status !== "opened") showOpenFailed(explain(r.status === "unavailable" ? r.reason : r.status));
        return;
      }
    }
  } catch (e) {
    showOpenFailed(explain(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * A tray click with the item's 打开方式 (dock.ts): through the workspace model (lib/workspaces openRef) —
 * an agent: 替换 (the focused workspace switches to it) / 并排 (a workspace beside) / 投影 (a live pane in the
 * focused workspace's Shelf); a service or an artifact goes into the focused workspace's Shelf in every
 * mode. A link opens as a browser tab.
 */
export async function openPinAs(pin: HomePin, mode: OpenMode, explain: (reason: string) => string): Promise<void> {
  const ref = dockRef(pin);
  if (!ref || serviceOutOfView(pin)) return openPin(pin, explain);
  try {
    const failed = await openRefWhy(ref, mode);
    if (failed) showOpenFailed(explain(failed));
  } catch (e) {
    showOpenFailed(explain(e instanceof Error ? e.message : String(e)));
  }
}

/** A template action's link (`cutex:service/<slug><path>`, tile.ts) → the service pin's path. */
export function openTileAction(pin: HomePin, link: string, explain: (reason: string) => string): Promise<void> {
  const prefix = `cutex:service/${pin.key}`;
  return openPin(pin, explain, link.startsWith(prefix) ? link.slice(prefix.length) || "/" : "/");
}

export const PROFILE_KIND = "home.profile";

/** The 个人页 pane (single; in the tool area). */
export function openProfile(): void {
  services.panes.open(PROFILE_KIND, {}, { focus: true });
}
