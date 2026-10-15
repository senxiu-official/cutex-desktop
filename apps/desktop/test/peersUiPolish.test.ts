import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { approvalDifferences, approvalFacts } from "../src/renderer/src/lib/approvals";
import { peerStateKey } from "../src/renderer/src/lib/delegations";
import { DelegationHops } from "../src/renderer/src/components/DelegationParts";
import { ApprovalDifferences } from "../src/renderer/src/modules/approvals/ApprovalDifferences";

let locale: "zh-CN" | "en" = "zh-CN";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: keyof typeof zhCN, vars?: Record<string, string | number>) => {
  const template = (locale === "zh-CN" ? zhCN : en)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
} }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useStatusWord: () => () => "" }));
beforeEach(() => { locale = "zh-CN"; });

const renderDiff = (value: unknown) => renderToStaticMarkup(createElement(ApprovalDifferences, { value }));

describe("delegation hop badge", () => {
  it.each([undefined, null, 0, 1])("hides %s hops in every shared surface", hops => {
    expect(renderToStaticMarkup(createElement(DelegationHops, { hops }))).toBe("");
  });
  it.each([2, 3])("shows %s hops in both languages", hops => {
    expect(renderToStaticMarkup(createElement(DelegationHops, { hops }))).toContain(`${hops} 跳`);
    locale = "en";
    expect(renderToStaticMarkup(createElement(DelegationHops, { hops }))).toContain(`${hops} hops`);
  });
});

describe("peer state words", () => {
  it.each(["pendingReview", "queued", "admitted", "running", "answered", "failed", "interrupted", "cancelled", "rejected", "completed", "accepted", "abandoned", "stopped", "superseded", "awaitingAcceptance", "changesRequested", "question", "waitingForInput", "waitingForApproval", "targetBusy", "paused", "blocked", "heldByRuntime", "runtimeUnsupported", "profileSwitchPending", "waitingForEvent", "peerUnreachable", "peerIdentityChanged", "peerVersionMismatch", "peerUnknown"])("maps %s to existing bilingual words", state => {
    const key = peerStateKey(state);
    expect(key).not.toBeNull();
    expect(zhCN[`delegation.status.${key}` as keyof typeof zhCN]).toBeTruthy();
    expect(en[`delegation.status.${key}` as keyof typeof en]).toBeTruthy();
  });
  it("reuses completed/running/accepted/question words and preserves unknown states", () => {
    expect(peerStateKey("answered")).toBe("answered");
    expect(peerStateKey("admitted")).toBe("starting");
    expect(peerStateKey("waitingForInput")).toBe("question");
    expect(peerStateKey("pausedByDirector")).toBeNull();
    expect(peerStateKey("toString")).toBeNull();
  });
});

describe("approval differences", () => {
  it("renders the daemon requester/target capability comparison as readable read-only rows", () => {
    const value = [
      { field: "sandbox", requester: "read-only", target: "workspace-write" },
      { field: "networkAccess", requester: false, target: true },
      { field: "writableRoots", requester: [], target: ["/work/a", "/work/b"] },
      { field: "managedServices", requester: "owner approval", target: "unrestricted" },
      { field: "reach", requester: ["project:demo"], target: "host" },
    ];
    expect(approvalDifferences(value)).toEqual(value);
    const html = renderDiff(value);
    expect(html).toContain("权限差异（请求方 → 承接方）");
    expect(html).toContain("沙箱：只读 → 工作区可写");
    expect(html).toContain("网络访问：否 → 是");
    expect(html).toContain("可写目录：无 → /work/a, /work/b");
    expect(html).toContain("托管服务权限：需要{{owner}}审批 → 无限制"); // display terms are applied at catalog load, not in this render
    expect(html).toContain("通信范围：project:demo → 整台主机");
    expect(html).not.toMatch(/<input|<button|<details/);
    locale = "en";
    expect(renderDiff(value)).toContain("Sandbox: Read-only → Workspace write");
  });
  it("keeps null, false, zero, unknown field names and literal strings", () => {
    const html = renderDiff([{ field: "futureField", requester: null, target: 0 }, { field: "x", requester: false, target: "<script>" }]);
    expect(html).toContain("futureField：未知 → 0");
    expect(html).toContain("x：否 → &lt;script&gt;");
  });
  it.each([{}, "future", [{ field: "sandbox", target: "x" }], [{ field: "sandbox", requester: {}, target: "x" }], [{ field: "sandbox", requester: "x", target: "y", extra: true }], [null]])("keeps unknown structure collapsed without discarding data: %j", value => {
    expect(approvalDifferences(value)).toBeNull();
    const html = renderDiff(value);
    expect(html).toContain("<details");
    expect(html).not.toContain(" open");
    expect(html).toContain("查看原始差异（JSON）");
    locale = "en";
    expect(renderDiff(value)).toContain("View raw differences (JSON)");
  });
  it("omits absent or empty differences and removes them from ordinary facts", () => {
    for (const value of [undefined, null, []]) expect(renderDiff(value)).toBe("");
    expect(approvalFacts({ differences: [{ field: "sandbox", requester: "a", target: "b" }], command: "echo test" })).toEqual([{ key: "command", value: "echo test", mono: true }]);
    expect(approvalFacts({ differences: { unknown: true } })).toEqual([]);
  });
});
