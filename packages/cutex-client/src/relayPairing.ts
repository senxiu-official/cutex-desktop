// 公网扫码配对 (cutex contract rev 9.4, `.claude/agent-artifacts/qr-pair/contract-rev9.md`): the owner's live switch
// for the relay's public pairing entry. Off closes the listener at once and keeps bind / name / invites; direct
// (tailnet / LAN) pairing, work TLS and paired devices do not change. Owner-local only.

/** Capability of a cutex with the live switch; older ones configure the entry with a restart and have no switch. */
export const RELAY_PAIRING_SWITCH_FEATURE = "relay-pairing-switch-v1";

export const RELAY_PAIRING_PATH = "/v2/relay/pairing";

/**
 * `enabled` is the owner's saved choice; `listening` is whether the entry really takes connections. Enabled but
 * not listening is a failure (`reason`: not_started, bind_unavailable, invalid_tls_config, listener_start_failed,
 * accept_failed, state_unavailable); off reads `disabled`, no entry `not_configured`.
 */
export interface RelayPairingStatus {
  configured: boolean;
  enabled: boolean;
  listening: boolean;
  reason: string | null;
  bootstrapBind: string | null;
  bootstrapServerName: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function readRelayPairingStatus(raw: unknown): RelayPairingStatus {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.configured !== "boolean" || typeof r.enabled !== "boolean" || typeof r.listening !== "boolean") throw new Error("malformed relay pairing status");
  return { configured: r.configured, enabled: r.enabled, listening: r.listening, reason: text(r.reason), bootstrapBind: text(r.bootstrapBind), bootstrapServerName: text(r.bootstrapServerName) };
}

/** The only body the route takes: exactly `{enabled}`, a strict boolean. */
export function relayPairingBody(enabled: boolean): { enabled: boolean } {
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  return { enabled };
}
