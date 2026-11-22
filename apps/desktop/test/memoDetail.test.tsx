// @vitest-environment jsdom
// 备忘 detail (owner 2026-11-19): a memo's title opens its detail instead of jumping (the jump's flash ring around the
// source turn was the "blue frame"); the text is selectable and copyable; 完成 / 不用了 / 重新放回 send the revision the
// owner saw and re-read on a 409; 回到原处 names the memo's host; the list asks cutex for its default (≤ 200) count.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerPin } from "../src/shared/ownerPins";

const fx = vi.hoisted(() => ({
  ownerPins: vi.fn(),
  ownerPinUpdate: vi.fn(),
  notice: vi.fn(),
  refsOpen: vi.fn(async (_ref: unknown, _opts?: unknown): Promise<unknown> => ({ status: "opened" })),
  sideOpen: vi.fn(),
  agentsOpen: vi.fn(),
  hosts: [] as string[],
  handlers: {} as Record<string, (payload: unknown) => void>,
  hostFile: vi.fn(async () => ({ base64: "", mime: "image/png", size: 0 })),
  fsFile: vi.fn(async () => ({ base64: "", mime: "image/png", size: 0 })),
  jumpToTurn: vi.fn(async () => ({ status: "focused" })),
  realRefs: false,
  browseDirs: vi.fn(async () => ({ home: "/home/x", dirs: [] })),
  setScope: vi.fn(async () => {}),
  useLink: vi.fn((_ref: unknown) => null),
  thumbnail: vi.fn(async (_ref: unknown, _max: number) => null),
  targets: null as unknown,
}));
// An artifact-like ref.target provider: its look (useLink) and image bytes (thumbnail) are the reads scoped Markdown
// must not make by itself.
fx.targets = [{ mode: "show", moduleId: "artifacts", item: { id: "artifacts.ref", kind: "artifact", role: "content", open: async () => ({ status: "opened", where: "page" }), useLink: (ref: unknown) => fx.useLink(ref), thumbnail: (ref: unknown, max: number) => fx.thumbnail(ref, max) } }];
vi.mock("../src/renderer/src/bridge", () => {
  const files = { hostFile: fx.hostFile, fsFile: fx.fsFile, browseDirs: fx.browseDirs, setScope: fx.setScope };
  return { api: files, apiFor: () => files, bridge: { on: (name: string, fn: (p: unknown) => void) => ((fx.handlers[name] = fn), () => {}) }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/jump", async (importOriginal) => ({ ...(await importOriginal<object>()), jumpToTurn: fx.jumpToTurn }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: (slot: string) => (slot === "ref.target" ? fx.targets : NO_ENTRIES), statuses: () => new Map(), modules: [] }),
  services: {
    daemonFor: (hostId: string) => (fx.hosts.push(hostId), { ownerPins: fx.ownerPins, ownerPinUpdate: fx.ownerPinUpdate }),
    ui: { notice: fx.notice },
    // The real routing (lib/refServices) when a test asks for it; the turn's final focus (lib/jump) stays a stub.
    refs: { open: async (ref: unknown, opts: unknown) => (fx.realRefs ? (await import("../src/renderer/src/lib/refServices")).refsOpen(ref as never, opts as never) : fx.refsOpen(ref, opts)) },
    side: { open: fx.sideOpen },
    agents: { open: fx.agentsOpen },
  },
}));
const NO_ENTRIES: never[] = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { translate } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";
import { parseList } from "../src/renderer/src/modules/bookmarks/model";
import { changePin, loadPins, startPinSync, tombstoneCount, usePins } from "../src/renderer/src/modules/bookmarks/pins/store";
import { pinRefOpener } from "../src/renderer/src/modules/bookmarks/pins/open";
import { PinBoard } from "../src/renderer/src/modules/bookmarks/pins/Board";
import { PinDetail } from "../src/renderer/src/modules/bookmarks/pins/Detail";

const pin = (id: string, over: Partial<OwnerPin> = {}): OwnerPin => ({
  pinId: `pin-${id}`, key: null, author: "agent", agentId: "alden", agentName: "Alden", kind: "todo", title: `title ${id}`, detail: null, links: [], turnId: null,
  state: "open", resolvedBy: null, resolution: null, createdAt: "2026-11-19T01:00:00Z", updatedAt: "2026-11-19T01:00:00Z", resolvedAt: null, revision: 3, ...over,
});

let root: Root | null = null;
let host: HTMLElement;
const openAgent = vi.fn(async () => {});
const realOpenAgent = useApp.getState().openAgent;
beforeEach(() => {
  vi.clearAllMocks();
  fx.hosts.length = 0;
  fx.realRefs = false;
  usePins.setState({ byHost: {} });
  openAgent.mockImplementation(async () => {});
  useApp.setState({ openAgent, hosts: undefined, selectedHost: null, selectedId: null, features: new Set<string>() } as never);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});
const render = (el: ReturnType<typeof h>) => act(() => { root = createRoot(host); root.render(el); });
const seed = (hostId: string, pins: OwnerPin[]) => usePins.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { pins, loaded: true, error: null } } }));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

describe("备忘 list and changes", () => {
  it("asks cutex for the list with no explicit limit (cutex caps it at 200 and refuses more)", async () => {
    fx.ownerPins.mockResolvedValue({ hostId: "h1", pins: [pin("a")], openCount: 1 });
    await loadPins("h1");
    expect(fx.ownerPins).toHaveBeenCalledWith({ state: "all" });
    expect(usePins.getState().byHost.h1?.pins.map((p) => p.pinId)).toEqual(["pin-a"]);
  });

  it("a state change carries the revision the owner saw", async () => {
    seed("h1", [pin("a", { revision: 7 })]);
    fx.ownerPinUpdate.mockResolvedValue({ ok: true, pin: pin("a", { revision: 8, state: "done" }) });
    await changePin("h1", "pin-a", { state: "done" });
    expect(fx.ownerPinUpdate).toHaveBeenCalledWith("pin-a", { state: "done", expectedRevision: 7 });
    expect(usePins.getState().byHost.h1?.pins[0]?.state).toBe("done");
    expect(fx.hosts).toEqual(["h1"]);
  });

  it("a 409 (the pin changed since) re-reads the list and says so, without overwriting", async () => {
    seed("h1", [pin("a", { revision: 3 })]);
    fx.ownerPinUpdate.mockResolvedValue({ ok: false, error: { code: "pin_revision_conflict", message: "the pin changed (revision 4); reload first" } });
    fx.ownerPins.mockResolvedValue({ hostId: "h1", pins: [pin("a", { revision: 4, title: "edited by the agent" })], openCount: 1 });
    await changePin("h1", "pin-a", { state: "dropped" });
    await vi.waitFor(() => expect(usePins.getState().byHost.h1?.pins[0]?.title).toBe("edited by the agent"));
    expect(fx.ownerPins).toHaveBeenCalledWith({ state: "all" });
    expect(fx.notice).toHaveBeenCalledWith(expect.any(String), "info");
  });

  it("a delete carries no revision", async () => {
    seed("h1", [pin("a")]);
    fx.ownerPinUpdate.mockResolvedValue({ ok: true, pin: null });
    await changePin("h1", "pin-a", { delete: true });
    expect(fx.ownerPinUpdate).toHaveBeenCalledWith("pin-a", { delete: true });
    expect(usePins.getState().byHost.h1?.pins).toEqual([]);
  });
});

describe("备忘 card state", () => {
  it("keeps a valid memo reference and drops a malformed one", () => {
    expect(parseList({ tab: "pins", pin: { hostId: "h1", pinId: "pin-a" } })).toEqual({ tab: "pins", pin: { hostId: "h1", pinId: "pin-a" } });
    expect(parseList({ tab: "pins", pin: null })).toEqual({ tab: "pins", pin: null });
    expect(parseList({ pin: { hostId: "h1", pinId: "../x" } })).toEqual({});
    expect(parseList({ pin: { pinId: "pin-a" } })).toEqual({});
  });
});

describe("备忘 row", () => {
  it("the title opens the detail and does not jump; the preview is selectable text outside any button", () => {
    seed("h1", [pin("a", { detail: "line one\nline two\nline three", turnId: "t-1" })]);
    const onOpen = vi.fn();
    render(h(PinBoard, { onOpen }));
    act(() => (host.querySelector("[data-owner-pin-open]") as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledWith({ hostId: "h1", pin: expect.objectContaining({ pinId: "pin-a" }) });
    expect(fx.refsOpen).not.toHaveBeenCalled();
    const preview = host.querySelector("[data-owner-pin-preview]")!;
    expect(preview.textContent).toBe("line one\nline two\nline three");
    expect(preview.closest("button")).toBeNull();
    expect(preview.className).toContain("select-text");
  });

  it("outside the card (the widget, the tool strip) the title opens the detail in the 备忘 card", () => {
    seed("h2", [pin("b")]);
    render(h(PinBoard, { compact: true }));
    act(() => (host.querySelector("[data-owner-pin-open]") as HTMLButtonElement).click());
    expect(fx.sideOpen).toHaveBeenCalledWith("bookmarks.list", { tab: "pins", pin: { hostId: "h2", pinId: "pin-b" } }, expect.anything());
  });
});

describe("备忘 detail", () => {
  it("shows the kind, the title, the author and the times; the body is selectable", () => {
    seed("h1", [pin("a", { kind: "decide", detail: "**pick** one", updatedAt: "2026-11-19T02:00:00Z" })]);
    render(h(PinDetail, { memo: { hostId: "h1", pinId: "pin-a" }, onBack: () => {} }));
    const detail = host.querySelector("[data-owner-pin-detail]")!;
    expect(detail.textContent).toContain("bookmarks.memo.kind.decide");
    expect(host.querySelector("[data-owner-pin-title]")?.textContent).toBe("title a");
    expect(detail.textContent).toContain("Alden");
    expect(detail.textContent).toContain("bookmarks.memo.detail.created");
    expect(detail.textContent).toContain("bookmarks.memo.detail.updated");
    expect(host.querySelector("[data-owner-pin-body]")?.textContent).toContain("pick one");
    expect(host.querySelector("article")?.className).toContain("select-text");
  });

  it("copy writes the raw markdown; a link's copy writes its target", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    seed("h1", [pin("a", { detail: "see `D:/x/y.md`\n\n- one", links: [{ target: "D:/Workspace/a b/c.md", label: "c" }] })]);
    render(h(PinDetail, { memo: { hostId: "h1", pinId: "pin-a" }, onBack: () => {} }));
    act(() => button("bookmarks.memo.copy").click());
    expect(writeText).toHaveBeenLastCalledWith("see `D:/x/y.md`\n\n- one");
    act(() => (host.querySelector("[data-owner-pin-copy-link]") as HTMLButtonElement).click());
    expect(writeText).toHaveBeenLastCalledWith("D:/Workspace/a b/c.md");
  });

  it("完成 sends the shown revision; 回到原处 without a turn opens the agent on the memo's host", async () => {
    seed("h2", [pin("a", { revision: 5 })]);
    fx.ownerPinUpdate.mockResolvedValue({ ok: true, pin: pin("a", { revision: 6, state: "done", resolvedBy: "owner", resolvedAt: "2026-11-19T03:00:00Z" }) });
    render(h(PinDetail, { memo: { hostId: "h2", pinId: "pin-a" }, onBack: () => {} }));
    act(() => button("bookmarks.memo.jump").click());
    expect(openAgent).toHaveBeenCalledWith("alden", "h2");
    expect(fx.agentsOpen).not.toHaveBeenCalled();
    await act(async () => button("bookmarks.memo.done").click());
    expect(fx.ownerPinUpdate).toHaveBeenCalledWith("pin-a", { state: "done", expectedRevision: 5 });
    // The open detail follows the cache: now resolved, it offers 重新放回.
    expect(host.querySelector("[data-owner-pin-detail]")?.getAttribute("data-pin-state")).toBe("done");
    expect(button("bookmarks.memo.reopen")).toBeTruthy();
  });

  // Review 2026-11-19: refs open on the active or the viewed host only; a memo of host B seen from host A first brings
  // B into view (its agent opened there), then the real routing reaches the turn.
  const twoHosts = () => useApp.setState({ hosts: { active: "A", hosts: [{ id: "A", kind: "local", label: "A" }, { id: "B", kind: "remote", label: "B" }], scope: { kind: "all" } }, selectedHost: null, selectedId: null } as never);
  it("回到原处 of a memo on another host: that host comes into view, then the real routing jumps to the turn", async () => {
    fx.realRefs = true;
    twoHosts();
    openAgent.mockImplementation((async (id: string, hostId: string) => useApp.setState({ selectedId: id, selectedHost: hostId } as never)) as never);
    seed("B", [pin("a", { turnId: "turn-9" })]);
    render(h(PinDetail, { memo: { hostId: "B", pinId: "pin-a" }, onBack: () => {} }));
    await act(async () => button("bookmarks.memo.jump").click());
    await vi.waitFor(() => expect(fx.jumpToTurn).toHaveBeenCalledWith("B", "alden", "turn-9"));
    expect(openAgent).toHaveBeenCalledWith("alden", "B");
    expect(fx.notice).not.toHaveBeenCalled();
  });
  it("a jump the routing still refuses says why instead of doing nothing", async () => {
    fx.realRefs = true;
    twoHosts(); // openAgent does not bring B into view here: the routing answers host-changed
    seed("B", [pin("a", { turnId: "turn-9" })]);
    render(h(PinDetail, { memo: { hostId: "B", pinId: "pin-a" }, onBack: () => {} }));
    await act(async () => button("bookmarks.memo.jump").click());
    await vi.waitFor(() => expect(fx.notice).toHaveBeenCalledWith(translate("bookmarks.memo.openFailed", { reason: translate("bookmarks.unavailable.host-changed") }), "error"));
    expect(fx.jumpToTurn).not.toHaveBeenCalled();
  });
  // Review 2026-11-19 (2): from a narrow device scope, a memo of a host outside it must not widen the scope to 所有设备
  // (main keeps that and picks the active host again): the owner is told, nothing changes. The real openAgent is in place.
  const narrow = () => useApp.setState({ openAgent: realOpenAgent, hosts: { active: "A", hosts: [{ id: "A", kind: "local", label: "A" }, { id: "B", kind: "remote", label: "Bee" }], groups: [], scope: { kind: "host", id: "A" } }, selectedHost: null, selectedId: null } as never);
  it("from a narrow scope, 回到原处 / 去对话里回答 / a cutex: link of a memo outside it change no scope and say why", async () => {
    fx.realRefs = true;
    narrow();
    seed("B", [pin("a", { kind: "decide", turnId: "turn-9" })]);
    render(h(PinDetail, { memo: { hostId: "B", pinId: "pin-a" }, onBack: () => {} }));
    await act(async () => button("bookmarks.memo.jump").click());
    await act(async () => button("bookmarks.memo.answer").click());
    const r = await pinRefOpener("B", pin("a"))({ hostId: "B", kind: "artifact", key: "af-1", title: "x", params: {} } as never, {});
    await new Promise((r) => setTimeout(r, 20));
    expect(r).toEqual({ status: "unavailable", reason: "host-changed" });
    expect(fx.notice).toHaveBeenCalledTimes(2);
    expect(fx.notice).toHaveBeenCalledWith(translate("bookmarks.memo.outOfScope", { host: "Bee" }), "info");
    expect(fx.setScope).not.toHaveBeenCalled();
    expect(useApp.getState().hosts).toMatchObject({ active: "A", scope: { kind: "host", id: "A" } });
    expect(useApp.getState().selectedHost).toBeNull();
    expect(fx.jumpToTurn).not.toHaveBeenCalled();
  });
  // Review 2026-11-19 (3): a cutex:agent mention in a memo, of an agent on a connected host outside the scope.
  it("from a narrow scope, an agent mention of a host outside it opens nothing and changes no scope", async () => {
    narrow();
    const sidebar = { active: [{ cutexSessionId: "cutex.ag-kai", displayName: "Kai", runtime: { status: "online" } }], retired: [], hostRows: {}, projects: null };
    useApp.setState({ byHost: { B: { sidebar } } } as never);
    seed("A", [pin("a", { detail: "ask [@Kai](cutex:agent/cutex.ag-kai@B) about it" })]);
    render(h(PinDetail, { memo: { hostId: "A", pinId: "pin-a" }, onBack: () => {} }));
    const chip = host.querySelector("[data-agent-mention=\"cutex.ag-kai\"]") as HTMLElement;
    expect(chip?.getAttribute("data-mention-host")).toBe("B");
    const notify = vi.fn();
    useApp.setState({ notify } as never);
    await act(async () => chip.click());
    await new Promise((r) => setTimeout(r, 20));
    expect(fx.setScope).not.toHaveBeenCalled();
    expect(useApp.getState().hosts).toMatchObject({ active: "A", scope: { kind: "host", id: "A" } });
    expect(useApp.getState().selectedId).toBeNull();
    expect(notify.mock.calls.map((c) => c.slice(0, 2))).toEqual([["gutter.unavailable", "error"]]); // 打不开：属于另一台主机
    useApp.setState({ byHost: {} } as never);
  });
  it("a cutex: link in a memo of another host brings that host into view before it opens", async () => {
    twoHosts();
    const order: string[] = [];
    openAgent.mockImplementation((async (id: string, hostId: string) => { order.push("agent " + hostId); useApp.setState({ selectedId: id, selectedHost: hostId } as never); }) as never);
    fx.refsOpen.mockImplementation((async (ref: { hostId: string }) => (order.push("ref " + ref.hostId), { status: "opened" })) as never);
    await pinRefOpener("B", pin("a"))({ hostId: "B", kind: "artifacts.viewer", key: "af-1", title: "x", params: {} } as never, {});
    expect(order).toEqual(["agent B", "ref B"]);
  });

  it("要你定 offers the conversation to answer in", () => {
    seed("h1", [pin("a", { kind: "decide" })]);
    render(h(PinDetail, { memo: { hostId: "h1", pinId: "pin-a" }, onBack: () => {} }));
    act(() => button("bookmarks.memo.answer").click());
    expect(openAgent).toHaveBeenCalledWith("alden", "h1");
  });

  it("a memo deleted while open says so; one not loaded yet says loading", () => {
    seed("h1", [pin("a")]);
    render(h(PinDetail, { memo: { hostId: "h1", pinId: "pin-a" }, onBack: () => {} }));
    act(() => usePins.setState({ byHost: { h1: { pins: [], loaded: true, error: null } } }));
    expect(host.querySelector("[data-owner-pin-detail]")?.textContent).toContain("bookmarks.memo.gone");
    act(() => usePins.setState({ byHost: {} }));
    expect(host.querySelector("[data-owner-pin-detail]")?.textContent).toContain("bookmarks.memo.loading");
  });

  // Review 2026-11-19: an agent's memo text never makes the app read a host file by itself; a path outside the workspace
  // is shown and copyable, not fetched.
  it("opening the detail makes no host-file request, even with host file reads and thumbnails on", async () => {
    useApp.setState({ features: new Set(["fs-file-read"]) } as never);
    seed("local", [pin("a", {
      detail: "![shot](D:/secret/shot.png)\n\nsee [ini](C:/Windows/win.ini) and [rc](~/.ssh/config)\n\n![chart](cutex:artifact/af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8@2) [report](cutex:artifact/af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8@1)",
      links: [{ target: "D:/secret/other.png", label: "other" }, { target: "cutex:artifact/af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8@3", label: "v3" }, { target: "~/notes.md", label: "notes" }],
    })]);
    render(h(PinDetail, { memo: { hostId: "local", pinId: "pin-a" }, onBack: () => {} }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const chip = [...host.querySelectorAll("[data-owner-pin-body] a")].find((a) => a.textContent?.includes("ini")) as HTMLElement;
    expect(chip).toBeTruthy();
    await act(async () => chip.click());
    expect(fx.hostFile).not.toHaveBeenCalled();
    expect(fx.fsFile).not.toHaveBeenCalled();
    // cutex: images and links are plain chips (no artifact bytes, no name / state look-up); ~ paths ask for no home.
    expect([...host.querySelectorAll("[data-cutex-ref=artifact]")].map((a) => a.textContent)).toEqual(["chart", "report", "v3"]);
    expect(host.querySelector("img")).toBeNull();
    expect(fx.thumbnail).not.toHaveBeenCalled();
    expect(fx.useLink).not.toHaveBeenCalled();
    expect(fx.browseDirs).not.toHaveBeenCalled();
    const rc = [...host.querySelectorAll("[data-owner-pin-body] a")].find((a) => a.textContent === "rc") as HTMLElement;
    await act(async () => rc.click());
    expect(fx.browseDirs).not.toHaveBeenCalled();
    expect(fx.hostFile).not.toHaveBeenCalled();
  });
});

// Review 2026-11-19: a list read must not undo what arrived while it was on the way.
describe("备忘 list read vs live changes", () => {
  const changed = (hostId: string, params: unknown) => fx.handlers.hostEvent!({ hostId, epoch: "e1", envelope: { cutex: { method: "cutex/ownerPin/changed", params } } });
  const deferred = () => { let resolve!: (v: unknown) => void; const promise = new Promise((r) => (resolve = r)); return { promise, resolve }; };
  let stop: AbortController;
  beforeEach(() => { stop = new AbortController(); startPinSync({ signal: stop.signal } as never); });
  afterEach(() => stop.abort());

  it("a delete and an update that arrive during a read survive its answer", async () => {
    seed("h1", [pin("a"), pin("b")]);
    const read = deferred();
    fx.ownerPins.mockReturnValueOnce(read.promise);
    const loading = loadPins("h1");
    await vi.waitFor(() => expect(fx.ownerPins).toHaveBeenCalled());
    changed("h1", { pinId: "pin-a", deleted: true });
    changed("h1", { pin: pin("b", { revision: 4, title: "b edited" }) });
    read.resolve({ hostId: "h1", pins: [pin("a"), pin("b")], openCount: 2 }); // the answer was taken before both
    await loading;
    expect(usePins.getState().byHost.h1?.pins.map((p) => [p.pinId, p.title])).toEqual([["pin-b", "b edited"]]);
  });

  it("an answer newer than a change it overlapped keeps the newer revision", async () => {
    seed("h1", [pin("a")]);
    const read = deferred();
    fx.ownerPins.mockReturnValueOnce(read.promise);
    const loading = loadPins("h1");
    await vi.waitFor(() => expect(fx.ownerPins).toHaveBeenCalled());
    changed("h1", { pin: pin("a", { revision: 4, title: "r4" }) });
    read.resolve({ hostId: "h1", pins: [pin("a", { revision: 5, title: "r5" })], openCount: 1 });
    await loading;
    expect(usePins.getState().byHost.h1?.pins[0]?.title).toBe("r5");
  });

  it("a 409 starts a fresh read even with one on the way, and only the fresh answer is kept", async () => {
    seed("h1", [pin("a", { revision: 3 })]);
    const stale = deferred();
    fx.ownerPins.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ hostId: "h1", pins: [pin("a", { revision: 4, title: "fresh" })], openCount: 1 });
    void loadPins("h1");
    await vi.waitFor(() => expect(fx.ownerPins).toHaveBeenCalledTimes(1));
    fx.ownerPinUpdate.mockResolvedValue({ ok: false, error: { code: "pin_revision_conflict", message: "changed" } });
    await changePin("h1", "pin-a", { state: "done" });
    await vi.waitFor(() => expect(fx.ownerPins).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(usePins.getState().byHost.h1?.pins[0]?.title).toBe("fresh"));
    stale.resolve({ hostId: "h1", pins: [pin("a", { revision: 3, title: "stale" })], openCount: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(usePins.getState().byHost.h1?.pins[0]?.title).toBe("fresh");
  });

  // Review 2026-11-19 (3): PATCH commits → delete event → PATCH answer: the answer must not bring the memo back.
  it("a PATCH answer arriving after the delete event does not resurrect the memo", async () => {
    seed("h1", [pin("a", { revision: 3 }), pin("b")]);
    const answer = deferred();
    fx.ownerPinUpdate.mockReturnValueOnce(answer.promise);
    const done = changePin("h1", "pin-a", { state: "done" });
    await vi.waitFor(() => expect(fx.ownerPinUpdate).toHaveBeenCalled());
    changed("h1", { pinId: "pin-a", deleted: true });
    answer.resolve({ ok: true, pin: pin("a", { revision: 4, state: "done" }) });
    await done;
    expect(usePins.getState().byHost.h1?.pins.map((p) => p.pinId)).toEqual(["pin-b"]);
    // Nor does a later event or list answer that still carries it.
    changed("h1", { pin: pin("a", { revision: 5 }) });
    fx.ownerPins.mockResolvedValueOnce({ hostId: "h1", pins: [pin("a", { revision: 4, state: "done" }), pin("b")], openCount: 1 });
    await loadPins("h1");
    expect(usePins.getState().byHost.h1?.pins.map((p) => p.pinId)).toEqual(["pin-b"]);
  });

  it("tombstones are bounded: at most 1000 per host, and dropped after ten minutes", async () => {
    seed("h1", []);
    for (let i = 0; i < 1005; i++) changed("h1", { pinId: `pin-t${i}`, deleted: true });
    expect(tombstoneCount("h1")).toBe(1000);
    // The oldest went first: an answer for the first one counts again, one for the newest does not.
    changed("h1", { pin: pin("t0") });
    changed("h1", { pin: pin("t1004") });
    expect(usePins.getState().byHost.h1?.pins.map((p) => p.pinId)).toEqual(["pin-t0"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      changed("h1", { pinId: "pin-late", deleted: true });
      expect(tombstoneCount("h1")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
