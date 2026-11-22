// Confirm by risk (owner rule): restorable / undoable actions confirm in place (armed second click), the dialog stays
// for a busy agent, owned services, running or persistent services; low-risk resume is one click. Covers the agent
// menu's 归档 (+ the re-read at the click), the message menu's revert / edit-and-resend, the delegation ⋯ menu, the
// service menu's delete, the agent list's bulk levels and `/archive`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary, ServiceView } from "../src/shared/ipc";

const mock = vi.hoisted(() => ({ confirms: [] as boolean[], dialogs: [] as string[], deleteService: vi.fn(async () => ({})) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { deleteService: mock.deleteService }, apiFor: () => ({ deleteService: mock.deleteService }), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/contextMenu", async (orig) => ({
  ...(await orig<typeof import("../src/renderer/src/lib/contextMenu")>()),
  confirmDialog: vi.fn(async (message: string) => {
    mock.dialogs.push(message);
    return mock.confirms.shift() ?? false;
  }),
}));
vi.mock("../src/renderer/src/lib/p2Access", async (orig) => ({
  ...(await orig<typeof import("../src/renderer/src/lib/p2Access")>()),
  p2AccessNow: () => ({ delegations: true }),
}));

import { normalizeEntries, selectStep, type MenuAction } from "../src/renderer/src/lib/contextMenu";
import { useApp } from "../src/renderer/src/store";
import { agentMenu, archiveNeedsDialog, messageMenu } from "../src/renderer/src/lib/menus";
import { delegationMenu } from "../src/renderer/src/lib/delegationMenu";
import { serviceDeleteLevel, serviceMenu } from "../src/renderer/src/lib/services";
import { bulkConfirmLevel, START_CONFIRM_OVER } from "../src/renderer/src/lib/agentList";
import { slashSpec } from "../src/renderer/src/lib/slashCommands";

const t = ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)) as never;

function session(over: { busy?: boolean } = {}) {
  return { cutexSessionId: "a", displayName: "A", lifecycle: "active", revision: 1, runtime: { status: "online", activeTurnId: over.busy ? "turn" : null, runtimeGeneration: 1 } } as never;
}

const rows = (entries: ReturnType<typeof agentMenu>) => normalizeEntries(entries).filter((e): e is MenuAction => e !== "separator");
const row = (entries: ReturnType<typeof agentMenu>, label: string) => rows(entries).find((e) => e.label === label);

beforeEach(() => {
  mock.confirms = [];
  mock.dialogs = [];
  mock.deleteService.mockClear();
});

describe("agent menu 归档", () => {
  const seed = (resource: unknown, services: unknown[] = []) => {
    const sessionAction = vi.fn(async () => null);
    useApp.setState({ hosts: { active: "local" } as never, features: new Set() as never, sidebar: { active: [resource], retired: [], hostRows: {} } as never, services: services as never, sessionAction: sessionAction as never });
    return sessionAction;
  };

  it("idle and owning no services: armed in place; the second click archives without a dialog", async () => {
    const s = session();
    const sessionAction = seed(s);
    const archive = row(agentMenu(s, t, "local"), "menu.archive")!;
    expect(archive.armed).toBe("menu.archiveArmed(A)");
    expect(archive.confirm).toBeUndefined();
    expect(selectStep(archive, null)).toBe("arm");
    await archive.onSelect();
    expect(mock.dialogs).toEqual([]);
    expect(sessionAction).toHaveBeenCalledWith("a", "cutex/session/retire", expect.objectContaining({ expectedRevision: 1 }), "local");
  });

  it("busy or owning services: the dialog that names it (no armed row)", async () => {
    const busy = session({ busy: true });
    const sessionAction = seed(busy);
    const archive = row(agentMenu(busy, t, "local"), "menu.archive")!;
    expect(archive.armed).toBeUndefined();
    expect(archiveNeedsDialog(busy, "local")).toBe(true);
    await archive.onSelect();
    expect(mock.dialogs[0]).toContain("menu.archiveConfirmBusy(A)");
    expect(sessionAction).not.toHaveBeenCalled();

    const idle = session();
    seed(idle, [{ slug: "web", displayName: "Web", ownerCutexSessionId: "a" }]);
    expect(archiveNeedsDialog(idle, "local")).toBe(true);
    expect(row(agentMenu(idle, t, "local"), "menu.archive")!.armed).toBeUndefined();
  });

  it("an agent that started a turn after the row armed gets the dialog at the second click", async () => {
    const s = session();
    const sessionAction = seed(s);
    const archive = row(agentMenu(s, t, "local"), "menu.archive")!;
    expect(archive.armed).toBeDefined();
    seed(session({ busy: true }));
    await archive.onSelect();
    expect(mock.dialogs).toHaveLength(1);
    expect(sessionAction).not.toHaveBeenCalled();
  });
});

describe("message menu revert / edit and resend", () => {
  it("arm in place like the hover bar (no dialog)", () => {
    useApp.setState({ hosts: { active: "local" } as never, features: new Set(["session-fork"]) as never });
    const reply = rows(messageMenu({ sessionId: "a", hostId: "local", kind: "agent", text: "x", turnId: "t1", nextTurnId: "t2", laterTurns: 3 }, t, true));
    const revert = reply.find((e) => e.label === "reply.revert")!;
    expect(revert.confirm).toBeUndefined();
    expect(revert.armed).toBe("reply.revertArmed(3)");
    expect(revert.info).toBe("reply.revertHint(3)");
    const own = rows(messageMenu({ sessionId: "a", hostId: "local", kind: "user", text: "x", turnId: "t1" }, t, true));
    const edit = own.find((e) => e.label === "menu.editResend")!;
    expect(edit.confirm).toBeUndefined();
    expect(edit.armed).toBe("menu.editResendArmed");
  });
});

describe("delegation ⋯ menu", () => {
  const ask = (over: Partial<AskSummary>) => ({ askId: "ask-0123456789abcdef0123456789abcdef", target: "b", requester: { kind: "session", id: "a" }, execution: "running", review: null, revision: 1, ...over }) as unknown as AskSummary;
  const menu = (d: AskSummary) => rows(delegationMenu(d, t, (id) => id, { host: "local" }));

  it("停止 / 放弃 arm in place; no dialog", () => {
    const stop = menu(ask({})).find((e) => e.label === "delegation.stop")!;
    expect(stop.confirm).toBeUndefined();
    expect(stop.armed).toBe("delegation.stopArmed");
    const abandon = menu(ask({ execution: "interrupted" })).find((e) => e.label === "delegation.abandon")!;
    expect(abandon.confirm).toBeUndefined();
    expect(abandon.armed).toBe("delegation.abandonArmed");
  });

  it("结束等待并继续 runs on one click", () => {
    const resume = menu(ask({ canResume: true, hold: { reason: "waitingForEvent", jobs: ["j"], until: "all" } } as Partial<AskSummary>)).find((e) => e.label === "delegation.resumeWait")!;
    expect(resume.confirm).toBeUndefined();
    expect(resume.armed).toBeUndefined();
    expect(selectStep(resume, null)).toBe("run");
  });
});

describe("service 删除", () => {
  const view = (over: Partial<ServiceView>) => ({ slug: "web", displayName: "Web", runtime: "managed", health: "stopped", lifetime: "ephemeral", ownerCutexSessionId: null, projectId: null, ...over }) as unknown as ServiceView;
  const deleteRow = (s: ServiceView) => rows(serviceMenu(s, t, () => {}, undefined, "local")).find((e) => e.label === "services.removeRegistration" || e.label === "services.delete")!;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("levels: stopped + ephemeral → armed; running, persistent or kept → dialog", () => {
    expect(serviceDeleteLevel(view({}))).toBe("armed");
    expect(serviceDeleteLevel(view({ health: "stoppedIdle" }))).toBe("armed");
    expect(serviceDeleteLevel(view({ health: "reachable" }))).toBe("dialog");
    expect(serviceDeleteLevel(view({ health: "starting" }))).toBe("dialog");
    expect(serviceDeleteLevel(view({ lifetime: "persistent" }))).toBe("dialog");
    expect(serviceDeleteLevel(view({ lifetime: undefined }))).toBe("dialog");
    expect(serviceDeleteLevel(view({ pinned: true }))).toBe("dialog");
    // A managed service that does not answer may still have its process: not "stopped".
    expect(serviceDeleteLevel(view({ health: "unreachable" }))).toBe("dialog");
    expect(serviceDeleteLevel(view({ runtime: "external", health: "unreachable" }))).toBe("armed");
  });

  it("a stopped ephemeral registration: 移除登记 armed, removed on the second click without a dialog", async () => {
    const s = view({});
    useApp.setState({ hosts: { active: "local", hosts: [] } as never, services: [s] as never });
    const remove = deleteRow(s);
    expect(remove.label).toBe("services.removeRegistration");
    expect(remove.armed).toBe("services.removeRegistrationArmed(Web)");
    await remove.onSelect();
    await flush();
    expect(mock.dialogs).toEqual([]);
    expect(mock.deleteService).toHaveBeenCalledWith("web");
  });

  it("revalidates at the click: started since (or gone from the list) → the dialog", async () => {
    const s = view({});
    useApp.setState({ hosts: { active: "local", hosts: [] } as never, services: [view({ health: "reachable" })] as never });
    await deleteRow(s).onSelect();
    await flush();
    expect(mock.dialogs).toEqual(["services.deleteConfirm(Web)"]);
    expect(mock.deleteService).not.toHaveBeenCalled();
    useApp.setState({ services: [] as never });
    await deleteRow(s).onSelect();
    await flush();
    expect(mock.dialogs).toHaveLength(2);
  });

  it("running or persistent: 删除 with the dialog", async () => {
    const s = view({ health: "reachable", lifetime: "persistent" });
    useApp.setState({ hosts: { active: "local", hosts: [] } as never, services: [s] as never });
    const del = deleteRow(s);
    expect(del.label).toBe("services.delete");
    expect(del.armed).toBeUndefined();
    mock.confirms = [true];
    await del.onSelect();
    await flush();
    expect(mock.dialogs).toEqual(["services.deleteConfirm(Web)"]);
    expect(mock.deleteService).toHaveBeenCalledWith("web");
  });
});

describe("agent list bulk confirm levels", () => {
  it("idle stop / archive arm; busy or owned services → dialog; detach arms; big starts arm", () => {
    expect(bulkConfirmLevel("stop", { count: 3, busy: 0, owners: 0 })).toBe("armed");
    expect(bulkConfirmLevel("stop", { count: 3, busy: 1, owners: 0 })).toBe("dialog");
    expect(bulkConfirmLevel("archive", { count: 3, busy: 0, owners: 0 })).toBe("armed");
    expect(bulkConfirmLevel("archive", { count: 3, busy: 1, owners: 0 })).toBe("dialog");
    expect(bulkConfirmLevel("archive", { count: 3, busy: 0, owners: 1 })).toBe("dialog");
    expect(bulkConfirmLevel("detach", { count: 3, busy: 2, owners: 0 })).toBe("armed");
    expect(bulkConfirmLevel("start", { count: START_CONFIRM_OVER, busy: 0, owners: 0 })).toBe("none");
    expect(bulkConfirmLevel("start", { count: START_CONFIRM_OVER + 1, busy: 0, owners: 0 })).toBe("armed");
    expect(bulkConfirmLevel("restoreStart", { count: START_CONFIRM_OVER + 1, busy: 0, owners: 0 })).toBe("armed");
    expect(bulkConfirmLevel("restore", { count: 50, busy: 0, owners: 0 })).toBe("none");
  });
});

describe("/archive", () => {
  it("is picked into the composer, then sent: the send is the second step", () => {
    expect(slashSpec("archive")?.pick).toBe("insert");
  });
});
