import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "../src/shared/ipc";
import type { BrowserTabView } from "../src/shared/browser";
import { browserActivation } from "../src/shared/browser";

// A deterministic hook fixture: no DOM/Electron/IPC. It exercises the component's
// mount/update effects, not a focus handler or a second implementation of loading.
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0,
  effects: [] as { deps?: readonly unknown[]; effect: () => void | (() => void); off?: () => void }[], pending: [] as number[],
  epoch: "epoch", tabs: vi.fn(), cancel: vi.fn(), busy: vi.fn(), controller: null as any }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => { const i = hooks.cursor++; return hooks.values[i] ??= { current: value }; },
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === "function" ? next(hooks.values[i]) : next; }]; },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => { const i = hooks.cursor++, prior = hooks.effects[i];
    if (!prior || !deps || !prior.deps || deps.some((value, n) => !Object.is(value, prior.deps![n]))) {
      hooks.effects[i] = { effect, deps, off: prior?.off }; hooks.pending.push(i);
    }
  },
}));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { browser: { forHost: vi.fn(), subscribe: vi.fn(() => () => {}) }, apiFor: vi.fn() } }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ openHostAgent: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ confirmDialog: vi.fn() }));
vi.mock("../src/renderer/src/modules/react", () => ({ useModulePref: (_module: string, _name: string, fallback: unknown) => [fallback] }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => hooks.epoch, { getState: () => ({ hosts: null }) }) }));
vi.mock("../src/renderer/src/modules/approvals/browserClaimUi", () => ({
  BrowserClaimController: class { tabs = hooks.tabs; cancel = hooks.cancel; grant = vi.fn(async () => true); open = vi.fn(async () => true); constructor() { hooks.controller = this; } },
  browserClaimApproval: (record: ApprovalRecord) => record.state === "pending" ? { agentName: "Reader", reason: "look", urlHint: record.details?.urlHint } : null,
  browserClaimTabDisplay: (tab: BrowserTabView) => ({ title: tab.title, url: tab.url }),
}));
import { BrowserClaimPanel } from "../src/renderer/src/modules/approvals/BrowserClaimPanel";

const approval = (id = "first") => ({ approvalId: id, requestSha256: id, state: "pending" } as ApprovalRecord);
function render(record = approval(), variant: "card" | "page" = "page") {
  hooks.cursor = 0;
  const tree = BrowserClaimPanel({ approval: record, hostId: "local", variant, disabled: false, onBusy: hooks.busy });
  for (const i of hooks.pending.splice(0)) { const entry = hooks.effects[i]!; entry.off?.(); const off = entry.effect(); entry.off = typeof off === "function" ? off : undefined; }
  return tree;
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { hooks.values = []; hooks.effects = []; hooks.pending = []; hooks.cursor = 0; browserActivation.complete(browserActivation.begin()); hooks.epoch = "epoch";
  vi.clearAllMocks(); hooks.tabs.mockResolvedValue([]); });

describe("browser claim panel mount loading", () => {
  it("lists on initial mount before any owner focus, without granting or repeated renders triggering more reads", async () => {
    render(); expect(hooks.tabs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ hostId: "local", epoch: "epoch" }));
    await flush(); render(); expect(hooks.tabs).toHaveBeenCalledOnce();
  });
  it("a replacement approval loads even while the previous scope is still loading", async () => {
    const first = deferred<BrowserTabView[]>(); hooks.tabs.mockReturnValueOnce(first.promise);
    render(); render(); render(approval("second"));
    expect(hooks.tabs).toHaveBeenCalledTimes(2);
    expect(hooks.tabs.mock.calls[1]![0].approval.approvalId).toBe("second");
    first.resolve([]); await flush(); render(approval("second")); expect(hooks.tabs).toHaveBeenCalledTimes(2);
  });
  it("does not load while activation is off, then loads once when it becomes available", async () => {
    const token = browserActivation.begin(); render(); expect(hooks.tabs).not.toHaveBeenCalled();
    browserActivation.complete(token); render(); await flush(); render(); expect(hooks.tabs).toHaveBeenCalledOnce();
    browserActivation.end(token); render(); expect(hooks.tabs).toHaveBeenCalledOnce();
  });
});

// Walk the returned element tree (no DOM): props and text of every node.
type Node = { props?: Record<string, any> } | string | number | null | undefined | boolean | Node[];
function nodes(tree: Node, out: Record<string, any>[] = []): Record<string, any>[] {
  if (Array.isArray(tree)) { for (const child of tree) nodes(child, out); return out; }
  if (!tree || typeof tree !== "object" || !tree.props) return out;
  out.push(tree.props); nodes(tree.props.children as Node, out); return out;
}
const text = (tree: Node) => JSON.stringify(nodes(tree).map(props => props.children).filter(child => typeof child === "string" || typeof child === "number" || Array.isArray(child)));
const find = (tree: Node, attr: string) => nodes(tree).find(props => attr in props);
const claimTab = (extra: Partial<BrowserTabView> = {}): BrowserTabView => ({ guestId: "g1", tabKey: "k1", hostId: "local", pageGeneration: 1, url: "https://mail.example.com/", title: "Mail",
  loading: false, canGoBack: false, canGoForward: false, status: "attached", pool: "owner", ...extra });
const withHint = (urlHint?: string) => ({ ...approval(), details: urlHint ? { urlHint } : {} } as ApprovalRecord);

describe("browser claim card", () => {
  it("names the agent and the tab, warns about shared login, and offers 允许 / 一直允许 / 拒绝", async () => {
    hooks.tabs.mockResolvedValue([claimTab()]);
    render(withHint("https://mail.example.com/"), "card"); await flush(); const tree = render(withHint("https://mail.example.com/"), "card");
    const shown = text(tree);
    expect(shown).toContain("approvals.claim.title"); expect(shown).toContain("approvals.claim.ownerLogin");
    expect(find(tree, "data-browser-claim-allow")?.disabled).toBe(false);
    expect(find(tree, "data-browser-claim-session")?.disabled).toBe(false);
    expect(find(tree, "data-browser-claim-deny")).toBeTruthy();
    expect(find(tree, "data-browser-claim-tab")?.value).toBe("g1");
  });
  it("preselects the tab matching the claim's urlHint", async () => {
    hooks.tabs.mockResolvedValue([claimTab(), claimTab({ guestId: "g2", tabKey: "k2", url: "cutex:service/yemao/", title: "夜猫望月" })]);
    render(withHint("cutex:service/yemao/"), "card"); await flush();
    expect(find(render(withHint("cutex:service/yemao/"), "card"), "data-browser-claim-tab")?.value).toBe("g2");
  });
  it("an agent-pool tab says it shares none of the owner's logins", async () => {
    hooks.tabs.mockResolvedValue([claimTab({ pool: "agent" })]);
    render(approval(), "card"); await flush();
    const shown = text(render(approval(), "card"));
    expect(shown).toContain("approvals.claim.agentPool"); expect(shown).not.toContain("approvals.claim.ownerLogin");
  });
  it("with no open tab offers 打开并交给它 for a local hint, and only says which page for another", async () => {
    render(withHint("http://localhost:3000/app"), "card"); await flush();
    const local = render(withHint("http://localhost:3000/app"), "card");
    expect(find(local, "data-browser-claim-open")).toBeTruthy();
    await find(local, "data-browser-claim-open")!.onClick(); await flush();
    expect(hooks.controller.open).toHaveBeenCalledOnce();
    hooks.values = []; hooks.effects = []; hooks.pending = [];
    render(withHint("https://mail.example.com/"), "page"); await flush();
    const remote = render(withHint("https://mail.example.com/"), "page");
    expect(find(remote, "data-browser-claim-open")).toBeUndefined();
    expect(text(remote)).toContain("approvals.claim.goConversation");
  });
});

describe("审批 page approve path", () => {
  it("允许所选标签页 grants the selected tab with a confirmation; 一直允许 asks main to remember", async () => {
    hooks.tabs.mockResolvedValue([claimTab()]);
    render(); await flush(); let tree = render();
    expect(text(tree)).toContain("approvals.claim.approve");
    await find(tree, "data-browser-claim-allow")!.onClick(); await flush();
    expect(hooks.controller.grant).toHaveBeenCalledOnce();
    const [, selected, , confirm, options] = hooks.controller.grant.mock.calls[0];
    expect(selected.guestId).toBe("g1"); expect(options).toEqual({ remember: false });
    const { confirmDialog } = await import("../src/renderer/src/lib/contextMenu");
    (confirmDialog as any).mockResolvedValue(true);
    expect(await confirm("Reader", claimTab())).toBe(true); expect(confirmDialog).toHaveBeenCalledOnce();
    tree = render(); await find(tree, "data-browser-claim-session")!.onClick(); await flush();
    expect(hooks.controller.grant.mock.calls.at(-1)[4]).toEqual({ remember: true });
  });
});
