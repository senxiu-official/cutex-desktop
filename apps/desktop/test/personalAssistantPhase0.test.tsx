// @vitest-environment jsdom
// 个人助理 phase 0 (2026-11-27): the create form never starts on a Profile that can't run an assistant (only Claude
// Subscription has the tools; the host's r299 verdicts win when given); the 权限 card can't choose levels / operations
// the host can't carry out and says what is set versus what takes effect; 历史 names the assistant's own session by the
// assistant's name; requests waiting for the owner are 需要你 items (one per assistant, × until the set changes).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import type { PaAssistant, PaAuditRow, PaRequest, PaView } from "../src/shared/personalAssistants";

let auditRows: PaAuditRow[] = [];
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  hostApi: () => ({
    paAudit: () => Promise.resolve({ items: structuredClone(auditRows), nextCursor: null }),
    paGet: () => Promise.reject(new Error("not in this test")),
  }),
  openHostAgent: () => Promise.resolve(),
}));

import { I18nProvider } from "../src/renderer/src/i18n";
import { ASSISTANT_NEED_PREFIX, assistantNeedItems, assistantNeedKey, withAssistantNeeds } from "../src/renderer/src/lib/assistantNeeds";
import type { NeedItem } from "../src/renderer/src/lib/needItems";
import { needFingerprint } from "../src/renderer/src/lib/needsYouDismiss";
import type { HostPa } from "../src/renderer/src/lib/personalAssistantStore";
import { AuditList } from "../src/renderer/src/modules/personal-assistants/AuditList";
import { GrantsCard } from "../src/renderer/src/modules/personal-assistants/GrantsCard";
import { assistantProfileChoices, clientProfileReason, effectiveOperations, effectiveTier, grantSupport, pickAssistantProfile } from "../src/renderer/src/modules/personal-assistants/readiness";
import type { PaHost } from "../src/renderer/src/modules/personal-assistants/paHooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile = (name: string, cliKind: string, authKind: ProfileItem["authKind"], interfaces?: string[]) =>
  ({ name, cliKind, authKind, model: null, ...(interfaces ? { providerInterfaces: interfaces.map((kind) => ({ kind, baseUrl: null })) } : {}) }) as unknown as ProfileItem;

describe("which Profiles can run an assistant", () => {
  const omega = profile("omega", "codex", "chatgpt", ["chatgptLogin"]);
  const deepseek = profile("deepseek", "dsh", "apiKey", ["deepseekNative"]);
  const claude = profile("claude", "claude", "claude", ["claudeSubscription"]);
  const claudeKey = profile("claude-api", "claude", "apiKey", ["anthropicCompatible"]);
  const claudeOld = profile("claude-old", "claude", "none");
  const claudeOldKey = profile("claude-old-key", "claude", "apiKey");

  it("only a Claude Profile signed in with the subscription", () => {
    expect(clientProfileReason(omega)).toBe("notClaude");
    expect(clientProfileReason(deepseek)).toBe("notClaude");
    expect(clientProfileReason(claude)).toBeNull();
    expect(clientProfileReason(claudeKey)).toBe("notSubscription");
    // A host without provider interfaces: an API key is not the subscription.
    expect(clientProfileReason(claudeOld)).toBeNull();
    expect(clientProfileReason(claudeOldKey)).toBe("notSubscription");
  });

  it("lists usable ones first and never starts on an unusable one, even the host default", () => {
    const choices = assistantProfileChoices([omega, deepseek, claude, claudeKey]);
    expect(choices.map((c) => [c.name, c.eligible])).toEqual([["claude", true], ["omega", false], ["deepseek", false], ["claude-api", false]]);
    expect(pickAssistantProfile(choices, "", "omega")).toBe("claude");
    expect(pickAssistantProfile(choices, "omega", null)).toBe("claude");
    expect(pickAssistantProfile(assistantProfileChoices([omega]), "", "omega")).toBe("");
  });

  it("r299 create-options decide: the host's verdicts in its order; a Profile it doesn't name is not usable", () => {
    const host = [
      { id: "c", name: "claude", runtime: "claude", eligible: false, reason: "assistant_runtime_unsupported", runtimePin: null },
      { id: "o", name: "omega", runtime: "codex", eligible: true, reason: null, runtimePin: "codex-r9" },
    ];
    const choices = assistantProfileChoices([omega, claude, deepseek], host);
    expect(choices).toEqual([
      { name: "omega", model: null, eligible: true, reason: null, runtimePin: "codex-r9" },
      { name: "claude", model: null, eligible: false, reason: "assistant_runtime_unsupported", runtimePin: null },
      { name: "deepseek", model: null, eligible: false, reason: "notListed" },
    ]);
    // An empty eligible set is "none", never the host default.
    expect(pickAssistantProfile(assistantProfileChoices([claude], []), "", "claude")).toBe("");
  });
});

describe("what the host can carry out", () => {
  it("today: 收件箱 and 协调; 项目管理 / 运维 and the operations only with owner-operation delegation", () => {
    const now = grantSupport({ localDirectorRequests: true, ownerOperationDelegation: false });
    expect([...now.tiers]).toEqual(["inbox", "coordinator"]);
    expect([...now.operations]).toEqual([]);
    expect(effectiveTier("operational", now)).toBe("coordinator");
    expect(effectiveOperations(["publishing", "liveServices"], "operational", now)).toEqual([]);
    const later = grantSupport({ ownerOperationDelegation: true });
    expect([...later.tiers]).toEqual(["inbox", "coordinator", "projectAdmin", "operational"]);
    expect(effectiveOperations(["publishing", "liveServices"], "operational", later)).toEqual(["liveServices", "publishing"]);
    // Operations count only at 运维.
    expect(effectiveOperations(["publishing"], "projectAdmin", later)).toEqual([]);
  });

  it("r299 details per key win over the booleans", () => {
    const d = (unsupported: boolean) => ({ configured: true, effective: false, unsupported, reason: unsupported ? "host_unsupported" : "not_granted" });
    const s = grantSupport({ ownerOperationDelegation: false }, { projectAdmin: d(false), publishing: d(false), liveServices: d(true), localDirectorRequests: d(true) });
    expect([...s.tiers]).toEqual(["inbox", "projectAdmin", "operational"]);
    expect([...s.operations]).toEqual(["publishing"]);
    expect(effectiveTier("coordinator", s)).toBe("inbox");
  });
});

const assistant = (id: string, name: string, extra: Partial<PaAssistant> = {}): PaAssistant => ({
  id, revision: 3, enabled: true, sessionId: `${id}-s`, coordinationProjectId: null,
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name, profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] },
  ...extra,
}) as PaAssistant;
const req = (id: string, assistantId: string, state: PaRequest["state"]): PaRequest => ({
  id, assistantId, projectId: "desktop", outcome: "x", constraints: "", sourceRef: "", director: null, assistantRevision: 3, state, revision: 1, updatedAt: "2026-11-27T01:00:00Z", detail: null,
}) as unknown as PaRequest;
const hostPa = (assistants: PaAssistant[], requests: Record<string, PaRequest[]>, loadedAt: number | null = 1): HostPa => ({
  instanceId: "inst-a", assistants, views: {}, requests, moreRequests: {}, ticks: {}, sendsTemplates: false, loadedAt, loading: false, error: null,
});

describe("assistant requests in 需要你", () => {
  const byHost = {
    a: hostPa([assistant("pa-1", "生活助理"), assistant("pa-2", "研究助理")], { "pa-1": [req("r2", "pa-1", "awaitingOwner"), req("r1", "pa-1", "awaitingOwner"), req("r3", "pa-1", "queued")], "pa-2": [req("r9", "pa-2", "completed")] }),
    b: hostPa([assistant("pa-3", "远程助理")], { "pa-3": [req("r5", "pa-3", "awaitingOwner")] }, null),
    c: hostPa([assistant("pa-4", "别处助理")], { "pa-4": [req("r6", "pa-4", "awaitingOwner")] }),
  };

  it("one item per assistant with waiting requests, on read hosts in view", () => {
    const items = assistantNeedItems(byHost, ["a", "b"], {});
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item!.key).toBe(assistantNeedKey("a", "pa-1"));
    expect(item!.chip).toMatchObject({ name: "生活助理", signal: "needsYou", count: 2, hostId: "a" });
    expect(item!.need).toEqual({ count: 2, reasons: [], askIds: ["r1", "r2"] });
    expect(item!.assistant).toEqual({ assistantId: "pa-1" });
    expect(item!.row).toBeUndefined();
    // lib/attentionActivate opens the assistant's 请求 tab for this id.
    expect(item!.chip.id).toBe(`${ASSISTANT_NEED_PREFIX}pa-1`);
  });

  it("× hides it until the set of waiting requests changes; tracking keeps the dismissal while it applies", () => {
    const key = assistantNeedKey("a", "pa-1");
    const fp = needFingerprint({ count: 2, reasons: [], askIds: ["r1", "r2"] });
    expect(assistantNeedItems(byHost, ["a"], { [key]: { fp, at: 1 } })).toHaveLength(0);
    const more = { ...byHost, a: hostPa(byHost.a.assistants, { ...byHost.a.requests, "pa-1": [...byHost.a.requests["pa-1"]!, req("r4", "pa-1", "awaitingOwner")] }) };
    expect(assistantNeedItems(more, ["a"], { [key]: { fp, at: 1 } })).toHaveLength(1);
    const track = { current: new Map<string, string>(), inView: new Set<string>() };
    assistantNeedItems(byHost, ["a", "b"], {}, track);
    expect(track.current).toEqual(new Map([[key, fp]]));
    // Every assistant of a read host is in view (a × of one with nothing waiting goes); unread hosts are not.
    expect([...track.inView]).toEqual([key, assistantNeedKey("a", "pa-2")]);
  });

  it("joins after the agents that need you, before 出错", () => {
    const item = (key: string, signal: "needsYou" | "error") => ({ key, chip: { signal } }) as unknown as NeedItem;
    const [pa] = assistantNeedItems(byHost, ["a"], {});
    expect(withAssistantNeeds([item("x", "needsYou"), item("y", "error")], [pa!]).map((i) => i.key)).toEqual(["x", pa!.key, "y"]);
    expect(withAssistantNeeds([item("x", "needsYou")], [pa!]).map((i) => i.key)).toEqual(["x", pa!.key]);
  });
});

let container: HTMLDivElement;
let root: Root;
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const render = async (node: ReturnType<typeof h>) => {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await settle();
};

beforeEach(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const view = (a: PaAssistant, caps: PaView["capabilities"]): PaView => ({ assistant: a, overlaps: [], moreOverlaps: false, availability: "ready", activeProfile: "claude", capabilities: caps });

describe("权限 card", () => {
  it("levels and operations the host can't carry out can't be chosen; everything set is in effect", async () => {
    await render(h(GrantsCard, { hostId: "a", hostLabel: "EVA", view: view(assistant("pa-1", "生活助理"), { localDirectorRequests: true, ownerOperationDelegation: false }), readOnly: false }));
    const radio = (v: string) => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')][["inbox", "coordinator", "projectAdmin", "operational"].indexOf(v)]!;
    expect(radio("inbox").disabled).toBe(false);
    expect(radio("coordinator").disabled).toBe(false);
    expect(radio("projectAdmin").disabled).toBe(true);
    expect(radio("operational").disabled).toBe(true);
    expect(container.querySelectorAll("[data-pa-op-unsupported]")).toHaveLength(4);
    const boxes = [...container.querySelectorAll<HTMLButtonElement>("[data-pa-operations] [role=checkbox]")];
    expect(boxes).toHaveLength(4);
    expect(boxes.every((c) => c.disabled)).toBe(true);
    expect($("[data-pa-grants-effective]")!.dataset.paGrantsEffective).toBe("same");
    expect($("[data-pa-grants-configured]")!.textContent).toContain("生活助理");
  });

  it("an unsupported level set earlier stays shown and says what takes effect instead", async () => {
    const a = assistant("pa-1", "生活助理", { grants: { tier: "operational", operations: ["publishing"], fullOwner: false } });
    await render(h(GrantsCard, { hostId: "a", hostLabel: "EVA", view: view(a, { localDirectorRequests: true }), readOnly: false }));
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios[3]!.checked).toBe(true);
    expect(radios[3]!.disabled).toBe(false);
    expect(radios[2]!.disabled).toBe(true);
    const publishing = $('[data-pa-operation="publishing"] [role=checkbox]') as HTMLButtonElement;
    expect(publishing.getAttribute("aria-checked")).toBe("true");
    expect(publishing.disabled).toBe(false);
    const effective = $("[data-pa-grants-effective]")!;
    expect(effective.dataset.paGrantsEffective).toBe("less");
    expect(effective.textContent).toContain("协调");
  });
});

describe("历史", () => {
  it("the assistant's own session goes by the assistant's name; others by their session name", async () => {
    auditRows = [
      { seq: 2, actor: "pa-1-s", actionId: "x2", verb: "prepare", at: "2026-11-27T01:00:00Z", detail: null },
      { seq: 1, actor: "dir-s", actionId: "x1", verb: "directorResponse", at: "2026-11-27T00:00:00Z", detail: null },
    ] as PaAuditRow[];
    const host = { hostId: "a", look: null, label: "EVA", online: true, instanceId: "inst-a", supported: true, features: { recurring: false, qualifiedRefs: false, ownerViews: false, crossHost: false, readiness: false }, projects: [], names: new Map([["pa-1-s", "Kai"], ["dir-s", "Alice"]]) } as unknown as PaHost;
    await render(h(AuditList, { hostId: "a", assistantId: "pa-1", host, refreshKey: 0, self: { sessionId: "pa-1-s", name: "生活助理" } }));
    const text = [...container.querySelectorAll("[data-pa-audit]")].map((li) => li.textContent);
    expect(text[0]).toContain("生活助理");
    expect(text[0]).not.toContain("Kai");
    expect(text[1]).toContain("Alice");
  });
});
