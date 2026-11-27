// @vitest-environment jsdom
// Owner 2026-11-28 「服务的打开方式又变成了默认系统浏览器，why」: in 所有主机 with another host's agent open, this machine's
// services went to the system browser (since 8f5a1a03c only remote services switched the Shelf to their host; this
// machine's kept the 2026-10-25 system-browser fallback, silently). Now every entry point opens them like a remote one:
// this machine's agent first, then the in-app tab (lib/services openServiceTab). The system browser only while the
// browser module is off, with a toast saying so.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ shown: "ssh-samplehostb", sideOpen: vi.fn(), openService: vi.fn(), openExternal: vi.fn(), openAgent: vi.fn() }));

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

import { useShelfToast } from "../src/renderer/src/lib/shelves";
import { ShelfToast } from "../src/renderer/src/components/side/ShelfToast";
import { I18nProvider } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";
import { openService, openServiceTab } from "../src/renderer/src/lib/services";
import { openPin, openFailedText } from "../src/renderer/src/modules/home/open";
import { planOpen } from "../src/renderer/src/modules/quick-switch/model";
import { runOpen } from "../src/renderer/src/modules/quick-switch/open";
import { openRevealed } from "../src/renderer/src/modules/services/live";
import { openServiceRef } from "../src/renderer/src/modules/services/refTarget";
import { LOCAL_HOST_ID } from "../src/shared/hosts";

const SAMPLEHOSTB = "ssh-samplehostb";
let host: HTMLDivElement;
let root: Root;
const toastOnScreen = () => document.querySelector("[data-shelf-toast]")?.textContent ?? null;
const flush = async (fn: () => unknown) => {
  await act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  // 所有主机, a Samplehostb agent open: the Shelf shows Samplehostb; this machine lists its agent `eva`.
  m.shown = SAMPLEHOSTB;
  m.sideOpen.mockReset().mockReturnValue({ status: "opened" });
  m.openService.mockReset().mockResolvedValue({ slug: "board", url: "http://samplehosta:26180/", localUrl: "http://127.0.0.1:26180/" });
  m.openExternal.mockReset().mockResolvedValue(undefined);
  m.openAgent.mockReset().mockImplementation(async (id: string, hostId: string) => {
    m.shown = hostId;
    useApp.setState({ selectedId: id, selectedHost: hostId });
  });
  useApp.setState({
    selectedId: "lead", selectedHost: SAMPLEHOSTB, view: { kind: "conversation" }, openAgent: m.openAgent,
    hosts: { active: LOCAL_HOST_ID, scope: { kind: "all" }, hosts: [{ id: LOCAL_HOST_ID, label: "SAMPLEHOSTA" }, { id: SAMPLEHOSTB, label: "Samplehostb" }] } as never,
    // The focus host (this machine) keeps its data at the top level (lib/hostScope hostData).
    sidebar: { active: [{ cutexSessionId: "eva", lastActivityAt: "2026-11-28T00:00:00Z", visible: true }], retired: [], projects: null, hostRows: {} } as never,
  });
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

/** This machine's agent opened (its Shelf in view), the service in the tab bound to this machine; never the system browser. */
function inApp(url = "cutex:service/board/") {
  expect(m.openAgent).toHaveBeenCalledWith("eva", LOCAL_HOST_ID, expect.objectContaining({ keepUnread: true }));
  expect(m.sideOpen).toHaveBeenCalledWith("browser.service", { url }, expect.objectContaining({ binding: { kind: "host", hostId: LOCAL_HOST_ID } }));
  expect(m.openExternal).not.toHaveBeenCalled();
  expect(toastOnScreen()).toBeNull();
}

describe("this machine's service while another host's agent is open (所有主机)", () => {
  it("服务 page 打开 / service lines / cards (openService)", async () => {
    await flush(() => openService({ slug: "board" }, LOCAL_HOST_ID));
    inApp();
  });

  it("a tray / desktop pin", async () => {
    await flush(() => openPin({ hostId: LOCAL_HOST_ID, kind: "service", key: "board" }, openFailedText));
    inApp();
  });

  it("⌘K", async () => {
    const plan = planOpen({ kind: "service", hostId: LOCAL_HOST_ID, slug: "board" }, false, (id) => id === m.shown);
    await flush(() => runOpen(plan, { panesOpen: () => ({ status: "opened" }) as never, refsOpen: async () => ({ status: "stale" }), openServiceTab: async (slug, hostId) => void (await openServiceTab({ slug }, hostId)), openShelfPage: () => false, openRef: async () => false }));
    inApp();
  });

  it("an agent's reveal card", async () => {
    await flush(() => openRevealed({ services: { side: { open: () => ({ status: "opened" }) }, ui: { notice: () => {} } }, t: (k: string) => k } as unknown as Parameters<typeof openRevealed>[0], { hostId: LOCAL_HOST_ID, slug: "board", path: "/" }));
    inApp();
  });

  it("a cutex:service link in chat", async () => {
    let r: unknown;
    await flush(async () => { r = await openServiceRef({ hostId: LOCAL_HOST_ID, kind: "service", key: "board", title: "board", params: {} }, "auto"); });
    inApp();
    expect(r).toEqual({ status: "opened", where: "card" });
  });
});

describe("the system browser only with the browser module off", () => {
  it("this machine's service: the system browser with its loopback URL, and a toast saying why", async () => {
    m.shown = LOCAL_HOST_ID;
    m.sideOpen.mockReturnValue({ status: "unavailable", reason: "module-off" });
    await flush(() => openService({ slug: "board", displayName: "看板" }, LOCAL_HOST_ID));
    expect(m.openExternal).toHaveBeenCalledWith("http://127.0.0.1:26180/");
    expect(toastOnScreen()).toContain("看板");
  });

  it("an open that fails for another reason does not fall back to the system browser", async () => {
    m.shown = LOCAL_HOST_ID;
    m.sideOpen.mockReturnValue({ status: "unavailable", reason: "host-offline" });
    await flush(() => openService({ slug: "board" }, LOCAL_HOST_ID));
    expect(m.openExternal).not.toHaveBeenCalled();
    expect(toastOnScreen()).toContain("board");
  });
});
