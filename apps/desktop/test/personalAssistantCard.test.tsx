// @vitest-environment jsdom
// The assistant request's confirmation card (modules/personal-assistants/RequestCard): reads the request's detail, shows
// the seat that is current now (and the one it was prepared for when they differ), and 发给主管 sends exactly what is
// shown — the request and assistant revisions and the current seat. No Director: sending is disabled. A stale refusal
// reads the request again and says so. Reads are GETs only; the write happens only from the button.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaAssistant, PaRequest, PaRequestDetail } from "../src/shared/personalAssistants";

const calls: { method: string; args: unknown[] }[] = [];
let detail: PaRequestDetail;
let confirmReply: () => Promise<unknown>;
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  hostApi: () => ({
    paRequest: (...args: unknown[]) => (calls.push({ method: "paRequest", args }), Promise.resolve(structuredClone(detail))),
    paConfirm: (...args: unknown[]) => (calls.push({ method: "paConfirm", args }), confirmReply()),
    paCancel: (...args: unknown[]) => (calls.push({ method: "paCancel", args }), Promise.resolve(detail.request)),
    paGet: () => Promise.reject(new Error("not in this test")),
    paRequests: () => Promise.resolve({ items: [], nextCursor: null }),
  }),
  openHostAgent: () => Promise.resolve(),
}));

import { I18nProvider } from "../src/renderer/src/i18n";
import { RequestCard } from "../src/renderer/src/modules/personal-assistants/RequestCard";
import type { PaHost } from "../src/renderer/src/modules/personal-assistants/paHooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assistant: PaAssistant = {
  id: "pa-1", revision: 4, enabled: true, sessionId: "pa-s", coordinationProjectId: "pa-c",
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name: "生活助理", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] },
};
const request: PaRequest = {
  id: "dr-1", assistantId: "pa-1", projectId: "desktop", outcome: "补上截图", constraints: "只用模拟预览", sourceRef: "对话 · 10:42",
  director: { sessionId: "eva-old", epoch: 1 }, assistantRevision: 4, state: "awaitingOwner", revision: 2, updatedAt: "2026-11-25T10:00:00Z", detail: null,
};
const host: PaHost = {
  hostId: "local", look: null, label: "This PC", online: true, instanceId: "inst-a", supported: true, features: { recurring: false, qualifiedRefs: false, ownerViews: false, crossHost: false },
  projects: [{ project_id: "desktop", authority_epoch: 2, presentation: { display_name: "cutex-desktop", badge_label: "CD", color: "cyan" }, active_member_count: 3, lifecycle: "active" }],
  names: new Map([["eva", "Eva"], ["eva-old", "Old Eva"]]),
};

let container: HTMLDivElement;
let root: Root;
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const buttonByText = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

beforeEach(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  calls.length = 0;
  detail = { request: structuredClone(request), currentDirector: { sessionId: "eva", epoch: 2 }, currentAssistantRevision: 4, projectIssue: null, needsReview: true };
  confirmReply = () => Promise.resolve({ ...request, state: "queued", revision: 3, director: { sessionId: "eva", epoch: 2 } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(readOnly = false) {
  await act(async () => root.render(h(I18nProvider, null, h(RequestCard, { hostId: "local", assistant, request, host, readOnly }))));
  await settle();
}

describe("assistant request confirmation card", () => {
  it("shows the current seat and the change; 发给主管 sends the revisions and seat shown", async () => {
    await render();
    expect(calls.map((c) => c.method)).toEqual(["paRequest"]);
    expect($("[data-pa-card-field=director]")?.textContent).toContain("Eva · 第 2 任");
    expect($("[data-pa-seat-changed]")?.textContent).toContain("Old Eva · 第 1 任");
    expect($("[data-pa-needs-review]")).not.toBeNull();
    expect($("[data-pa-card-field=source]")?.textContent).toContain("对话 · 10:42");
    const send = buttonByText("发给")!;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    await settle();
    expect(calls.find((c) => c.method === "paConfirm")!.args).toEqual(["pa-1", "dr-1", expect.objectContaining({ expectedRevision: 2, expectedAssistantRevision: 4, director: { sessionId: "eva", epoch: 2 } })]);
    expect(String((calls.find((c) => c.method === "paConfirm")!.args[2] as { actionId: string }).actionId)).toMatch(/^desktop-confirm-/);
  });

  it("no Director: sending is disabled and the card says why", async () => {
    detail = { ...detail, currentDirector: { sessionId: null, epoch: 3 } };
    await render();
    expect(buttonByText("发给")!.disabled).toBe(true);
    expect($("[data-pa-no-director]")).not.toBeNull();
  });

  it("a stale refusal reads the request again and asks to check", async () => {
    confirmReply = () => Promise.reject(new Error("director_changed: director_changed"));
    await render();
    await act(async () => buttonByText("发给")!.click());
    await settle();
    expect(calls.map((c) => c.method)).toEqual(["paRequest", "paConfirm", "paRequest"]);
    expect($("[data-pa-card-note=warn]")).not.toBeNull();
  });

  it("read only (host offline): no write buttons", async () => {
    await render(true);
    expect(buttonByText("发给")).toBeUndefined();
    expect(buttonByText("取消请求")).toBeUndefined();
  });
});
