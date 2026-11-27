// @vitest-environment jsdom
// 个人助理 on host with grant supports (personal-assistants-readiness-v1) and on older ones:
// - the create form takes the host's create-options verdicts (a failed read offers nothing; an older host: this
//   app's rule, and create-options is never asked);
// - the 权限 card says what is in effect from `capabilityDetails` for the saved grants (with the assistant's own reason),
//   and only "at most" for a draft or an older host;
// - 今日 asks for the owner's zone on host with grant supports only, says how each source was read, never calls an unreadable source
//   empty, and keeps what it read (marked old) when a later read fails.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaAgenda, PaAssistant, PaCapabilityDetails, PaView } from "../src/shared/personalAssistants";

const calls: { method: string; args: unknown[] }[] = [];
let createOptions: () => Promise<unknown>;
let agendaReply: () => Promise<PaAgenda>;
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  hostApi: () => ({
    listProfiles: () => Promise.resolve({ defaultProfile: "omega", profiles: [{ name: "omega", cliKind: "codex", authKind: "chatgpt", model: "gpt" }, { name: "claude", cliKind: "claude", authKind: "none", model: "sonnet" }] }),
    paCreateOptions: (...args: unknown[]) => (calls.push({ method: "paCreateOptions", args }), createOptions()),
    paAgenda: (...args: unknown[]) => (calls.push({ method: "paAgenda", args }), agendaReply()),
    paGet: () => Promise.reject(new Error("not in this test")),
  }),
  openHostAgent: () => Promise.resolve(),
}));
vi.mock("../src/renderer/src/lib/dateText", async (orig) => ({ ...(await orig<object>()), localTimeZone: () => "Australia/Sydney" }));

import { I18nProvider } from "../src/renderer/src/i18n";
import { AgendaCard } from "../src/renderer/src/modules/personal-assistants/AgendaCard";
import { CreateAssistant } from "../src/renderer/src/modules/personal-assistants/AssistantForm";
import { GrantsCard } from "../src/renderer/src/modules/personal-assistants/GrantsCard";
import { grantSupport, liveGrants } from "../src/renderer/src/modules/personal-assistants/readiness";
import type { PaHost } from "../src/renderer/src/modules/personal-assistants/paHooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = (readiness: boolean): PaHost => ({
  hostId: "a", look: null, label: "EVA", online: true, instanceId: "inst-a", supported: true,
  features: { recurring: true, qualifiedRefs: true, ownerViews: true, crossHost: false, readiness }, projects: [], names: new Map(),
}) as unknown as PaHost;
const assistant = (extra: Partial<PaAssistant> = {}): PaAssistant => ({
  id: "pa-1", revision: 3, enabled: true, sessionId: "pa-s", coordinationProjectId: null,
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name: "生活助理", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] },
  ...extra,
}) as PaAssistant;
const detail = (effective: boolean, unsupported = false, reason: string | null = null) => ({ configured: true, effective, unsupported, reason: effective ? null : reason ?? (unsupported ? "host_unsupported" : "not_granted") });
const details = (over: Partial<PaCapabilityDetails> = {}): PaCapabilityDetails => ({
  localDirectorRequests: detail(true), projectAdmin: detail(false, true), liveServices: detail(false, true), kitActivation: detail(false, true), publishing: detail(false, true), destructive: detail(false, true), fullOwner: detail(false, true), ...over,
});
const view = (a: PaAssistant, d: PaCapabilityDetails | null): PaView => ({ assistant: a, overlaps: [], moreOverlaps: false, availability: "ready", activeProfile: "claude", capabilities: { localDirectorRequests: true, agenda: true }, capabilityDetails: d });

describe("what is in effect", () => {
  it("saved grants on an host with grant support: the host's `effective`, with the assistant's own reason", () => {
    const caps = { localDirectorRequests: true };
    expect(liveGrants("coordinator", [], grantSupport(caps, details()), details(), true)).toEqual({ source: "effective", tier: "coordinator", operations: [], reason: null });
    const off = details({ localDirectorRequests: detail(false, false, "assistant_disabled") });
    expect(liveGrants("coordinator", [], grantSupport(caps, off), off, true)).toEqual({ source: "effective", tier: "inbox", operations: [], reason: "assistant_disabled" });
  });
  it("a draft or an older host: only what the host can carry out, at most", () => {
    expect(liveGrants("operational", ["publishing"], grantSupport({ localDirectorRequests: true }, details()), details(), false)).toMatchObject({ source: "atMost", tier: "coordinator", operations: [] });
    expect(liveGrants("coordinator", [], grantSupport({ localDirectorRequests: true }), null, true).source).toBe("atMost");
  });
});

let container: HTMLDivElement;
let root: Root;
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const render = async (node: ReturnType<typeof h>) => {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await settle();
};
beforeEach(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  calls.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const createButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "创建") as HTMLButtonElement;

describe("create form", () => {
  it("r299: the host's verdicts decide (here: claude is not usable, omega is)", async () => {
    createOptions = () => Promise.resolve({ homeInstanceId: "inst-a", profiles: [
      { id: "1", name: "omega", runtime: "codex", eligible: true, reason: null, runtimePin: "codex-r9" },
      { id: "2", name: "claude", runtime: "claude", eligible: false, reason: "assistant_account_unavailable", runtimePin: null },
    ], capabilities: {}, observedAt: "2026-11-27T00:00:00Z", hostTimezone: "UTC" });
    await render(h(CreateAssistant, { hosts: [host(true)], onCreated: () => {} }));
    expect(calls.map((c) => c.method)).toEqual(["paCreateOptions"]);
    expect($("[data-pa-some-unusable]")!.textContent).toContain("这台主机说不能用");
    expect(container.textContent).toContain("omega · gpt · codex-r9");
  });

  it("r299: a failed read offers nothing (never this app's guess instead)", async () => {
    createOptions = () => Promise.reject(new Error("boom"));
    await render(h(CreateAssistant, { hosts: [host(true)], onCreated: () => {} }));
    expect($("[data-pa-verdict-error]")).not.toBeNull();
    expect(createButton().disabled).toBe(true);
  });

  it("an older host: this app's rule, create-options never asked", async () => {
    await render(h(CreateAssistant, { hosts: [host(false)], onCreated: () => {} }));
    expect(calls).toEqual([]);
    expect($("[data-pa-some-unusable]")!.textContent).toContain("Claude 订阅");
    expect(container.textContent).toContain("claude · sonnet");
  });
});

describe("权限 card", () => {
  it("r299, saved: says what the host reports in effect, and why not when the assistant itself can't act", async () => {
    await render(h(GrantsCard, { hostId: "a", hostLabel: "EVA", view: view(assistant(), details({ localDirectorRequests: detail(false, false, "session_inactive") })), readOnly: false }));
    const line = $("[data-pa-grants-effective]")!;
    expect(line.dataset.paGrantsSource).toBe("effective");
    expect(line.textContent).toContain("实际生效：收件箱");
    expect(line.textContent).toContain("会话没在运行");
  });
  it("an older host: never claims it is in effect", async () => {
    await render(h(GrantsCard, { hostId: "a", hostLabel: "EVA", view: view(assistant(), null), readOnly: false }));
    const line = $("[data-pa-grants-effective]")!;
    expect(line.dataset.paGrantsSource).toBe("atMost");
    expect(line.textContent).toContain("还不报告");
  });
});

const agenda = (extra: Partial<PaAgenda> = {}): PaAgenda => ({
  date: "2026-11-27", timezone: "Australia/Sydney", items: [], nextCursor: null,
  reminders: [{ alarmId: "al-1", at: "2026-11-27T06:00:00Z", message: "交周报", state: "pending" }], nextReminderCursor: null,
  schedules: [], nextScheduleCursor: null, projects: [], nextProjectCursor: null, dueRequests: [], nextDueCursor: null, calendar: null,
  ...extra,
}) as PaAgenda;

describe("今日", () => {
  it("r299: the owner's zone is asked; unreadable sources say so instead of 「没有…」", async () => {
    const src = (status: string, reason: string | null = null) => ({ instanceId: "inst-a", timezone: "UTC", observedAt: status === "ready" ? "2026-11-27T00:00:00Z" : null, status, reason });
    agendaReply = () => Promise.resolve(agenda({
      displayTimezone: "Australia/Sydney", hostTimezone: "UTC", observedAt: "2026-11-27T00:00:00Z",
      sources: { requests: src("ready"), reminders: src("ready"), schedules: src("ready"), dueRequests: src("ready"), projects: src("unknown", "directory_unavailable"), calendar: src("disconnected", "calendar_disconnected") },
    }));
    await render(h(AgendaCard, { hostId: "a", view: view(assistant(), details()), host: host(true), refreshKey: 0, readOnly: false, onOpenRequest: () => {} }));
    expect(calls[0]!.args[1]).toMatchObject({ displayTimezone: "Australia/Sydney" });
    expect(container.textContent).toContain("按 Australia/Sydney 时间（主机在 UTC）");
    expect($('[data-pa-source="projects"]')!.dataset.paSourceStatus).toBe("unknown");
    expect(container.textContent).toContain("读不到（directory_unavailable）");
    expect(container.textContent).not.toContain("没有选定的项目");
    // Readable empty sources still say so.
    expect(container.textContent).toContain("今天没有");
  });

  it("a later failed read keeps what was read, marked old — never an empty day", async () => {
    agendaReply = () => Promise.resolve(agenda());
    await render(h(AgendaCard, { hostId: "a", view: view(assistant(), null), host: host(false), refreshKey: 0, readOnly: false, onOpenRequest: () => {} }));
    expect(calls[0]!.args[1]).not.toHaveProperty("displayTimezone");
    expect(container.textContent).toContain("交周报");
    agendaReply = () => Promise.reject(new Error("host_unreachable"));
    await render(h(AgendaCard, { hostId: "a", view: view(assistant(), null), host: host(false), refreshKey: 1, readOnly: false, onOpenRequest: () => {} }));
    expect($("[data-pa-agenda-stale]")).not.toBeNull();
    expect(container.textContent).toContain("交周报");
  });

  it("a first read that fails shows the error and no day at all", async () => {
    agendaReply = () => Promise.reject(new Error("host_unreachable"));
    await render(h(AgendaCard, { hostId: "a", view: view(assistant(), null), host: host(true), refreshKey: 0, readOnly: false, onOpenRequest: () => {} }));
    expect(container.textContent).toContain("未能读取议程");
    expect(container.textContent).not.toContain("今天没有");
  });
});
