// Desktop notifications from the main process (Electron `Notification`): reliable while the window
// is hidden to the tray, unlike the renderer's web Notification. The renderer's notifications module
// decides what to show (cutex notification levels + this device's off switches) and calls the narrow
// shell op `notify`; a click shows the window and sends `notifyClick` back with the key.
// Always silent: sound is its own method (the renderer plays it when the matrix says so).
import { Notification } from "electron";
import type { ShellNotification } from "../shared/ipc";
import { retractMatches, type RetractRequest } from "../shared/notificationLevels";
import type { DesktopShell } from "./shell";

/** Shown notifications are kept referenced (a GC'd Notification loses its click handler on Windows). */
const MAX_KEPT = 50;

export class DesktopNotifications {
  private readonly shown = new Map<string, Notification>();

  constructor(
    private readonly shell: DesktopShell,
    private readonly onClick: (key: string) => void,
  ) {}

  supported(): boolean {
    try {
      return Notification.isSupported();
    } catch {
      return false;
    }
  }

  show(n: ShellNotification): void {
    if (!this.supported()) return;
    // Same key = an update of the same thing: replace instead of stacking.
    this.shown.get(n.key)?.close();
    this.shown.delete(n.key);
    const notification = new Notification({ title: n.title, body: n.body, silent: true, icon: this.shell.appIcon() });
    notification.on("click", () => {
      this.shell.show();
      this.onClick(n.key);
      this.shown.delete(n.key);
    });
    notification.on("close", () => {
      if (this.shown.get(n.key) === notification) this.shown.delete(n.key);
    });
    this.shown.set(n.key, notification);
    while (this.shown.size > MAX_KEPT) {
      const oldest = this.shown.keys().next().value as string;
      this.shown.delete(oldest);
    }
    notification.show();
  }

  /** The owner handled it in the app: close the notifications it named (shell op `retractAlerts`). */
  retract(retract: Pick<RetractRequest, "keys" | "prefixes">): void {
    for (const [key, notification] of [...this.shown]) {
      if (!retractMatches(key, retract)) continue;
      this.shown.delete(key);
      notification.close();
    }
  }
}
