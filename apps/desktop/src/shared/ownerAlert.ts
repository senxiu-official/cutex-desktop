// Big alert window ("雷霆大提醒", main/ownerAlert.ts): the narrow contract between main and the alert
// page (src/renderer/owner-alert.html + preload/ownerAlert.ts). The page only ever sees the alert
// records main hands it and can only ack / reply / open those.
import type { OwnerNotifyLevel } from "@cutex-desktop/protocol";

/** Page → main (invoke). */
export const OWNER_ALERT_CHANNEL = "cutex-desktop:owner-alert";
/** Main → page: the full alert state, sent whenever it changes. */
export const OWNER_ALERT_STATE = "cutex-desktop:owner-alert:state";

import type { AppLocale } from "./locales";

export type OwnerAlertLocale = AppLocale;

export interface OwnerAlertItem {
  notificationId: string;
  agentId: string;
  agentName: string;
  level: OwnerNotifyLevel;
  text: string;
  createdAt: string;
  needsReply: boolean;
  delegation: string | null;
  job: string | null;
  /** Desktop host id the record came from (owner_notify alerts; multi-host: actions go to that host). */
  hostId?: string;
  /** Demo alert (CUTEX_DESKTOP_DEMO_OWNER_ALERT): actions only close it locally. */
  demo?: boolean;
  /**
   * `event`: an urgent event that is not an owner_notify record (notifications module, shell op
   * `eventAlert`): no reply; 知道了 only closes it here; 打开 shows the app at it. Absent = owner_notify.
   */
  kind?: "event";
  /** Event alerts: what happened (replaces 「给你的消息」). */
  title?: string;
  /** Rings when it arrives; absent = the state's `sound` (older owner_notify records: bigAlertSound). */
  sound?: boolean;
}

export interface OwnerAlertState {
  locale: OwnerAlertLocale;
  /** Play the chime when a new alert without its own `sound` arrives (settings ownerNotify.bigAlertSound; off when this device turned sound off). */
  sound: boolean;
  /** Oldest first. */
  alerts: OwnerAlertItem[];
}

export type OwnerAlertRequest =
  | { op: "state" }
  | { op: "ack"; notificationId: string }
  | { op: "reply"; notificationId: string; text: string }
  | { op: "open"; notificationId: string };

export type OwnerAlertResult = { ok: true } | { ok: false; message: string };

/** `window.ownerAlert` in the alert page (preload/ownerAlert.ts). */
export interface OwnerAlertBridge {
  state(): Promise<OwnerAlertState>;
  onState(listener: (state: OwnerAlertState) => void): void;
  ack(notificationId: string): Promise<OwnerAlertResult>;
  reply(notificationId: string, text: string): Promise<OwnerAlertResult>;
  open(notificationId: string): Promise<OwnerAlertResult>;
}

export const OWNER_ALERT_SIZE = { width: 560, height: 340 } as const;
