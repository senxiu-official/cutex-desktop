// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServiceView } from "../src/shared/ipc";
import type { ServiceCardRow } from "../src/renderer/src/modules/services/ServiceCards";
const fx = vi.hoisted(() => ({ patch: vi.fn(), refresh: vi.fn(), error: vi.fn(), disabled: new Set<string>(), stale: new Set<string>() }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (host: string) => ({ patchService: (slug: string, patch: unknown) => fx.patch(host, slug, patch) }) }));
vi.mock("../src/renderer/src/lib/services", () => ({ openService: vi.fn() }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/services/i18n");
  return { useI18n: () => ({ t: (key: string, vars: Record<string, unknown> = {}) => ((zhCN as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? name)) }) };
});
import { ServiceCards } from "../src/renderer/src/modules/services/ServiceCards";
import { serviceOrganizationError } from "../src/renderer/src/modules/services/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement; let root: Root;
function row(key: string, purpose: string | null = null, lifetime: "persistent" | "ephemeral" = "persistent", groupName: string | null = null, hostId = "remote"): ServiceCardRow {
  return { key, hostId, item: { slug: key, displayName: key, host: "remote", port: 24001, path: null, ownerCutexSessionId: null, projectId: null, runtime: "managed", lifetime, purpose, groupName, createdAt: "", lastSeenAt: null, health: "reachable", url: "http://remote:24001", localUrl: "", process: null } satisfies ServiceView };
}
beforeEach(() => {
  fx.patch.mockReset().mockResolvedValue({}); fx.refresh.mockReset().mockResolvedValue(undefined); fx.error.mockReset(); fx.disabled.clear(); fx.stale.clear();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });
const render = async (rows: ServiceCardRow[]) => { await act(async () => root.render(h(ServiceCards, { rows, ownerName: () => "owner", hostName: () => "remote", stale: row => fx.stale.has(row.key), tileEnabled: () => false, organizable: row => !fx.disabled.has(row.key), menu: () => [], refresh: fx.refresh, error: fx.error }))); };
function event(type: string) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } });
  return e;
}
async function drag(key: string, target: string) {
  await act(async () => node.querySelector(`[data-service-card="${key}"]`)!.dispatchEvent(event("dragstart")));
  await act(async () => node.querySelector(`[data-service-section="${target}"]`)!.dispatchEvent(event("drop")));
}

it.each([null, "future-purpose"])("moves unclassified purpose=%s to a named section on the bound host", async purpose => {
  await render([row("unknown", purpose), row("front", "foreground", "persistent", "tools")]);
  expect(node.querySelector('[data-service-card="unknown"]')!.getAttribute("draggable")).toBe("true");
  await drag("unknown", "foreground");
  expect(fx.patch).toHaveBeenCalledWith("remote", "unknown", expect.objectContaining({ purpose: "foreground", groupName: null, sortOrder: expect.any(Number) }));
  expect(node.querySelector("[data-service-lifetime-confirm]")).toBeNull();
  expect(fx.refresh).toHaveBeenCalledOnce();
});

it("moves foreground cards back to unclassified and clears their group", async () => {
  await render([row("front", "foreground", "persistent", "tools"), row("unknown")]);
  await drag("front", "unknown");
  expect(fx.patch).toHaveBeenCalledWith("remote", "front", expect.objectContaining({ purpose: null, groupName: null }));
});

it("moves unclassified cards into a named group", async () => {
  await render([row("unknown"), row("front", "foreground", "persistent", "tools")]);
  await act(async () => node.querySelector('[data-service-card="unknown"]')!.dispatchEvent(event("dragstart")));
  await act(async () => node.querySelector('[data-service-group="tools"]')!.dispatchEvent(event("drop")));
  expect(fx.patch).toHaveBeenCalledWith("remote", "unknown", expect.objectContaining({ purpose: "foreground", groupName: "tools" }));
});

it("lets a temporary card enter unclassified only after explicit keep confirmation", async () => {
  await render([row("temp", null, "ephemeral"), row("unknown")]);
  await drag("temp", "unknown");
  expect(fx.patch).not.toHaveBeenCalled();
  expect(node.querySelector("[data-service-lifetime-confirm]")!.textContent).toContain("未分类");
  await act(async () => [...node.querySelectorAll("button")].find(b => b.textContent === "保留并移动")!.click());
  expect(fx.patch).toHaveBeenCalledWith("remote", "temp", expect.objectContaining({ lifetime: "persistent", purpose: null }));
});

it("confirms becoming temporary and allows cancelling without any writes", async () => {
  await render([row("unknown"), row("temp", null, "ephemeral")]);
  await drag("unknown", "temporary");
  expect(node.querySelector("[data-service-lifetime-confirm]")!.textContent).toContain("空闲或到期");
  expect(fx.patch).not.toHaveBeenCalled();
  await act(async () => [...node.querySelectorAll("button")].find(b => b.textContent === "dialog.cancel")!.click());
  expect(fx.patch).not.toHaveBeenCalled();
  await drag("unknown", "temporary");
  await act(async () => [...node.querySelectorAll("button")].find(b => b.textContent === "转为临时并移动")!.click());
  expect(fx.patch).toHaveBeenCalledWith("remote", "unknown", expect.objectContaining({ lifetime: "ephemeral", purpose: null }));
});

it("translates an old-host field rejection and refreshes after partial batch success", async () => {
  fx.patch.mockImplementation(async (_host: string, slug: string) => { if (slug === "unknown") throw Error("HTTP 400 invalid_request: unknown field `sortOrder`"); return {}; });
  await render([row("unknown"), row("front", "foreground")]);
  await drag("unknown", "foreground");
  expect(fx.error).toHaveBeenCalledWith("remote 这台主机需要升级 cutex 才能保存服务的分区、分组和排序");
  expect(fx.refresh).toHaveBeenCalledOnce();
});

it("does not renumber unsupported or stale neighbours from another host", async () => {
  fx.disabled.add("legacy"); fx.stale.add("stale");
  await render([row("unknown"), row("legacy", "foreground", "persistent", null, "old-host"), row("stale", "foreground", "persistent", null, "disconnected-host")]);
  await drag("unknown", "foreground");
  expect(fx.patch.mock.calls.every(call => call[0] === "remote")).toBe(true);
  expect(node.textContent).toContain("这台主机需要升级");
});

it("keeps unrelated errors intact", () => {
  expect(serviceOrganizationError(Error("Forbidden"), "upgrade")).toBe("Forbidden");
  expect(serviceOrganizationError(Error("unknown field `password`"), "upgrade")).toContain("password");
  expect(serviceOrganizationError(Error("unknown field `groupName`"), "upgrade")).toBe("upgrade");
});
