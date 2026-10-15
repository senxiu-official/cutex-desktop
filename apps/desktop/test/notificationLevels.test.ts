// Notification levels (docs/research/notification-levels.md, contract 1.3 `notify.method`): matrix
// resolution, the local decision fallback, this device's off filter, the one-time prefs migration,
// wire sanitizing, and the desktop's turn-trigger approximation.
import { describe, expect, it } from "vitest";
import {
  cellPatch,
  cellValue,
  decideLocally,
  devicePlan,
  DEVICE_OFF_NONE,
  fixedCell,
  groupedMethods,
  migrationPatch,
  parseDeviceOff,
  presetChoices,
  projectMutedIn,
  sanitizeEvaluate,
  sanitizeEventAlert,
  sanitizeLevelsPatch,
  sanitizeShellNotification,
  type NotificationLevelsView,
} from "../src/shared/notificationLevels";
import { applyTurnEvent, endTurn, serverRequestEventOf, turnEventOf, turnOwnerOf, type TurnTriggerState } from "../src/renderer/src/lib/turnTriggers";
import { mock } from "../src/renderer/src/modules/notifications/mock";

const core = { legacy: false } as Parameters<NonNullable<typeof mock.api>>[0];
const api = mock.api!(core);
const view = async () => (await api.notificationLevels!())!;

describe("matrix", () => {
  it("fixed cells win and cannot be patched; other cells read the effective table", async () => {
    const v = await view();
    expect(fixedCell(v, "urgent", "needsYou")).toBe(true);
    expect(fixedCell(v, "record", "needsYou")).toBe(false);
    expect(fixedCell(v, "inform", "desktop")).toBeNull();
    expect(cellValue(v, "record", "needsYou")).toBe(false);
    expect(cellPatch(v, "urgent", "needsYou", false)).toBeNull();
    expect(cellPatch(v, "inform", "phone", true)).toEqual({ methods: { cells: { inform: { phone: true } } } });
    // The mock's one custom cell: inform · sound on top of the default preset.
    expect(cellValue(v, "inform", "sound")).toBe(true);
    expect(v.effective.methodPreset).toBe("custom");
  });

  it("groups columns 应用内 | 本设备 | 手机 | 外发 in registry order", async () => {
    const groups = groupedMethods((await view()).methods).map((g) => [g.group, g.methods.map((m) => m.id)]);
    expect(groups).toEqual([
      ["inApp", ["needsYou", "mark"]],
      ["device", ["desktop", "sound", "bigAlert"]],
      ["phone", ["phone"]],
      ["outbound", []],
    ]);
  });
});

describe("decideLocally (fallback for /evaluate)", () => {
  it("the highest level wins and its row gives the actions", async () => {
    const v = await view();
    const d = decideLocally(v, ["ownerNotify.info", "native.approval"]);
    expect(d).toMatchObject({ level: "needsYou", event: "native.approval", needsYou: true, muted: false });
    expect(d.actions).toEqual(["needsYou", "mark", "desktop", "phone"]);
    expect(d.channels).toEqual(["desktop", "phone"]);
    expect(decideLocally(v, ["no.suchEvent"]).level).toBe("record");
  });

  it("a muted project lowers inform to record and drops outgoing methods; legacy keeps inform", async () => {
    const base = await view();
    const v: NotificationLevelsView = { ...base, settings: { ...base.settings, projectOverrides: { p1: "mute", __independent__: "mute" } } };
    expect(decideLocally(v, ["runtime.error"], { projectId: "p1" })).toMatchObject({ level: "record", muted: true });
    expect(decideLocally(v, ["runtime.error"], { projectId: null }).muted).toBe(true);
    expect(decideLocally(v, ["runtime.error"]).muted).toBe(false); // unknown project
    const urgent = decideLocally(v, ["ownerNotify.urgent"], { projectId: "p1" });
    expect(urgent.level).toBe("urgent");
    expect(urgent.actions).toEqual(["needsYou", "mark"]);
    const legacy: NotificationLevelsView = { ...v, settings: { ...v.settings, methodPreset: "legacy" } };
    expect(decideLocally(legacy, ["runtime.error"], { projectId: "p1" }).level).toBe("inform");
  });

  it("matches the mock's evaluate (a copy of cutex Evaluator::decide)", async () => {
    const v = await view();
    for (const events of [["ownerNotify.urgent"], ["turn.owner.failed"], ["turn.other.completed"], ["ownerNotify.info", "delegation.failed.owner"]]) {
      const local = decideLocally(v, events);
      const remote = await api.evaluateNotification!({ events });
      expect(local, events.join()).toEqual(remote);
    }
  });
});

describe("mock patch rules", () => {
  it("a preset clears its table's cells; a cell equal to the preset is not stored", async () => {
    let v = await api.patchNotificationLevels!({ methods: { cells: { inform: { phone: true } } } });
    expect(v.settings.methods.inform).toEqual({ sound: true, phone: true });
    v = await api.patchNotificationLevels!({ methods: { cells: { inform: { phone: false } } } });
    expect(v.settings.methods.inform).toEqual({ sound: true });
    v = await api.patchNotificationLevels!({ events: { levels: { "runtime.error": "urgent" } } });
    expect(v.events.find((e) => e.id === "runtime.error")).toMatchObject({ level: "urgent", overridden: true });
    v = await api.patchNotificationLevels!({ events: { preset: "default" }, methods: { preset: "quiet" } });
    expect(v.settings).toMatchObject({ eventLevels: {}, methodPreset: "quiet", methods: {} });
    expect(v.effective).toMatchObject({ eventPreset: "default", methodPreset: "quiet" });
    v = await api.patchNotificationLevels!({ projectOverrides: { p1: "mute" } });
    expect(projectMutedIn(v, "p1")).toBe(true);
    expect(projectMutedIn(v, null)).toBe(false);
    v = await api.patchNotificationLevels!({ projectOverrides: { p1: null } });
    expect(projectMutedIn(v, "p1")).toBe(false);
  });

  it("offers no legacy preset; an older host's legacy shows read-only", async () => {
    const v = await view();
    expect(v.methodPresets.map((p) => p.id)).toEqual(["quiet", "default", "all"]);
    expect(v.eventPresets.map((p) => p.id)).toEqual(["default"]);
    await expect(api.patchNotificationLevels!({ methods: { preset: "legacy" } })).rejects.toThrow();
    await expect(api.patchNotificationLevels!({ events: { preset: "legacy" } })).rejects.toThrow();
    // Older host (no notification-presets-no-legacy): legacy listed and current.
    expect(presetChoices(["legacy", "quiet", "default", "all"], "legacy")).toEqual([
      { id: "quiet", readOnly: false },
      { id: "default", readOnly: false },
      { id: "all", readOnly: false },
      { id: "legacy", readOnly: true },
    ]);
    expect(presetChoices(["legacy", "default"], "default")).toEqual([{ id: "default", readOnly: false }]);
    expect(presetChoices(["quiet", "default"], "custom").at(-1)).toEqual({ id: "custom", readOnly: true });
    expect(presetChoices([], "legacy")).toEqual([{ id: "legacy", readOnly: true }]);
  });

  it("?legacy: no routes", async () => {
    const legacy = mock.api!({ ...core, legacy: true });
    expect(await legacy.notificationLevels!()).toBeNull();
    await expect(legacy.evaluateNotification!({ events: ["native.approval"] })).rejects.toThrow();
  });
});

describe("this device", () => {
  const all = () => true;
  it("runs device methods only, minus the ones switched off or unavailable", () => {
    expect(devicePlan(["needsYou", "mark", "desktop", "phone"], { off: DEVICE_OFF_NONE, looking: false, available: all })).toEqual({ methods: ["desktop"], alertSound: false });
    expect(devicePlan(["desktop", "sound"], { off: { ...DEVICE_OFF_NONE, desktop: true }, looking: false, available: all }).methods).toEqual(["sound"]);
    expect(devicePlan(["desktop", "sound"], { off: DEVICE_OFF_NONE, looking: false, available: (m) => m !== "sound" }).methods).toEqual(["desktop"]);
  });
  it("never adds a method; nothing while the owner is looking; the big alert carries the sound", () => {
    expect(devicePlan([], { off: DEVICE_OFF_NONE, looking: false, available: all }).methods).toEqual([]);
    expect(devicePlan(["desktop", "bigAlert"], { off: DEVICE_OFF_NONE, looking: true, available: all }).methods).toEqual([]);
    expect(devicePlan(["desktop", "sound", "bigAlert"], { off: DEVICE_OFF_NONE, looking: false, available: all })).toEqual({ methods: ["desktop", "bigAlert"], alertSound: true });
    expect(devicePlan(["sound", "bigAlert"], { off: { ...DEVICE_OFF_NONE, bigAlert: true }, looking: false, available: all })).toEqual({ methods: ["sound"], alertSound: false });
  });
  it("parses stored off switches defensively", () => {
    expect(parseDeviceOff({ sound: true, bigAlert: "yes", phone: true })).toEqual({ desktop: false, sound: true, bigAlert: false });
    expect(parseDeviceOff(null)).toEqual(DEVICE_OFF_NONE);
  });
});

describe("one-time migration of the old desktop prefs", () => {
  it("mutedProjects become project mutes (only new ones); the old switches are dropped", () => {
    expect(migrationPatch(JSON.stringify({ needsInput: false, turnCompleted: true, mutedProjects: ["p1", "p2", 7, ""] }), { p2: "mute" })).toEqual({ projectOverrides: { p1: "mute" } });
    expect(migrationPatch(JSON.stringify({ needsInput: false }), {})).toBeNull();
    expect(migrationPatch(JSON.stringify({ mutedProjects: ["p2"] }), { p2: "mute" })).toBeNull();
    expect(migrationPatch("{not json", {})).toBeNull();
    expect(migrationPatch(null, {})).toBeNull();
  });
});

describe("wire sanitizing (main)", () => {
  it("patch: keeps known shapes only", () => {
    expect(sanitizeLevelsPatch({ events: { preset: "default", levels: { "turn.owner.completed": "inform", "Bad id": "inform", "a.b": "loud", "c.d": null } }, methods: { cells: { inform: { sound: true, "x y": true, phone: "on" }, nope: { sound: true } } }, projectOverrides: { p1: "mute", p2: "loud", p3: null }, extra: 1 })).toEqual({
      events: { preset: "default", levels: { "turn.owner.completed": "inform", "c.d": null } },
      methods: { cells: { inform: { sound: true } } },
      projectOverrides: { p1: "mute", p3: null },
    });
  });
  it("evaluate: 1–32 events; null / __independent__ = independent; absent = unknown", () => {
    expect(() => sanitizeEvaluate({ events: ["Bad id"] })).toThrow();
    expect(sanitizeEvaluate({ events: ["native.approval"], agentId: "eva", projectId: null })).toEqual({ events: ["native.approval"], agentId: "eva", projectId: null });
    expect(sanitizeEvaluate({ events: ["native.approval"], projectId: "__independent__" }).projectId).toBeNull();
    expect("projectId" in sanitizeEvaluate({ events: ["native.approval"] })).toBe(false);
  });
  it("shell notification / event alert: checked key, capped text", () => {
    expect(() => sanitizeShellNotification({ key: "has space" })).toThrow();
    expect(sanitizeShellNotification({ key: "turn:eva:t1", title: "", body: "x".repeat(2000) })).toMatchObject({ title: "Cutex", body: "x".repeat(1000) });
    expect(sanitizeEventAlert({ key: "req:eva:1", agentId: 5, agentName: " ", title: "Q", text: "t", sound: 1 })).toEqual({ key: "req:eva:1", agentId: null, agentName: "Cutex", title: "Q", text: "t", sound: false });
  });
});

describe("turn triggers (desktop approximation)", () => {
  it("a turn is the owner's once a userMessage item shows up in it", () => {
    let s: TurnTriggerState = new Map();
    s = applyTurnEvent(s, "eva", { method: "turn/started", params: { turn: { id: "t1" } } });
    expect(turnOwnerOf(s, "eva", "t1")).toBe("other");
    s = applyTurnEvent(s, "eva", { method: "item/started", params: { item: { type: "agentMessage" } } });
    expect(turnOwnerOf(s, "eva", "t1")).toBe("other");
    s = applyTurnEvent(s, "eva", { method: "item/started", params: { item: { type: "userMessage" } } });
    expect(turnOwnerOf(s, "eva", "t1")).toBe("owner");
    expect(turnOwnerOf(s, "eva", "t0")).toBe("other");
    s = endTurn(s, "eva");
    expect(turnOwnerOf(s, "eva", "t1")).toBe("other");
  });
  it("maps a finished turn and a server request to registered events", () => {
    expect(turnEventOf("owner", "completed")).toBe("turn.owner.completed");
    expect(turnEventOf("owner", "failed")).toBe("turn.owner.failed");
    expect(turnEventOf("owner", "interrupted")).toBe("turn.owner.interrupted");
    expect(turnEventOf("other", "completed")).toBe("turn.other.completed");
    expect(turnEventOf("other", "interrupted")).toBe("turn.other.failed");
    expect(serverRequestEventOf("item/tool/requestUserInput")).toBe("native.question");
    expect(serverRequestEventOf("mcpServer/elicitation/request")).toBe("native.question");
    expect(serverRequestEventOf("item/commandExecution/requestApproval")).toBe("native.approval");
  });
});
