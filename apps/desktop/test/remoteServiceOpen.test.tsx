// @vitest-environment jsdom
// A remote host's service never opens its cutex `url` (`http://hosta:<port>`, the daemon machine's name) in the system
// browser (owner 2026-11-23: Hostb reached EVA over the relay, Tailscale down, every such open failed). On the host the
// Shelf shows it opens in the in-app tab (view ticket over the app's own connection); otherwise a notice says what to
// do — the window-wide toast (components/side/ShelfToast), not the composer notice, which shows only beside an open
// conversation (cross-review 2026-11-23: on the home page / 服务 page the click looked dead). 「在系统浏览器中打开」
// is disabled for it. This machine's services keep their loopback URL. lib/services.ts.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sideOpen = vi.fn();
const openService = vi.fn();
const openExternal = vi.fn();
let shownHost = "local";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openService: (...a: unknown[]) => openService(...a), openExternal: (...a: unknown[]) => openExternal(...a) },
  apiFor: () => ({ openService: (...a: unknown[]) => openService(...a), openExternal: (...a: unknown[]) => openExternal(...a) }),
  bridge: {},
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { open: (...a: unknown[]) => sideOpen(...a) } } }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (h: string) => h === shownHost }));

import { openService as open, openServiceExternal, serviceMenu, systemBrowserOpens } from "../src/renderer/src/lib/services";
import { useShelfToast } from "../src/renderer/src/lib/shelves";
import { ShelfToast } from "../src/renderer/src/components/side/ShelfToast";
import { I18nProvider } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";
import { LOCAL_HOST_ID } from "../src/shared/hosts";
import type { ServiceView } from "../src/shared/ipc";
import type { MenuEntry } from "../src/renderer/src/lib/contextMenu";

const notify = vi.fn();
const svc = { slug: "board", displayName: "看板", runtime: "managed", health: "reachable", url: "http://hosta:26180/", localUrl: "http://127.0.0.1:26180/" } as unknown as ServiceView;
const REMOTE = "ssh-eva";
let host: HTMLDivElement;
let root: Root;

/** The toast as drawn (null: none on screen). No conversation / composer is mounted: only the window-wide toast. */
const toastOnScreen = () => document.querySelector("[data-shelf-toast]")?.textContent ?? null;
const run = async (fn: () => Promise<unknown>) => {
  await act(async () => {
    await fn();
  });
};

beforeEach(() => {
  sideOpen.mockReset();
  openService.mockReset().mockResolvedValue({ slug: "board", url: "http://hosta:26180/", localUrl: "http://127.0.0.1:26180/" });
  openExternal.mockReset().mockResolvedValue(undefined);
  notify.mockReset();
  shownHost = LOCAL_HOST_ID;
  useApp.setState({ notify, hosts: { active: LOCAL_HOST_ID, hosts: [{ id: REMOTE, label: "EVA" }] } as never });
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

describe("a remote host's service", () => {
  it("only this machine opens services in the system browser", () => {
    expect(systemBrowserOpens(LOCAL_HOST_ID)).toBe(true);
    expect(systemBrowserOpens(REMOTE)).toBe(false);
  });

  it("on the host the Shelf shows: the in-app tab bound to it, nothing in the system browser, no toast", async () => {
    shownHost = REMOTE;
    sideOpen.mockReturnValue({ status: "opened" });
    await run(() => open(svc, REMOTE));
    expect(sideOpen).toHaveBeenCalledWith("browser.service", { url: "cutex:service/board/" }, expect.objectContaining({ binding: { kind: "host", hostId: REMOTE } }));
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastOnScreen()).toBeNull();
  });

  it("on a host the Shelf does not show: the toast on screen (no conversation open), never its host URL", async () => {
    expect(toastOnScreen()).toBeNull();
    await run(() => open(svc, REMOTE));
    expect(sideOpen).not.toHaveBeenCalled();
    expect(openService).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    const text = toastOnScreen();
    expect(text).toContain("EVA");
    expect(text).toContain("看板");
    // Not the composer notice (drawn only beside an open conversation).
    expect(notify).not.toHaveBeenCalled();
  });

  it("shown but the browser module is off: a different toast on screen, nothing in the system browser", async () => {
    await run(() => open(svc, REMOTE));
    const otherHost = toastOnScreen();
    shownHost = REMOTE;
    sideOpen.mockReturnValue({ status: "unavailable", reason: "module-off" });
    await run(() => open(svc, REMOTE));
    const text = toastOnScreen();
    expect(text).toContain("看板");
    expect(text).not.toBe(otherHost);
    expect(openExternal).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("every fallback entry (home pin, ⌘K, the reveal card) goes through openServiceExternal: refused with the toast, false", async () => {
    let opened: boolean | undefined;
    await run(async () => {
      opened = await openServiceExternal({ slug: "board" }, REMOTE, "/a");
    });
    expect(opened).toBe(false);
    expect(toastOnScreen()).toContain("board");
    await run(() => open(svc, REMOTE, "/", { external: true }));
    expect(openService).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("the menu's 「在系统浏览器中打开」 is disabled with its reason; this machine's is not", () => {
    const row = (hostId: string) => (serviceMenu(svc, (k) => k, () => {}, undefined, hostId).filter(Boolean) as Exclude<MenuEntry, string | false>[])
      .find((e) => !!e && typeof e === "object" && "label" in e && e.label === "services.openExternal") as { disabled?: boolean; title?: string };
    expect(row(REMOTE)).toMatchObject({ disabled: true, title: "services.remote.noSystemBrowser" });
    expect(row(LOCAL_HOST_ID)?.disabled).toBeFalsy();
  });
});

describe("this machine's service", () => {
  it("the system browser gets its loopback URL, as before; no toast", async () => {
    let opened: boolean | undefined;
    await run(async () => {
      opened = await openServiceExternal({ slug: "board" }, LOCAL_HOST_ID, "/x");
    });
    expect(opened).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:26180/x");
    expect(toastOnScreen()).toBeNull();
  });
});
