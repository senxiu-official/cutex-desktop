import { MAX_MESSAGE_BYTES, parseBrowserOperation, parseBrowserOperationResult, type BrowserOperation, type BrowserOperationResult } from "@cutex-desktop/browser-protocol";
import { browserServiceError, parseBrowserServiceUrl } from "./services";

export const RELAY_CAPABILITY = "browser-relay-v1";
export const RELAY_KEY_HEADER = "X-Cutex-Browser-Key";
export const RELAY_GENERATION_HEADER = "X-Cutex-Browser-Generation";
export const RELAY_MAX_BYTES = MAX_MESSAGE_BYTES;
export const RELAY_MAX_LEASES = 256;
export const RELAY_CODES = ["invalid_request", "unsupported_operation", "unsupported_provider", "permission_denied", "loopback_only", "browser_disabled", "browser_unavailable", "target_closed", "lease_revoked", "lease_ended_desktop_restarted", "target_hidden", "owner_paused", "scope_unsupported", "scope_invalid", "stale_connection", "stale_request", "stale_ref", "deadline_exceeded", "cancelled", "outcome_unknown", "request_conflict", "request_result_not_retained", "approval_required", "approval_denied", "lease_limit", "lease_conflict", "busy", "idempotency_capacity_exceeded", "external_pages_unavailable", "service_proxy_required", "service_unavailable", "service_auth_failed", "navigation_failed", "browser_identity_unavailable", "invalid_result", "message_too_large"] as const;
export type RelayErrorCode = typeof RELAY_CODES[number];
export class BrowserRelayError extends Error {
  constructor(readonly code: RelayErrorCode) { super(code); this.name = "BrowserRelayError"; }
}
export function relayError(error: unknown): RelayErrorCode {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (typeof code === "string" && (RELAY_CODES as readonly string[]).includes(code)) return code as RelayErrorCode;
  const aliases: Record<string, RelayErrorCode> = { lease_expired: "lease_revoked", debugger_detached: "target_closed", request_id_conflict: "request_conflict", tab_busy: "busy", transport_error: "browser_unavailable", not_actionable: "invalid_request", unsupported_frame: "unsupported_operation" };
  return typeof code === "string" && Object.hasOwn(aliases, code) ? aliases[code]! : "browser_unavailable";
}
/**
 * A services-route failure (lease / view-ticket) as a relay code. The daemon's own refusals about the
 * service (service_not_found, service_reclaimed, service_start_failed, lease_not_found, …) are not relay
 * codes; the generic fallback would make them browser_unavailable, which the relay reports for a write
 * as outcome_unknown although nothing happened. They are a definite service_unavailable.
 */
export function browserServiceRelayError(error: unknown): RelayErrorCode {
  const code = browserServiceError(error), mapped = relayError({ code });
  // Only a real transport failure stays browser_unavailable (uncertain); relay codes and aliases pass.
  if (mapped !== "browser_unavailable" || code === "browser_unavailable" || code === "transport_error") return mapped;
  return code === "module_disabled" ? "browser_disabled" : "service_unavailable";
}
export interface RelayTarget { hostId: string; deviceId: string; guestId: string | null }
export interface RelayRegistration { deviceId: string; hostId: string; providerId: "browser"; executor: "inApp"; connectionGeneration: string; connectionKey: string; heartbeatMs: number; offlineMs: number }
export type RelayBinding = Omit<RelayRegistration, "connectionKey" | "heartbeatMs" | "offlineMs">;
export interface RelayLease { leaseId: string; cutexSessionId: string; target: RelayTarget & { guestId: string }; state: "pending" | "active"; title: string; url: string; origin: "owner" | "agent"; agentName: string }
interface RelayBase { version: 1; providerId: "browser"; deviceId: string; connectionGeneration: string }
export interface RelayCommand extends RelayBase { kind: "command"; requestId: string; dispatchSeq: number; remainingMs: number; cutexSessionId: string; turnId: string; target: RelayTarget; leaseId?: string; title: string; operation: BrowserOperation; purpose: "agent" | "owner-turn-shot" }
export type RelayMessage = RelayCommand
  | (RelayBase & { kind: "inventory"; leases: RelayLease[] })
  | (RelayBase & { kind: "cancel"; requestId: string; dispatchSeq: number; reason: string })
  | (RelayBase & { kind: "lease-revoked"; leaseId: string; reason: string });
export type RelayState = "accepted" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled" | "outcome_unknown";
export interface RelayResult { dispatchSeq: number; target: RelayTarget; operationKind: BrowserOperation["kind"]; status: RelayState; metadataOnly?: true; result?: BrowserOperationResult; error?: { code: RelayErrorCode } }
export interface RelayGrant { deviceId: string; guestId: string; cutexSessionId: string; title: string; url: string; source: { kind: "owner" } | { kind: "claim"; approvalId: string } | { kind: "agent-open"; requestId: string } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function relayId(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new BrowserRelayError("invalid_request"); }
function text(value: unknown, max: number, empty = false): asserts value is string { if (typeof value !== "string" || (!empty && !value) || Array.from(value).length > max || /[\x00-\x1f\x7f]/.test(value)) throw new BrowserRelayError("invalid_request"); }
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new BrowserRelayError("invalid_request");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new BrowserRelayError("invalid_request"); }
export function boundedRelayJson(value: unknown): string { let encoded: string; try { encoded = JSON.stringify(value); } catch { throw new BrowserRelayError("invalid_request"); } if (typeof encoded !== "string") throw new BrowserRelayError("invalid_request"); if (Buffer.byteLength(encoded) > RELAY_MAX_BYTES) throw new BrowserRelayError("message_too_large"); return encoded; }
function target(value: unknown, nullable = false): RelayTarget { const v = record(value, ["hostId", "deviceId", "guestId"]); relayId(v.hostId); relayId(v.deviceId); if (!nullable || v.guestId !== null) relayId(v.guestId); return v as unknown as RelayTarget; }
export function parseRelayLease(value: unknown): RelayLease {
  const v = record(value, ["leaseId", "cutexSessionId", "target", "state", "title", "url", "origin", "agentName"]); relayId(v.leaseId); relayId(v.cutexSessionId); target(v.target); text(v.title, 200); text(v.url, 8192); text(v.agentName, 200);
  if (!["pending", "active"].includes(v.state as string) || !["owner", "agent"].includes(v.origin as string)) throw new BrowserRelayError("invalid_request"); return v as unknown as RelayLease;
}
export function parseRelayRegistration(value: unknown, expected: Pick<RelayBinding, "hostId" | "deviceId">): RelayRegistration {
  const v = record(value, ["deviceId", "hostId", "providerId", "executor", "connectionGeneration", "connectionKey", "heartbeatMs", "offlineMs"]);
  if (v.deviceId !== expected.deviceId || v.hostId !== expected.hostId || v.providerId !== "browser" || v.executor !== "inApp" || typeof v.connectionGeneration !== "string" || !UUID.test(v.connectionGeneration) || typeof v.connectionKey !== "string" || !/^[0-9a-f]{64}$/.test(v.connectionKey)) throw new BrowserRelayError("invalid_request");
  integer(v.heartbeatMs, 100, 60_000); integer(v.offlineMs, 1000, 300_000); if (v.offlineMs <= v.heartbeatMs) throw new BrowserRelayError("invalid_request"); return v as unknown as RelayRegistration;
}
export function parseRelayMessage(value: unknown, binding: RelayBinding): RelayMessage {
  boundedRelayJson(value); const common = ["version", "providerId", "deviceId", "connectionGeneration", "kind"];
  const kind = value && typeof value === "object" && "kind" in value ? value.kind : undefined;
  const extras = kind === "inventory" ? ["leases"] : kind === "cancel" ? ["requestId", "dispatchSeq", "reason"] : kind === "lease-revoked" ? ["leaseId", "reason"] : kind === "command" ? ["requestId", "dispatchSeq", "remainingMs", "cutexSessionId", "turnId", "target", "title", "operation", "purpose"] : undefined;
  if (!extras) throw new BrowserRelayError("invalid_request"); const v = record(value, [...common, ...extras], kind === "command" ? ["leaseId"] : []);
  if (v.version !== 1 || v.providerId !== "browser") throw new BrowserRelayError("unsupported_provider");
  if (v.deviceId !== binding.deviceId || v.connectionGeneration !== binding.connectionGeneration) throw new BrowserRelayError("stale_connection");
  if (kind === "inventory") { if (!Array.isArray(v.leases) || v.leases.length > RELAY_MAX_LEASES) throw new BrowserRelayError("invalid_request"); const ids = new Set(); for (const raw of v.leases) { const lease = parseRelayLease(raw); if (lease.target.hostId !== binding.hostId || lease.target.deviceId !== binding.deviceId || ids.has(lease.leaseId)) throw new BrowserRelayError("invalid_request"); ids.add(lease.leaseId); } }
  if (kind === "lease-revoked") { relayId(v.leaseId); text(v.reason, 200); }
  if (kind === "cancel") { relayId(v.requestId); integer(v.dispatchSeq, 1, Number.MAX_SAFE_INTEGER); text(v.reason, 200); }
  if (kind === "command") {
    relayId(v.requestId); relayId(v.cutexSessionId); relayId(v.turnId); integer(v.dispatchSeq, 1, Number.MAX_SAFE_INTEGER); integer(v.remainingMs, 0, 30_000); text(v.title, 200); if (v.leaseId !== undefined) relayId(v.leaseId);
    // Service aliases are relay/main-only: validate the same strict operation shape
    // without broadening the public executor protocol's browser URL grammar.
    const raw = v.operation as Record<string, unknown> | undefined;
    const action = raw?.action as Record<string, unknown> | undefined, condition = action?.condition as Record<string, unknown> | undefined;
    const service = raw && ["tabs.open", "tab.navigate"].includes(raw.kind as string)
      && typeof raw.url === "string" && raw.url.startsWith("cutex:service/");
    const waitService = raw?.kind === "tab.act" && action?.kind === "wait" && condition?.kind === "url"
      && typeof condition.url === "string" && condition.url.startsWith("cutex:service/");
    const serviceUrl = service ? raw.url : waitService ? condition.url : undefined;
    if (serviceUrl !== undefined) { text(serviceUrl, 8192); if (!parseBrowserServiceUrl(serviceUrl as string)) throw new BrowserRelayError("invalid_request"); }
    const validated = service ? { ...raw, url: "http://service-validation.localhost/" } : waitService
      ? { ...raw, action: { ...action, condition: { ...condition, url: "http://service-validation.localhost/" } } } : raw;
    const operation = parseBrowserOperation(validated), t = target(v.target, operation.kind === "tabs.open");
    if (t.hostId !== binding.hostId || t.deviceId !== binding.deviceId || !["agent", "owner-turn-shot"].includes(v.purpose as string)) throw new BrowserRelayError("permission_denied");
    if (v.purpose === "owner-turn-shot" && operation.kind !== "tab.screenshot") throw new BrowserRelayError("invalid_request");
    if (operation.kind.startsWith("tab.") && v.leaseId === undefined) throw new BrowserRelayError("permission_denied");
  }
  return v as unknown as RelayMessage;
}
export function validateRelayResult(value: BrowserOperationResult, command: RelayCommand): BrowserOperationResult {
  try { boundedRelayJson(value); const result = parseBrowserOperationResult(value); if (result.kind !== command.operation.kind) throw new BrowserRelayError("invalid_result"); return result; }
  catch (error) { throw new BrowserRelayError(relayError(error) === "message_too_large" ? "message_too_large" : "invalid_result"); }
}
export function parseRelayGrant(value: unknown, deviceId: string): RelayGrant {
  const v = record(value, ["deviceId", "guestId", "cutexSessionId", "title", "url", "source"]); if (v.deviceId !== deviceId) throw new BrowserRelayError("permission_denied"); relayId(v.guestId); relayId(v.cutexSessionId); text(v.title, 200); text(v.url, 8192);
  const source = v.source as Record<string, unknown> | undefined, kind = source?.kind; record(source, kind === "owner" ? ["kind"] : kind === "claim" ? ["kind", "approvalId"] : kind === "agent-open" ? ["kind", "requestId"] : []);
  if (kind === "claim") relayId(source!.approvalId); else if (kind === "agent-open") relayId(source!.requestId); else if (kind !== "owner") throw new BrowserRelayError("invalid_request"); return v as unknown as RelayGrant;
}
