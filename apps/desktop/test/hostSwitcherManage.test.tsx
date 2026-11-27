// @vitest-environment jsdom
// The host switcher's rows: › opens that host's own page (picked for Settings), 连接 appears in words only
// on a host that is not connected, and disconnecting is not offered here. Every online host shows its cutex
// version after its name (owner 2026-11-28); a host whose version differs keeps the attention tag.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  openSettings: vi.fn(),
  connect: vi.fn(async () => {}),
  view: vi.fn(async () => {}),
  hosts: [] as unknown[],
}));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { active: "local", hosts: [{ id: "local", kind: "local" }], groups: [] }, openSettings: fx.openSettings, openAddHost: () => {} };
  const useApp = Object.assign((selector: (s: unknown) => unknown) => selector(state), { getState: () => state });
  return { useApp };
});
vi.mock("../src/renderer/src/lib/useHostScope", () => ({
  setHostConnected: fx.connect,
  setViewScope: fx.view,
  useHostScope: () => ({
    scope: { kind: "host", id: "local" },
    hosts: fx.hosts,
    hostsInScope: fx.hosts,
    focus: "local",
    host: (id: string) => (fx.hosts as { id: string }[]).find((x) => x.id === id),
  }),
}));

import { I18nProvider } from "../src/renderer/src/i18n";
import { HostSwitcher } from "../src/renderer/src/components/HostSwitcher";
import { setSettingsHost, settingsHostChoice } from "../src/renderer/src/lib/settingsHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const look = (id: string, connected: boolean, version: string, status = connected ? "online" : "disconnected") => ({
  id,
  label: id,
  kind: id === "local" ? "local" : "ssh",
  connected,
  inScope: true,
  version,
  build: version.startsWith("r") ? { release: version } : { commit: version },
  view: { kind: "ssh", label: id },
  indicator: { status },
});

let root: Root | null = null;
let box: HTMLDivElement;

async function openMenu() {
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(h(I18nProvider, null, h(HostSwitcher))));
  await vi.waitFor(() => expect(box.querySelector("button[aria-expanded]")).not.toBeNull());
  await act(async () => box.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
}

const row = (name: string) => [...box.querySelectorAll<HTMLElement>("[role=menuitem]")].find((x) => x.textContent?.startsWith(name))!;
const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("button")];

beforeEach(() => {
  vi.clearAllMocks();
  setSettingsHost(null);
  fx.hosts = [look("local", true, "r300"), look("a", true, "r300"), look("b", false, "r300")];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  box?.remove();
});

describe("host switcher rows", () => {
  it("› opens the host's own page", async () => {
    await openMenu();
    const manage = buttons(row("b")).find((x) => x.getAttribute("aria-label") === "Manage this host")!;
    act(() => manage.click());
    expect(settingsHostChoice()).toBe("b");
    expect(fx.openSettings).toHaveBeenCalledWith("access");
    expect(fx.view).not.toHaveBeenCalled();
  });

  it("offers 连接 only on a host that is not connected, and no disconnect", async () => {
    await openMenu();
    expect(buttons(row("b")).map((x) => x.textContent)).toContain("Connect");
    expect(buttons(row("a")).map((x) => x.textContent)).not.toContain("Connect");
    expect(buttons(row("a"))).toHaveLength(1);
    act(() => buttons(row("b")).find((x) => x.textContent === "Connect")!.click());
    expect(fx.connect).toHaveBeenCalledWith("b", true);
    expect(fx.view).not.toHaveBeenCalled();
  });

  const ver = (name: string) => row(name).querySelector<HTMLElement>("[data-host-version]");
  it("shows every online host's version after its name, also when all agree", async () => {
    fx.hosts = [look("local", true, "r298"), look("a", true, "r298")];
    await openMenu();
    expect(ver("local")?.textContent).toBe(" · r298");
    expect(ver("a")?.textContent).toBe(" · r298");
    expect(box.querySelector("[data-version-differs]")).toBeNull();
    // Not as an attention tag when they agree.
    expect(ver("a")!.querySelector("[data-tip]")!.getAttribute("data-tip")).toMatch(/^cutex r298/);
  });
  it("a host whose version differs keeps the attention tag (版本不一致 tip) in the same place", async () => {
    fx.hosts = [look("local", true, "r300"), look("a", true, "r300"), look("c", true, "r299")];
    await openMenu();
    expect(ver("c")?.textContent).toContain("r299");
    expect(ver("c")!.hasAttribute("data-version-differs")).toBe(true);
    expect(ver("c")!.querySelector("[data-tip]")!.getAttribute("data-tip")).toContain("Another cutex version");
    expect(ver("a")?.textContent).toContain("r300");
    expect(ver("a")!.hasAttribute("data-version-differs")).toBe(false);
  });
  it("no version on a host that is not online or whose version is unknown; a dev build says so", async () => {
    fx.hosts = [look("local", true, "abc1234"), look("a", false, "r300"), look("c", true, "r300", "connecting"), { ...look("d", true, "r300"), version: null, build: null }];
    await openMenu();
    expect(ver("local")?.textContent).toBe(" · dev build abc1234");
    expect(ver("a")).toBeNull();
    expect(ver("c")).toBeNull();
    expect(ver("d")).toBeNull();
  });
});
