// Big alert ("雷霆大提醒", owner-notify channel `bigAlert`; docs/research/owner-notify.md §4): an
// always-on-top frameless window over everything — also while the main window is hidden to the
// tray — for every open record whose channels contain "bigAlert", and (notification levels) for any
// urgent event the renderer's notifications module sends (`showEvent`, kind "event": 打开 / 知道了 only;
// `retract` takes one back once the owner handled it in the app).
// This device's off switches (DesktopPrefs.notifyOff) apply: bigAlert off = no window, sound off = silent. One window lists them (pager);
// it closes when none is left. Records come from the host feed (`cutex/ownerNotify/created|updated`,
// main/index.ts) and, on every (re)connect, from `GET /v2/owner-notifications?filter=alerting` (the
// ones missed while away). Ack / reply anywhere → `updated` → closed everywhere.
//
// The window loads src/renderer/owner-alert.html with its own narrow preload (preload/ownerAlert.ts):
// sandboxed, contextIsolation, no nodeIntegration, no navigation. Its IPC channel only accepts calls
// from that window and only for the alerts it shows.
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, screen, type WebContents } from "electron";
import type { EventEnvelope, OwnerNotification } from "@cutex-desktop/protocol";
import type { DaemonState, OwnerNotifyAction, ShellEventAlert } from "../shared/ipc";
import { OWNER_ALERT_CHANNEL, OWNER_ALERT_SIZE, OWNER_ALERT_STATE, type OwnerAlertItem, type OwnerAlertRequest, type OwnerAlertResult, type OwnerAlertState } from "../shared/ownerAlert";
import { applyAlertRecord, compareAlerts, deletedIdOfEvent, isNotificationId, OWNER_NOTIFY_FEATURE, reconcileAlerts, recordOfEvent, wantsBigAlert } from "../shared/ownerNotify";
import { retractMatches, type RetractRequest } from "../shared/notificationLevels";
import type { DaemonService } from "./daemon";
import type { DesktopShell } from "./shell";
import { userAccessOf } from "../shared/users";

export interface OwnerAlertDeps {
  /** The daemon of a connected host (multi-host: one OwnerAlerts for every connection); null when not connected. */
  daemonFor(hostId: string): DaemonService | null;
  shell: DesktopShell;
  mainWindow(): BrowserWindow | null;
  /** 打开: tell the renderer to open that host's agent at that message (after the window was shown). */
  openInApp(hostId: string, agentId: string, notificationId: string): void;
  /** 打开 on an event alert: the renderer runs the click of that key. */
  openEvent(key: string): void;
}

const EVENT_PREFIX = "evt:";

export class OwnerAlerts {
  private alerts: OwnerAlertItem[] = [];
  private win: BrowserWindow | null = null;
  private sound = true;
  /** Per connected host: the cutex host id last seen (a different daemon drops its alerts) and a reconcile generation. */
  private hosts = new Map<string, { daemonHostId: string | null; gen: number }>();
  private flashing = false;

  constructor(private readonly deps: OwnerAlertDeps) {}

  /** Register the alert window's IPC (once, after app ready). */
  start(): void {
    ipcMain.handle(OWNER_ALERT_CHANNEL, (event, request: OwnerAlertRequest) => {
      if (!this.isAlertSender(event.sender)) throw new Error("untrusted sender");
      return this.handle(request);
    });
  }

  /** The alert window's webContents (main/index.ts refuses the app channels from it). */
  isAlertSender(sender: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && sender === this.win.webContents;
  }

  /** Host feed event of one host (every session's stream). */
  onHostEvent(hostId: string, envelope: EventEnvelope): void {
    const deleted = deletedIdOfEvent(envelope.cutex?.method, envelope.cutex?.params);
    if (deleted) {
      if (this.alerts.some((a) => a.hostId === hostId && a.notificationId === deleted)) this.updateHost(hostId, (mine) => mine.filter((a) => a.notificationId !== deleted));
      return;
    }
    const record = recordOfEvent(envelope.cutex?.method, envelope.cutex?.params);
    if (!record) return;
    const isNew = wantsBigAlert(record) && !this.alerts.some((a) => a.hostId === hostId && a.notificationId === record.notificationId);
    if (isNew) {
      // Re-read the sound switch with the alert (settings have no change event); show regardless.
      const gen = this.hostGen(hostId);
      void this.refreshSound(hostId).finally(() => {
        if (gen === this.hostGen(hostId)) this.apply(hostId, record);
      });
    } else this.apply(hostId, record);
  }

  /** Connection changes of one host: a different daemon behind it drops its alerts; each connect re-reads its alerting list. */
  onDaemonState(hostId: string, state: DaemonState): void {
    if (state.kind !== "connected") return;
    const info = this.hosts.get(hostId) ?? { daemonHostId: null, gen: 0 };
    if (info.daemonHostId !== null && info.daemonHostId !== state.hostId) this.updateHost(hostId, () => []);
    const next = { daemonHostId: state.hostId, gen: info.gen + 1 };
    this.hosts.set(hostId, next);
    void this.reconcile(hostId, next.gen);
  }

  /** A host's connection ended (disconnected / replaced / removed): its alerts cannot be acted on any more. */
  forgetHost(hostId: string): void {
    const info = this.hosts.get(hostId);
    if (info) this.hosts.set(hostId, { daemonHostId: null, gen: info.gen + 1 });
    if (this.alerts.some((a) => a.hostId === hostId)) this.updateHost(hostId, () => []);
  }

  /** Dev: CUTEX_DESKTOP_DEMO_OWNER_ALERT=1 shows sample alerts without a daemon. */
  showDemo(): void {
    const now = Date.now();
    const iso = (ago: number) => new Date(now - ago).toISOString();
    this.setAlerts([
      ...this.alerts,
      {
        notificationId: "ntf-demo-1",
        agentId: "demo-eva",
        agentName: "Eva",
        level: "urgent",
        text: "生产库迁移卡在第 3 步：`users` 表的外键约束和旧数据冲突。\n\n要我回滚到迁移前的快照，还是先手动清理那 12 行孤儿数据？",
        createdAt: iso(40_000),
        needsReply: true,
        delegation: "ask-42",
        job: null,
        demo: true,
      },
      {
        notificationId: "ntf-demo-2",
        agentId: "demo-alden",
        agentName: "Alden",
        level: "attention",
        text: "Release build finished; the installer is on the share. Nothing else needed from you.",
        createdAt: iso(5_000),
        needsReply: false,
        delegation: null,
        job: "job-7f3a",
        demo: true,
      },
    ]);
  }

  /** An urgent event (not an owner_notify record) from the renderer. Same key = replaces the shown one. */
  showEvent(alert: Omit<ShellEventAlert, "agentId"> & { agentId: string | null }): void {
    const id = `${EVENT_PREFIX}${alert.key}`.slice(0, 128);
    const item: OwnerAlertItem = {
      notificationId: id,
      agentId: alert.agentId ?? "",
      agentName: alert.agentName,
      level: "urgent",
      text: alert.text,
      createdAt: new Date().toISOString(),
      needsReply: false,
      delegation: null,
      job: null,
      kind: "event",
      title: alert.title,
      sound: alert.sound,
    };
    this.setAlerts([...this.alerts.filter((a) => a.notificationId !== id), item]);
  }

  /**
   * The owner handled it in the app (shell op `retractAlerts`): event alerts by occurrence key /
   * key prefix, and owner_notify alerts the renderer saw closed (when main missed the host event).
   * Without this an event alert stayed up until 知道了 although the approval / question was answered.
   */
  retract(retract: RetractRequest): void {
    const gone = (a: OwnerAlertItem): boolean => {
      if (a.demo) return false;
      if (a.kind === "event") {
        const key = a.notificationId.slice(EVENT_PREFIX.length);
        return retractMatches(key, retract) || retract.keys.some((k) => `${EVENT_PREFIX}${k}`.slice(0, 128) === a.notificationId);
      }
      return retract.notes.some((n) => n.hostId === a.hostId && n.notificationId === a.notificationId);
    };
    if (this.alerts.some(gone)) this.setAlerts(this.alerts.filter((a) => !gone(a)));
  }

  /** This device turned big alerts / sound on or off (Settings → 通知 → 本设备). */
  onNotifyOffChanged(): void {
    if (this.deps.shell.notifyOff.bigAlert) this.setAlerts([]);
    else this.push();
  }

  /** Close everything (app quit). */
  dispose(): void {
    this.win?.destroy();
    this.win = null;
  }

  // ---------- internals ----------

  private hostGen(hostId: string): number {
    return this.hosts.get(hostId)?.gen ?? 0;
  }

  /** Replace one host's owner_notify alerts (demo and event alerts belong to no host). */
  private updateHost(hostId: string, update: (mine: OwnerAlertItem[]) => OwnerAlertItem[]): void {
    const mine = this.alerts.filter((a) => a.hostId === hostId);
    const rest = this.alerts.filter((a) => a.hostId !== hostId);
    const next = update(mine).map((a) => (a.demo || a.kind === "event" ? a : { ...a, hostId }));
    this.setAlerts([...rest, ...next.filter((a) => !rest.includes(a))].sort(compareAlerts));
  }

  private async reconcile(hostId: string, gen: number): Promise<void> {
    const daemon = this.deps.daemonFor(hostId);
    if (!daemon) return;
    try {
      const caps = await daemon.capabilities();
      if (gen !== this.hostGen(hostId)) return;
      // users: owner notices are owner-only (a non-owner / pending connection would get 403).
      if (!caps?.featureList.includes(OWNER_NOTIFY_FEATURE) || !userAccessOf(caps).isOwner) {
        this.updateHost(hostId, () => []);
        return;
      }
      const [alerting] = await Promise.all([daemon.ownerNotifications({ filter: "alerting", limit: 100 }), this.refreshSound(hostId)]);
      if (gen !== this.hostGen(hostId)) return;
      this.updateHost(hostId, (mine) => reconcileAlerts(mine, alerting));
    } catch {
      // unreachable meanwhile: the next connect retries
    }
  }

  private async refreshSound(hostId: string): Promise<void> {
    const daemon = this.deps.daemonFor(hostId);
    if (!daemon) return;
    try {
      const settings = await Promise.race([daemon.getSettings(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      if (settings?.ownerNotify) this.sound = settings.ownerNotify.bigAlertSound !== false;
    } catch {
      // keep the last value
    }
  }

  private apply(hostId: string, record: OwnerNotification): void {
    this.updateHost(hostId, (mine) => applyAlertRecord(mine, record));
  }

  private setAlerts(input: OwnerAlertItem[]): void {
    // This device does not want big alerts: none are kept (the demo still shows in dev runs).
    const next = this.deps.shell.notifyOff.bigAlert ? input.filter((a) => a.demo) : input;
    const added = next.some((a) => !this.alerts.some((b) => b.notificationId === a.notificationId));
    this.alerts = next;
    if (next.length === 0) {
      this.win?.destroy();
      this.win = null;
      this.flash(false);
      return;
    }
    if (!this.win || this.win.isDestroyed()) this.createWindow();
    else this.push();
    if (added) {
      this.win?.showInactive();
      this.win?.moveTop();
      this.flash(true);
    }
  }

  private state(): OwnerAlertState {
    const silent = this.deps.shell.notifyOff.sound;
    return { locale: this.deps.shell.locale, sound: this.sound && !silent, alerts: silent ? this.alerts.map((a) => ({ ...a, sound: false })) : this.alerts };
  }

  private push(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(OWNER_ALERT_STATE, this.state());
  }

  /** Taskbar flash until the main window gets focus or no alert is left. */
  private flash(on: boolean): void {
    const main = this.deps.mainWindow();
    if (!main || main.isDestroyed() || this.flashing === on) return;
    if (on && main.isFocused()) return;
    this.flashing = on;
    main.flashFrame(on);
    if (on) main.once("focus", () => this.flash(false));
  }

  private createWindow(): void {
    const area = screen.getPrimaryDisplay().workArea;
    const { width, height } = OWNER_ALERT_SIZE;
    const win = new BrowserWindow({
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: "Cutex",
      icon: this.deps.shell.appIcon(),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1d" : "#ffffff",
      webPreferences: {
        preload: join(__dirname, "../preload/ownerAlert.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // The chime plays without a click (the window shows inactive).
        autoplayPolicy: "no-user-gesture-required",
        spellcheck: false,
      },
    });
    this.win = win;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("did-finish-load", () => this.push());
    win.once("ready-to-show", () => {
      if (this.win !== win) return;
      win.showInactive();
      win.moveTop();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) void win.loadURL(`${devUrl.replace(/\/$/, "")}/owner-alert.html`);
    else void win.loadFile(join(__dirname, "../renderer/owner-alert.html"));
  }

  private async handle(request: OwnerAlertRequest): Promise<OwnerAlertState | OwnerAlertResult> {
    if (request?.op === "state") return this.state();
    const id = (request as { notificationId?: unknown })?.notificationId;
    if (!isNotificationId(id)) throw new Error("bad notification id");
    const alert = this.alerts.find((a) => a.notificationId === id);
    if (!alert) return { ok: true }; // already gone (acked elsewhere)
    if (alert.kind === "event") return this.handleEvent(alert, request.op);
    switch (request.op) {
      case "ack":
        return this.act(alert, "ack");
      case "reply":
        if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 20000) return { ok: false, message: "bad reply" };
        return this.act(alert, "reply", request.text);
      case "open":
        this.deps.shell.show();
        if (alert.hostId) this.deps.openInApp(alert.hostId, alert.agentId, alert.notificationId);
        // Opening it = the owner saw it (the message stays pending in 需要你 while it needs a reply).
        return this.act(alert, "ack");
      default:
        throw new Error("unknown owner alert op");
    }
  }

  /** Event alerts live only here: 知道了 closes, 打开 shows the app at it; no reply. */
  private handleEvent(alert: OwnerAlertItem, op: OwnerAlertRequest["op"]): OwnerAlertResult {
    if (op === "reply") return { ok: false, message: "no reply" };
    if (op === "open") {
      this.deps.shell.show();
      this.deps.openEvent(alert.notificationId.slice(EVENT_PREFIX.length));
    }
    this.setAlerts(this.alerts.filter((a) => a.notificationId !== alert.notificationId));
    return { ok: true };
  }

  private async act(alert: OwnerAlertItem, action: OwnerNotifyAction, text?: string): Promise<OwnerAlertResult> {
    if (alert.demo) {
      console.info(`[owner-alert demo] ${action} ${alert.notificationId}${text ? `: ${text}` : ""}`);
      this.setAlerts(this.alerts.filter((a) => a.notificationId !== alert.notificationId));
      return { ok: true };
    }
    const daemon = alert.hostId ? this.deps.daemonFor(alert.hostId) : null;
    if (!daemon || !alert.hostId) return { ok: false, message: "host not connected" };
    const hostId = alert.hostId;
    try {
      const r = await daemon.ownerNotifyAction(alert.agentId, action, alert.notificationId, text);
      if (!r.ok) {
        // Already answered / dismissed / gone: nothing left to alert about.
        if (r.error.code === "notification_closed" || r.error.code === "notification_not_found") this.updateHost(hostId, (mine) => mine.filter((a) => a.notificationId !== alert.notificationId));
        return { ok: false, message: r.error.message || r.error.code };
      }
      this.apply(hostId, r.notification);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Demo hook only in dev runs (never in a packaged build). */
export function demoOwnerAlertRequested(): boolean {
  return process.env.CUTEX_DESKTOP_DEMO_OWNER_ALERT === "1" && !app.isPackaged;
}
