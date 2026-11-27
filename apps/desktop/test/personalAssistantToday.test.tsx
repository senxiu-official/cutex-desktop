// @vitest-environment jsdom
// 个人助理 「今日」 and phase-1 settings (owner 2026-11-27):
// - 范围规则: the most specific scope wins (project > host > folder > all), ties go to the more careful role, a project
//   rule equal to what it inherits is dropped, folders map to refs, and enabling 代你确认 lists the projects first;
// - 默认助理: the first one created is the default; a stored default that is gone falls back to the first;
// - the title-bar popover lists the top waiting requests and what finished in the last day;
// - each assumed call is gated by its feature (no feature → "unsupported" without asking the host);
// - 今日 shows 待你确认 with the card, 在办 by project and host, 简报 / 提醒 / 记一下 from the assumed contract;
// - 运行方式 (r299 normal-agent assistants): the old kind says so; a mode change is one `runtime` change.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaAssistant, PaRequest, PaView } from "../src/shared/personalAssistants";

const calls: { method: string; args: unknown[] }[] = [];
const replies: Record<string, (...args: unknown[]) => unknown> = {};
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  hostApi: () => new Proxy({}, {
    get: (_t, m: string) => (m === "then" ? undefined : (...args: unknown[]) => {
      calls.push({ method: m, args });
      const r = replies[m];
      return r ? Promise.resolve().then(() => r(...args)) : Promise.reject(new Error(`no reply for ${m}`));
    }),
  }),
  openHostAgent: () => Promise.resolve(),
}));
const services = vi.hoisted(() => ({ ui: { openPage: () => {}, toast: () => {}, notice: () => {} }, side: { open: () => {}, list: () => [] }, panes: { open: () => {} } }));
vi.mock("../src/renderer/src/modules/app", () => ({ services }));
vi.mock("../src/renderer/src/lib/dateText", async (orig) => ({ ...(await orig<object>()), localTimeZone: () => "Australia/Sydney" }));

import { I18nProvider } from "../src/renderer/src/i18n";
import { onPaChanged, readChange, usePa, resetPaStore } from "../src/renderer/src/lib/personalAssistantStore";
import { adoptFirstAssistant, defaultRow, getDefaultAssistant, resetDefaultAssistantCache, setDefaultAssistant } from "../src/renderer/src/modules/personal-assistants/defaultAssistant";
import { OWNER_PINS_CREATE_FEATURE, PA_BRIEF_FEATURE, PA_REMINDERS_WRITE_FEATURE, PA_SCOPE_RULES_FEATURE, type PaScopeRule } from "../src/renderer/src/modules/personal-assistants/phase1Contract";
import { phase1 } from "../src/renderer/src/modules/personal-assistants/phase1Api";
import { affectedBy, effectiveRoles, groupScopes, newlyConfirmForYou, ruleFor, withProjectRole } from "../src/renderer/src/modules/personal-assistants/scopeRules";
import { menuRows } from "../src/renderer/src/modules/personal-assistants/todayMenu";
import { todayTarget } from "../src/renderer/src/modules/personal-assistants/todayModel";
import { TodayView } from "../src/renderer/src/modules/personal-assistants/TodayView";
import { ScopeRulesCard } from "../src/renderer/src/modules/personal-assistants/ScopeRulesCard";
import { RuntimeCard } from "../src/renderer/src/modules/personal-assistants/RuntimeCard";
import type { PaHost } from "../src/renderer/src/modules/personal-assistants/paHooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = "inst-a", B = "inst-b";
const ref = (instanceId: string, projectId: string) => ({ instanceId, projectId });
const refs = [ref(A, "desktop"), ref(A, "waveline"), ref(B, "thesis")];
const rule = (id: string, scope: PaScopeRule["scope"], role: PaScopeRule["role"]): PaScopeRule => ({ id, scope, role });

describe("范围规则", () => {
  it("the most specific scope wins; with none, the default role (协调)", () => {
    const rules = [rule("all", { kind: "all" }, "observe"), rule("host", { kind: "host", instanceId: A }, "confirmForYou"), rule("p", { kind: "project", ref: ref(A, "waveline") }, "coordinate")];
    expect(effectiveRoles(rules, refs)).toEqual([
      { ref: ref(A, "desktop"), role: "confirmForYou", ruleId: "host" },
      { ref: ref(A, "waveline"), role: "coordinate", ruleId: "p" },
      { ref: ref(B, "thesis"), role: "observe", ruleId: "all" },
    ]);
    expect(effectiveRoles([], refs).every((p) => p.role === "coordinate" && p.ruleId === null)).toBe(true);
  });
  it("a folder beats 全部项目 but not a host; two folders holding one project: the more careful role", () => {
    const g1 = rule("g1", { kind: "group", groupId: "s1", name: "科研 Research", members: [ref(B, "thesis")] }, "confirmForYou");
    const g2 = rule("g2", { kind: "group", groupId: "s2", name: "毕业", members: [ref(B, "thesis")] }, "observe");
    expect(ruleFor([rule("all", { kind: "all" }, "coordinate"), g1], ref(B, "thesis"))?.id).toBe("g1");
    expect(ruleFor([g1, g2], ref(B, "thesis"))?.id).toBe("g2");
    expect(ruleFor([g1, rule("h", { kind: "host", instanceId: B }, "coordinate")], ref(B, "thesis"))?.id).toBe("h");
  });
  it("a project set to what it inherits keeps no rule of its own", () => {
    const base = [rule("all", { kind: "all" }, "observe")];
    const set = withProjectRole(base, ref(A, "desktop"), "confirmForYou", () => "new");
    expect(set).toHaveLength(2);
    expect(withProjectRole(set, ref(A, "desktop"), "observe", () => "x")).toEqual(base);
  });
  it("lists what a broad rule decides and which projects would newly go to 代你确认", () => {
    const own = rule("p", { kind: "project", ref: ref(A, "waveline") }, "observe");
    const all = rule("all", { kind: "all" }, "confirmForYou");
    expect(affectedBy([own], all, refs).map((r) => r.projectId)).toEqual(["desktop", "thesis"]);
    expect(newlyConfirmForYou([own], [own, all], refs).map((r) => r.projectId)).toEqual(["desktop", "thesis"]);
    expect(newlyConfirmForYou([own, all], [own, all], refs)).toEqual([]);
  });
  it("folders (sidebar sections of host keys) become group scopes with refs, only when they hold one of the projects", () => {
    const sections = [
      { id: "s1", name: "科研 Research", members: [JSON.stringify(["samplehostb", "thesis"]), JSON.stringify(["samplehostb", "other"])] },
      { id: "s2", name: "杂项", members: [JSON.stringify(["eva", "notes"])] },
    ];
    const groups = groupScopes(sections, (hostId) => (hostId === "samplehostb" ? B : hostId === "eva" ? A : null), refs);
    expect(groups).toEqual([{ kind: "group", groupId: "s1", name: "科研 Research", members: [ref(B, "thesis"), ref(B, "other")] }]);
  });
});

const assistant = (id: string, name: string, sessionId: string | null = `${id}-s`): PaAssistant => ({
  id, revision: 3, enabled: true, sessionId, coordinationProjectId: `pa-${id}`,
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name, profile: "claude", homeInstanceId: A, projectIds: ["desktop", "waveline"] },
}) as PaAssistant;
const request = (id: string, state: string, projectId = "desktop", updatedAt = "2026-11-27T09:00:00Z", extra: Partial<PaRequest> = {}): PaRequest => ({
  id, assistantId: "pa-1", projectId, outcome: `做 ${id}`, constraints: "", sourceRef: "", director: { sessionId: "dir", epoch: 1 }, assistantRevision: 3, state, revision: 1, updatedAt, detail: null, ...extra,
});

describe("默认助理", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultAssistantCache();
  });
  it("the first one created is the default; later ones don't replace it; it can be switched", () => {
    adoptFirstAssistant({ hostId: "a", assistantId: "pa-1" });
    adoptFirstAssistant({ hostId: "a", assistantId: "pa-2" });
    expect(getDefaultAssistant()).toEqual({ hostId: "a", assistantId: "pa-1" });
    setDefaultAssistant({ hostId: "b", assistantId: "pa-9" });
    resetDefaultAssistantCache();
    expect(getDefaultAssistant()).toEqual({ hostId: "b", assistantId: "pa-9" });
  });
  it("a stored default that is gone falls back to the first assistant", () => {
    const rows = [{ hostId: "a", assistant: assistant("pa-1", "生活助理") }, { hostId: "a", assistant: assistant("pa-2", "研究助理") }];
    expect(defaultRow(rows, { hostId: "a", assistantId: "pa-2" })?.assistant.id).toBe("pa-2");
    expect(defaultRow(rows, { hostId: "a", assistantId: "gone" })?.assistant.id).toBe("pa-1");
    expect(defaultRow([], null)).toBeNull();
  });
  it("今日 follows the selected assistant's conversation, else shows the default one", () => {
    const byHost = { a: { assistants: [assistant("pa-1", "生活助理"), assistant("pa-2", "研究助理")] } } as never;
    expect(todayTarget(byHost, "a", "pa-2-s", null)).toMatchObject({ own: true, assistant: { id: "pa-2" } });
    expect(todayTarget(byHost, "a", "someone-else", { hostId: "a", assistantId: "pa-2" })).toMatchObject({ own: false, assistant: { id: "pa-2" } });
    expect(todayTarget({} as never, "a", "x", null)).toBeNull();
  });
});

describe("title-bar popover", () => {
  it("the oldest waiting requests first (three, then a count) and what finished within a day", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const list = [
      request("w1", "awaitingOwner", "desktop", "2026-11-27T08:00:00Z"), request("w2", "awaitingOwner", "desktop", "2026-11-27T07:00:00Z"),
      request("w3", "awaitingOwner", "desktop", "2026-11-27T09:00:00Z"), request("w4", "awaitingOwner", "desktop", "2026-11-27T10:00:00Z"),
      request("d1", "completed", "desktop", "2026-11-27T11:00:00Z"), request("d0", "completed", "desktop", "2026-11-25T11:00:00Z"), request("q", "queued"),
    ];
    const rows = menuRows(list, now);
    expect(rows.decide.map((r) => r.id)).toEqual(["w2", "w1", "w3"]);
    expect(rows.moreDecide).toBe(1);
    expect(rows.done.map((r) => r.id)).toEqual(["d1"]);
  });
});

describe("assumed calls are gated by their features", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  it("no feature: unsupported without asking the host", async () => {
    expect(await phase1.scopeRules("a", new Set(), "pa-1")).toBeNull();
    expect(await phase1.brief("a", undefined, "pa-1")).toBeNull();
    expect(calls).toEqual([]);
  });
  it("with the feature: the host is asked", async () => {
    replies.paScopeRules = () => ({ revision: 1, rules: [], effective: [] });
    expect(await phase1.scopeRules("a", new Set([PA_SCOPE_RULES_FEATURE]), "pa-1")).toEqual({ revision: 1, rules: [], effective: [] });
    expect(calls.map((c) => c.method)).toEqual(["paScopeRules"]);
  });
});

let container: HTMLDivElement;
let root: Root;
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const render = async (node: ReturnType<typeof h>) => {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await settle();
};
const setValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const paHost = (features: string[], extra: Partial<PaHost> = {}): PaHost => ({
  hostId: "a", look: null, label: "EVA", online: true, instanceId: A, supported: true,
  features: { recurring: true, qualifiedRefs: true, ownerViews: true, crossHost: false, readiness: true }, featureSet: new Set(features),
  projects: [{ project_id: "desktop", presentation: { display_name: "cutex-desktop" } }, { project_id: "waveline", presentation: { display_name: "Waveline" } }],
  names: new Map([["dir", "小侦探"]]), ...extra,
}) as unknown as PaHost;
const hostB = paHost([], { hostId: "b", label: "Samplehostb", instanceId: B, projects: [{ project_id: "thesis", presentation: { display_name: "论文" } }] as never });
let hostsNow: PaHost[] = [];
vi.mock("../src/renderer/src/modules/personal-assistants/paHooks", async (orig) => ({ ...(await orig<object>()), usePaHosts: () => hostsNow, usePaRefresh: () => {} }));

beforeEach(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  calls.length = 0;
  for (const k of Object.keys(replies)) delete replies[k];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPaStore();
});

describe("今日", () => {
  const a = assistant("pa-1", "生活助理");
  const seed = (list: PaRequest[]) => usePa.setState({ byHost: { a: { instanceId: A, assistants: [a], views: {}, requests: { "pa-1": list }, moreRequests: {}, ticks: {}, sendsTemplates: false, loadedAt: 1, loading: false, error: null } } });
  beforeEach(() => {
    replies.paRequest = (_id, rid) => ({ request: request(String(rid), "awaitingOwner"), currentDirector: { sessionId: "dir", epoch: 1 }, currentAssistantRevision: 3, projectIssue: null });
    replies.paAgenda = () => ({ date: "2026-11-27", timezone: "Australia/Sydney", items: [], reminders: [{ alarmId: "al-1", at: "2026-11-27T06:30:00Z", message: "看推送排查", state: "pending" }], nextReminderCursor: null, schedules: [], nextScheduleCursor: null });
  });
  it("待你确认 with the card, 在办 by project and host (a project of another host under that host)", async () => {
    hostsNow = [paHost([]), hostB];
    seed([request("w1", "awaitingOwner"), request("q1", "queued", "waveline"), request("q2", "accepted", "thesis", undefined, { projectRef: ref(B, "thesis") })]);
    await render(h(TodayView, { hostId: "a", assistant: a }));
    expect($$("[data-pa-today-block=decide] [data-pa-request-card]")).toHaveLength(1);
    expect($("[data-pa-today-block=decide]")?.textContent).toContain("发给");
    const groups = $$("[data-pa-today-project]").map((g) => g.textContent);
    expect(groups).toHaveLength(2);
    expect(groups.some((t) => t?.includes("论文") && t.includes("Samplehostb"))).toBe(true);
    expect(groups.some((t) => t?.includes("Waveline") && t.includes("EVA"))).toBe(true);
  });
  it("a host without the assumed features says so in place (no brief, no add, no memo)", async () => {
    hostsNow = [paHost([])];
    seed([]);
    await render(h(TodayView, { hostId: "a", assistant: a }));
    expect($("[data-pa-today-block=brief]")?.textContent).toContain("还不支持简报");
    expect(($("[data-pa-reminder-add]") as HTMLButtonElement).disabled).toBe(true);
    expect(($("[data-pa-capture]") as HTMLTextAreaElement).disabled).toBe(true);
    expect($$("[data-pa-reminder]")).toHaveLength(1);
    expect(calls.some((c) => c.method === "paBrief")).toBe(false);
  });
  it("简报 off by default links to the times; a reminder is added; 记一下 writes a note under the assistant", async () => {
    hostsNow = [paHost([PA_BRIEF_FEATURE, PA_REMINDERS_WRITE_FEATURE, OWNER_PINS_CREATE_FEATURE])];
    seed([]);
    replies.paBrief = () => ({ revision: 0, times: [], timezone: null, latest: null });
    replies.paReminderCreate = (_id, body) => ({ alarmId: "al-2", at: (body as { at: string }).at, message: (body as { message: string }).message, state: "pending" });
    replies.ownerPinCreate = (body) => ({ pinId: "pin-1", ...(body as object) });
    await render(h(TodayView, { hostId: "a", assistant: a }));
    expect($("[data-pa-brief-off]")).not.toBeNull();
    await act(async () => $("[data-pa-reminder-add]")!.click());
    const [time, text] = $$("[data-pa-reminder-form] input") as HTMLInputElement[];
    await act(async () => (setValue(time!, "15:30"), setValue(text!, "给导师回邮件")));
    await act(async () => ($$("[data-pa-reminder-form] button")[0] as HTMLButtonElement).click());
    await settle();
    expect($$("[data-pa-reminder]").map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("给导师回邮件")]));
    await act(async () => setValue($("[data-pa-capture]") as HTMLTextAreaElement, "周五前回复 Mika\n带上推送结论"));
    await act(async () => $("[data-pa-capture-save]")!.click());
    await settle();
    const pin = calls.find((c) => c.method === "ownerPinCreate")!.args[0] as Record<string, unknown>;
    expect(pin).toMatchObject({ kind: "note", title: "周五前回复 Mika", detail: "带上推送结论", agentId: "pa-1-s" });
    expect($("[data-pa-capture-note]")?.getAttribute("data-pa-capture-note")).toBe("ok");
  });
  it("简报 is read again when the host announces `brief` (a brief written or re-scheduled elsewhere)", async () => {
    expect(readChange({ assistantId: "pa-1", areas: ["brief", "audit"] })?.areas).toEqual(["brief", "audit"]);
    hostsNow = [paHost([PA_BRIEF_FEATURE])];
    seed([]);
    let text = "早上好。今天有 1 件等你确认。";
    replies.paBrief = () => ({ revision: 1, times: ["08:30"], timezone: null, latest: { at: "2026-11-27T08:30:00+11:00", text, sources: ["requests"] } });
    await render(h(TodayView, { hostId: "a", assistant: a }));
    expect($("[data-pa-brief]")?.textContent).toContain("1 件等你确认");
    const reads = () => calls.filter((c) => c.method === "paBrief").length;
    const before = reads();
    // Another area does not re-read the brief…
    await act(async () => onPaChanged("a", { assistantId: "pa-1", areas: ["notes"] }));
    await settle();
    expect(reads()).toBe(before);
    // …`brief` does, and the card shows the new text.
    text = "下午好。等你确认的都处理完了。";
    await act(async () => onPaChanged("a", { assistantId: "pa-1", areas: ["brief", "audit"] }));
    await settle();
    expect(reads()).toBe(before + 1);
    expect($("[data-pa-brief]")?.textContent).toContain("都处理完了");
  });
  it("简报: a run being written says so; a run replaced unwritten warns while the last good brief stays", async () => {
    hostsNow = [paHost([PA_BRIEF_FEATURE])];
    seed([]);
    const latest = { at: "2026-11-27T08:30:00+11:00", text: "早上好。今天有 1 件等你确认。", sources: ["requests"] };
    const at1730 = new Date(2026, 10, 27, 17, 30).toISOString();
    replies.paBrief = () => ({ revision: 3, times: ["08:30", "17:30"], timezone: null, latest, pending: { runId: "run-1730", scheduledAt: at1730, queued: true }, stale: false });
    await render(h(TodayView, { hostId: "a", assistant: a }));
    expect($("[data-pa-brief-writing]")?.textContent).toBe("17:30 的简报正在写…");
    expect($("[data-pa-brief-stale]")).toBeNull();
    expect($("[data-pa-brief]")?.textContent).toContain("1 件等你确认");
    // Not queued yet (due later): no line.
    replies.paBrief = () => ({ revision: 4, times: ["08:30", "17:30"], timezone: null, latest, pending: { runId: "run-1730", scheduledAt: at1730, queued: false }, stale: true });
    await act(async () => onPaChanged("a", { assistantId: "pa-1", areas: ["brief"] }));
    await settle();
    expect($("[data-pa-brief-writing]")).toBeNull();
    expect($("[data-pa-brief-stale]")?.textContent).toBe("上一份简报没写成，已换成下一时段");
    expect($("[data-pa-brief]")?.textContent).toContain("1 件等你确认");
  });
  it("简报 with nothing written yet and a run being written shows only the writing line", async () => {
    hostsNow = [paHost([PA_BRIEF_FEATURE])];
    seed([]);
    replies.paBrief = () => ({ revision: 1, times: ["08:00"], timezone: null, latest: null, pending: { runId: "r", scheduledAt: new Date(2026, 10, 28, 8, 0).toISOString(), queued: true }, stale: false });
    await render(h(TodayView, { hostId: "a", assistant: a }));
    expect($("[data-pa-today-block=brief]")?.textContent).toContain("08:00 的简报正在写…");
    expect($("[data-pa-today-block=brief]")?.textContent).not.toContain("还没写");
  });
  it("the band (compact) lists 待你确认 as rows that open the card", async () => {
    hostsNow = [paHost([])];
    seed([request("w1", "awaitingOwner")]);
    await render(h(TodayView, { hostId: "a", assistant: a, compact: true }));
    expect($$("[data-pa-today-block=decide] [data-pa-request-card]")).toHaveLength(0);
    await act(async () => $("[data-pa-today-block=decide] [data-pa-today-request]")!.click());
    await settle();
    expect($$("[data-pa-today-block=decide] [data-pa-request-card]")).toHaveLength(1);
  });
});

const view = (a: PaAssistant, extra: Partial<PaView> = {}): PaView => ({ assistant: a, overlaps: [], moreOverlaps: false, availability: "ready", activeProfile: "claude", capabilities: { localDirectorRequests: true, agenda: true }, ...extra }) as PaView;

describe("范围规则 card", () => {
  const a = { ...assistant("pa-1", "生活助理"), config: { ...assistant("pa-1", "x").config, name: "生活助理", projectRefs: [ref(A, "desktop"), ref(A, "waveline")] } } as PaAssistant;
  it("each project shows its role and which rule set it; turning 代你确认 on lists the projects before saving", async () => {
    hostsNow = [paHost([PA_SCOPE_RULES_FEATURE])];
    const own = rule("p", { kind: "project", ref: ref(A, "waveline") }, "observe");
    replies.paScopeRules = () => ({ revision: 4, rules: [own], effective: [] });
    replies.paScopeRulesSave = (_id, body) => ({ revision: 5, rules: (body as { rules: PaScopeRule[] }).rules, effective: [] });
    await render(h(ScopeRulesCard, { hostId: "a", view: view(a), hosts: hostsNow, readOnly: false }));
    const row = (id: string) => $(`[data-pa-scope-project="${id}"]`)!;
    expect(row("desktop").getAttribute("data-pa-scope-role")).toBe("coordinate");
    expect(row("desktop").textContent).toContain("默认协调");
    expect(row("waveline").getAttribute("data-pa-scope-role")).toBe("observe");
    expect(row("waveline").textContent).toContain("单独设定");
    // desktop → 代你确认 (a project rule), then save: the list names it, and nothing is sent until 确认保存.
    await act(async () => setValue(row("desktop").querySelector("select")!, "confirmForYou"));
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "保存") as HTMLButtonElement).click());
    expect($("[data-pa-scope-confirm]")?.textContent).toContain("cutex-desktop");
    expect(calls.some((c) => c.method === "paScopeRulesSave")).toBe(false);
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "确认保存") as HTMLButtonElement).click());
    await settle();
    const body = calls.find((c) => c.method === "paScopeRulesSave")!.args[1] as { expectedRevision: number; rules: PaScopeRule[] };
    expect(body.expectedRevision).toBe(4);
    expect(body.rules.map((r) => [r.scope.kind, r.role])).toEqual([["project", "observe"], ["project", "confirmForYou"]]);
  });
  it("a host without the feature says so", async () => {
    hostsNow = [paHost([])];
    await render(h(ScopeRulesCard, { hostId: "a", view: view(a), hosts: hostsNow, readOnly: false }));
    expect($("[data-pa-scope-unsupported]")?.textContent).toContain("还不支持范围规则");
    expect(calls).toEqual([]);
  });
});

describe("运行方式", () => {
  const a = assistant("pa-1", "生活助理");
  it("an old restricted assistant says so; a host without the feature shows nothing", async () => {
    await render(h(RuntimeCard, { hostId: "a", view: view(a, { runtime: { behavior: "legacyRestricted", permissionMode: null, policy: null, workspace: null } }), readOnly: false }));
    expect($("[data-pa-runtime=legacy]")?.textContent).toContain("旧版");
    await render(h(RuntimeCard, { hostId: "a", view: view(a), readOnly: false }));
    expect($("[data-pa-runtime]")).toBeNull();
  });
  it("a mode change is one `runtime` change at the shown revision, keeping the rest of the policy", async () => {
    const policy = { version: 1 as const, initialPermissionMode: "fullAccess" as const, checkInFullAccess: false, authorizedWriteProjects: [ref(A, "desktop")] };
    replies.paUpdate = (_id, body) => ({ ...view(a), assistant: { ...a, revision: 4 }, echo: body });
    await render(h(RuntimeCard, { hostId: "a", view: view(a, { runtime: { behavior: "agent", permissionMode: "fullAccess", policy, workspace: "~/pa" } }), readOnly: false }));
    expect($("[data-pa-permission-mode]")?.getAttribute("data-pa-permission-mode")).toBe("fullAccess");
    await act(async () => (container.querySelector('input[type="radio"]') as HTMLInputElement).click());
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "保存") as HTMLButtonElement).click());
    await settle();
    const body = calls.find((c) => c.method === "paUpdate")!.args[1] as { expectedRevision: number; change: unknown };
    expect(body.expectedRevision).toBe(3);
    expect(body.change).toEqual({ kind: "runtime", policy: { ...policy, initialPermissionMode: "auto" } });
  });
});
