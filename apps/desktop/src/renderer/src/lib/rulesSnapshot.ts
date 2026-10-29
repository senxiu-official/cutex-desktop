// Read-only popover snapshots. Mutations still use cutex's revision checks.
import type { ApprovalRulesView, ClaudePermissionRules, DaemonApi } from "../../../shared/ipc";
import { bridge } from "../bridge";
import { captureHostAction, onHostReset } from "./hostSwitch";

const FRESH_MS = 30_000;
type Entry<T> = { value?: T; at: number; running?: Promise<T | null> };
const approvals = new Map<string, Entry<ApprovalRulesView | null>>();
const claude = new Map<string, Entry<ClaudePermissionRules>>();
type Change = "rules" | "reset" | "resync";
const listeners = new Map<string, Set<(change: Change) => void>>();
const keyOf = (hostId: string, sessionId: string) => JSON.stringify([hostId, sessionId]);

function read<T>(cache: Map<string, Entry<T>>, key: string, hostId: string, fetch: () => Promise<T>, force: boolean): Promise<T | null> {
  let entry = cache.get(key);
  if (entry?.running && !force) return entry.running;
  if (!force && entry?.value !== undefined && Date.now() - entry.at < FRESH_MS) return Promise.resolve(entry.value);
  if (!entry || force) { entry = { value: entry?.value, at: entry?.at ?? 0 }; cache.set(key, entry); }
  const target = entry, current = captureHostAction(hostId);
  const running = fetch().then((value) => {
    if (!current() || cache.get(key) !== target) return null;
    target.value = value; target.at = Date.now();
    return value;
  }).catch((error: unknown) => {
    if (!current() || cache.get(key) !== target) return null;
    throw error;
  }).finally(() => { if (target.running === running) target.running = undefined; });
  target.running = running;
  return running;
}

export const cachedApprovalRules = (hostId: string) => approvals.get(hostId)?.value ?? null;
export const loadApprovalRules = (hostId: string, api: DaemonApi, force = false) => read(approvals, hostId, hostId, () => api.approvalRules(), force);
export function rememberApprovalRules(hostId: string, value: ApprovalRulesView): void { approvals.set(hostId, { value, at: Date.now() }); }
export const cachedClaudeRules = (hostId: string, sessionId: string) => claude.get(keyOf(hostId, sessionId))?.value ?? null;
export const loadClaudeRules = (hostId: string, sessionId: string, api: DaemonApi, force = false) => read(claude, keyOf(hostId, sessionId), hostId, () => api.claudePermissionRules(sessionId), force);
export function rememberClaudeRules(hostId: string, sessionId: string, value: ClaudePermissionRules): void { claude.set(keyOf(hostId, sessionId), { value, at: Date.now() }); }
export function watchApprovalRules(hostId: string, listener: (change: Change) => void): () => void {
  const set = listeners.get(hostId) ?? new Set(); set.add(listener); listeners.set(hostId, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(hostId); };
}
function invalidate(hostId: string): void {
  approvals.delete(hostId);
  for (const key of claude.keys()) if (JSON.parse(key)[0] === hostId) claude.delete(key);
}
const notify = (hostId: string, change: Change) => { for (const listener of listeners.get(hostId) ?? []) listener(change); };
onHostReset((hostId) => { invalidate(hostId); notify(hostId, "reset"); });
if (typeof bridge.on === "function") {
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    const method = envelope.cutex?.method;
    const rolesChanged = method === "cutex/sessions/changed" && (envelope.cutex?.params as { projectsChanged?: boolean } | undefined)?.projectsChanged;
    if (method !== "cutex/approvalRules/changed" && !rolesChanged) return;
    approvals.delete(hostId);
    notify(hostId, "rules");
  });
  bridge.on("daemonState", ({ hostId, state }) => {
    if (state.kind !== "connected") { invalidate(hostId); notify(hostId, "reset"); }
    else notify(hostId, "resync");
  });
  bridge.on("hostResync", ({ hostId }) => {
    invalidate(hostId);
    notify(hostId, "resync");
  });
}
