// @vitest-environment jsdom
// A remote host's service while the Shelf shows another host (Director 2026-11-24, auto-switch): that host's agent is
// opened (the one viewed last, else its most recently active one), which brings its Shelf into view, and the service
// opens in the in-app tab there — from every entry point: the 服务 page / lines / cards (openService), a home pin
// (openPin), ⌘K (planOpen → runOpen), an agent's reveal card (openRevealed) and a service link (openServiceRef). Never the
// system browser; a host with no agent to open keeps the window-wide toast. lib/services.ts openOnItsHost.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ shown: "local", sideOpen: vi.fn(), openService: vi.fn(), openExternal: vi.fn(), openAgent: vi.fn() }));

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openService: (...a: unknown[]) => m.openService(...a), openExternal: (...a: unknown[]) => m.openExternal(...a) },
  apiFor: () => ({ openService: (...a: unknown[]) => m.openService(...a), openExternal: (...a: unknown[]) => m.openExternal(...a) }),
  bridge: {},
  onEvent: () => () => {},
  cleanIpcMessage: (s: string) => s,
}));
vi.mock("../src/renderer/src/modules/app", () => ({
  services: {
    side: { open: (...a: unknown[]) => m.sideOpen(...a) },
    ui: { notice: () => {} },
    refs: { open: async () => ({ status: "unavailable", reason: "gone" }) },
    panes: { open: () => ({ status: "unavailable", reason: "module-off" }) },
  },
}));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (hostId: string) => hostId === m.shown }));

import { openOnItsHost, openService, openServiceExternal, SHELF_SWITCH_MS, shelfAgentFor } from "../src/renderer/src/lib/services";
import { recordTurnEndOn, turnMarksOn, unreadCount } from "../src/renderer/src/lib/turnUnread";
import { useShelfToast } from "../src/renderer/src/lib/shelves";
import { ShelfToast } from "../src/renderer/src/components/side/ShelfToast";
import { I18nProvider } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";
import { openPin, openFailedText } from "../src/renderer/src/modules/home/open";
import { planOpen } from "../src/renderer/src/modules/quick-switch/model";
import { runOpen } from "../src/renderer/src/modules/quick-switch/open";
import { openRevealed } from "../src/renderer/src/modules/services/live";
import { openServiceRef } from "../src/renderer/src/modules/services/refTarget";
import { LOCAL_HOST_ID } from "../src/shared/hosts";

const REMOTE = "ssh-eva";
const agent = (id: string, lastActivityAt: string, visible = true) => ({ cutexSessionId: id, lastActivityAt, visible });
let host: HTMLDivElement;
let root: Root;
const toastOnScreen = () => document.querySelector("[data-shelf-toast]")?.textContent ?? null;
const flush = async (fn: () => unknown) => {
  await act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
};
/** What a selection does here: the store's selection, and the Shelf follows its host. */
const select = (id: string, hostId: string) => {
  m.shown = hostId;
  useApp.setState({ selectedId: id, selectedHost: hostId });
};
/** The remote host is connected and lists these agents. */
const remoteLists = (active: ReturnType<typeof agent>[]) =>
  useApp.setState({ byHost: { [REMOTE]: { sidebar: { active, retired: [], projects: null, hostRows: {} } } } as never });

beforeEach(() => {
  m.shown = LOCAL_HOST_ID;
  m.sideOpen.mockReset().mockReturnValue({ status: "opened" });
  m.openService.mockReset().mockResolvedValue({ slug: "board", url: "http://hosta:26180/", localUrl: "http://127.0.0.1:26180/" });
  m.openExternal.mockReset().mockResolvedValue(undefined);
  // Opening an agent selects it and shows its host's Shelf (the Shelf follows the open agent's host).
  m.openAgent.mockReset().mockImplementation(async (id: string, hostId: string) => select(id, hostId));
  useApp.setState({ selectedId: "here", selectedHost: LOCAL_HOST_ID, view: { kind: "conversation" }, openAgent: m.openAgent, hosts: { active: LOCAL_HOST_ID, hosts: [{ id: REMOTE, label: "EVA" }] } as never });
  remoteLists([agent("old", "2026-11-20T00:00:00Z"), agent("hidden", "2026-11-24T00:00:00Z", false), agent("busy", "2026-11-23T00:00:00Z")]);
  act(() => useShelfToast.setState({ toast: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(h(I18nProvider, null, h(ShelfToast))));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => useShelfToast.setState({ toast: null }));
});

/** The switch happened and the service opened in the tab bound to its host; nothing else. */
function switchedAndOpened(url = "cutex:service/board/") {
  expect(m.openAgent).toHaveBeenCalledWith("busy", REMOTE, expect.objectContaining({ keepUnread: true }));
  expect(m.sideOpen).toHaveBeenCalledWith("browser.service", { url }, expect.objectContaining({ binding: { kind: "host", hostId: REMOTE } }));
  expect(m.openService).not.toHaveBeenCalled();
  expect(m.openExternal).not.toHaveBeenCalled();
  expect(toastOnScreen()).toBeNull();
}

describe("which agent brings the host's Shelf into view", () => {
  it("its most recently active listed agent (hidden ones left out); none when the host lists none or is not connected", () => {
    expect(shelfAgentFor(REMOTE)).toBe("busy");
    remoteLists([]);
    expect(shelfAgentFor(REMOTE)).toBeNull();
    useApp.setState({ byHost: {} as never });
    expect(shelfAgentFor(REMOTE)).toBeNull();
  });
});

describe("every entry point switches to the service's host and opens it in the app", () => {
  it("the 服务 page / lines / cards (openService)", async () => {
    await flush(() => openService({ slug: "board" }, REMOTE));
    switchedAndOpened();
  });

  it("a home pin of a host out of view", async () => {
    await flush(() => openPin({ hostId: REMOTE, kind: "service", key: "board" }, openFailedText));
    switchedAndOpened();
  });

  it("⌘K (a service row of another host)", async () => {
    const plan = planOpen({ kind: "service", hostId: REMOTE, slug: "board" }, false, (id) => id === m.shown);
    expect(plan).toEqual({ via: "serviceExternal", hostId: REMOTE, slug: "board" });
    let outcome: unknown;
    await flush(async () => {
      outcome = await runOpen(plan, { panesOpen: () => ({ status: "opened" }) as never, refsOpen: async () => ({ status: "stale" }), openServiceExternal: async (slug, hostId) => void (await openServiceExternal({ slug }, hostId)), openShelfPage: () => false, openRef: async () => false });
    });
    expect(outcome).toEqual({ ok: true });
    switchedAndOpened();
  });

  it("an agent's reveal card", async () => {
    await flush(() => openRevealed({ services: { side: { open: (...a: unknown[]) => m.sideOpen(...a) }, ui: { notice: () => {} } }, t: (k: string) => k } as unknown as Parameters<typeof openRevealed>[0], { hostId: REMOTE, slug: "board", path: "/r/a.html" }));
    switchedAndOpened("cutex:service/board/r/a.html");
  });

  it("a service link in an agent's reply", async () => {
    let r: unknown;
    await flush(async () => {
      r = await openServiceRef({ hostId: REMOTE, kind: "service", key: "board/x", title: "board", params: {} }, "auto");
    });
    expect(r).toEqual({ status: "opened", where: "card" });
    switchedAndOpened("cutex:service/board/x");
  });

});

describe("fallbacks", () => {
  it("a host with no agent to open: no switch, the toast on screen, never the system browser", async () => {
    remoteLists([]);
    let opened: unknown;
    await flush(async () => {
      opened = await openOnItsHost("board", REMOTE, "/");
    });
    expect(opened).toBe("no-agent");
    await flush(() => openService({ slug: "board", displayName: "看板" } as never, REMOTE));
    expect(m.openAgent).not.toHaveBeenCalled();
    expect(m.openExternal).not.toHaveBeenCalled();
    expect(toastOnScreen()).toContain("EVA");
    expect(toastOnScreen()).toContain("看板");
  });

  it("the switch happened but the browser module is off: the toast says so (no system browser)", async () => {
    m.sideOpen.mockReturnValue({ status: "unavailable", reason: "module-off" });
    await flush(() => openService({ slug: "board" }, REMOTE));
    expect(m.openAgent).toHaveBeenCalledWith("busy", REMOTE, expect.objectContaining({ keepUnread: true }));
    expect(m.openExternal).not.toHaveBeenCalled();
    expect(toastOnScreen()).toContain("board");
  });

  it("this machine's service out of view keeps the system browser (its loopback URL)", async () => {
    m.shown = REMOTE;
    await flush(() => openServiceExternal({ slug: "board" }, LOCAL_HOST_ID, "/"));
    expect(m.openAgent).not.toHaveBeenCalled();
    expect(m.openExternal).toHaveBeenCalledWith("http://127.0.0.1:26180/");
  });
});

describe("cross-review 2026-11-24 boundaries", () => {
  it("only current candidates: hidden, archived (soft / permanent / retired) and no-longer-listed agents are skipped", () => {
    remoteLists([agent("h", "2026-11-24T09:00:00Z", false), { ...agent("soft", "2026-11-24T08:00:00Z"), archiveKind: "soft" } as never, { ...agent("ret", "2026-11-24T07:00:00Z"), retiredAt: "2026-11-24T07:30:00Z" } as never, agent("ok", "2026-11-01T00:00:00Z")]);
    expect(shelfAgentFor(REMOTE)).toBe("ok");
  });

  it("a stalled history load: the service opens as soon as the Shelf shows the host, not when history arrives", async () => {
    let finishHistory = () => {};
    m.openAgent.mockImplementation((id: string, hostId: string) => {
      select(id, hostId);
      return new Promise<void>((r) => (finishHistory = r));
    });
    let outcome: unknown;
    await flush(async () => {
      outcome = await openOnItsHost("board", REMOTE, "/");
    });
    expect(outcome).toBe("opened");
    expect(m.sideOpen).toHaveBeenCalledTimes(1);
    finishHistory();
  });

  it("the owner goes to another agent before the switch: nothing opens, no toast, and nothing opens later", async () => {
    let late = () => {};
    m.openAgent.mockImplementation((id: string, hostId: string) => new Promise<void>((r) => (late = () => (select(id, hostId), r()))));
    const pending = openOnItsHost("board", REMOTE, "/");
    await flush(() => useApp.setState({ selectedId: "elsewhere", selectedHost: LOCAL_HOST_ID }));
    expect(await pending).toBe("moved");
    await flush(async () => late());
    expect(m.sideOpen).not.toHaveBeenCalled();
  });

  it("the owner leaves the conversation view meanwhile (home page): nothing opens", async () => {
    m.openAgent.mockImplementation(() => new Promise<void>(() => {}));
    const pending = openOnItsHost("board", REMOTE, "/");
    await flush(() => useApp.setState({ view: { kind: "home" } as never }));
    expect(await pending).toBe("moved");
    expect(m.sideOpen).not.toHaveBeenCalled();
  });

  it("the Shelf never reaches the host (the agent is in another window): after SHELF_SWITCH_MS a toast says so; no late open", async () => {
    vi.useFakeTimers();
    try {
      m.openAgent.mockImplementation(async () => {});
      let opened: boolean | undefined;
      const run = openServiceExternal({ slug: "board" }, REMOTE, "/").then((r) => (opened = r));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHELF_SWITCH_MS + 10);
      });
      await run;
      expect(opened).toBe(false);
      expect(toastOnScreen()).toContain("EVA");
      expect(m.sideOpen).not.toHaveBeenCalled();
      // The selection arriving after the timeout opens nothing.
      await act(async () => select("busy", REMOTE));
      expect(m.sideOpen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("an agent shown in another window", () => {
  it("is not a candidate (switching to it would mean going to that window): the next one is", async () => {
    const { usePanes } = await import("../src/renderer/src/lib/paneStore");
    const { defaultLayout } = await import("../src/renderer/src/lib/paneLayout");
    const { useDesks } = await import("../src/renderer/src/lib/deskStore");
    const desk = "d000000000002";
    useDesks.setState({ desks: [{ deskId: desk, handle: {}, content: { kind: "conversation", hostId: REMOTE, sessionId: "busy" } }] as never });
    usePanes.of(desk).setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 220, hostId: REMOTE, sessionId: "busy" }) });
    try {
      expect(shelfAgentFor(REMOTE)).toBe("old");
    } finally {
      useDesks.setState({ desks: [] as never });
    }
  });
});

describe("the auto-opened agent keeps its unread mark", () => {
  it("select with keepUnread leaves the mark; a plain select clears it", async () => {
    recordTurnEndOn(REMOTE, "busy", { turnId: "t1", status: "completed" }, false);
    expect(unreadCount(turnMarksOn(REMOTE)["busy"])).toBe(1);
    await flush(() => useApp.getState().select("busy", REMOTE, { keepUnread: true }).catch(() => {}));
    expect(unreadCount(turnMarksOn(REMOTE)["busy"])).toBe(1);
    await flush(() => useApp.getState().select("busy2", REMOTE).catch(() => {}));
    await flush(() => useApp.getState().select("busy", REMOTE).catch(() => {}));
    expect(turnMarksOn(REMOTE)["busy"]).toBeUndefined();
  });

  it("openOnItsHost asks for keepUnread", async () => {
    await flush(() => openOnItsHost("board", REMOTE, "/"));
    expect(m.openAgent).toHaveBeenCalledWith("busy", REMOTE, expect.objectContaining({ keepUnread: true }));
  });
});

// Last: a select registers the host's recent view for the rest of this file (module state of the store).
describe("the agent viewed last", () => {
  it("the agent viewed last on that host comes first", async () => {
    useApp.setState({ openAgent: async (id: string, hostId: string) => void (m.shown = hostId, m.openAgent(id, hostId)) } as never);
    await flush(() => useApp.getState().select("old", REMOTE).catch(() => {}));
    m.openAgent.mockClear();
    m.shown = LOCAL_HOST_ID;
    expect(shelfAgentFor(REMOTE)).toBe("old");
  });
});
