// @vitest-environment jsdom
// 服务 cards (owner 2026-10-25, desktop 0.2.0 + cutex r259): a 未分类 card could not be dragged out. A host whose cutex
// predates the owner fields (no `services-organize`, r256) reports persistent services without a purpose, so they sit
// in 未分类 — its cards were silently not draggable, and moving any other card out of 未分类 renumbered theirs too, so
// that host refused the PATCH with serde's raw `unknown field \`sortOrder\``. Now: a card that cannot be moved says why,
// only rows whose host keeps the order are renumbered, and an old host's refusal reads 「…需要升级…」.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServicePatch, ServiceView } from "../src/shared/ipc";

const patches: { hostId: string; slug: string; patch: ServicePatch }[] = [];
const refuse = new Map<string, string>();
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: (hostId: string) => ({
    patchService: async (slug: string, patch: ServicePatch) => {
      patches.push({ hostId, slug, patch });
      const refusal = refuse.get(hostId);
      if (refusal) throw new Error(refusal);
      return {};
    },
    serviceTile: async () => null,
  }),
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key), locale: "zh-CN" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ServiceCards } = await import("../src/renderer/src/modules/services/ServiceCards");
const { isOrganizeUnsupported } = await import("../src/renderer/src/modules/services/model");
type Row = import("../src/renderer/src/modules/services/ServiceCards").ServiceCardRow;

const service = (slug: string, extra: Partial<ServiceView> = {}): ServiceView => ({
  slug, displayName: slug, host: "h", port: 1, path: null, ownerCutexSessionId: null, projectId: null, runtime: "managed", lifetime: "persistent", purpose: null,
  pinned: false, effectiveIdleTtlMinutes: null, maxIdleTtlMinutes: null, groupName: null, starred: false, sortOrder: 0, note: null, hidden: false, archived: false,
  createdAt: "2026-10-25T00:00:00Z", lastSeenAt: null, lastTrafficAt: null, health: "reachable", url: "", localUrl: "", process: null, ...extra,
} as ServiceView);
/** What an r256 cutex reports: no owner fields at all. */
const oldService = (slug: string): ServiceView => {
  const { purpose: _p, groupName: _g, starred: _s, sortOrder: _o, note: _n, hidden: _h, archived: _a, ...rest } = service(slug);
  return rest as ServiceView;
};
const row = (hostId: string, item: ServiceView): Row => ({ hostId, key: `${hostId}/${item.slug}`, item });

let host: HTMLDivElement;
let root: Root;
const errors: string[] = [];
let organizations = new Map<string, unknown[]>();
beforeEach(() => {
  patches.length = 0;
  errors.length = 0;
  refuse.clear();
  organizations = new Map();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(rows: Row[], { stale = [] as string[], organizable = ["new"] } = {}) {
  act(() => root.render(h(ServiceCards, {
    rows,
    ownerName: () => "owner",
    hostName: (r: Row) => (r.hostId === "old" ? "workstation" : "HOST-A"),
    stale: (r: Row) => stale.includes(r.hostId),
    tileEnabled: () => false,
    organizable: (r: Row) => organizable.includes(r.hostId),
    menu: (r: Row, organization: unknown[]) => { organizations.set(r.key, organization); return []; },
    refresh: async () => {},
    error: (message: string) => { errors.push(message); },
  })));
}
const card = (slug: string) => [...host.querySelectorAll<HTMLElement>("[role=button][aria-label]")].find((e) => e.getAttribute("aria-label")!.startsWith(`${slug} ·`))!;
const section = (name: string) => [...host.querySelectorAll("section")].find((s) => s.querySelector("h2 span")?.textContent === `services.purpose.${name}`)!;
function fire(target: Element, type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { setData() {}, effectAllowed: "", dropEffect: "" } });
  act(() => { target.dispatchEvent(event); });
  return event;
}
async function drag(slug: string, to: string) {
  const start = fire(card(slug), "dragstart");
  if (start.defaultPrevented) return false;
  fire(section(to).querySelector("h2")!, "dragover");
  fire(section(to).querySelector("h2")!, "drop");
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return true;
}

describe("服务 cards: 未分类 and hosts without services-organize", () => {
  const rows = () => [
    row("new", service("results")),
    row("new", service("console", { purpose: "foreground", sortOrder: 100 })),
    row("new", service("notes", { sortOrder: 300 })),
    row("old", oldService("grafana")),
  ];

  it("a 未分类 card of an organizable host moves to 前台; only that host's rows are renumbered", async () => {
    draw(rows(), { organizable: ["new"] });
    expect(await drag("results", "foreground")).toBe(true);
    expect(patches.every((p) => p.hostId === "new")).toBe(true);
    expect(patches.find((p) => p.slug === "results")!.patch).toMatchObject({ purpose: "foreground", groupName: null });
    // The old host's 未分类 row keeps its place, unpatched; no raw error.
    expect(patches.some((p) => p.slug === "grafana")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("…and back from 前台 to 未分类 (purpose null)", async () => {
    draw(rows(), { organizable: ["new"] });
    await drag("console", "unknown");
    expect(patches.find((p) => p.slug === "console")!.patch).toMatchObject({ purpose: null });
    expect(errors).toEqual([]);
  });

  it("an old host's card does not drag silently: it says the host needs an upgrade (tooltip, drag, menu)", async () => {
    draw(rows(), { organizable: ["new"] });
    expect(card("grafana").getAttribute("draggable")).toBe("true");
    expect(card("grafana").title).toContain("services.organize.upgrade");
    expect(await drag("grafana", "foreground")).toBe(false);
    expect(patches).toEqual([]);
    expect(errors).toEqual([`services.organize.upgrade ${JSON.stringify({ host: "workstation" })}`]);
    // Its ⋯ menu: the same reason, disabled, instead of an empty 移到 part.
    act(() => { (card("grafana").querySelector("button") as HTMLButtonElement).click(); });
    expect(organizations.get("old/grafana")).toEqual([expect.objectContaining({ label: expect.stringContaining("services.organize.upgrade"), disabled: true })]);
  });

  it("a card of a host that is not connected says so", async () => {
    draw(rows(), { organizable: ["new", "old"], stale: ["old"] });
    expect(await drag("grafana", "foreground")).toBe(false);
    expect(errors[0]).toContain("services.organize.offline");
  });

  it("a host that still refuses a field (unknown field) gets the plain upgrade message, not the serde text", async () => {
    refuse.set("new", "invalid_request: unknown field `sortOrder`, expected one of `displayName`, `path`");
    draw(rows(), { organizable: ["new"] });
    await drag("results", "foreground");
    expect(errors).toEqual([`services.organize.upgrade ${JSON.stringify({ host: "HOST-A" })}`]);
  });

  it("other failures keep their own message", async () => {
    refuse.set("new", "not_found: results");
    draw(rows(), { organizable: ["new"] });
    await drag("results", "foreground");
    expect(errors).toEqual(["not_found: results"]);
  });

  it("isOrganizeUnsupported: serde's unknown-field refusal of an owner field only", () => {
    expect(isOrganizeUnsupported("invalid_request: unknown field `sortOrder`, expected one of `displayName`")).toBe(true);
    expect(isOrganizeUnsupported("unknown field `groupName`")).toBe(true);
    expect(isOrganizeUnsupported("invalid_request: unknown field `agentPersistentApproval`")).toBe(false);
    expect(isOrganizeUnsupported("purpose must be foreground or background")).toBe(false);
  });
});
