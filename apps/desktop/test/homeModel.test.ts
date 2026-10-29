// 桌面: the home document model (modules/home/model.ts) — pins add / remove / reorder / resize, what a
// ref pins as, blocks, the two entrances' defaults, which host keeps the settings; and the wire body
// check (cutex-client homePutBody / readHomeDoc).
import { describe, expect, it } from "vitest";
import { homePutBody, readHomeDoc, readHomeView } from "@cutex-desktop/cutex-client";
import { bootHost, homeBlocks, homeHostOf, isPinned, pinId, pinOfRef, pinsOf, showWhenEmpty, sidebarEntry, sizeOf, withBlockMoved, withBlockVisible, withPin, withPinMoved, withPinToggled, withoutPin, deskIconsOf, withDeskIconSize } from "../src/renderer/src/modules/home/model";
import type { HomeDoc, HomePin } from "../src/shared/home";

const p = (key: string, kind: HomePin["kind"] = "service", hostId = "local"): HomePin => ({ hostId, kind, key });
const keys = (d: HomeDoc) => pinsOf(d).map((x) => x.key);

describe("pins", () => {
  it("add (once, appended), remove, toggle", () => {
    let d: HomeDoc = { bio: "x", future: { kept: true } };
    d = withPin(d, p("a"));
    d = withPin(d, p("b", "agent"));
    expect(withPin(d, p("a"))).toBe(d);
    expect(keys(d)).toEqual(["a", "b"]);
    // Same key on another host or of another kind is another pin.
    d = withPin(d, p("a", "service", "ssh-ws"));
    expect(pinsOf(d)).toHaveLength(3);
    expect(isPinned(d, p("a", "service", "ssh-ws"))).toBe(true);
    d = withoutPin(d, pinId(p("a")));
    expect(pinsOf(d).map(pinId)).toEqual([pinId(p("b", "agent")), pinId(p("a", "service", "ssh-ws"))]);
    expect(withoutPin(d, "nope")).toBe(d);
    d = withPinToggled(d, p("b", "agent"));
    expect(isPinned(d, p("b", "agent"))).toBe(false);
    d = withPinToggled(d, p("b", "agent"));
    expect(isPinned(d, p("b", "agent"))).toBe(true);
    // Unknown keys of a newer desktop survive every edit.
    expect(d).toMatchObject({ bio: "x", future: { kept: true } });
  });

  it("at most 64 pins", () => {
    let d: HomeDoc = {};
    for (let i = 0; i < 70; i++) d = withPin(d, p(`s${i}`));
    expect(pinsOf(d)).toHaveLength(64);
  });

  it("reorder (drag): to an index, clamped; resize; default sizes", () => {
    let d: HomeDoc = { pins: [p("a"), p("b"), p("c"), p("d")] };
    d = withPinMoved(d, pinId(p("d")), 0);
    expect(keys(d)).toEqual(["d", "a", "b", "c"]);
    d = withPinMoved(d, pinId(p("d")), 99);
    expect(keys(d)).toEqual(["a", "b", "c", "d"]);
    d = withPinMoved(d, pinId(p("a")), 2);
    expect(keys(d)).toEqual(["b", "c", "a", "d"]);
    expect(withPinMoved(d, "missing", 0)).toBe(d);
    // Sizes are the desktop icons' (the tray has one icon size).
    d = withDeskIconSize(d, pinId(p("c")), "w");
    expect(sizeOf(deskIconsOf(d).find((x) => x.key === "c")!)).toBe("w");
    expect(sizeOf(pinsOf(d)[1]!)).toBe("m");
    expect(sizeOf(p("x"))).toBe("m");
    expect(sizeOf(p("x", "agent"))).toBe("s");
  });

  it("what a ref pins as: agents, services (also a browser tab on a service), artifacts (tab or link), web pages", () => {
    expect(pinOfRef({ hostId: "local", kind: "agent", key: "eva", title: "Eva", params: { sessionId: "eva" } })).toEqual({ hostId: "local", kind: "agent", key: "eva", title: "Eva" });
    expect(pinOfRef({ hostId: "local", kind: "service", key: "audiobook/player", title: "听书", params: {} })).toMatchObject({ kind: "service", key: "audiobook" });
    expect(pinOfRef({ hostId: "local", kind: "service", key: "Bad!", title: "", params: {} })).toBeNull();
    const ref = "af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8@latest";
    expect(pinOfRef({ hostId: "local", kind: "artifacts.view", key: ref, title: "清单", params: { ref } })).toMatchObject({ kind: "artifact", key: ref });
    expect(pinOfRef({ hostId: "local", kind: "artifact", key: "nope@1", title: "", params: {} })).toBeNull();
    expect(pinOfRef({ hostId: "ssh-ws", kind: "browser.tab", key: "cutex:service/audiobook/", title: "听书", params: { url: "cutex:service/audiobook/" } })).toMatchObject({ hostId: "ssh-ws", kind: "service", key: "audiobook" });
    expect(pinOfRef({ hostId: "local", kind: "browser.tab", key: "https://example.com/a", title: "Ex", params: { url: "https://example.com/a" } })).toMatchObject({ kind: "url", key: "https://example.com/a" });
    expect(pinOfRef({ hostId: "local", kind: "browser.tab", key: "about:blank", title: "", params: { url: "about:blank" } })).toBeNull();
    expect(pinOfRef({ hostId: "local", kind: "turn", key: "t1", title: "", params: {} })).toBeNull();
  });
});

describe("blocks and entrances", () => {
  it("default order; stored order kept; missing appended; unknown blocks kept at the end", () => {
    expect(homeBlocks(null).map((b) => b.id)).toEqual(["profile", "clock", "needs", "stats", "tiles"]);
    const d: HomeDoc = { blocks: [{ id: "tiles", visible: true }, { id: "weather", visible: true }, { id: "clock", visible: false }] };
    expect(homeBlocks(d)).toEqual([{ id: "tiles", visible: true }, { id: "clock", visible: false }, { id: "profile", visible: true }, { id: "needs", visible: true }, { id: "stats", visible: true }]);
    const moved = withBlockMoved(d, "clock", -1);
    expect(homeBlocks(moved).map((b) => b.id).slice(0, 2)).toEqual(["clock", "tiles"]);
    expect(moved.blocks!.at(-1)).toEqual({ id: "weather", visible: true });
    expect(homeBlocks(withBlockVisible(d, "clock", true))[1]).toEqual({ id: "clock", visible: true });
    expect(withBlockMoved(d, "tiles", -1)).toBe(d);
  });

  it("both entrances default on (owner: 都要); false turns them off", () => {
    expect([showWhenEmpty(null), sidebarEntry(null)]).toEqual([true, true]);
    expect([showWhenEmpty({ showWhenEmpty: false }), sidebarEntry({ sidebarEntry: false })]).toEqual([false, false]);
    expect(showWhenEmpty({ showWhenEmpty: null })).toBe(true);
  });
});

describe("the home host", () => {
  const h = (id: string, o: Partial<{ connected: boolean; owner: boolean; local: boolean }> = {}) => ({ id, connected: true, owner: true, local: false, ...o });
  it("this machine's host when connected, else the first connected owner host", () => {
    expect(bootHost([h("ssh-a"), h("local", { local: true })])).toBe("local");
    expect(bootHost([h("ssh-a", { owner: false }), h("local", { local: true, connected: false }), h("ssh-b")])).toBe("ssh-b");
    expect(bootHost([h("ssh-a", { connected: false })])).toBeNull();
  });
  it("the stored homeHost when it is a connected owner host", () => {
    const hosts = [h("local", { local: true }), h("ssh-a"), h("ssh-b", { connected: false }), h("ssh-c", { owner: false })];
    expect(homeHostOf("local", "ssh-a", hosts)).toBe("ssh-a");
    expect(homeHostOf("local", "ssh-b", hosts)).toBe("local");
    expect(homeHostOf("local", "ssh-c", hosts)).toBe("local");
    expect(homeHostOf("local", null, hosts)).toBe("local");
    expect(homeHostOf(null, "ssh-a", hosts)).toBeNull();
  });
});

describe("wire (cutex-client)", () => {
  it("reads a view: revision 0 / home null before the first write; malformed known keys dropped, unknown kept", () => {
    expect(readHomeView({ revision: 0, home: null, coverEtag: null })).toEqual({ revision: 0, home: null, coverEtag: null, updatedAt: null });
    const v = readHomeView({ revision: 4, coverEtag: "e1", home: { bio: 5, sidebarEntry: "yes", pins: [{ hostId: "local", kind: "service", key: "a", size: "xl" }, { kind: "nope" }], extra: [1], coverEtag: "e1" } });
    expect(v.home).toEqual({ pins: [{ hostId: "local", kind: "service", key: "a" }], extra: [1] });
    expect(readHomeDoc([])).toBeNull();
  });
  it("refuses a PUT the host would refuse", () => {
    expect(homePutBody(2, { bio: "ok", pins: [{ hostId: "local", kind: "agent", key: "eva", size: "s" }] })).toEqual({ revision: 2, home: { bio: "ok", pins: [{ hostId: "local", kind: "agent", key: "eva", size: "s" }] } });
    expect(homePutBody(0, null)).toEqual({ revision: 0, home: null });
    expect(() => homePutBody(-1, {})).toThrow();
    expect(() => homePutBody(1, { bio: "x".repeat(201) })).toThrow(/bio/);
    expect(() => homePutBody(1, { pins: [{ hostId: "local", kind: "file" as never, key: "a" }] })).toThrow(/pins/);
    expect(() => homePutBody(1, { pins: [{ hostId: "local", kind: "url", key: "https://x", title: "y".repeat(5000) }] })).not.toThrow();
    expect(() => homePutBody(1, { blob: "x".repeat(70 * 1024) })).toThrow(/too large/);
  });
});
