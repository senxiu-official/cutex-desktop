import type { BrowserAgentView, BrowserControlSettings, BrowserTabView, HostBrowserBridge } from "../../../../shared/browser";

export interface BrowserOwnerScope { hostId: string; epoch: string; tabKey: string }
export interface BrowserOwnerSnapshot { enabled: boolean; epoch: string | null; view?: BrowserTabView }
export interface BrowserOwnerControllerDeps {
  snapshot(scope: BrowserOwnerScope): BrowserOwnerSnapshot;
  api(hostId: string): Pick<HostBrowserBridge, "agents" | "grantAgent" | "resumeLease" | "releaseLease">;
  afterHostsDelivered(): Promise<void>;
}
const safeName = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  && [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function browserOwnerAgents(value: unknown): BrowserAgentView[] | null {
  if (!Array.isArray(value) || value.length > 512) return null;
  const ids = new Set<string>(), result: BrowserAgentView[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.sessionId !== "string"
      || !/^[A-Za-z0-9._:-]{1,200}$/.test(candidate.sessionId) || ids.has(candidate.sessionId) || !safeName(candidate.name)) return null;
    ids.add(candidate.sessionId); result.push({ sessionId: candidate.sessionId, name: candidate.name });
  }
  return result;
}

/** UI orchestration only. Main/daemon remain the authority for eligibility, leases and approvals. */
export class BrowserOwnerController {
  private readonly pending = new Map<string, object>();
  constructor(private readonly deps: BrowserOwnerControllerDeps) {}
  private key(scope: Pick<BrowserOwnerScope, "hostId" | "tabKey">): string { return JSON.stringify([scope.hostId, scope.tabKey]); }
  private current(scope: BrowserOwnerScope, original?: BrowserTabView): BrowserTabView | null {
    const { enabled, epoch, view } = this.deps.snapshot(scope);
    if (!enabled || epoch !== scope.epoch || !view || view.hostId !== scope.hostId || view.tabKey !== scope.tabKey || view.status !== "attached") return null;
    if (original && (view.guestId !== original.guestId || view.pageGeneration !== original.pageGeneration || view.url !== original.url
      || view.title !== original.title || view.pool !== original.pool || view.lease?.leaseId !== original.lease?.leaseId)) return null;
    return view;
  }
  async agents(scope: BrowserOwnerScope): Promise<BrowserAgentView[]> {
    const original = this.current(scope); if (!original) return [];
    await this.deps.afterHostsDelivered();
    if (!this.current(scope, original)) return [];
    const result = browserOwnerAgents(await this.deps.api(scope.hostId).agents());
    if (!this.current(scope, original)) return [];
    if (!result) throw new Error("invalid_result");
    return result;
  }
  async grant(scope: BrowserOwnerScope, selected: BrowserAgentView, settings: BrowserControlSettings,
    confirm: (name: string, pool: "owner" | "agent") => Promise<boolean>): Promise<boolean> {
    const original = this.current(scope);
    if (!original || original.lease || original.control || !browserOwnerAgents([selected])) return false;
    const token = {}, key = this.key(scope); this.pending.set(key, token);
    try {
      if (!(await confirm(selected.name, original.pool === "agent" ? "agent" : "owner"))) return false;
      await this.deps.afterHostsDelivered();
      const current = this.current(scope, original);
      if (this.pending.get(key) !== token || !current || current.lease || current.control) return false;
      const candidates = await this.agents(scope);
      const fresh = this.current(scope, original);
      if (this.pending.get(key) !== token || !fresh || fresh.lease || fresh.control
        || !candidates.some(agent => agent.sessionId === selected.sessionId && agent.name === selected.name)) return false;
      await this.deps.api(scope.hostId).grantAgent(scope.tabKey, selected.sessionId, settings, undefined,
        { guestId: fresh.guestId, pageGeneration: fresh.pageGeneration });
      return true;
    } finally { if (this.pending.get(key) === token) this.pending.delete(key); }
  }
  async resume(scope: BrowserOwnerScope, settings: BrowserControlSettings,
    confirm: (name: string, pool: "owner" | "agent") => Promise<boolean>): Promise<boolean> {
    const original = this.current(scope), lease = original?.lease;
    if (!original || !lease || lease.state !== "active" || original.control?.state !== "paused") return false;
    const token = {}, key = this.key(scope); this.pending.set(key, token);
    try {
      if (!(await confirm(lease.agentName, original.pool === "agent" ? "agent" : "owner"))) return false;
      await this.deps.afterHostsDelivered();
      const current = this.current(scope, original);
      if (this.pending.get(key) !== token || !current || current.lease?.state !== "active" || current.control?.state !== "paused") return false;
      await this.deps.api(scope.hostId).resumeLease(scope.tabKey, lease.leaseId, settings);
      return true;
    } finally { if (this.pending.get(key) === token) this.pending.delete(key); }
  }
  /** Revocation is not blocked by an obsolete epoch or module-off state. Exact lease only. */
  async revoke(hostId: string, tabKey: string, leaseId: string): Promise<void> {
    this.pending.delete(this.key({ hostId, tabKey }));
    // owner: the explicit 停止并撤销授予 also ends that agent's 一直允许 for the page's origin (main).
    await this.deps.api(hostId).releaseLease(tabKey, leaseId, true);
  }
  cancel(scope: Pick<BrowserOwnerScope, "hostId" | "tabKey">): void { this.pending.delete(this.key(scope)); }
}
