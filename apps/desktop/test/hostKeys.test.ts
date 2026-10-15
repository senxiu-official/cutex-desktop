// Host-keyed desktop prefs (multi-host RFC §6.1 / §6.4, ★ Q18): agent / project ids are stored under
// `JSON.stringify([hostId, id])`; entries from before multi-host (bare ids) stay visible everywhere
// until the first host whose sidebar lists them claims them, and are dropped 30 days after this
// version first ran. Readers see the focus host's bare ids.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storage: Map<string, string>;
const key = (hostId: string, id: string) => JSON.stringify([hostId, id]);

beforeEach(() => {
  vi.resetModules();
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host keys", () => {
  it("project, write, claim and drop host-keyed lists", async () => {
    const k = await import("../src/renderer/src/lib/hostKeys");
    expect(k.hostKey("local", "a")).toBe(key("local", "a"));
    expect(k.parseHostKey(key("ssh-t", "x"))).toEqual(["ssh-t", "x"]);
    for (const bare of ["a", "[bad", "[1,2]", '["only"]']) expect(k.parseHostKey(bare)).toBeNull();
    const list = ["a", key("local", "b"), key("ssh-t", "c")];
    expect(k.projectList(list, "local")).toEqual(["a", "b"]);
    expect(k.projectList(list, "ssh-t")).toEqual(["a", "c"]);
    // The focus host's ids replace its part; an unclaimed legacy id still listed stays bare.
    expect(k.writeList(list, ["a", "b", "d"], "local")).toEqual([key("ssh-t", "c"), "a", key("local", "b"), key("local", "d")]);
    expect(k.writeList(list, ["c"], "ssh-t")).toEqual([key("local", "b"), key("ssh-t", "c")]);
    expect(k.claimList(list, "ssh-t", (id) => id === "a")).toEqual([key("ssh-t", "a"), key("local", "b"), key("ssh-t", "c")]);
    expect(k.claimList(list, "ssh-t", () => false)).toBe(list);
    expect(k.claimList(["a", key("ssh-t", "a")], "ssh-t", () => true)).toEqual([key("ssh-t", "a")]);
    expect(k.dropLegacy(list)).toEqual([key("local", "b"), key("ssh-t", "c")]);
    const keyed = [key("local", "b")];
    expect(k.dropLegacy(keyed)).toBe(keyed);
    expect(k.projectRecord({ a: 1, [key("local", "b")]: 2, [key("ssh-t", "b")]: 3 }, "ssh-t")).toEqual({ a: 1, b: 3 });
  });

  it("the focus host is what projections show; listeners follow it", async () => {
    const k = await import("../src/renderer/src/lib/hostKeys");
    const seen: string[] = [];
    const off = k.onKeyFocus(() => seen.push(k.keyFocus()));
    expect(k.keyFocus()).toBe("local");
    k.setKeyFocus("local");
    k.setKeyFocus("ssh-t");
    expect(k.projectList([key("ssh-t", "c"), key("local", "b")])).toEqual(["c"]);
    off();
    k.setKeyFocus("local");
    expect(seen).toEqual(["ssh-t"]);
  });

  it("legacy entries expire 30 days after this version first ran (the start is persisted)", async () => {
    const k = await import("../src/renderer/src/lib/hostKeys");
    expect(k.legacySince(1_000)).toBe(1_000);
    expect(k.legacyExpired(1_000 + k.LEGACY_KEY_TTL_MS)).toBe(false);
    expect(k.legacyExpired(1_000 + k.LEGACY_KEY_TTL_MS + 1)).toBe(true);
    vi.resetModules();
    const again = await import("../src/renderer/src/lib/hostKeys");
    expect(again.legacySince(9_999_999)).toBe(1_000);
    // A registered store whose legacy entries expired drops them at once, and claims stop.
    const store = { claim: vi.fn(), dropLegacy: vi.fn() };
    vi.useFakeTimers({ now: 1_000 + again.LEGACY_KEY_TTL_MS + 5 });
    again.registerHostKeyed(store);
    expect(store.dropLegacy).toHaveBeenCalledTimes(1);
    again.claimHostIds("local", new Set(["a"]));
    expect(store.claim).not.toHaveBeenCalled();
    expect(store.dropLegacy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("UI prefs lists per host", () => {
  it("legacy lists stay visible until a host claims them; each host keeps its own order / stars / folds", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ projectOrder: ["p1", "p2"], starredProjects: ["p2"], foldedGroups: ["proj:p1", "other:x"], sendKeys: "queueFirst" }));
    const k = await import("../src/renderer/src/lib/hostKeys");
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().projectOrder).toEqual(["p1", "p2"]);
    k.claimHostIds("local", new Set(["p1"]));
    const stored = JSON.parse(storage.get("cutex-desktop.ui")!) as Record<string, unknown>;
    expect(stored.projectOrder).toEqual([key("local", "p1"), "p2"]);
    expect(stored.foldedGroups).toEqual([key("local", "proj:p1"), "other:x"]);
    expect(stored.starredProjects).toEqual(["p2"]);
    expect(prefs.getUiPrefs().projectOrder).toEqual(["p1", "p2"]);
    k.setKeyFocus("ssh-t");
    expect(prefs.getUiPrefs().projectOrder).toEqual(["p2"]);
    expect(prefs.getUiPrefs().foldedGroups).toEqual(["other:x"]);
    prefs.setUiPref("projectOrder", ["w1", "p2"]);
    expect(JSON.parse(storage.get("cutex-desktop.ui")!).projectOrder).toEqual([key("local", "p1"), key("ssh-t", "w1"), "p2"]);
    // Not a host list: shared by every host.
    prefs.setUiPref("sendKeys", "cli");
    k.setKeyFocus("local");
    expect(prefs.getUiPrefs().projectOrder).toEqual(["p1", "p2"]);
    expect(prefs.getUiPrefs().sendKeys).toBe("cli");
  });
});

describe("turn marks per host", () => {
  it("another host's marks stay apart; a legacy mark becomes the host's that touches it", async () => {
    storage.set("cutex-desktop.turnMarks", JSON.stringify({ a1: { at: 5, failed: false, turnId: "t0" } }));
    const k = await import("../src/renderer/src/lib/hostKeys");
    const marks = await import("../src/renderer/src/lib/turnUnread");
    expect(Object.keys(marks.getTurnMarks())).toEqual(["a1"]);
    marks.recordTurnEndOn("ssh-t", "z9", { turnId: "t1", status: "completed" }, false, 10);
    expect(Object.keys(marks.getTurnMarks())).toEqual(["a1"]);
    k.setKeyFocus("ssh-t");
    expect(Object.keys(marks.getTurnMarks()).sort()).toEqual(["a1", "z9"]);
    // An interrupted turn not looked at leaves everything as it was (legacy included).
    marks.recordTurnEnd("a1", { turnId: "t2", status: "interrupted" }, false, 11);
    expect(marks.getTurnMarks().a1).toMatchObject({ turnId: "t0" });
    k.setKeyFocus("local");
    marks.markSeen("a1");
    expect(marks.getTurnMarks()).toEqual({});
    k.setKeyFocus("ssh-t");
    expect(Object.keys(marks.getTurnMarks())).toEqual(["z9"]);
    expect(Object.keys(JSON.parse(storage.get("cutex-desktop.turnMarks")!))).toEqual([key("ssh-t", "z9")]);
    // Pruning keeps other hosts' marks.
    k.setKeyFocus("local");
    marks.recordTurnEnd("b2", { turnId: "t3", status: "failed" }, false, 12);
    marks.pruneTurnMarks(new Set());
    expect(Object.keys(JSON.parse(storage.get("cutex-desktop.turnMarks")!))).toEqual([key("ssh-t", "z9")]);
  });

  it("a host's sidebar claims legacy marks of its agents", async () => {
    storage.set("cutex-desktop.turnMarks", JSON.stringify({ a1: { at: 5, failed: true, turnId: "t0" }, w1: { at: 6, failed: false, turnId: "t1" } }));
    const k = await import("../src/renderer/src/lib/hostKeys");
    const marks = await import("../src/renderer/src/lib/turnUnread");
    k.claimHostIds("ssh-t", new Set(["w1"]));
    expect(Object.keys(marks.getTurnMarks())).toEqual(["a1"]);
    expect(JSON.parse(storage.get("cutex-desktop.turnMarks")!)).toEqual({ a1: { at: 5, failed: true, turnId: "t0" }, [key("ssh-t", "w1")]: { at: 6, failed: false, turnId: "t1" } });
  });
});
