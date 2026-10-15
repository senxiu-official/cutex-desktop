// Big alerts per host (multi-host P0): one OwnerAlerts for every connected host. Each host's alerting
// records are kept apart (reconcile / delete / disconnect touch only that host) and actions go to the
// host the record came from.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import type { DaemonState } from "../src/shared/ipc";

const fake = vi.hoisted(() => ({
  handler: null as null | ((event: unknown, request: unknown) => Promise<unknown>),
  windows: [] as { webContents: unknown; destroyed: boolean }[],
}));
vi.mock("electron", () => {
  class FakeWindow {
    webContents = { send() {}, setWindowOpenHandler() {}, on() {} };
    destroyed = false;
    constructor() {
      fake.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setMenu() {}
    once() {}
    on() {}
    showInactive() {}
    moveTop() {}
    loadFile() {
      return Promise.resolve();
    }
    loadURL() {
      return Promise.resolve();
    }
  }
  return {
    app: { isPackaged: true },
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (_channel: string, fn: typeof fake.handler) => void (fake.handler = fn) },
    nativeTheme: { shouldUseDarkColors: false },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
  };
});
import { OwnerAlerts } from "../src/main/ownerAlert";
import type { OwnerAlertState } from "../src/shared/ownerAlert";

const record = (notificationId: string, agentId: string, over: Partial<OwnerNotification> = {}): OwnerNotification => ({
  notificationId, agentId, agentName: agentId, origin: "agent", text: "help", level: "urgent", requestedLevel: "urgent", downgraded: null, muted: false,
  channels: ["desktop", "bigAlert"], needsReply: false, delegation: null, job: null, turnId: null, state: "open",
  createdAt: "2026-10-10T10:00:00.000Z", acknowledgedAt: null, reply: null, closedAt: null, ...over,
});
const connected = (hostId: string): DaemonState => ({ kind: "connected", baseUrl: "fake://", hostId });
function daemon(alerting: OwnerNotification[]) {
  return {
    capabilities: vi.fn(async () => ({ featureList: ["owner-messages"] })),
    ownerNotifications: vi.fn(async () => alerting),
    getSettings: vi.fn(async () => ({})),
    ownerNotifyAction: vi.fn(async (_agentId: string, _action: string, id: string) => ({ ok: true, notification: { ...alerting.find((r) => r.notificationId === id)!, state: "acknowledged" } })),
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let daemons: Record<string, ReturnType<typeof daemon>>;
let alerts: OwnerAlerts;
let openInApp: ReturnType<typeof vi.fn<(hostId: string, agentId: string, notificationId: string) => void>>;
const state = async () => {
  const win = fake.windows.at(-1);
  if (!win || win.destroyed) return [];
  return ((await fake.handler!({ sender: win.webContents }, { op: "state" })) as OwnerAlertState).alerts.map((a) => [a.hostId, a.notificationId]);
};

beforeEach(async () => {
  fake.windows.length = 0;
  fake.handler = null;
  daemons = {
    local: daemon([record("ntf-1", "a1")]),
    "ssh-t": daemon([record("ntf-t1", "w1"), record("ntf-t2", "w2", { createdAt: "2026-10-10T09:00:00.000Z" })]),
  };
  openInApp = vi.fn<(hostId: string, agentId: string, notificationId: string) => void>();
  alerts = new OwnerAlerts({
    daemonFor: (hostId) => (daemons[hostId] as never) ?? null,
    shell: { notifyOff: { bigAlert: false, sound: false }, locale: "en", appIcon() {}, show: vi.fn() } as never,
    mainWindow: () => null,
    openInApp,
    openEvent: vi.fn(),
  });
  alerts.start();
  alerts.onDaemonState("local", connected("HOST-A"));
  alerts.onDaemonState("ssh-t", connected("WORKSTATION"));
  await flush();
});

describe("big alerts of several connected hosts", () => {
  it("each host's alerting records are listed with their host", async () => {
    expect((await state()).sort()).toEqual([["local", "ntf-1"], ["ssh-t", "ntf-t1"], ["ssh-t", "ntf-t2"]]);
    expect(daemons.local!.ownerNotifications).toHaveBeenCalledTimes(1);
    expect(daemons["ssh-t"]!.ownerNotifications).toHaveBeenCalledTimes(1);
  });

  it("host events, reconnects and disconnects touch only that host", async () => {
    // A deleted event for the same id on another host does nothing here.
    alerts.onHostEvent("local", { cutexSessionId: "w1", source: "cutex", correlation: {}, cutex: { method: "cutex/ownerNotify/deleted", params: { notificationId: "ntf-t1", agentId: "w1" } } } as never);
    expect((await state()).length).toBe(3);
    alerts.onHostEvent("ssh-t", { cutexSessionId: "w1", source: "cutex", correlation: {}, cutex: { method: "cutex/ownerNotify/deleted", params: { notificationId: "ntf-t1", agentId: "w1" } } } as never);
    expect((await state()).sort()).toEqual([["local", "ntf-1"], ["ssh-t", "ntf-t2"]]);
    // Reconnect of local re-reads only local's list.
    daemons.local!.ownerNotifications.mockResolvedValueOnce([]);
    alerts.onDaemonState("local", connected("HOST-A"));
    await flush();
    expect(await state()).toEqual([["ssh-t", "ntf-t2"]]);
    // workstation' connection ends: its alerts go (they cannot be acted on); the window closes when none is left.
    alerts.forgetHost("ssh-t");
    expect(await state()).toEqual([]);
    expect(fake.windows.at(-1)!.destroyed).toBe(true);
  });

  it("打开 / 知道了 act on the record's own host", async () => {
    const win = fake.windows.at(-1)!;
    await fake.handler!({ sender: win.webContents }, { op: "open", notificationId: "ntf-t2" });
    expect(openInApp).toHaveBeenCalledWith("ssh-t", "w2", "ntf-t2");
    expect(daemons["ssh-t"]!.ownerNotifyAction).toHaveBeenCalledWith("w2", "ack", "ntf-t2", undefined);
    expect(daemons.local!.ownerNotifyAction).not.toHaveBeenCalled();
    await fake.handler!({ sender: win.webContents }, { op: "ack", notificationId: "ntf-1" });
    expect(daemons.local!.ownerNotifyAction).toHaveBeenCalledWith("a1", "ack", "ntf-1", undefined);
    expect(await state()).toEqual([["ssh-t", "ntf-t1"]]);
  });
});
