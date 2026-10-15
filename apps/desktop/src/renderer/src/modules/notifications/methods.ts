// The built-in device methods (`notify.method` slot items): desktop notification, sound, big alert.
// In Electron the desktop notification and the big alert run in main (shell ops `notify` /
// `eventAlert`: they work while the window is hidden to the tray); in the browser preview the desktop
// notification is a web Notification and there is no big alert window (unsupported).
import { bridge } from "../../bridge";
import { chimeSupported, playChime } from "../../lib/chime";
import { runClick } from "../../lib/notifyEvents";
import { retractMatches, type RetractRequest } from "../../../../shared/notificationLevels";
import type { NotifyDelivery, NotifyMethodAvailability, NotifyMethodItem } from "../slots";

/** Electron `Notification.isSupported()` from the shell state (true until it is known). */
let mainSupported = true;

/** Read what main can do (module activation). */
export async function loadMethodSupport(): Promise<void> {
  try {
    const state = await bridge.shell?.state();
    if (state) mainSupported = state.notificationsSupported !== false;
  } catch {
    // keep the last value
  }
}

function webPermission(): NotifyMethodAvailability {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "ok";
  return Notification.permission === "denied" ? "unsupported" : "needsPermission";
}

/** Web notifications shown in the preview (closed by a retract); bounded. */
const webShown = new Map<string, Notification>();

function webNotify(n: NotifyDelivery): void {
  const shown = new Notification(n.title, { body: n.body, tag: n.key, silent: true });
  shown.onclick = () => {
    window.focus();
    runClick(n.key);
  };
  webShown.delete(n.key);
  webShown.set(n.key, shown);
  while (webShown.size > 50) webShown.delete(webShown.keys().next().value as string);
}

/**
 * The owner handled it in the app: main closes the event big alerts and desktop notifications it
 * names (and owner_notify big alerts of closed records); the preview closes its web notifications.
 */
export function retractDelivered(retract: RetractRequest): void {
  void bridge.shell?.retractAlerts?.(retract).catch(() => {});
  for (const [key, shown] of [...webShown]) {
    if (!retractMatches(key, retract)) continue;
    webShown.delete(key);
    shown.close();
  }
}

export const desktopMethod: NotifyMethodItem = {
  id: "notifications.desktop",
  order: 100,
  method: "desktop",
  titleKey: "notifications.method.desktop",
  available: () => (bridge.shell?.notify ? (mainSupported ? "ok" : "unsupported") : webPermission()),
  requestPermission: async () => {
    if (!bridge.shell?.notify && typeof Notification !== "undefined") await Notification.requestPermission();
  },
  deliver: (n) => {
    if (bridge.shell?.notify) void bridge.shell.notify({ key: n.key, title: n.title, body: n.body });
    else if (webPermission() === "ok") webNotify(n);
  },
};

export const soundMethod: NotifyMethodItem = {
  id: "notifications.sound",
  order: 200,
  method: "sound",
  titleKey: "notifications.method.sound",
  available: () => (chimeSupported() ? "ok" : "unsupported"),
  deliver: (n) => playChime(n.level === "urgent"),
};

export const bigAlertMethod: NotifyMethodItem = {
  id: "notifications.bigAlert",
  order: 300,
  method: "bigAlert",
  titleKey: "notifications.method.bigAlert",
  available: () => (bridge.shell?.eventAlert ? "ok" : "unsupported"),
  deliver: (n) => void bridge.shell?.eventAlert?.({ key: n.key, agentId: n.agentId, agentName: n.agentName ?? "Cutex", title: n.eventTitle || n.title, text: n.body, sound: n.sound }),
};
