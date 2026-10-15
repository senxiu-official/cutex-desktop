// browser_claim without the approval round trip (owner decision 2026-10-13). Main is the authority:
// it decides from the per-profile mode, the tab's page and this run's 「一直允许」, and grants by the
// same exact owner-tab selection the 「交给…」 menu performs (lease source `claim`), so cutex still
// consumes its own approval record. The renderer only shows the card and sends the owner's click.
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserClaimAllowView, BrowserClaimAuditView, BrowserClaimPolicyView } from "../../shared/browser";
import {
  browserClaimApproval, browserClaimOpenTarget, browserClaimOrigin, browserClaimScore, DEFAULT_BROWSER_CLAIM_MODE, isBrowserClaimMode, planBrowserClaim,
  type BrowserClaimAutoReason, type BrowserClaimMode, type BrowserClaimTab,
} from "../../shared/browserClaim";
import type { ApprovalRecord } from "../../shared/ipc";
import { BrowserRelayError } from "./relayTypes";

const key = (...parts: string[]) => JSON.stringify(parts);

/** Desktop-local per (host, profile) mode. Untrusted file content falls back to the default. */
export class BrowserClaimPolicyStore {
  private modes = new Map<string, BrowserClaimMode>();
  private loaded = false;
  constructor(private readonly file: string | null, private readonly io = { read: (path: string) => readFileSync(path, "utf8"), write: (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path);
  } }) {}
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const value = JSON.parse(this.io.read(this.file)) as { version?: unknown; modes?: unknown };
      if (value?.version !== 1 || !value.modes || typeof value.modes !== "object" || Array.isArray(value.modes)) return;
      for (const [k, mode] of Object.entries(value.modes).slice(0, 1024)) if (isBrowserClaimMode(mode)) this.modes.set(k, mode);
    } catch { /* Missing or unreadable: defaults. */ }
  }
  get(hostId: string, profile: string | null): BrowserClaimPolicyView {
    this.load();
    const stored = profile ? this.modes.get(key(hostId, profile)) ?? null : null;
    return { mode: stored ?? DEFAULT_BROWSER_CLAIM_MODE, stored, defaultMode: DEFAULT_BROWSER_CLAIM_MODE };
  }
  set(hostId: string, profile: string, mode: BrowserClaimMode | null): BrowserClaimPolicyView {
    this.load();
    if (mode === null) this.modes.delete(key(hostId, profile)); else this.modes.set(key(hostId, profile), mode);
    if (this.file) this.io.write(this.file, JSON.stringify({ version: 1, modes: Object.fromEntries(this.modes) }, null, 2));
    return this.get(hostId, profile);
  }
}

/** 「本次运行内一直允许」: this agent, any tab of the origin; memory only, never written to disk. */
export class BrowserClaimSessionAllows {
  private entries = new Map<string, BrowserClaimAllowView & { hostId: string }>();
  constructor(private readonly now = () => Date.now()) {}
  allow(hostId: string, sessionId: string, agentName: string, origin: string): void {
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key(hostId, sessionId, origin), { hostId, sessionId, agentName, origin, since: new Date(this.now()).toISOString() });
  }
  has(hostId: string, sessionId: string, origin: string): boolean { return this.entries.has(key(hostId, sessionId, origin)); }
  list(hostId: string): BrowserClaimAllowView[] {
    return [...this.entries.values()].filter(e => e.hostId === hostId).map(({ hostId: _h, ...view }) => view);
  }
  revoke(hostId: string, sessionId: string, origin?: string): void {
    for (const [k, e] of this.entries) if (e.hostId === hostId && e.sessionId === sessionId && (origin === undefined || e.origin === origin)) this.entries.delete(k);
  }
  clear(): void { this.entries.clear(); }
}

/** Automatic grants of this run (bounded), also written to the main log. */
export class BrowserClaimAudit {
  private entries: (BrowserClaimAuditView & { hostId: string })[] = [];
  constructor(private readonly log: (line: string) => void = line => console.info(line)) {}
  add(hostId: string, entry: BrowserClaimAuditView): void {
    this.entries.unshift({ hostId, ...entry }); this.entries.length = Math.min(this.entries.length, 64);
    this.log(`browser claim auto-granted (auto: ${entry.reason === "local" ? "local page" : entry.reason === "session" ? "allowed until restart" : "profile always"}) host=${hostId} agent=${entry.sessionId} approval=${entry.approvalId} origin=${entry.origin}`);
  }
  list(hostId: string): BrowserClaimAuditView[] { return this.entries.filter(e => e.hostId === hostId).map(({ hostId: _h, ...view }) => view); }
}

export interface BrowserClaimDeps {
  mode(hostId: string, profile: string | null): BrowserClaimMode;
  /** The requester's profile (cutex session), null when unknown — then the default mode applies. */
  profileOf(hostId: string, sessionId: string): Promise<string | null>;
  /** Slugs of cutex services this agent owns (matched when the claim has no urlHint). */
  ownedServices(hostId: string, sessionId: string): Promise<string[]>;
  /** Tabs main can hand over now (attached, loaded, no lease / control), both pools. */
  tabs(hostId: string): BrowserClaimTab[];
  /** The exact owner-tab selection with lease source `claim` (cutex consumes the approval). */
  grant(hostId: string, tab: BrowserClaimTab, approval: ApprovalRecord, auto?: BrowserClaimAutoReason): Promise<void>;
  /** Open a local page in a new owner tab shown in the agent's lane; resolves once it is attached and loaded. */
  openTab(hostId: string, url: string, sessionId: string): Promise<BrowserClaimTab>;
  /** The pending record as cutex has it now (owner clicks never trust a renderer copy). */
  approval(hostId: string, approvalId: string): Promise<ApprovalRecord | null>;
  granted(hostId: string, tab: BrowserClaimTab, agentName: string, reason: BrowserClaimAutoReason): void;
  now?(): number;
}

export type BrowserClaimOutcome = "granted" | "ask" | "skip";

export class BrowserClaimCoordinator {
  private pending = new Map<string, { hostId: string; approval: ApprovalRecord }>();
  private attempted = new Map<string, string>();
  private running = new Set<string>();
  /** A consider asked for while one ran (e.g. the tab finished loading meanwhile): run once more after it. */
  private rerun = new Set<string>();
  constructor(private readonly deps: BrowserClaimDeps, readonly allows: BrowserClaimSessionAllows, readonly audit: BrowserClaimAudit) {}

  /** A claim seen in the host feed or a pending scan. Anything not pending leaves the cache. */
  observe(hostId: string, approval: ApprovalRecord): Promise<BrowserClaimOutcome> {
    const k = key(hostId, approval.approvalId);
    if (approval.kind !== "browser_claim") return Promise.resolve("skip");
    if (approval.state !== "pending") { this.pending.delete(k); this.attempted.delete(k); return Promise.resolve("skip"); }
    this.pending.set(k, { hostId, approval });
    return this.consider(hostId, approval);
  }
  /** Tabs changed (a tab attached or finished loading): reconsider this host's pending claims. */
  retry(hostId: string): void {
    for (const entry of [...this.pending.values()]) if (entry.hostId === hostId) void this.consider(hostId, entry.approval);
  }
  forgetHost(hostId: string): void {
    for (const [k, entry] of this.pending) if (entry.hostId === hostId) { this.pending.delete(k); this.attempted.delete(k); }
  }
  pendingFor(hostId: string): ApprovalRecord[] { return [...this.pending.values()].filter(e => e.hostId === hostId).map(e => e.approval); }

  async consider(hostId: string, approval: ApprovalRecord): Promise<BrowserClaimOutcome> {
    const now = this.deps.now?.() ?? Date.now();
    const details = browserClaimApproval(approval, hostId, now);
    const k = key(hostId, approval.approvalId);
    if (!details) { this.pending.delete(k); return "skip"; }
    if (this.running.has(k)) { this.rerun.add(k); return "skip"; }
    this.running.add(k);
    let outcome: BrowserClaimOutcome = "ask";
    try {
      outcome = await this.decide(hostId, approval, details, k);
      return outcome;
    } finally {
      this.running.delete(k);
      const again = this.rerun.delete(k);
      const latest = this.pending.get(k);
      if (again && outcome !== "granted" && latest) void this.consider(hostId, latest.approval);
    }
  }

  /**
   * cutex's browser_claim waits ~3 s for a grant: the approvals-changed event reaches `observe`
   * directly (no debounce), and when an open tab already matches the urlHint the agent's service
   * list (only a fallback below a hint match) is not fetched at all.
   */
  private async decide(hostId: string, approval: ApprovalRecord, details: NonNullable<ReturnType<typeof browserClaimApproval>>, k: string): Promise<BrowserClaimOutcome> {
    try {
      const sessionId = approval.requesterCutexSessionId;
      const hinted = !!details.urlHint && this.deps.tabs(hostId).some(t => browserClaimScore(t.url, details.urlHint, []) >= 2);
      const owned = hinted ? Promise.resolve<string[]>([]) : this.deps.ownedServices(hostId, sessionId).catch(() => []);
      const [profile, ownedSlugs] = await Promise.all([this.deps.profileOf(hostId, sessionId).catch(() => null), owned]);
      const mode = this.deps.mode(hostId, profile);
      const plan = planBrowserClaim({ mode, tabs: this.deps.tabs(hostId), hint: details.urlHint, ownedSlugs,
        allowed: origin => this.allows.has(hostId, sessionId, origin) });
      if (plan.action === "ask") return "ask";
      // A failed attempt is not repeated for the same target; a new tab or page may try again.
      const signature = plan.action === "grant" ? `tab:${plan.tab.guestId}:${plan.tab.pageGeneration}` : `open:${plan.url}`;
      if (this.attempted.get(k) === signature) return "ask";
      this.attempted.set(k, signature);
      const tab = plan.action === "grant" ? plan.tab : await this.deps.openTab(hostId, plan.url, sessionId);
      await this.deps.grant(hostId, tab, approval, plan.reason);
      this.pending.delete(k); this.attempted.delete(k);
      this.audit.add(hostId, { at: new Date(this.deps.now?.() ?? Date.now()).toISOString(), sessionId, agentName: details.agentName, approvalId: approval.approvalId,
        reason: plan.reason, origin: browserClaimOrigin(tab.url) ?? "", title: tab.title });
      this.deps.granted(hostId, tab, details.agentName, plan.reason);
      return "granted";
    } catch (error) {
      console.warn("browser claim auto-grant failed; the owner card stays", error instanceof Error ? error.message : error);
      return "ask";
    }
  }

  /**
   * The owner's 「打开并交给它」: only the claim's own local urlHint (or the agent's only service), as
   * cutex has the record now. A renderer cannot name the page, the agent or a non-local URL.
   */
  async ownerOpen(hostId: string, approvalId: string): Promise<void> {
    const approval = await this.deps.approval(hostId, approvalId);
    const details = browserClaimApproval(approval ?? undefined, hostId, this.deps.now?.() ?? Date.now());
    if (!approval || !details) throw new BrowserRelayError("approval_denied");
    const owned = details.urlHint ? [] : await this.deps.ownedServices(hostId, approval.requesterCutexSessionId).catch(() => []);
    const url = browserClaimOpenTarget(details.urlHint, owned);
    if (!url) throw new BrowserRelayError("external_pages_unavailable");
    const k = key(hostId, approvalId);
    if (this.running.has(k)) throw new BrowserRelayError("busy");
    this.running.add(k);
    try {
      const tab = await this.deps.openTab(hostId, url, approval.requesterCutexSessionId);
      await this.deps.grant(hostId, tab, approval);
      this.pending.delete(k);
    } finally { this.running.delete(k); this.rerun.delete(k); }
  }
}
