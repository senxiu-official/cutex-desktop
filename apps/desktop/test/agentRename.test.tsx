// @vitest-environment jsdom
// 自己的名字 (formal-agent-name-rename-v1): wire helpers, offer rule, the in-place confirm flow with its
// retry rules (same request after an uncertain answer, a fresh one after a stale revision), plain-words
// errors, paginated history, and the mock host.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { FORMAL_RENAME_FEATURE, formalNameProblem, nameHistoryPath, renameErrorKey, validRenameRequest, type FormalRenameRequest, type NameHistoryEvent } from "../src/shared/agentRename";

const send = vi.fn();
const history = vi.fn();
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({ InfoTip: ({ children }: { children: unknown }) => h("span", { "data-tip": "" }, children as string) }));
vi.mock("../src/renderer/src/lib/agentRename", async () => {
  const shared = await import("../src/shared/agentRename");
  return {
    formalNameProblem: shared.formalNameProblem,
    newRenameRequest: (s: { revision: number }, name: string) => ({ requestId: `r${Math.random()}`, expectedRevision: s.revision, name: name.trim() }),
    sendRename: (...args: unknown[]) => send(...args),
    nameHistory: (...args: unknown[]) => history(...args),
    sessionOf: () => live,
    holderNames: (_host: string, ids?: string[]) => (ids ?? []).map((id) => `name-of-${id}`),
    scopeProjectName: (_host: string, id: string) => `P:${id}`,
  };
});
let live: { revision: number } | null = { revision: 7 };

import { AgentOwnName } from "../src/renderer/src/components/AgentOwnName";
import { canRenameFormal } from "../src/shared/agentRename";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  send.mockReset(); history.mockReset(); live = { revision: 7 };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const buttons = () => [...container.querySelectorAll("button")];
const byText = (text: string) => buttons().find((b) => b.textContent?.startsWith(text));
function click(el: Element | undefined) { expect(el).toBeTruthy(); act(() => (el as HTMLElement).click()); }
function type(value: string) {
  const input = container.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const draw = () => act(() => root.render(h(AgentOwnName, { host: "local", sessionId: "cutex.mira", ownName: "Mira", revision: 7 })));
const apply = () => container.querySelector<HTMLButtonElement>("[data-testid=agent-own-name-apply]")!;
const ev = (seq: number, oldName: string, newName: string): NameHistoryEvent => ({ sequence: seq, eventId: `e${seq}`, requestId: `q${seq}`, cutexSessionId: "cutex.mira", oldName, newName, scope: { kind: "project", projectId: "alpha" }, committedAt: "2026-11-05T01:00:00.000Z", actor: "human-management", previousRevision: seq, revision: seq + 1 });

describe("wire helpers", () => {
  it("checks names like cutex and maps codes to plain words", () => {
    expect(formalNameProblem("  ", "Mira")).toBe("empty");
    expect(formalNameProblem("x".repeat(129), "Mira")).toBe("tooLong");
    expect(formalNameProblem("😀".repeat(128), "Mira")).toBeNull(); // code points, not UTF-16 units
    expect(formalNameProblem("a\nb", "Mira")).toBe("control");
    expect(formalNameProblem(" Mira ", "Mira")).toBe("unchanged");
    expect(formalNameProblem("mira", "Mira")).toBeNull(); // case-only change: a real rename (contract v2)
    expect(renameErrorKey("agent_name_conflict")).toBe("rename.error.conflict");
    expect(renameErrorKey("agent_name_reserved")).toBe("rename.error.reserved");
    expect(renameErrorKey("agent_name_invalid")).toBe("rename.error.invalid");
    expect(renameErrorKey("invalid_request")).toBe("rename.error.malformed");
    expect(renameErrorKey("agent_archived")).toBe("rename.error.archived");
    expect(renameErrorKey("owner_required")).toBe("rename.error.ownerRequired");
    expect(renameErrorKey("stale_session_revision")).toBe("rename.error.stale");
    expect(renameErrorKey("admission_busy")).toBe("rename.error.busy");
    expect(renameErrorKey("whatever")).toBe("rename.error.other");
    expect(nameHistoryPath("cutex.a b", null)).toBe("/v2/human/agents/cutex.a%20b/name-history?limit=50");
    expect(nameHistoryPath("cutex.a", 42)).toBe("/v2/human/agents/cutex.a/name-history?before=42&limit=50");
    expect(validRenameRequest({ requestId: "r", expectedRevision: 3, name: "Nova" })).toBe(true);
    expect(validRenameRequest({ requestId: "r", expectedRevision: 0, name: "Nova" })).toBe(false);
  });

  it("is offered only to the owner on a capable host, for an agent with an own name", () => {
    const named = { formalAgentName: "Mira" } as Pick<SessionResource, "formalAgentName">;
    expect(canRenameFormal(new Set([FORMAL_RENAME_FEATURE]), named)).toBe(true);
    expect(canRenameFormal(new Set(), named)).toBe(false); // host without the capability: as today
    expect(canRenameFormal(new Set([FORMAL_RENAME_FEATURE, "desktop:restricted"]), named)).toBe(false);
    expect(canRenameFormal(new Set([FORMAL_RENAME_FEATURE]), { formalAgentName: null })).toBe(false);
    // An archived agent without an own name still gets the read-only (empty) history; quick chats don't.
    expect(canRenameFormal(new Set([FORMAL_RENAME_FEATURE]), { formalAgentName: undefined, lifecycle: "retired", registrationClass: "managed" } as never)).toBe(true);
    expect(canRenameFormal(new Set([FORMAL_RENAME_FEATURE]), { formalAgentName: undefined, lifecycle: "retired", registrationClass: "local_only" } as never)).toBe(false);
  });
});

describe("AgentOwnName", () => {
  it("says what renaming does, then renames only on the second click", async () => {
    draw();
    expect(container.textContent).toContain("Mira");
    click(byText("rename.change"));
    // What a rename does, before applying it (no restart / quiet note; the old name stays reserved).
    expect(container.textContent).toContain("rename.factNow");
    expect(container.textContent).toContain('rename.factOld {"old":"Mira"}');
    type("Nova");
    send.mockResolvedValue({ ok: true, oldName: "Mira", newName: "Nova", session: null });
    click(apply());
    expect(send).not.toHaveBeenCalled();
    expect(apply().dataset.armed).toBe("true");
    click(apply());
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![2]).toMatchObject({ expectedRevision: 7, name: "Nova" });
    expect(container.textContent).toContain('rename.done {"old":"Mira","name":"Nova"}');
    expect(container.querySelector("input")).toBeNull();
  });

  it("an uncertain answer retries the very same request; a stale revision sends a fresh one", async () => {
    draw(); click(byText("rename.change")); type("Nova");
    send.mockImplementationOnce(async (_h: string, _id: string, request: FormalRenameRequest) => ({ ok: false, request, fresh: null, error: { code: "transport", message: "socket hang up", retrySame: true } }));
    click(apply()); click(apply()); await flush();
    expect(container.querySelector("[role=alert]")!.textContent).toContain("rename.error.transport");
    send.mockImplementationOnce(async (_h: string, _id: string, request: FormalRenameRequest) => ({ ok: false, request, fresh: { revision: 9 }, error: { code: "stale_session_revision", message: "moved", retrySame: false } }));
    click(byText("rename.retry")); await flush();
    expect(send.mock.calls[1]![2]).toEqual(send.mock.calls[0]![2]);
    expect(container.querySelector("[role=alert]")!.textContent).toContain("rename.error.stale");
    live = { revision: 9 };
    send.mockResolvedValueOnce({ ok: true, oldName: "Mira", newName: "Nova", session: null });
    click(byText("rename.retry")); await flush();
    const third = send.mock.calls[2]![2] as FormalRenameRequest;
    expect(third.requestId).not.toBe((send.mock.calls[0]![2] as FormalRenameRequest).requestId);
    expect(third.expectedRevision).toBe(9);
  });

  it("names a conflict's holder and offers no retry for a definitive refusal", async () => {
    draw(); click(byText("rename.change")); type("Kai");
    send.mockImplementation(async (_h: string, _id: string, request: FormalRenameRequest) => ({ ok: false, request, fresh: null, error: { code: "agent_name_conflict", message: "taken", retrySame: false, holderSessionIds: ["cutex.kai"] } }));
    click(apply()); click(apply()); await flush();
    const alert = container.querySelector("[role=alert]")!.textContent!;
    expect(alert).toContain("rename.error.conflict");
    expect(alert).toContain("name-of-cutex.kai");
    expect(byText("rename.retry")).toBeUndefined();
    type("Kai2"); // editing clears the refusal
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("an archived agent keeps its tag and history and renames in place like an active one", async () => {
    act(() => root.render(h(AgentOwnName, { host: "local", sessionId: "cutex.mira", ownName: "Mira", revision: 7, archived: true })));
    expect(container.querySelector("[data-testid=agent-own-name-archived]")!.textContent).toBe("rename.archivedTag");
    history.mockResolvedValue({ events: [ev(1, "Eva", "Mira")], next: null });
    click(byText("rename.history")); await flush();
    expect(container.querySelector("[data-testid=agent-name-history]")!.textContent).toContain('rename.historyFrom {"old":"Eva"}');
    click(byText("rename.change")); type("Nova");
    send.mockResolvedValue({ ok: true, oldName: "Mira", newName: "Nova", session: null });
    click(apply()); click(apply()); await flush();
    expect(send.mock.calls[0]![2]).toMatchObject({ expectedRevision: 7, name: "Nova" });
    expect(container.textContent).toContain('rename.done {"old":"Mira","name":"Nova"}');
    expect(container.querySelector("[data-testid=agent-own-name-archived]")).not.toBeNull(); // still archived
  });

  it("an archived agent without an own name shows only its (empty) history", async () => {
    act(() => root.render(h(AgentOwnName, { host: "local", sessionId: "cutex.mira", ownName: "", revision: 7, archived: true })));
    expect(byText("rename.change")).toBeUndefined();
    history.mockResolvedValue({ events: [], next: null });
    click(byText("rename.history")); await flush();
    expect(container.textContent).toContain("rename.historyEmpty");
  });

  it("blocks empty and unchanged names before sending; a case-only change is allowed", () => {
    draw(); click(byText("rename.change"));
    expect(apply().disabled).toBe(true); // unchanged
    type("mira");
    expect(apply().disabled).toBe(false);
    type("  ");
    expect(apply().disabled).toBe(true);
    expect(container.textContent).toContain("rename.problem.empty");
  });

  it("reads the permanent history newest first, page by page", async () => {
    history.mockResolvedValueOnce({ events: [ev(3, "B", "Mira"), ev(2, "A", "B")], next: 2 }).mockResolvedValueOnce({ events: [ev(1, "Z", "A")], next: null });
    draw();
    click(byText("rename.history")); await flush();
    expect(history).toHaveBeenLastCalledWith("local", "cutex.mira", null);
    const list = () => container.querySelector("[data-testid=agent-name-history]")!.textContent!;
    expect(list()).toContain("Mira");
    expect(list()).toContain('rename.historyFrom {"old":"B"}');
    expect(list()).toContain('P:alpha');
    click(byText("rename.historyMore")); await flush();
    expect(history).toHaveBeenLastCalledWith("local", "cutex.mira", 2);
    expect(list().indexOf('"old":"B"')).toBeLessThan(list().indexOf('"old":"Z"'));
    expect(byText("rename.historyMore")).toBeUndefined();
  });
});

describe("restore refused for the name", () => {
  it("crosses IPC as a wire message and reads back with its code and holders; other errors pass", async () => {
    const { restoreNameWire, restoreNameBlock } = await import("../src/shared/agentRename");
    const wire = restoreNameWire({ code: "agent_name_reserved", details: { holderSessionIds: ["cutex.kai"], scope: { kind: "project", projectId: "p1" }, renameRequired: true } })!;
    expect(restoreNameBlock(new Error(`Error invoking remote method 'daemon:sessionAction': Error: ${wire}`))).toEqual({ code: "agent_name_reserved", holderSessionIds: ["cutex.kai"], scope: { kind: "project", projectId: "p1" }, renameRequired: true });
    expect(restoreNameBlock({ code: "agent_name_taken", details: { scope: { kind: "unassigned" } } })).toEqual({ code: "agent_name_taken", scope: { kind: "unassigned" } });
    expect(restoreNameWire({ code: "agent_name_conflict" })).toBeNull(); // the rename code is not a restore refusal
    expect(restoreNameWire({ code: "stale_session_revision" })).toBeNull();
    expect(restoreNameBlock(new Error("restore_name_blocked:{\"code\":\"other\"}"))).toBeNull();
    expect(restoreNameBlock(new Error("boom"))).toBeNull();
  });
});

describe("mock host", () => {
  it("refuses conflicts, reserved and invalid names, replays a request and keeps the alias", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const { mockRename, mockNameHistory } = await import("../src/renderer/src/dev/mockAgentRename");
      const mk = (id: string, name: string, extra: Partial<SessionResource> = {}) => ({ cutexSessionId: id, displayName: extra.displayNameOverride ?? name, formalAgentName: name, displayNameOverride: null, revision: 1, registrationClass: "managed", ...extra }) as unknown as SessionResource;
      const sidebar = { active: [mk("a", "Mira", { displayNameOverride: "小米" }), mk("b", "Kai")], retired: [mk("z", "Old", { lifecycle: "retired" })], hostRows: { a: { projectId: "p" }, b: { projectId: "p" } } };
      const run = async (request: FormalRenameRequest) => { const p = mockRename(sidebar, "a", request); await vi.runAllTimersAsync(); return p; };
      expect(await run({ requestId: "1", expectedRevision: 1, name: "kai" })).toMatchObject({ ok: false, error: { code: "agent_name_conflict", holderSessionIds: ["b"] } });
      expect(await run({ requestId: "2", expectedRevision: 1, name: "Nova" })).toMatchObject({ ok: false, error: { code: "agent_name_reserved" } });
      expect(await run({ requestId: "3", expectedRevision: 1, name: "director" })).toMatchObject({ ok: false, error: { code: "agent_name_invalid" } });
      // Owner 2026-11-05: an archived agent can be renamed and stays archived.
      const archived = mockRename(sidebar, "z", { requestId: "3z", expectedRevision: 1, name: "New" }); await vi.runAllTimersAsync();
      expect(await archived).toMatchObject({ ok: true, event: { oldName: "Old", newName: "New" } });
      expect(sidebar.retired[0]).toMatchObject({ lifecycle: "retired", formalAgentName: "New" });
      expect(await run({ requestId: "4", expectedRevision: 5, name: "Lumi" })).toMatchObject({ ok: false, error: { code: "stale_session_revision" } });
      const ok = await run({ requestId: "5", expectedRevision: 1, name: "Lumi" });
      expect(ok).toMatchObject({ ok: true, replayed: false, event: { oldName: "Mira", newName: "Lumi", scope: { kind: "project", projectId: "p" } } });
      expect(sidebar.active[0]).toMatchObject({ formalAgentName: "Lumi", displayName: "小米", displayNameOverride: "小米", revision: 2 });
      expect(await run({ requestId: "5", expectedRevision: 1, name: "Lumi" })).toMatchObject({ ok: true, replayed: true });
      expect(await run({ requestId: "5", expectedRevision: 1, name: "Other" })).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
      const page = mockNameHistory(sidebar, "a", null); await vi.runAllTimersAsync();
      expect((await page).events[0]).toMatchObject({ oldName: "Mira", newName: "Lumi" });
    } finally {
      vi.useRealTimers();
    }
  });
});
