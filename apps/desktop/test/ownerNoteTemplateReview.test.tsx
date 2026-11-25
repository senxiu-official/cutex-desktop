// @vitest-environment jsdom
// cutex r296: a 定期任务 whose run was refused as stale raises an owner notice (systemKind assistantTemplateNeedsReview
// with templateReview). Its card offers 打开定期任务, which opens the assistant's 定期任务 tab on that task with the
// refused revision and reason (the tab then has 重新确认 ready). Older notices (no templateReview) and hosts without
// recurring templates keep the plain text. The wire record is read defensively.
import { createElement as h } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { asRecord, asTemplateReview } from "../src/shared/ownerNotify";

const fx = vi.hoisted(() => ({
  notes: {} as Record<string, unknown>,
  features: new Set<string>(),
  opened: [] as [string, unknown][],
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = { notify: () => {}, sidebar: null, selectedId: null, selectedHost: null, hosts: { active: "local" }, features: new Set<string>(), byHost: {} };
  return {
    ...(await importOriginal<object>()),
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state, setState: () => {}, subscribe: () => () => {} }),
  };
});
vi.mock("../src/renderer/src/lib/conversationScope", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useConvHost: () => "remote",
  useConvScope: () => null,
  convFeaturesOf: () => fx.features,
  convSidebarOf: () => null,
  convNotify: () => {},
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: (page: string, params: unknown) => fx.opened.push([page, params]) } } }));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHostOwnerNotes: () => fx.notes,
  ownerNotifyAct: async () => ({ ok: true }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { OwnerNotifyCard } = await import("../src/renderer/src/components/OwnerNotifyCard");

const wire = {
  notificationId: "ntf-tpl",
  agentId: "pa-life-session",
  agentName: "生活助理",
  origin: "system",
  text: "A recurring assistant template needs review.",
  level: "attention",
  state: "open",
  channels: ["desktop"],
  createdAt: "2026-11-25T10:00:00Z",
  systemKind: "assistantTemplateNeedsReview",
  notificationEvent: "system.assistantTemplateNeedsReview",
  templateReview: { assistantId: "pa-1", scheduleId: "sch-1", templateRevision: 2, reason: "director_changed" },
};

function render() {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  act(() => root.render(h(OwnerNotifyCard, { notificationId: "ntf-tpl", sessionId: "pa-life-session", hostId: "remote" })));
  return { div, unmount: () => act(() => root.unmount()) };
}

describe("owner notice: a 定期任务 needs re-confirming", () => {
  it("the record keeps templateReview; a malformed one is dropped", () => {
    expect(asRecord(wire)?.templateReview).toEqual({ assistantId: "pa-1", scheduleId: "sch-1", templateRevision: 2, reason: "director_changed" });
    expect(asTemplateReview({ assistantId: "pa-1", scheduleId: "", templateRevision: 2 })).toBeNull();
    expect(asTemplateReview({ assistantId: "pa-1", scheduleId: "s", templateRevision: "2" })).toBeNull();
    expect(asRecord({ ...wire, templateReview: undefined })).not.toHaveProperty("templateReview");
  });

  it("打开定期任务 opens that assistant's 定期任务 tab on the task of the notice's host", () => {
    fx.features = new Set(["personal-assistants-recurring-v1"]);
    fx.notes = { "ntf-tpl": asRecord(wire) };
    fx.opened.length = 0;
    const { div, unmount } = render();
    const button = div.querySelector<HTMLButtonElement>("[data-note-open-template=sch-1]");
    expect(button?.textContent).toContain("personal-assistants.notice.openTemplate");
    act(() => button!.click());
    expect(fx.opened).toEqual([["personal-assistants.page", { host: "remote", id: "pa-1", tab: "templates", template: "sch-1", review: "director_changed", reviewRevision: "2" }]]);
    expect(div.textContent).toContain("A recurring assistant template needs review.");
    unmount();
  });

  it("older notices and hosts without recurring templates keep the plain text", () => {
    fx.features = new Set();
    fx.notes = { "ntf-tpl": asRecord(wire) };
    let r = render();
    expect(r.div.querySelector("[data-note-open-template]")).toBeNull();
    r.unmount();
    fx.features = new Set(["personal-assistants-recurring-v1"]);
    fx.notes = { "ntf-tpl": asRecord({ ...wire, templateReview: undefined }) };
    r = render();
    expect(r.div.querySelector("[data-note-open-template]")).toBeNull();
    expect(r.div.textContent).toContain("A recurring assistant template needs review.");
    r.unmount();
  });
});
