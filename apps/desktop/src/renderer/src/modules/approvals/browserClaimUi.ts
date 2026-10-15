import type { ApprovalRecord } from "../../../../shared/ipc";
import type { BrowserControlSettings, BrowserTabView, HostBrowserBridge } from "../../../../shared/browser";
import { approvalFacts } from "../../lib/approvals";
import { browserClaimApproval } from "../../../../shared/browserClaim";

/** Reuse the approval facts whitelist, not the browser module's private state helpers. */
export function browserClaimTabDisplay(tab: Pick<BrowserTabView, "title" | "url">): { title: string; url: string } {
  const facts = approvalFacts({ title: tab.title, url: tab.url }, "browser_open");
  return { title: [...(facts.find(fact => fact.key === "title")?.value ?? "")].slice(0, 200).join("").trim(),
    url: facts.find(fact => fact.key === "url")?.value ?? "" };
}

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
export { browserClaimApproval };
function sameApproval(a: ApprovalRecord, b: ApprovalRecord): boolean {
  return a.approvalId === b.approvalId && a.requestSha256 === b.requestSha256 && a.requesterCutexSessionId === b.requesterCutexSessionId
    && a.createdAt === b.createdAt && ["hostId", "requestId", "deviceId", "connectionGeneration", "threadId", "runtimeGeneration", "agentName", "reason", "urlHint"]
      .every(key => a.details?.[key] === b.details?.[key]);
}
export function browserClaimTabs(value: readonly BrowserTabView[], hostId: string): BrowserTabView[] {
  if (!Array.isArray(value) || value.length > 512) return [];
  const seen = new Set<string>();
  return value.filter(tab => {
    // Both pools: an agent-pool tab (e.g. one an agent opened before an app restart) shares no owner login.
    if (!tab || tab.hostId !== hostId || (tab.pool !== "owner" && tab.pool !== "agent") || tab.status !== "attached" || tab.lease || tab.control
      || !ID.test(tab.tabKey) || !ID.test(tab.guestId) || !Number.isSafeInteger(tab.pageGeneration) || tab.pageGeneration < 0
      || typeof tab.url !== "string" || typeof tab.title !== "string" || seen.has(tab.tabKey)) return false;
    seen.add(tab.tabKey); return true;
  });
}
const sameTab = (a: BrowserTabView, b: BrowserTabView) => a.tabKey === b.tabKey && a.guestId === b.guestId
  && a.hostId === b.hostId && a.pageGeneration === b.pageGeneration && a.url === b.url && a.title === b.title && a.pool === b.pool;
export interface BrowserClaimScope { hostId: string; epoch: string; approval: ApprovalRecord }
export interface BrowserClaimDeps {
  current(scope: BrowserClaimScope): { enabled: boolean; epoch: string | null; approval?: ApprovalRecord };
  browser(hostId: string): Pick<HostBrowserBridge, "list" | "grantAgent" | "claimOpen">;
  approvals(hostId: string): Promise<ApprovalRecord[] | null>;
  afterHostsDelivered(): Promise<void>;
  now?(): number;
}
/** Explicit owner selection; no human-approve fallback, agent choice, navigation, focus or retry. */
export class BrowserClaimController {
  private attempt?: object;
  constructor(private deps: BrowserClaimDeps) {}
  private valid(scope: BrowserClaimScope): boolean {
    const current = this.deps.current(scope), now = this.deps.now?.() ?? Date.now();
    return current.enabled && current.epoch === scope.epoch && !!browserClaimApproval(scope.approval, scope.hostId, now)
      && !!browserClaimApproval(current.approval, scope.hostId, now) && sameApproval(scope.approval, current.approval!);
  }
  async tabs(scope: BrowserClaimScope): Promise<BrowserTabView[]> {
    if (!this.valid(scope)) return [];
    await this.deps.afterHostsDelivered(); if (!this.valid(scope)) return [];
    const tabs = await this.deps.browser(scope.hostId).list();
    return this.valid(scope) ? browserClaimTabs(tabs, scope.hostId) : [];
  }
  private async pending(scope: BrowserClaimScope): Promise<boolean> {
    const records = await this.deps.approvals(scope.hostId);
    if (!this.valid(scope) || !Array.isArray(records) || records.length > 4096) return false;
    const matches = records.filter(record => record.approvalId === scope.approval.approvalId);
    return matches.length === 1 && !!browserClaimApproval(matches[0], scope.hostId, this.deps.now?.() ?? Date.now()) && sameApproval(scope.approval, matches[0]!);
  }
  async grant(scope: BrowserClaimScope, selected: BrowserTabView, settings: BrowserControlSettings,
    confirm: (agentName: string, tab: BrowserTabView) => Promise<boolean>, options: { remember?: boolean } = {}): Promise<boolean> {
    if (this.attempt || !this.valid(scope) || !browserClaimTabs([selected], scope.hostId).length) return false;
    const token = {}; this.attempt = token;
    try {
      const original = (await this.tabs(scope)).find(tab => sameTab(tab, selected));
      if (!original || !await this.pending(scope) || this.attempt !== token || !this.valid(scope)) return false;
      const details = browserClaimApproval(scope.approval, scope.hostId, this.deps.now?.() ?? Date.now())!;
      if (!await confirm(details.agentName, original)) return false;
      await this.deps.afterHostsDelivered();
      if (this.attempt !== token || !this.valid(scope) || !await this.pending(scope)) return false;
      const current = (await this.tabs(scope)).find(tab => sameTab(tab, original));
      if (!current || this.attempt !== token || !this.valid(scope)) return false;
      const api = this.deps.browser(scope.hostId), target = { guestId: current.guestId, pageGeneration: current.pageGeneration };
      if (options.remember) await api.grantAgent(current.tabKey, scope.approval.requesterCutexSessionId, settings, scope.approval.approvalId, target, { remember: true });
      else await api.grantAgent(current.tabKey, scope.approval.requesterCutexSessionId, settings, scope.approval.approvalId, target);
      return true;
    } finally { if (this.attempt === token) this.attempt = undefined; }
  }
  /** 「打开并交给它」: main opens the claim's own local page (it reads the record from cutex) and grants it. */
  async open(scope: BrowserClaimScope, settings: BrowserControlSettings): Promise<boolean> {
    if (this.attempt || !this.valid(scope)) return false;
    const token = {}; this.attempt = token;
    try {
      if (!await this.pending(scope) || this.attempt !== token || !this.valid(scope)) return false;
      await this.deps.browser(scope.hostId).claimOpen(scope.approval.approvalId, settings);
      return true;
    } finally { if (this.attempt === token) this.attempt = undefined; }
  }
  cancel(): void { this.attempt = undefined; }
}
