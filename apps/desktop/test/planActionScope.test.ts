import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const fake = vi.hoisted(() => ({
  state: {
    selectedId: "a" as string | null,
    sessions: { a: { timeline: { threadId: "thread-a" } }, b: { timeline: { threadId: "thread-b" } } },
    setCollabMode: vi.fn(),
    submit: vi.fn(),
  },
  updates: [] as unknown[],
}));
// Execute the real component's event callback; only its state setters and store transport are fake.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, (value: unknown) => { fake.updates.push(value); }],
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => fake.state } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/statusItemsView", () => ({ useStatusPlace: () => "off" }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: () => null }));
import { PlanCard } from "../src/renderer/src/modules/plan/PlanCard";
import { fireHostSwitch } from "../src/renderer/src/lib/hostSwitch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function implementButton(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(implementButton).find(Boolean) ?? null;
  const element = node as ReactElement<{ children?: ReactNode; onClick: () => void }>;
  if (element.type === "button" && element.props.children === "plan.implement") return element;
  return implementButton(element.props?.children);
}
function clickImplement() {
  const button = implementButton(PlanCard({ sessionId: "a", text: "# Original plan", streaming: false, actionable: true }));
  if (!button) throw Error("Expected actual plan implementation button");
  button.props.onClick();
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
beforeEach(() => {
  fake.state.selectedId = "a";
  fake.state.sessions = { a: { timeline: { threadId: "thread-a" } }, b: { timeline: { threadId: "thread-b" } } };
  fake.state.setCollabMode.mockReset();
  fake.state.submit.mockReset().mockResolvedValue(null);
  fake.updates.length = 0;
});

describe("plan implementation retains the clicked conversation", () => {
  it.each(["host", "session", "thread"])("rejects a displayed plan after %s changes before its click", async (boundary) => {
    const button = implementButton(PlanCard({ sessionId: "a", text: "# Original plan", streaming: false, actionable: true }));
    if (!button) throw Error("Expected plan implementation button");
    if (boundary === "host") fireHostSwitch();
    else if (boundary === "session") fake.state.selectedId = "b";
    else fake.state.sessions.a.timeline.threadId = "replacement-thread";
    button.props.onClick();
    await settle();
    expect(fake.state.setCollabMode).not.toHaveBeenCalled();
    expect(fake.state.submit).not.toHaveBeenCalled();
  });

  it.each(["host", "host ABA", "session", "thread"])("does not submit after %s changes during mode switch", async (boundary) => {
    const mode = deferred<boolean>();
    fake.state.setCollabMode.mockReturnValue(mode.promise);
    clickImplement();
    if (boundary === "host") fireHostSwitch();
    else if (boundary === "host ABA") { fireHostSwitch(); fireHostSwitch(); }
    else if (boundary === "session") fake.state.selectedId = "b";
    else fake.state.sessions.a.timeline.threadId = "replacement-thread";
    mode.resolve(true);
    await settle();
    expect(fake.state.submit).not.toHaveBeenCalled();
    expect(fake.updates).not.toContain(true);
  });

  it("does not show an old mode failure after selecting another conversation", async () => {
    const mode = deferred<boolean>();
    fake.state.setCollabMode.mockReturnValue(mode.promise);
    clickImplement();
    fake.state.selectedId = "b";
    mode.reject(Error("old operation failure"));
    await settle();
    expect(fake.state.submit).not.toHaveBeenCalled();
    expect(fake.updates).not.toContain("old operation failure");
  });

  it("still submits the ordinary implementation message once for its original conversation", async () => {
    fake.state.setCollabMode.mockResolvedValue(true);
    clickImplement();
    await settle();
    expect(fake.state.setCollabMode).toHaveBeenCalledWith("default");
    expect(fake.state.submit).toHaveBeenCalledExactlyOnceWith("Implement the plan.", "auto");
    expect(fake.updates).toContain(true);
  });

  it("keeps a same-conversation unavailable-mode error without sending", async () => {
    fake.state.setCollabMode.mockResolvedValue(false);
    clickImplement();
    await settle();
    expect(fake.state.submit).not.toHaveBeenCalled();
    expect(fake.updates).toContain("plan.defaultUnavailable");
  });

  it("still displays a mode-switch failure on the original conversation", async () => {
    fake.state.setCollabMode.mockRejectedValue(Error("current operation failure"));
    clickImplement();
    await settle();
    expect(fake.state.submit).not.toHaveBeenCalled();
    expect(fake.updates).toContain("current operation failure");
  });
});
