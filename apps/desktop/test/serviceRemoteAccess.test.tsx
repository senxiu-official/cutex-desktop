// @vitest-environment jsdom
// 允许 iPad 访问 (cutex services-remote-access-v1, owner 2026-11-24): a row of the service menu (服务 page / cards), only
// where the host offers it (not greyed elsewhere); turning it on is confirmed in place (medium risk: armed), turning it
// off applies at once (low risk); decided on the registration shown (ifRegistration) — a 409
// service_registration_changed re-reads the list and asks the owner to decide again, never retried. A service open to
// the iPad carries a low-key mark. lib/services.ts, modules/services/RemoteAccessMark.tsx.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ patchService: vi.fn(), refreshServices: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: { patchService: (...a: unknown[]) => m.patchService(...a) },
  apiFor: () => ({ patchService: (...a: unknown[]) => m.patchService(...a) }),
  bridge: {},
  onEvent: () => () => {},
  cleanIpcMessage: (s: string) => s,
}));

import { serviceMenu, setRemoteAccess } from "../src/renderer/src/lib/services";
import { RemoteAccessMark } from "../src/renderer/src/modules/services/RemoteAccessMark";
import { I18nProvider } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";
import { SERVICES_REMOTE_ACCESS_FEATURE } from "../src/shared/servicesSettings";
import type { ServiceView } from "../src/shared/ipc";
import { openMenuAt, closeMenu, closeDialog } from "../src/renderer/src/lib/contextMenu";
import { Overlays } from "../src/renderer/src/components/Overlays";

const svc = (extra: Partial<ServiceView> = {}) => ({ slug: "notes", displayName: "数学讲义", runtime: "managed", health: "reachable", lifetime: "persistent", archived: false, createdAt: "2026-11-23T04:00:00Z", ownerCutexSessionId: "cutex.a1", ...extra }) as ServiceView;
const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}(${Object.values(v).join(",")})` : k);
type Row = { label: string; armed?: string; armedTone?: string; info?: string; onSelect(): void };
const row = (s: ServiceView, onError = vi.fn()) =>
  (serviceMenu(s, t as never, onError).filter((e) => !!e && typeof e === "object" && "label" in e) as Row[]).find((e) => e.label.endsWith("services.remoteAccess"));
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  m.patchService.mockReset().mockImplementation(async (slug: string, patch: { remoteAccess: boolean }) => svc({ slug, remoteAccess: patch.remoteAccess }));
  m.refreshServices.mockReset().mockResolvedValue(undefined);
  useApp.setState({ hosts: { active: "local", hosts: [] } as never, features: new Set([SERVICES_REMOTE_ACCESS_FEATURE]), refreshServices: m.refreshServices });
});

describe("the menu row", () => {
  it("not shown (not greyed) on a host without services-remote-access-v1, for a worker, or an archived service", () => {
    useApp.setState({ features: new Set() });
    expect(row(svc())).toBeUndefined();
    useApp.setState({ features: new Set([SERVICES_REMOTE_ACCESS_FEATURE]) });
    expect(row(svc())).toBeDefined();
    expect(row(svc({ runtime: "worker" } as never))).toBeUndefined();
    expect(row(svc({ archived: true }))).toBeUndefined();
  });

  it("each host on its own: another host's service follows that host's capabilities", () => {
    useApp.setState({ byHost: { "ssh-eva": { features: new Set() } } as never });
    expect(serviceMenu(svc(), t as never, vi.fn(), undefined, "ssh-eva").some((e) => !!e && typeof e === "object" && "label" in e && String(e.label).endsWith("services.remoteAccess"))).toBe(false);
  });

  it("off → on: confirmed in place (armed), then PATCH with the registration it was decided on", async () => {
    const r = row(svc())!;
    expect(r.label).toBe("services.remoteAccess");
    expect(r.armed).toBe("services.remoteAccess.armed(数学讲义)");
    // Not destructive: the armed row in the primary colour, not the red of 删除.
    expect(r.armedTone).toBe("accent");
    r.onSelect();
    await settle();
    expect(m.patchService).toHaveBeenCalledWith("notes", { remoteAccess: true, ifRegistration: { createdAt: "2026-11-23T04:00:00Z", ownerCutexSessionId: "cutex.a1" } });
  });

  it("on → off: low risk, no confirm, at once", async () => {
    const r = row(svc({ remoteAccess: true }))!;
    expect(r.label).toBe("✓ services.remoteAccess");
    expect(r.armed).toBeUndefined();
    r.onSelect();
    await settle();
    expect(m.patchService).toHaveBeenCalledWith("notes", expect.objectContaining({ remoteAccess: false }));
  });

  it("409 service_registration_changed: the list is read again, the owner is asked to decide again, no retry", async () => {
    m.patchService.mockRejectedValue(new Error("409 service_registration_changed: refresh the row before retrying"));
    const onError = vi.fn();
    row(svc(), onError)!.onSelect();
    await settle();
    expect(m.patchService).toHaveBeenCalledTimes(1);
    expect(m.refreshServices).toHaveBeenCalledWith("local");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![0])).toMatch(/服务已变化|has changed/);
  });

  it("other errors pass through unchanged (no refresh)", async () => {
    m.patchService.mockRejectedValue(new Error("403 forbidden"));
    await expect(setRemoteAccess(svc(), "local", true)).rejects.toThrow("403 forbidden");
    expect(m.refreshServices).not.toHaveBeenCalled();
  });
});

describe("the mark", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  it("shows only on a service open to the iPad (absent on older hosts = none)", () => {
    act(() => root.render(h(I18nProvider, null, h(RemoteAccessMark, { on: true }))));
    const mark = host.querySelector("[data-remote-access]");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("aria-label")).toMatch(/iPad/);
    act(() => root.render(h(I18nProvider, null, h(RemoteAccessMark, { on: undefined }))));
    expect(host.querySelector("[data-remote-access]")).toBeNull();
    act(() => root.render(h(I18nProvider, null, h(RemoteAccessMark, { on: false }))));
    expect(host.querySelector("[data-remote-access]")).toBeNull();
  });
});

// Review 2026-11-24: a held Enter's auto-repeat must not confirm the armed row.
describe("the permission needs two deliberate confirmations", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root.render(h(I18nProvider, null, h(Overlays))));
  });
  afterEach(() => {
    act(() => { closeMenu(); closeDialog(); root.unmount(); }); host.remove();
  });
  const key = (key: string, repeat = false) => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, bubbles: true })));
  it("a held Enter must not grant access through auto-repeat", async () => {
    act(() => openMenuAt(20, 20, [row(svc())! as never]));
    key("ArrowDown");
    key("Enter");
    expect(document.querySelector("[data-armed]")).not.toBeNull();
    expect(m.patchService).not.toHaveBeenCalled();
    key("Enter", true);
    await settle();
    expect(m.patchService).not.toHaveBeenCalled();
  });
  it("closing and reopening the menu requires arming again", async () => {
    const action = row(svc())!;
    act(() => openMenuAt(20, 20, [action as never]));
    key("ArrowDown"); key("Enter");
    act(() => closeMenu());
    act(() => openMenuAt(20, 20, [action as never]));
    key("ArrowDown"); key("Enter");
    await settle();
    expect(m.patchService).not.toHaveBeenCalled();
    expect(document.querySelector("[data-armed]")).not.toBeNull();
  });
});
