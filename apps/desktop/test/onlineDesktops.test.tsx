// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ close: vi.fn(), toast: vi.fn(), rows: [] as object[], host: "h1" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, args?: object) => key + (args ? JSON.stringify(args) : "") }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ confirmDialog: async () => true }));
vi.mock("../src/renderer/src/lib/shelves", () => ({ showShelfToast: fx.toast }));
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ useHostAccess: () => ({ isOwner: false, userId: "owner", scope: "full" }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetFeatures: () => new Set(), useTargetHostId: () => fx.host }));
vi.mock("../src/renderer/src/lib/remoteClose", () => ({ ONLINE_DESKTOPS_ANCHOR: "online-desktops", useOnlineClients: () => ({ available: true, read: true, rows: fx.rows, close: fx.close }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => Date.now(), formatWhen: () => "just now", formatAbsolute: (seconds: number) => new Date(seconds * 1000).toISOString() }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: () => ({ users: async () => null }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ title, children }: { title: ReactNode; children: ReactNode }) => h("section", null, h("h3", null, title), children),
  SettingsGroup: ({ children }: { children: ReactNode }) => h("div", null, children),
  ListRow: ({ title, detail, actions }: { title: ReactNode; detail: ReactNode; actions: ReactNode }) => h("div", null, title, detail, actions),
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick(): void; disabled: boolean }) => h("button", { disabled, onClick }, children),
  ErrorNote: ({ children }: { children: ReactNode }) => h("p", { role: "alert" }, children),
  Loading: () => null, EmptyState: ({ children }: { children: ReactNode }) => h("p", null, children),
}));
import { OnlineDesktopsSection } from "../src/renderer/src/components/settings/OnlineDesktops";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, div: HTMLDivElement;
const row = (id: string, started: string) => ({ instanceId: id, connectedSince: started, lastSeen: new Date().toISOString(), deviceName: "remote", appName: "cutex-desktop", appVersion: "0.1.0", platform: "linux", state: "online", allowRemoteClose: true, self: false, userId: "owner", gate: "ok" });
beforeEach(() => {
  fx.host = "h1";
  fx.rows = [row("12345678-first", "2026-10-25T01:00:00Z"), row("abcdefgh-second", "2026-10-25T02:00:00Z")];
  fx.close.mockReset(); fx.toast.mockReset();
  div = document.createElement("div"); document.body.append(div); root = createRoot(div);
  act(() => root.render(h(OnlineDesktopsSection)));
});
afterEach(() => { act(() => root.unmount()); div.remove(); });
const click = async () => act(async () => div.querySelector<HTMLButtonElement>("button")!.click());
it("distinguishes same-host launches by connection time and instance ID", () => {
  expect(div.querySelectorAll('[data-testid="online-desktop"]')).toHaveLength(2);
  expect(div.textContent).toContain('remoteClose.instance{"id":"12345678"}');
  expect(div.textContent).toContain('remoteClose.instance{"id":"abcdefgh"}');
  expect(div.textContent).toContain("2026-10-25T01:00:00.000Z");
  expect(div.textContent).toContain("2026-10-25T02:00:00.000Z");
  expect(div.textContent).toContain("remoteClose.instancesHint");
});
it("announces the confirmed target by name", async () => {
  fx.close.mockResolvedValue({ ok: true, value: { instanceId: "12345678-first", state: "closing" } });
  await click();
  expect(fx.close).toHaveBeenCalledWith("12345678-first");
  expect(fx.toast).toHaveBeenCalledWith('remoteClose.closed{"device":"remote"}');
});
it.each(["remote_close_timeout", "remote_close_cancelled", "remote_close_disconnected"])("restores the close button and explains %s", async code => {
  fx.close.mockResolvedValue({ ok: false, error: { code, message: code } });
  await click();
  expect(div.querySelector('[role="alert"]')!.textContent).toBe(`remoteClose.refusal.${code}`);
  expect(div.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  expect(fx.toast).toHaveBeenCalledWith(`remoteClose.refusal.${code}`);
});
it("does not attach an old host's failure to the new host's settings", async () => {
  let done!: (value: unknown) => void;
  fx.close.mockReturnValue(new Promise(resolve => { done = resolve; }));
  await click();
  fx.host = "h2";
  act(() => root.render(h(OnlineDesktopsSection)));
  await act(async () => done({ ok: false, error: { code: "remote_close_timeout", message: "timeout" } }));
  expect(div.querySelector('[role="alert"]')).toBeNull();
  expect(div.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});
