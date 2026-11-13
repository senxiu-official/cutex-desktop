// 重新批准文件夹 (shared/creatorPaths, components/CreatorPathsNote): a child agent refused for moved folders
// (409 creator_paths_changed). The wire helpers keep only the session id; the conversation line offers the
// armed button to the owner on a capable host (second click → reapprove + start), else the CLI command.
// The main → preload → store path is covered in hostActionsScope.test.ts.
// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CREATOR_PATHS_CODE, creatorPathsBlock, creatorPathsWire, reapproveFailure, reapproveFailureWire, reapprovePathsCommand } from "../src/shared/creatorPaths";

const fake = vi.hoisted(() => ({ reapprove: vi.fn<(id: string, host: string) => Promise<void>>() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (pick: (s: unknown) => unknown) => pick({ reapprovePathsAndStart: fake.reapprove }) }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "zh-CN" }),
}));

describe("wire", () => {
  it("keeps only the session id, survives Electron's IPC prefix and ignores other errors", () => {
    const wire = creatorPathsWire({ code: CREATOR_PATHS_CODE, message: "D:/secret", details: { cutexSessionId: "cutex.child", path: "D:/secret" } })!;
    expect(wire).not.toContain("secret");
    expect(creatorPathsBlock(new Error(`Error invoking remote method 'cutex-desktop:invoke': Error: ${wire}`))).toEqual({ cutexSessionId: "cutex.child" });
    expect(creatorPathsBlock(wire)).toEqual({ cutexSessionId: "cutex.child" });
    // cutex's own message text is not the wire.
    expect(creatorPathsBlock(new Error("creator_paths_changed: the folder changed since the agent was created"))).toBeNull();
    expect(creatorPathsWire({ code: "session_retired" })).toBeNull();
    expect(creatorPathsBlock(creatorPathsWire({ code: CREATOR_PATHS_CODE, details: { cutexSessionId: "bad id/../x" } }))).toEqual({});
    expect(reapprovePathsCommand("cutex.child")).toBe("cutex session reapprove-paths cutex.child");
    expect(reapproveFailure(new Error(`Error invoking remote method 'cutex-desktop:invoke': Error: ${reapproveFailureWire({ code: "session_retired", message: "D:/x" })}`))).toBe("session_retired");
    expect(reapproveFailure(new Error("reapprove_paths_failed:D:/secret"))).toBeNull();
  });
});

let Note: typeof import("../src/renderer/src/components/CreatorPathsNote").CreatorPathsNote;
let root: Root | null = null;
beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Note = (await import("../src/renderer/src/components/CreatorPathsNote")).CreatorPathsNote;
}, 30_000);
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  fake.reapprove.mockReset();
});
async function mount(canReapprove: boolean): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(h(Note, { sessionId: "cutex.child", hostId: "local", canReapprove })));
  return host;
}
const button = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-testid=creator-paths-reapprove]");

describe("CreatorPathsNote", () => {
  it("says what happened and re-approves only on the second click, then shows nothing extra", async () => {
    fake.reapprove.mockResolvedValue();
    const host = await mount(true);
    expect(host.textContent).toContain("creatorPaths.changed");
    expect(host.textContent).not.toContain("reapprove-paths");
    const b = button(host)!;
    expect(b.textContent).toBe("creatorPaths.reapprove");
    await act(async () => b.click());
    expect(b.getAttribute("data-armed")).toBe("true");
    expect(fake.reapprove).not.toHaveBeenCalled();
    await act(async () => b.click());
    expect(fake.reapprove).toHaveBeenCalledWith("cutex.child", "local");
    expect(host.querySelector(".text-danger")).toBeNull();
  });

  it("shows a refused re-approval in place in fixed words, never the error's own text", async () => {
    fake.reapprove.mockRejectedValueOnce(new Error("Error invoking remote method 'cutex-desktop:invoke': Error: reapprove_paths_failed:forbidden"));
    const host = await mount(true);
    await act(async () => button(host)!.click());
    await act(async () => button(host)!.click());
    expect(host.querySelector(".text-danger")!.textContent).toBe("creatorPaths.error.forbidden");
    // Anything that is not main's fixed code reads as the generic failure.
    fake.reapprove.mockRejectedValueOnce(new Error("D:/secret/moved"));
    await act(async () => button(host)!.click());
    await act(async () => button(host)!.click());
    expect(host.querySelector(".text-danger")!.textContent).toBe("creatorPaths.error.failed");
    expect(host.textContent).not.toContain("secret");
  });

  it("an armed button does not carry over to another agent shown in the same place", async () => {
    fake.reapprove.mockResolvedValue();
    const host = await mount(true);
    await act(async () => button(host)!.click());
    expect(button(host)!.getAttribute("data-armed")).toBe("true");
    // The pane switches to agent B within the arming window (same component instance).
    await act(async () => root!.render(h(Note, { sessionId: "cutex.other", hostId: "local", canReapprove: true })));
    expect(button(host)!.hasAttribute("data-armed")).toBe(false);
    await act(async () => button(host)!.click());
    expect(fake.reapprove).not.toHaveBeenCalled();
    await act(async () => button(host)!.click());
    expect(fake.reapprove).toHaveBeenCalledWith("cutex.other", "local");
  });

  it("without the capability gives the host command instead of a button", async () => {
    const host = await mount(false);
    expect(button(host)).toBeNull();
    expect(host.querySelector("[data-creator-paths]")!.getAttribute("data-creator-paths")).toBe("cli");
    expect(host.querySelector("code")!.textContent).toBe("cutex session reapprove-paths cutex.child");
  });
});
