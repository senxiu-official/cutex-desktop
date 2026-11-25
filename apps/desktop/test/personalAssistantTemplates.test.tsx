// @vitest-environment jsdom
// 定期任务 (modules/personal-assistants/TemplatesCard, cutex r296): a template whose project's Director changed says so
// plainly and 重新确认 PUTs the same task and rule for the seat shown now, at the template's revision; 暂停 POSTs pause
// at its revision; 运行记录 shows the outcomes (已发送 with 查看请求, 已合并, 被拒绝 with its reason in plain words). The
// schedule is shown in the host's local time. Reads are GETs; writes only from the buttons.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaAssistant, PaRun, PaTemplate } from "../src/shared/personalAssistants";

const calls: { method: string; args: unknown[] }[] = [];
let templates: PaTemplate[] = [];
let runs: PaRun[] = [];
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  hostDataNow: () => null,
  hostApi: () => ({
    paTemplates: (...args: unknown[]) => (calls.push({ method: "paTemplates", args }), Promise.resolve({ items: structuredClone(templates), nextCursor: null })),
    paTemplateRuns: (...args: unknown[]) => (calls.push({ method: "paTemplateRuns", args }), Promise.resolve({ items: structuredClone(runs), nextCursor: null })),
    paTemplateConfirm: (...args: unknown[]) => {
      calls.push({ method: "paTemplateConfirm", args });
      const input = args[2] as { confirmedSeat: { sessionId: string; epoch: number } };
      return Promise.resolve({ ...templates[0]!, revision: templates[0]!.revision + 1, lastRun: null, template: { ...templates[0]!.template!, confirmedSeat: input.confirmedSeat } });
    },
    paTemplateStop: (...args: unknown[]) => (calls.push({ method: "paTemplateStop", args }), Promise.resolve({ ...templates[0]!, revision: templates[0]!.revision + 1, enabled: false, nextRunAt: null })),
  }),
  openHostAgent: () => Promise.resolve(),
}));

import { I18nProvider } from "../src/renderer/src/i18n";
import { TemplatesCard } from "../src/renderer/src/modules/personal-assistants/TemplatesCard";
import type { PaHost } from "../src/renderer/src/modules/personal-assistants/paHooks";
import { templateFocus, type TemplateFocus } from "../src/renderer/src/modules/personal-assistants/detailTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assistant: PaAssistant = {
  id: "pa-1", revision: 5, enabled: true, sessionId: "pa-s", coordinationProjectId: "pa-c",
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name: "生活助理", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] },
};
const host: PaHost = {
  hostId: "local", look: null, label: "This PC", online: true, instanceId: "inst-a", supported: true,
  features: { recurring: true, qualifiedRefs: true, ownerViews: true, crossHost: false },
  projects: [{ project_id: "desktop", authority_epoch: 3, director_cutex_session_id: "nova", presentation: { display_name: "cutex-desktop", badge_label: "CD", color: "cyan" }, active_member_count: 3, lifecycle: "active" }],
  names: new Map([["eva", "Eva"], ["nova", "Nova"]]),
};
const run = (over: Partial<PaRun>): PaRun => ({ id: "r", sequence: 1, scheduleRevision: 2, scheduledAt: "2026-11-24T22:00:00Z", startedAt: null, finishedAt: null, outcome: "handedOff", attempts: 1, lastError: null, requestId: null, coalescedUntil: null, slotLocal: "2026-11-25T09:00:00+11:00", ...over });
const template = (over: Partial<PaTemplate> = {}): PaTemplate => ({
  id: "sch-1", revision: 2, rule: { kind: "daily", time: "09:00" }, enabled: true, nextRunAt: "2026-11-25T22:00:00Z", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z", deletedAt: null,
  lastRun: run({ id: "r3", sequence: 3, outcome: "refused", lastError: "director_changed" }),
  template: { assistantId: "pa-1", assistantRevision: 4, projectRef: { instanceId: "inst-a", projectId: "desktop" }, templateRevision: 2, confirmedSeat: { sessionId: "eva", epoch: 2 }, task: "projectStatus" },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const buttonByText = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const opened: string[] = [];

beforeEach(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  calls.length = 0;
  opened.length = 0;
  templates = [template()];
  runs = [
    run({ id: "r3", sequence: 3, outcome: "refused", lastError: "director_changed" }),
    run({ id: "r2", sequence: 2, outcome: "handedOff", requestId: "dr-2", coalescedUntil: "2026-11-23T22:00:00Z", scheduledAt: "2026-11-22T22:00:00Z", slotLocal: "2026-11-23T09:00:00+11:00" }),
    run({ id: "r1", sequence: 1, outcome: "cancelled", scheduledAt: "2026-11-21T22:00:00Z", slotLocal: "2026-11-22T09:00:00+11:00" }),
  ];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const scrolled: string[] = [];
Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.getAttribute("data-pa-template") ?? ""); };

async function render(readOnly = false, focus: TemplateFocus | null = null) {
  await act(async () => root.render(h(I18nProvider, null, h(TemplatesCard, { hostId: "local", assistant, host, readOnly, focus, onOpenRequest: (id: string) => opened.push(id) }))));
  await settle();
}

describe("定期任务", () => {
  it("a changed Director: plainly needs 重新确认, which confirms the seat shown now at the template's revision", async () => {
    await render();
    expect(calls.map((c) => c.method)).toEqual(["paTemplates"]);
    expect($("[data-pa-template-reconfirm]")?.textContent).toBe("需要重新确认");
    expect($("[data-pa-template-why=director]")?.textContent).toContain("Eva · 第 2 任");
    expect($("[data-pa-template-why=director]")?.textContent).toContain("Nova · 第 3 任");
    // Host time: 22:00Z at the run's +11:00 slot offset.
    expect($("[data-pa-template-next]")?.textContent).toContain("09:00");
    expect($("[data-pa-template-next]")?.textContent).toContain("主机时间");
    // While it needs re-confirming there is no 暂停 / 修改: the only action is to confirm (or cancel).
    expect(buttonByText("暂停")).toBeUndefined();
    await act(async () => buttonByText("重新确认")!.click());
    await settle();
    const confirm = calls.find((c) => c.method === "paTemplateConfirm")!;
    expect(confirm.args.slice(0, 2)).toEqual(["pa-1", "sch-1"]);
    expect(confirm.args[2]).toMatchObject({ expectedRevision: 2, expectedAssistantRevision: 5, projectRef: { instanceId: "inst-a", projectId: "desktop" }, confirmedSeat: { sessionId: "nova", epoch: 3 }, task: "projectStatus", rule: { kind: "daily", time: "09:00" } });
    expect(String((confirm.args[2] as { actionId: string }).actionId)).toMatch(/^desktop-template-/);
    expect($("[data-pa-template-reconfirm]")).toBeNull();
  });

  it("暂停 goes at the template's revision; 运行记录 shows sent / merged / refused (in plain words) / cancelled", async () => {
    templates = [template({ lastRun: run({ id: "r2", outcome: "handedOff", requestId: "dr-2" }), template: { ...template().template!, confirmedSeat: { sessionId: "nova", epoch: 3 } } })];
    await render();
    expect($("[data-pa-template-reconfirm]")).toBeNull();
    await act(async () => buttonByText("暂停")!.click());
    await settle();
    expect(calls.find((c) => c.method === "paTemplateStop")!.args).toEqual(["pa-1", "sch-1", "pause", expect.objectContaining({ expectedRevision: 2 })]);
    expect($("[data-pa-template-state]")?.getAttribute("data-pa-template-state")).toBe("paused");
    await act(async () => ($("[data-pa-template-runs-toggle]") as HTMLButtonElement).click());
    await settle();
    expect([...container.querySelectorAll("[data-pa-run] [data-pa-run-kind]")].map((e) => e.getAttribute("data-pa-run-kind"))).toEqual(["refused", "sent", "cancelled"]);
    expect($("[data-pa-run-merged]")).not.toBeNull();
    expect($("[data-pa-run-reason=director_changed]")?.textContent).toContain("这次没有发出");
    await act(async () => ($("[data-pa-run-request=dr-2]") as HTMLButtonElement).click());
    expect(opened).toEqual(["dr-2"]);
  });

  it("opened from an owner notice: the task is brought into view with 重新确认 ready and focused", async () => {
    // The app still sees the confirmed seat (its project list is behind the host): the notice's reason stands, in words
    // that do not contradict the seat shown.
    host.projects[0]!.director_cutex_session_id = "eva";
    host.projects[0]!.authority_epoch = 2;
    try {
      templates = [template({ lastRun: null })];
      scrolled.length = 0;
      await render(false, { scheduleId: "sch-1", templateRevision: 2, reason: "director_changed" });
      expect($("[data-pa-template-focus]")?.getAttribute("data-pa-template")).toBe("sch-1");
      expect(scrolled).toEqual(["sch-1"]);
      expect($("[data-pa-template-reconfirm]")?.getAttribute("data-pa-template-reconfirm")).toBe("director");
      expect($("[data-pa-template-why]")?.textContent).toContain("上次运行被拒绝了");
      expect(document.activeElement).toBe($("[data-pa-template-reconfirm-action]"));
      await act(async () => ($("[data-pa-template-reconfirm-action]") as HTMLButtonElement).click());
      await settle();
      expect(calls.find((c) => c.method === "paTemplateConfirm")!.args[2]).toMatchObject({ expectedRevision: 2, confirmedSeat: { sessionId: "eva", epoch: 2 } });
    } finally {
      host.projects[0]!.director_cutex_session_id = "nova";
      host.projects[0]!.authority_epoch = 3;
    }
  });

  it("a notice for an older revision (already re-confirmed) asks for nothing; the task is still marked", async () => {
    templates = [template({ lastRun: null, template: { ...template().template!, templateRevision: 3, confirmedSeat: { sessionId: "nova", epoch: 3 } } })];
    await render(false, { scheduleId: "sch-1", templateRevision: 2, reason: "confirmation_stale" });
    expect($("[data-pa-template-focus]")).not.toBeNull();
    expect($("[data-pa-template-reconfirm]")).toBeNull();
    expect(buttonByText("暂停")).toBeDefined();
  });

  it("the page reads the notice's task from its params", () => {
    expect(templateFocus({ template: "sch-1", review: "director_changed", reviewRevision: "2" })).toEqual({ scheduleId: "sch-1", templateRevision: 2, reason: "director_changed" });
    expect(templateFocus({ template: "sch-1" })).toEqual({ scheduleId: "sch-1", templateRevision: null, reason: "" });
    expect(templateFocus({ review: "director_changed" })).toBeNull();
  });

  it("read only (host offline): no write buttons", async () => {
    await render(true);
    expect(buttonByText("重新确认")).toBeUndefined();
    expect(buttonByText("新建定期任务")).toBeUndefined();
  });
});
