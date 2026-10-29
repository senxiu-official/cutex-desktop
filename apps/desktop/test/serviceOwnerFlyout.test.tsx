// @vitest-environment jsdom
// components/ServiceOwnerFlyout (Services 更换负责人, owner bug 2026-10-28): the flyout lists the
// service's OWN host's agents (Director and project members first, offline folded, one-off chats
// hidden until searched) and patches the service through that host's api — never the focus host's.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { ServiceView } from "../src/shared/ipc";

const fx = vi.hoisted(() => ({
  state: { hosts: { active: "local" } },
  data: {} as Record<string, { sidebar: unknown; features?: Set<string> }>,
  patch: vi.fn(),
  eligible: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: { serviceEligibleOwners: (...a: unknown[]) => fx.eligible("local", a), patchService: (...a: unknown[]) => fx.patch("local", a) },
  apiFor: (hostId: string) => ({ serviceEligibleOwners: (...a: unknown[]) => fx.eligible(hostId, a), patchService: (...a: unknown[]) => fx.patch(hostId, a) }),
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: (sel: (s: typeof fx.state) => unknown) => sel(fx.state) }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: (hostId: string) => fx.data[hostId] ?? null }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ closeMenu: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }) }));

import { ServiceOwnerFlyout } from "../src/renderer/src/components/ServiceOwnerFlyout";
import { closeMenu } from "../src/renderer/src/lib/contextMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, over: Partial<SessionResource> = {}): SessionResource =>
  ({ cutexSessionId: id, displayName: id, formalAgentName: null, displayNameOverride: null, registrationClass: null, runtime: { status: "online" }, ...over }) as SessionResource;
const service = (over: Partial<ServiceView> = {}) => ({ slug: "board", ownerCutexSessionId: null, projectId: "cutex-e", ...over }) as ServiceView;

/** Two hosts' sidebars: the flyout must read the service's own host, not the focus host. */
fx.data.remote = {
  sidebar: {
    active: [
      session("director", { formalAgentName: "director" }),
      session("member"),
      session("stranger"),
      session("off-1", { activityStatus: "offline" }),
      session("chat", { displayName: "Wait for one cross-agent nonce…", registrationClass: "local_only" }),
    ],
    retired: [],
    projects: { schema: "x", projects: [{ project_id: "cutex-e", director_cutex_session_id: "director" }] },
    hostRows: { member: { id: "member", projectId: "cutex-e" } },
  },
};
fx.data.local = { sidebar: { active: [session("local-agent")], retired: [], projects: null, hostRows: {} } };

let root: Root, host: HTMLDivElement, errors: string[];
function mount(hostId: string | undefined) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(h(ServiceOwnerFlyout, { service: service(), hostId, onError: (e: string) => errors.push(e) })));
}
const rows = () => [...host.querySelectorAll<HTMLElement>("[data-owner-id]")].map((b) => b.dataset.ownerId);
const group = (g: string) => host.querySelector(`[data-owner-group="${g}"]`)!;
async function search(text: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>("[data-owner-search]")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  errors = [];
  for (const data of Object.values(fx.data)) data.features = new Set();
  fx.eligible.mockReset();
  fx.patch.mockClear().mockImplementation((hostId: string, a: unknown[]) => Promise.resolve({ ok: true, host: hostId, args: a }));
  vi.mocked(closeMenu).mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("owner flyout", () => {
  it("lists the service host's agents: project group (Director + members), others, offline folded, unnamed hidden", () => {
    mount("remote");
    expect(group("project").textContent).toContain("services.owner.project");
    expect([...group("project").querySelectorAll<HTMLElement>("[data-owner-id]")].map((b) => b.dataset.ownerId)).toEqual(["director", "member"]);
    expect(group("project").querySelector<HTMLElement>("[data-owner-id=director]")!.textContent).toContain("services.owner.director");
    expect([...group("all").querySelectorAll<HTMLElement>("[data-owner-id]")].map((b) => b.dataset.ownerId)).toEqual(["stranger"]);
    // Offline strangers only as a folded count; the one-off chat is not offered unsearched.
    expect(group("offline").querySelector("[data-owner-id]")).toBeNull();
    expect(group("offline").textContent).toContain('services.owner.offline {"n":1}');
    expect(rows()).toEqual(["director", "member", "stranger"]);
  });

  it("expands the offline group on click", () => {
    mount("remote");
    act(() => group("offline").querySelector("button")!.click());
    expect(group("offline").querySelector("[data-owner-id=off-1]")).not.toBeNull();
  });

  it("search unmasks one-off chats and matches by id; an empty match says so", async () => {
    mount("remote");
    await search("nonce");
    expect(rows()).toEqual(["chat"]);
    expect(host.querySelector("[data-owner-id=chat]")!.textContent).toContain("services.owner.unnamed");
    await search("off-1");
    expect(rows()).toEqual(["off-1"]);
    await search("nobody");
    expect(rows()).toEqual([]);
    expect(host.textContent).toContain("services.owner.none");
  });

  it("patches through the service host's api (not the focus host) and closes the menu", async () => {
    mount("remote");
    await act(async () => void host.querySelector<HTMLElement>("[data-owner-id=stranger]")!.click());
    expect(fx.patch).toHaveBeenCalledWith("remote", ["board", { ownerCutexSessionId: "stranger" }]);
    expect(closeMenu).toHaveBeenCalledOnce();
  });

  it("uses the focus-host api when the service runs there", async () => {
    mount(undefined);
    await act(async () => void host.querySelector<HTMLElement>("[data-owner-id=local-agent]")!.click());
    expect(fx.patch).toHaveBeenCalledWith("local", ["board", { ownerCutexSessionId: "local-agent" }]);
  });

  it("reports a patch failure without closing the menu", async () => {
    mount("remote");
    fx.patch.mockImplementationOnce(() => Promise.reject(new Error("409")));
    await act(async () => void host.querySelector<HTMLElement>("[data-owner-id=stranger]")!.click());
    expect(errors).toEqual(["409"]);
    expect(closeMenu).not.toHaveBeenCalled();
  });
  it("fetches hidden candidates only from the capable service host and preserves grouping/search", async () => {
    fx.data.remote!.features = new Set(["services-eligible-owners"]);
    fx.eligible.mockResolvedValue({ hostId: "daemon-remote", slug: "board", owners: [
      { id: "hidden", name: "Hidden Keeper", realName: "keeper-formal", projectId: "cutex-e", isDirector: false, online: true, unnamed: false },
      { id: "off", name: "Offline keeper", realName: null, projectId: null, isDirector: false, online: false, unnamed: false },
      { id: "chat", name: "Untitled nonce", realName: null, projectId: null, isDirector: false, online: true, unnamed: true },
    ] });
    mount("remote");
    expect(host.textContent).toContain("services.owner.loading");
    expect(rows()).toEqual([]);
    await act(async () => {});
    expect(fx.eligible).toHaveBeenCalledExactlyOnceWith("remote", ["board"]);
    expect(rows()).toEqual(["hidden"]);
    await search("keeper-formal");
    expect(rows()).toEqual(["hidden"]);
    await search("nonce");
    expect(rows()).toEqual(["chat"]);
    await search("off");
    expect(rows()).toEqual(["off"]);
    await act(async () => void host.querySelector<HTMLElement>("[data-owner-id=off]")!.click());
    expect(fx.patch).toHaveBeenCalledWith("remote", ["board", { ownerCutexSessionId: "off" }]);
  });

  it("does not call the endpoint for a legacy service host even if the focus host supports it", () => {
    fx.data.local!.features = new Set(["services-eligible-owners"]);
    mount("remote");
    expect(fx.eligible).not.toHaveBeenCalled();
    expect(rows()).toContain("member");
    expect(rows()).not.toContain("local-agent");
  });

  it("keeps legitimate empty API results empty instead of using the sidebar", async () => {
    fx.data.remote!.features = new Set(["services-eligible-owners"]);
    fx.eligible.mockResolvedValue({ hostId: "remote", slug: "board", owners: [] });
    mount("remote");
    await act(async () => {});
    expect(rows()).toEqual([]);
    expect(host.textContent).toContain("services.owner.none");
  });

  it("keeps read failures in the flyout and retries without a sidebar fallback", async () => {
    fx.data.remote!.features = new Set(["services-eligible-owners"]);
    fx.eligible.mockRejectedValueOnce(new Error("503 unavailable")).mockResolvedValueOnce({ hostId: "remote", slug: "board", owners: [] });
    mount("remote");
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("503 unavailable");
    expect(rows()).toEqual([]);
    expect(errors).toEqual([]);
    await act(async () => void host.querySelector<HTMLElement>('[role="alert"] button')!.click());
    expect(fx.eligible).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("ignores an old host response after changing the service host", async () => {
    fx.data.remote!.features = new Set(["services-eligible-owners"]);
    fx.data.local!.features = new Set(["services-eligible-owners"]);
    let finish!: (value: unknown) => void;
    fx.eligible.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ hostId: "local", slug: "board", owners: [] });
    mount("remote");
    await act(async () => root.render(h(ServiceOwnerFlyout, { service: service(), hostId: "local", onError: (e: string) => errors.push(e) })));
    await act(async () => finish({ hostId: "remote", slug: "board", owners: [
      { id: "wrong-host", name: "Wrong host", online: true, unnamed: false, isDirector: false, projectId: null, realName: null },
    ] }));
    expect(rows()).toEqual([]);
    expect(fx.eligible.mock.calls.map((call) => call[0])).toEqual(["remote", "local"]);
  });

});
