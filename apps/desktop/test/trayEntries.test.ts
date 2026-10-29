// 托盘 钉住 / 最近 (docs/design/039-workspace-groups.md): which entries the tray shows and the group pin that is stored
// with the home pins (the same pins store: an agent pin listing its members).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
import type { HomeDoc, HomePin } from "../src/shared/home";
import { allEntries, entryAfterClose, groupPin, pinMembers, trayEntries, withGroupPin } from "../src/renderer/src/modules/home/trayEntries";
import { mergeBadges } from "../src/renderer/src/modules/home/Dock";
import type { WsSet } from "../src/renderer/src/lib/workspaceSets";

const a = (sessionId: string, hostId = "local") => ({ hostId, sessionId });
const pin = (sessionId: string): HomePin => ({ hostId: "local", kind: "agent", key: sessionId });
const set = (id: string, at: number, ...m: string[]): WsSet => ({ id, at, members: m.map((x) => a(x)) });
const names = (es: { members: { sessionId: string }[] }[]) => es.map((e) => e.members.map((m) => m.sessionId).join("+"));

describe("the entries", () => {
  const known = () => true;

  it("pinned first (pin order), then 最近 newest first; a workspace of several agents is one entry", () => {
    const e = trayEntries({ pins: [pin("P1"), pin("P2")], sets: [set("w1", 1, "A"), set("w2", 5, "B", "C"), set("w3", 3, "D")], onScreen: [a("B"), a("C")], known });
    expect(names(e.pinned)).toEqual(["P1", "P2"]);
    expect(names(e.recent)).toEqual(["B+C", "D", "A"]);
    expect(e.pinned.every((x) => x.pinned && x.pin)).toBe(true);
    expect(e.recent.every((x) => !x.pinned && x.setId)).toBe(true);
  });

  it("an agent that is pinned is not in 最近 again; a set made only of pinned agents is gone from it", () => {
    const e = trayEntries({ pins: [pin("A")], sets: [set("w", 9, "A", "B"), set("x", 2, "A")], onScreen: [], known });
    expect(names(e.pinned)).toEqual(["A"]);
    expect(names(e.recent)).toEqual(["B"]);
  });

  it("at most 6 recents; one of them on screen is always among them (it is the newest)", () => {
    const sets = ["a", "b", "c", "d", "e", "f", "g", "h"].map((x, i) => set(x, i, x.toUpperCase()));
    expect(trayEntries({ pins: [], sets, onScreen: [a("H")], known }).recent).toHaveLength(6);
    expect(names(trayEntries({ pins: [], sets, onScreen: [a("H")], known }).recent)[0]).toBe("H");
  });

  it("marks: on screen = on, all folded = strip, off screen = open (recent) / pinned; the sidebar must know an agent that is not on screen", () => {
    const e = trayEntries({ pins: [pin("P"), pin("Q")], sets: [set("w", 9, "A", "B"), set("x", 5, "C"), set("y", 4, "Z")], onScreen: [a("A"), a("P")], strips: [a("P")], known: (x) => x.sessionId !== "Z" });
    expect(e.pinned.map((x) => x.mark)).toEqual(["strip", "pinned"]);
    expect(e.recent.map((x) => [x.members.map((m) => m.sessionId).join("+"), x.mark])).toEqual([["A+B", "on"], ["C", "open"]]);
  });

  it("hosts are told apart", () => {
    const e = trayEntries({ pins: [], sets: [{ id: "w", at: 1, members: [a("A", "ssh-b")] }], onScreen: [a("A")], known });
    expect(e.recent[0]!.mark).toBe("open");
  });
});

describe("a group pin is an agent pin listing its members", () => {
  it("one agent = a plain pin; several = the first member's pin with the list", () => {
    expect(groupPin([a("A")])).toEqual({ hostId: "local", kind: "agent", key: "A" });
    const g = groupPin([a("A"), a("B", "ssh-b")], "Ada + Bo");
    expect(g).toMatchObject({ hostId: "local", kind: "agent", key: "A", title: "Ada + Bo", members: [{ hostId: "local", key: "A" }, { hostId: "ssh-b", key: "B" }] });
    expect(pinMembers(g)).toEqual([a("A"), a("B", "ssh-b")]);
  });

  it("a host that dropped the list leaves the first agent's pin: it opens as that member", () => {
    expect(pinMembers({ hostId: "local", kind: "agent", key: "A", title: "Ada + Bo" })).toEqual([a("A")]);
    expect(pinMembers({ hostId: "local", kind: "service", key: "s" })).toEqual([]);
    expect(pinMembers({ hostId: "local", kind: "agent", key: "A", members: [{ hostId: "local", key: "A" }] })).toEqual([a("A")]);
  });

  it("pinning a group takes its members out of their own pins", () => {
    const doc: HomeDoc = { pins: [pin("A"), pin("X"), pin("B")] };
    const next = withGroupPin(doc, [a("A"), a("B")], "Ada + Bo");
    expect(next.pins!.map((p) => p.key)).toEqual(["X", "A"]);
    expect(pinMembers(next.pins![1]!)).toEqual([a("A"), a("B")]);
  });
});

describe("one badge for a capsule", () => {
  const none = { dot: null, count: null, dim: false } as const;
  it("需要你 (summed) > error > unread > running; dimmed only when every member is", () => {
    expect(mergeBadges([{ dot: "needs", count: 2, dim: false }, { dot: "needs", count: 1, dim: false }, { dot: "error", count: null, dim: false }])).toEqual({ dot: "needs", count: 3, dim: false });
    expect(mergeBadges([{ dot: "running", count: null, dim: false }, { dot: "unread", count: null, dim: false }]).dot).toBe("unread");
    expect(mergeBadges([{ dot: "running", count: null, dim: false }, none]).dot).toBe("running");
    expect(mergeBadges([{ ...none, dim: true }, { ...none, dim: true }]).dim).toBe(true);
    expect(mergeBadges([{ ...none, dim: true }, none]).dim).toBe(false);
  });
});

// Owner 2026-10-23: the tray is the taskbar of what is open — closing the item on screen activates the next one, like a
// browser closing its active tab (modules/home/trayNext; lib/workspaces closeWorkspace).
describe("the entry after a close", () => {
  const known = () => true;
  const group: HomePin = { ...pin("Y"), members: [{ hostId: "local", key: "Y" }, { hostId: "local", key: "Z" }] };
  // 钉住 X, Y+Z | 最近 A (on screen, the newest), B, C.
  const entries = allEntries(trayEntries({ pins: [pin("X"), group], sets: [set("w1", 9, "A"), set("w2", 5, "B"), set("w3", 1, "C")], onScreen: [a("A")], known }));
  const after = (...closing: string[]) => {
    const e = entryAfterClose(entries, closing.map((x) => a(x)));
    return e ? e.members.map((m) => m.sessionId).join("+") : null;
  };

  it("the right neighbour in the tray's order — after a 最近 entry, the one used before it", () => {
    expect(names(entries)).toEqual(["X", "Y+Z", "A", "B", "C"]);
    expect(after("A")).toBe("B");
    expect(after("B")).toBe("C");
  });

  it("across the divider: the last pin's right is the newest 最近; a pin's right is the next pin", () => {
    expect(after("Y", "Z")).toBe("A");
    expect(after("X")).toBe("Y+Z");
  });

  it("the last one: its left neighbour", () => {
    expect(after("C")).toBe("B");
  });

  it("an entry made only of closing agents is skipped; one that keeps a member is not", () => {
    expect(after("A", "B")).toBe("C");
    expect(after("B", "C")).toBe("A");
    expect(entryAfterClose(entries, [a("X"), a("Y"), a("Z")])?.members.map((m) => m.sessionId)).toEqual(["A"]);
  });

  it("nothing else in the tray, or the closing agent in no entry: none (the desktop)", () => {
    const lone = allEntries(trayEntries({ pins: [], sets: [set("w1", 1, "A")], onScreen: [a("A")], known }));
    expect(entryAfterClose(lone, [a("A")])).toBeNull();
    expect(after("Q")).toBeNull();
    // Same session id on another host: not that entry.
    expect(entryAfterClose(entries, [a("A", "ssh-b")])).toBeNull();
  });
});
