// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "../src/shared/ipc";
import { NOTIFICATION_PAGES_FEATURE } from "../src/shared/notificationPaging";
import type { ListHosts } from "../src/renderer/src/lib/hostLists";
import type { HostData } from "../src/renderer/src/lib/hostScope";

const mocks = vi.hoisted(() => ({ hosts: null as unknown as ListHosts, refresh: vi.fn(), apis: new Map<string, { approvalsPage: ReturnType<typeof vi.fn>; approvals: ReturnType<typeof vi.fn> }>() }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ useListHosts: () => mocks.hosts, hostApi: (id: string) => mocks.apis.get(id) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (selector: (state: unknown) => unknown) => selector({ refreshApprovals: mocks.refresh }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/components/HostListParts", () => ({ MissingHosts: () => null, RowHost: () => null }));
vi.mock("../src/renderer/src/components/Page", () => ({ PageBody: ({ children }: { children: ReactNode }) => h("main", null, children), PageToolbar: ({ children }: { children: ReactNode }) => h("nav", null, children) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Segmented: ({ options, onChange }: { options: { value: string; label: string }[]; onChange(value: string): void }) => h("div", null, options.map(o => h("button", { key: o.value, onClick: () => onChange(o.value) }, o.label))) }));
vi.mock("../src/renderer/src/modules/approvals/PendingApprovalCard", () => ({ PendingCard: ({ record }: { record: ApprovalRecord }) => h("p", null, record.summary), Requester: () => null, When: () => null }));
import { ApprovalsPage } from "../src/renderer/src/modules/approvals/ApprovalsPage";
import { mock } from "../src/renderer/src/modules/approvals/mock";
import type { MockCore } from "../src/renderer/src/dev/mockTypes";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let node: HTMLDivElement, root: Root;
const record = (summary: string, state: ApprovalRecord["state"] = "approved"): ApprovalRecord => ({ approvalId: "same-id", kind: "managed_service", reason: "test", details: null, requesterCutexSessionId: "agent", requestSha256: "x", createdAt: "2026-11-04T00:00:00Z", summary, state });
function setup(ids = ["a"]) {
  mocks.hosts = { data: ids.map(hostId => ({ hostId, features: new Set(["owner-approvals", NOTIFICATION_PAGES_FEATURE]), approvals: [], sidebar: null, services: null }) as unknown as HostData), missing: [], stale: new Set(), marks: false, multi: ids.length > 1, look: () => null, focus: ids[0]! };
  for (const id of ids) mocks.apis.set(id, { approvalsPage: vi.fn().mockResolvedValue({ approvals: [], nextCursor: null }), approvals: vi.fn().mockResolvedValue([]) });
}
async function click(label: string, index = 0) {
  const button = [...node.querySelectorAll("button")].filter(b => b.textContent === label)[index];
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
}
beforeEach(() => { mocks.apis.clear(); mocks.refresh.mockClear(); node = document.createElement("div"); root = createRoot(node); setup(); });
afterEach(() => { act(() => root.unmount()); node.remove(); history.replaceState(null, "", "/"); });

it("keeps Pending on store data and shows continuation when the all-page contains only pending records", async () => {
  const a = mocks.apis.get("a")!;
  mocks.hosts.data[0]!.approvals = [record("Store pending", "pending")];
  a.approvalsPage.mockResolvedValueOnce({ approvals: [record("Page pending", "pending")], nextCursor: "opaque" })
    .mockResolvedValueOnce({ approvals: [record("Past decision")] });
  await act(async () => { root.render(h(ApprovalsPage)); });
  expect(node.textContent).toContain("Store pending");
  expect(a.approvalsPage).not.toHaveBeenCalled();
  await click("approvals.scope.decided");
  expect(node.textContent).toContain("approvals.noHistory");
  expect(node.textContent).not.toContain("Page pending");
  await click("delegation.loadMore");
  expect(node.textContent).toContain("Past decision");
  expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100, cursor: "opaque" });
  expect(node.textContent).not.toContain("delegation.loadMore");
});

it("renders equal IDs from different hosts separately and loads/reloads only the chosen host", async () => {
  setup(["a", "b"]);
  const a = mocks.apis.get("a")!, b = mocks.apis.get("b")!;
  a.approvalsPage.mockResolvedValue({ approvals: [record("Host A decision")], nextCursor: "a-next" });
  b.approvalsPage.mockResolvedValue({ approvals: [record("Host B decision")], nextCursor: "b-next" });
  await act(async () => { root.render(h(ApprovalsPage)); });
  await click("approvals.scope.decided");
  expect(node.textContent).toContain("Host A decision");
  expect(node.textContent).toContain("Host B decision");
  await click("delegation.loadMore", 1);
  expect(a.approvalsPage).toHaveBeenCalledTimes(1);
  expect(b.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100, cursor: "b-next" });
  await click("approvals.rules.refresh", 0);
  expect(a.approvalsPage).toHaveBeenLastCalledWith("all", { limit: 100 });
  expect(b.approvalsPage).toHaveBeenCalledTimes(2);
});

it("shows a retry control after a first-page failure and recovers without legacy fallback", async () => {
  const a = mocks.apis.get("a")!;
  a.approvalsPage.mockRejectedValueOnce(new Error("409 resync_required")).mockResolvedValueOnce({ approvals: [record("Recovered")] });
  await act(async () => { root.render(h(ApprovalsPage)); });
  await click("approvals.scope.decided");
  expect(node.querySelector('[role="alert"]')!.textContent).toBe("409 resync_required");
  await click("hostAction.retry");
  expect(node.textContent).toContain("Recovered");
  expect(a.approvals).not.toHaveBeenCalled();
});

it("opt-in s10pages mock history crosses two boundaries and retains pending and legacy behavior", async () => {
  history.replaceState(null, "", "/?s10pages");
  const api = mock.api!({ legacy: false } as MockCore);
  const first = (await api.approvalsPage!("all", { limit: 100 }))!;
  const second = (await api.approvalsPage!("all", { limit: 100, cursor: first.nextCursor! }))!;
  const third = (await api.approvalsPage!("all", { limit: 100, cursor: second.nextCursor! }))!;
  expect(first.approvals).toHaveLength(100);
  expect(second.approvals).toHaveLength(100);
  expect(third.approvals.length).toBeGreaterThan(0);
  expect(third.nextCursor).toBeNull();
  const combined = [...first.approvals, ...second.approvals, ...third.approvals];
  expect(new Set(combined.map(r => r.approvalId)).size).toBe(combined.length);
  expect(await api.approvals!("all")).toEqual(combined);
  expect((await api.approvals!("pending"))!.every(r => r.state === "pending")).toBe(true);
  expect(await mock.api!({ legacy: true } as MockCore).approvalsPage!("all")).toBeNull();
  history.replaceState(null, "", "/");
  expect((await api.approvalsPage!("all", { limit: 100 }))!.approvals.length).toBeLessThan(100);
});
