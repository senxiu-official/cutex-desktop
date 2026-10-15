// The notifications module at run time: loads the host's tables, migrates the old desktop prefs once,
// and executes occurrences (lib/notifyEvents) — host decision (cutex evaluate, or the r216 fallback on
// a cutex without notification levels) → this device's off switches → the `notify.method` items.
import { currentLocale } from "../../i18n";
import { bridge, api } from "../../bridge";
import { refreshNotificationLevels, patchNotificationLevels, resetNotificationLevels, useNotificationLevels } from "../../lib/notificationLevelsStore";
import { loadDeviceOff, deviceOff } from "../../lib/notifyDevice";
import { rememberClick, runClick, setNotifyHandler, setRetractHandler, type NotifyOccurrence, type NotifyRetraction } from "../../lib/notifyEvents";
import { decideLocally, devicePlan, isNotificationLevel, LEGACY_NOTIFY_KEY, localText, migrationPatch, NOTIFICATION_LEVELS_FEATURE, retractMatches, type DeviceMethod, type NotificationLevel, type NotificationLevelsView, type RetractRequest } from "../../../../shared/notificationLevels";
import { appModules } from "../app";
import type { AppModuleContext, NotifyDelivery, NotifyMethodItem } from "../slots";
import { loadMethodSupport, retractDelivered } from "./methods";

/** Available device method items by method id (slot order; the first one per method wins). */
export function methodItems(): Map<DeviceMethod, NotifyMethodItem> {
  const out = new Map<DeviceMethod, NotifyMethodItem>();
  for (const entry of appModules().snapshot("notify.method")) if (entry.mode === "show" && !out.has(entry.item.method)) out.set(entry.item.method, entry.item);
  return out;
}

/** A key main accepts (`[A-Za-z0-9._:@-]`, ≤ 160). */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._:@-]/g, "_").slice(0, 160) || "n";
}

/** A key prefix main accepts: the same characters, ends with ":" (null when nothing is left). */
export function safePrefix(prefix: string): string | null {
  const p = prefix.replace(/[^A-Za-z0-9._:@-]/g, "_").slice(0, 160);
  return p.length > 1 && p.endsWith(":") ? p : null;
}

/** A retraction in the form main checks (keys / prefixes as `deliver` sends them). */
export function retractRequestOf(r: NotifyRetraction): RetractRequest {
  return {
    keys: [...new Set((r.keys ?? []).map(safeKey))],
    prefixes: [...new Set((r.prefixes ?? []).map(safePrefix).filter((p): p is string => !!p))],
    notes: r.notes ?? [],
  };
}

// The host's decision is asynchronous: a retract that lands meanwhile (answered at once, agent opened)
// must stop the delivery that is still on its way.
let retractSeq = 0;
const recentRetracts: { seq: number; retract: RetractRequest }[] = [];

/** Remember a retraction (the last 100) and return its sequence number. */
export function noteRetract(retract: RetractRequest): number {
  recentRetracts.push({ seq: ++retractSeq, retract });
  if (recentRetracts.length > 100) recentRetracts.shift();
  return retractSeq;
}

/** Current retraction sequence (taken when an occurrence arrives). */
export function retractMark(): number {
  return retractSeq;
}

/** Whether `key` (safeKey form) was retracted after `since`. */
export function retractedSince(key: string, since: number): boolean {
  return recentRetracts.some((r) => r.seq > since && retractMatches(key, r.retract));
}

function eventTitle(view: NotificationLevelsView | null, event: string): string {
  const spec = view?.events.find((e) => e.id === event);
  return spec ? localText(spec.title, currentLocale()) : "";
}

/** Run the device methods for decided actions. */
export function deliver(occ: NotifyOccurrence, decided: { level: NotificationLevel; actions: string[]; event: string }): void {
  const items = methodItems();
  const actions = decided.actions.filter((a) => !occ.skip?.includes(a));
  const plan = devicePlan(actions, { off: deviceOff(), looking: occ.looking, available: (m) => items.get(m)?.available() === "ok" });
  if (!plan.methods.length) return;
  const key = safeKey(occ.key);
  rememberClick(key, occ.onClick);
  const delivery: NotifyDelivery = {
    key,
    event: decided.event,
    eventTitle: eventTitle(useNotificationLevels.getState().view, decided.event),
    level: decided.level,
    title: occ.title,
    body: occ.body,
    agentId: occ.agentId,
    agentName: occ.agentName,
    sound: plan.alertSound,
    onClick: occ.onClick,
  };
  for (const method of plan.methods) {
    try {
      items.get(method)?.deliver(delivery);
    } catch (error) {
      console.warn(`[notifications] ${method} failed`, error);
    }
  }
}

/** A host decision; `tables` false = not decided by the host's notification levels (fallback). */
export interface OccurrenceDecision {
  level: NotificationLevel;
  actions: string[];
  event: string;
  tables: boolean;
}

/** Whether an occurrence leaves its in-app mark: the tables' `mark` method, or always without tables. */
export function markWanted(decision: Pick<OccurrenceDecision, "actions" | "tables"> | null): boolean {
  return !decision || !decision.tables || decision.actions.includes("mark");
}

/**
 * Host decision for an occurrence: the tables of the host it happened on (v1.5 `ctx.hosts`: the focus
 * host, or a connected host outside the scope — multi-host RFC §9.4).
 */
export async function decide(occ: NotifyOccurrence, ctx: Pick<AppModuleContext, "hosts" | "services">): Promise<OccurrenceDecision | null> {
  if (occ.decided) return { ...occ.decided, event: occ.events[0] ?? "", tables: true };
  const focus = ctx.hosts.list().find((h) => h.focus);
  const other = occ.hostId !== undefined && occ.hostId !== focus?.id;
  const host = other ? ctx.hosts.get(occ.hostId!) : focus;
  // r216 behaviour of this desktop on a cutex without notification levels.
  if (!host?.features.has(NOTIFICATION_LEVELS_FEATURE)) return { level: "needsYou", actions: occ.fallback, event: occ.events[0] ?? "", tables: false };
  if (!occ.events.length) return null;
  try {
    const daemon = other ? ctx.services.daemonFor(host.id) : api;
    const d = await daemon.evaluateNotification({ events: occ.events, agentId: occ.agentId, ...(occ.projectId !== undefined ? { projectId: occ.projectId } : {}) });
    return { level: d.level, actions: d.actions, event: d.event, tables: true };
  } catch {
    // Another host unreachable meanwhile: its fallback. Its tables are not loaded here.
    if (other) return { level: "needsYou", actions: occ.fallback, event: occ.events[0] ?? "", tables: false };
    // Unreachable / an event this cutex does not know: the fetched tables decide.
    const view = useNotificationLevels.getState().view;
    if (!view) return null;
    const d = decideLocally(view, occ.events, { projectId: occ.projectId });
    return { level: d.level, actions: d.actions, event: d.event, tables: true };
  }
}

/** One-time: the old desktop `mutedProjects` become cutex project mutes; the old switches go. */
async function migrateLegacyPrefs(view: NotificationLevelsView): Promise<void> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LEGACY_NOTIFY_KEY);
  } catch {
    return;
  }
  if (stored === null) return;
  const patch = migrationPatch(stored, view.settings.projectOverrides);
  try {
    if (patch) await patchNotificationLevels(patch);
    localStorage.removeItem(LEGACY_NOTIFY_KEY);
  } catch {
    // try again on the next activation
  }
}

/** activate(): everything the module runs is tied to ctx.signal (host / capability change restarts it). */
export function startNotifications(ctx: AppModuleContext): void {
  const supported = !!ctx.hosts.list().find((h) => h.focus)?.features.has(NOTIFICATION_LEVELS_FEATURE);
  resetNotificationLevels(supported);
  void loadDeviceOff();
  void loadMethodSupport();
  if (supported) {
    void refreshNotificationLevels().then((view) => {
      if (view && !ctx.signal.aborted) void migrateLegacyPrefs(view);
    });
  }
  const offHandler = setNotifyHandler((occ) => {
    const since = retractMark();
    void decide(occ, ctx)
      .catch(() => null)
      .then((d) => {
        // The mark is state, not a popup: left even when the module restarted meanwhile.
        if (occ.mark && markWanted(d)) occ.mark();
        // Handled while the host decided (answered at once, agent opened): nothing pops up.
        if (retractedSince(safeKey(occ.key), since)) return;
        if (d && !ctx.signal.aborted && isNotificationLevel(d.level)) deliver(occ, d);
      });
  });
  const offRetract = setRetractHandler((r) => {
    const retract = retractRequestOf(r);
    noteRetract(retract);
    retractDelivered(retract);
  });
  // (no bridge events in unit tests)
  const offClick = typeof bridge.on === "function" ? bridge.on("notifyClick", ({ key }) => runClick(key)) : () => {};
  ctx.signal.addEventListener("abort", () => {
    offHandler();
    offRetract();
    offClick();
    resetNotificationLevels(false);
  });
}

/** Settings test buttons: run one method now (the host's tables are not asked; the device switch is). */
export function testMethod(method: DeviceMethod, text: { title: string; body: string }): void {
  const item = methodItems().get(method);
  if (!item || item.available() !== "ok" || deviceOff()[method]) return;
  const key = `test:${method}:${Date.now()}`;
  item.deliver({ key, event: "", eventTitle: text.title, level: "urgent", title: text.title, body: text.body, agentId: null, agentName: "Cutex", sound: method === "bigAlert" && !deviceOff().sound });
}
