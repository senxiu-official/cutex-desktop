// browser_claim policy helpers shared by main (the authority) and the renderer (display only).
// Main decides every automatic grant from these; the renderer uses them to preselect a tab and to
// word the card. Nothing here grants, opens or reads a page.
import type { ApprovalRecord, BrowserClaimApprovalDetails } from "./ipc";

/** Per-profile 「浏览器控制」: ask every time / local pages without asking (default) / always allow. */
export type BrowserClaimMode = "ask" | "local" | "always";
export const BROWSER_CLAIM_MODES: readonly BrowserClaimMode[] = ["ask", "local", "always"];
export const DEFAULT_BROWSER_CLAIM_MODE: BrowserClaimMode = "local";
export const isBrowserClaimMode = (value: unknown): value is BrowserClaimMode => value === "ask" || value === "local" || value === "always";

/** Why main granted a claim without the owner's click (shown on the tab's control banner and in the log). */
export type BrowserClaimAutoReason = "local" | "session" | "profile";

/** A tab main may hand over for a claim: attached, not loading, not leased or controlled. */
export interface BrowserClaimTab { guestId: string; tabKey: string; url: string; title: string; pageGeneration: number; pool: "owner" | "agent" }

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const text = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim()
  && [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

/** A pending, well-formed browser_claim of this host, or null. The same whitelist main and renderer apply. */
export function browserClaimApproval(record: ApprovalRecord | undefined, hostId: string, now = Date.now()): BrowserClaimApprovalDetails | null {
  if (!record || record.kind !== "browser_claim" || record.state !== "pending" || !ID.test(record.approvalId)
    || !ID.test(record.requesterCutexSessionId) || !/^[a-f0-9]{64}$/i.test(record.requestSha256)
    || !Number.isFinite(Date.parse(record.createdAt)) || Date.parse(record.createdAt) + 86_400_000 <= now) return null;
  const d = record.details;
  if (!d || d.version !== 1 || d.hostId !== hostId || d.cutexSessionId !== record.requesterCutexSessionId || d.sharesOwnerLogin !== true
    || d.intentDigest !== record.requestSha256 || !text(d.agentName, 200) || !text(d.reason, 4096)
    || ![d.requestId, d.deviceId, d.connectionGeneration, d.threadId].every(value => typeof value === "string" && ID.test(value))
    || !Number.isSafeInteger(d.runtimeGeneration) || (d.runtimeGeneration as number) < 0
    || (d.urlHint !== undefined && (typeof d.urlHint !== "string" || d.urlHint.length > 4096))) return null;
  return d as unknown as BrowserClaimApprovalDetails;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Where a page lives for claim matching: `cutex:service/<slug>` or an http(s) origin, plus its path. */
export function browserClaimTarget(raw: unknown): { origin: string; path: string; local: boolean; slug?: string } | null {
  if (typeof raw !== "string" || !raw || raw.length > 8000) return null;
  if (raw.startsWith("cutex:service/")) {
    let rest: string;
    try { rest = decodeURIComponent(raw.slice("cutex:service/".length)); } catch { return null; }
    const slash = rest.indexOf("/"), slug = slash < 0 ? rest : rest.slice(0, slash);
    if (!SLUG.test(slug)) return null;
    return { origin: `cutex:service/${slug}`, path: slash < 0 ? "/" : rest.slice(slash).split("?")[0]!, local: true, slug };
  }
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Port-less service names (`<slug>.svc.localhost`) are the same service as cutex:service/<slug>.
  if (url.protocol === "http:" && url.hostname.endsWith(".svc.localhost")) {
    const slug = url.hostname.slice(0, -".svc.localhost".length);
    if (SLUG.test(slug)) return { origin: `cutex:service/${slug}`, path: url.pathname, local: true, slug };
  }
  return { origin: url.origin, path: url.pathname, local: LOOPBACK.has(url.hostname) };
}

/** A page without valuable login state: loopback (127.0.0.1 / localhost / [::1]) or a cutex service on this host. */
export function browserLocalPage(raw: unknown): boolean { return browserClaimTarget(raw)?.local === true; }
export function browserClaimOrigin(raw: unknown): string | null { return browserClaimTarget(raw)?.origin ?? null; }

/** How well a tab fits a claim: the claim's urlHint first, then the agent's own services. 0 = no match. */
export function browserClaimScore(tabUrl: string, hint: string | undefined, ownedSlugs: readonly string[]): number {
  const tab = browserClaimTarget(tabUrl);
  if (!tab) return 0;
  const wanted = hint ? browserClaimTarget(hint) : null;
  if (wanted && wanted.origin === tab.origin) {
    if (wanted.path === tab.path) return 4;
    const prefix = wanted.path.endsWith("/") ? wanted.path : `${wanted.path}/`;
    return wanted.path !== "/" && tab.path.startsWith(prefix) ? 3 : 2;
  }
  return tab.slug && ownedSlugs.includes(tab.slug) ? 1 : 0;
}

/** The best matching tab (first wins a tie), or undefined. */
export function pickBrowserClaimTab<T extends Pick<BrowserClaimTab, "url">>(tabs: readonly T[], hint: string | undefined, ownedSlugs: readonly string[] = []): T | undefined {
  let best: T | undefined, score = 0;
  for (const tab of tabs) { const value = browserClaimScore(tab.url, hint, ownedSlugs); if (value > score) { best = tab; score = value; } }
  return best;
}

export type BrowserClaimPlan =
  | { action: "grant"; tab: BrowserClaimTab; reason: BrowserClaimAutoReason }
  | { action: "open"; url: string; reason: "local" }
  | { action: "ask"; tab?: BrowserClaimTab };

/**
 * Main's decision for a pending claim. Local pages (mode local / always), tabs of an origin the owner
 * allowed for this agent until restart, and — mode always — any matching tab are granted; a local
 * urlHint without an open tab is opened first. Everything else waits for the owner's card.
 */
export function planBrowserClaim(input: { mode: BrowserClaimMode; tabs: readonly BrowserClaimTab[]; hint?: string; ownedSlugs: readonly string[];
  allowed(origin: string): boolean }): BrowserClaimPlan {
  const tab = pickBrowserClaimTab(input.tabs, input.hint, input.ownedSlugs);
  if (tab) {
    if (input.mode !== "ask" && browserLocalPage(tab.url)) return { action: "grant", tab, reason: "local" };
    const origin = browserClaimOrigin(tab.url);
    if (origin && input.allowed(origin)) return { action: "grant", tab, reason: "session" };
    if (input.mode === "always") return { action: "grant", tab, reason: "profile" };
    return { action: "ask", tab };
  }
  const url = input.mode !== "ask" ? browserClaimOpenTarget(input.hint, input.ownedSlugs) : null;
  return url ? { action: "open", url, reason: "local" } : { action: "ask" };
}

/** What to open for a claim without an open tab: its local urlHint, else the agent's only service. Null = none. */
export function browserClaimOpenTarget(hint: string | undefined, ownedSlugs: readonly string[]): string | null {
  if (hint) return browserClaimOpenUrl(hint);
  return ownedSlugs.length === 1 && SLUG.test(ownedSlugs[0]!) ? `cutex:service/${ownedSlugs[0]}` : null;
}

/** The page main opens in a new owner tab for a claim: only a loopback or cutex service URL, never anything else. */
export function browserClaimOpenUrl(hint: unknown): string | null {
  const target = browserClaimTarget(hint);
  if (!target?.local || typeof hint !== "string") return null;
  if (target.slug) {
    // Normalize a port-less service name to the module's cutex:service ref (no query, no fragment).
    return `cutex:service/${target.slug}${encodeURIComponent(target.path).replace(/%2F/g, "/")}`;
  }
  try { const url = new URL(hint); url.username = ""; url.password = ""; url.hash = ""; return url.href; } catch { return null; }
}
