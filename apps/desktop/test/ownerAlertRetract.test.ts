// Retracting big alerts (owner bug 2026-10-13: the big alert stayed in the middle of the screen after
// the owner handled it in the app): event alerts by key / key prefix, owner_notify alerts the renderer
// saw closed (by host + id); demo alerts and other hosts' records stay. Plus the IPC sanitiser.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import type { DaemonState } from "../src/shared/ipc";
import { retractMatches, sanitizeRetract } from "../src/shared/notificationLevels";

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
    ownerNotifyAction: vi.fn(),
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const ids = async () => {
  const win = fake.windows.at(-1);
  if (!win || win.destroyed) return [];
  return ((await fake.handler!({ sender: win.webContents }, { op: "state" })) as OwnerAlertState).alerts.map((a) => a.notificationId).sort();
};
const event = (key: string, agentId: string | null = "a1") => ({ key, agentId, agentName: "A", title: "t", text: "x", sound: false });
const none = { keys: [], prefixes: [], notes: [] };

let alerts: OwnerAlerts;
beforeEach(async () => {
  fake.windows.length = 0;
  fake.handler = null;
  const daemons: Record<string, ReturnType<typeof daemon>> = { local: daemon([record("ntf-1", "a1")]), "ssh-t": daemon([record("ntf-1", "w1")]) };
  alerts = new OwnerAlerts({
    daemonFor: (hostId) => (daemons[hostId] as never) ?? null,
    shell: { notifyOff: { bigAlert: false, sound: false }, locale: "en", appIcon() {}, show: vi.fn() } as never,
    mainWindow: () => null,
    openInApp: vi.fn(),
    openEvent: vi.fn(),
  });
  alerts.start();
  alerts.onDaemonState("local", connected("HOST-A"));
  alerts.onDaemonState("ssh-t", connected("WORKSTATION"));
  await flush();
});

describe("retracting big alerts", () => {
  it("event alerts go by exact key or key prefix; owner_notify records with the same text stay", async () => {
    alerts.showEvent(event("req:a1:7"));
    alerts.showEvent(event("req:a1:8"));
    alerts.showEvent(event("turn:a1:t1"));
    alerts.showEvent(event("approval:ap-1", "a2"));
    expect(await ids()).toEqual(["evt:approval:ap-1", "evt:req:a1:7", "evt:req:a1:8", "evt:turn:a1:t1", "ntf-1", "ntf-1"]);
    alerts.retract({ ...none, keys: ["req:a1:7"] });
    expect(await ids()).toEqual(["evt:approval:ap-1", "evt:req:a1:8", "evt:turn:a1:t1", "ntf-1", "ntf-1"]);
    alerts.retract({ ...none, prefixes: ["req:a1:", "turn:a1:"] });
    expect(await ids()).toEqual(["evt:approval:ap-1", "ntf-1", "ntf-1"]);
    // An event key never names an owner_notify record (those are not `evt:`).
    alerts.retract({ ...none, keys: ["ntf-1"], prefixes: ["ntf-"] });
    expect(await ids()).toEqual(["evt:approval:ap-1", "ntf-1", "ntf-1"]);
  });

  it("owner_notify alerts go by host + id (main missed the host event); the window closes when none is left", async () => {
    alerts.showEvent(event("approval:ap-1"));
    alerts.retract({ ...none, notes: [{ hostId: "local", notificationId: "ntf-1" }] });
    expect(await ids()).toEqual(["evt:approval:ap-1", "ntf-1"]);
    // A note never names an event alert.
    alerts.retract({ ...none, notes: [{ hostId: "ssh-t", notificationId: "evt:approval:ap-1" }] });
    expect(await ids()).toEqual(["evt:approval:ap-1", "ntf-1"]);
    alerts.retract({ keys: ["approval:ap-1"], prefixes: [], notes: [{ hostId: "ssh-t", notificationId: "ntf-1" }] });
    expect(await ids()).toEqual([]);
    expect(fake.windows.at(-1)!.destroyed).toBe(true);
  });

  it("a long key matches its truncated alert id; demo alerts stay", async () => {
    const long = `turn:a1:${"x".repeat(150)}`;
    alerts.showEvent(event(long));
    alerts.showDemo();
    alerts.retract({ ...none, keys: [long] });
    expect(await ids()).toEqual(["ntf-1", "ntf-1", "ntf-demo-1", "ntf-demo-2"]);
    alerts.retract({ ...none, notes: [{ hostId: "local", notificationId: "ntf-demo-1" }] });
    expect((await ids()).filter((id) => id.startsWith("ntf-demo"))).toEqual(["ntf-demo-1", "ntf-demo-2"]);
  });

  it("the sanitiser keeps only well-formed keys, ':'-ended prefixes and notes", () => {
    const r = sanitizeRetract({
      keys: ["req:a:1", "bad key", 5, "x".repeat(161)],
      prefixes: ["req:a:", ":", "approval", "turn:a:"],
      notes: [{ hostId: "local", notificationId: "ntf-1" }, { hostId: "bad host", notificationId: "ntf-2" }, { hostId: "local" }, "x"],
      extra: true,
    });
    expect(r).toEqual({ keys: ["req:a:1"], prefixes: ["req:a:", "turn:a:"], notes: [{ hostId: "local", notificationId: "ntf-1" }] });
    expect(sanitizeRetract(null)).toEqual(none);
    expect(sanitizeRetract({ keys: Array.from({ length: 300 }, (_, i) => `k${i}`) }).keys).toHaveLength(200);
    expect(retractMatches("req:a:1", { keys: [], prefixes: ["req:a:"] })).toBe(true);
    expect(retractMatches("req:ab:1", { keys: [], prefixes: ["req:a:"] })).toBe(false);
  });
});
