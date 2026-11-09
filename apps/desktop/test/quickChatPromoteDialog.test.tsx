// @vitest-environment jsdom
// 转为智能体… dialog: a running chat is stopped first (after the click), refusals read as plain words, an uncertain
// answer is retried with the identical request, and success says where the agent now lives.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendPromote = vi.fn();
const stopChat = vi.fn(async () => {});
let state: { sidebar: unknown } = { sidebar: null };
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }),
  sidebarOf: (s: typeof state) => s.sidebar,
  featuresOf: () => new Set<string>(),
  hostApi: () => ({}),
}));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ projectOrder: [] }) }));
vi.mock("../src/renderer/src/lib/hostSwitch", () => ({ captureHostAction: () => () => true, onHostReset: () => () => {} }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ closeDialog: () => {} }));
vi.mock("../src/renderer/src/lib/quickChatPromote", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/renderer/src/lib/quickChatPromote")>();
  return { ...real, sendPromote: (...a: unknown[]) => sendPromote(...a), stopChat: (...a: unknown[]) => stopChat(...(a as [])), sessionOn: () => null };
});
const { QuickChatPromoteDialog } = await import("../src/renderer/src/components/QuickChatPromoteDialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const sidebar = (status: string) => ({
  active: [
    { cutexSessionId: "cutex.chat", displayName: "Fix the build", registrationClass: "local_only", formalAgentName: null, lifecycle: "active", revision: 4, runtime: { status, activeTurnId: null, runtimeGeneration: 2 } },
    { cutexSessionId: "cutex.mira", displayName: "Mira", formalAgentName: "Mira", registrationClass: "persistent", lifecycle: "active", revision: 1, runtime: { status: "online" } },
  ],
  retired: [],
  hostRows: { "cutex.chat": { kind: "Session", projectId: null } },
  projects: { projects: [{ project_id: "p1", lifecycle: "active", presentation: { display_name: "Alpha" } }] },
});
beforeEach(() => { sendPromote.mockReset(); stopChat.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const submit = () => host.querySelector<HTMLButtonElement>("button[type=submit]")!;
const draw = () => act(() => root.render(h(QuickChatPromoteDialog, { sessionId: "cutex.chat", hostId: "local", resolve: () => {} })));
function type(value: string) {
  const input = host.querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("QuickChatPromoteDialog", () => {
  it("a running chat: says so, stops it on the click, then promotes with the chat's title as the name, standalone", async () => {
    state = { sidebar: sidebar("online") };
    sendPromote.mockResolvedValue({ ok: true, result: { cutexSessionId: "cutex.chat", name: "Fix the build", projectId: null, revision: 5, complete: true, error: null } });
    draw();
    expect(host.textContent).toContain("promote.running");
    expect(submit().textContent).toBe("promote.stopAndSubmit");
    expect(host.querySelector("input")!.value).toBe("Fix the build");
    act(() => submit().click());
    await flush();
    expect(stopChat).toHaveBeenCalledTimes(1);
    expect(sendPromote).toHaveBeenCalledWith("local", "cutex.chat", expect.objectContaining({ name: "Fix the build", projectId: null, expectedRevision: 4 }));
    expect(host.querySelector("[data-done]")?.textContent).toContain("promote.done");
  });

  it("a name another agent has is caught before sending", () => {
    state = { sidebar: sidebar("offline") };
    draw();
    type("mira");
    expect(host.textContent).toContain("promote.name.taken");
    expect(submit().disabled).toBe(true);
  });

  it("a refusal reads as plain words; an uncertain answer retries the identical request", async () => {
    state = { sidebar: sidebar("offline") };
    draw();
    type("Researcher");
    sendPromote.mockResolvedValueOnce({ ok: false, error: { code: "agent_name_reserved", message: "x", retrySame: false }, request: {} });
    act(() => submit().click());
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("promote.error.nameReserved");
    expect(submit().textContent).toBe("promote.submit");

    const uncertain = { requestId: "promote-x", expectedRevision: 4, name: "Researcher", projectId: null };
    sendPromote.mockResolvedValueOnce({ ok: false, error: { code: "transport", message: "timeout", retrySame: true }, request: uncertain });
    act(() => submit().click());
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("promote.error.transport");
    expect(submit().textContent).toBe("promote.retry");
    expect(host.querySelector("input")!.disabled).toBe(true);
    sendPromote.mockResolvedValueOnce({ ok: true, result: { cutexSessionId: "cutex.chat", name: "Researcher", projectId: null, revision: 5, complete: true, error: null } });
    act(() => submit().click());
    await flush();
    expect(sendPromote.mock.calls.at(-1)![2]).toBe(uncertain);
    expect(stopChat).not.toHaveBeenCalled();
  });
});
