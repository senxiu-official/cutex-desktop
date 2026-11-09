// 公网扫码配对 (cutex contract rev 9.4): what the switch status means for the UI. Pure; lib/relayPairing.ts reads it.
import type { RelayPairingStatusView } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";

export type RelayPairingKind = "listening" | "off" | "notConfigured" | "failed";

export function relayPairingKind(status: RelayPairingStatusView): RelayPairingKind {
  if (!status.configured) return "notConfigured";
  if (!status.enabled) return "off";
  return status.listening ? "listening" : "failed";
}

const REASONS = ["not_started", "bind_unavailable", "invalid_tls_config", "listener_start_failed", "accept_failed", "state_unavailable"] as const;

/** Why an enabled entry does not listen, as a message key (an unknown reason: the generic text). */
export function relayPairingReasonKey(reason: string | null): MessageKey {
  return (REASONS as readonly string[]).includes(reason ?? "") ? (`users.relayPairing.reason.${reason}` as MessageKey) : "users.relayPairing.reason.other";
}

/** 添加设备 says public pairing is off and offers the switch: a relay entry exists but takes no requests now. */
export function offerInAddDevice(status: RelayPairingStatusView | null): boolean {
  return !!status && status.configured && !status.listening;
}

/**
 * Whether a phone can apply over the relay now. The QR names the configured entry whatever the switch says
 * (contract 9.4); with the switch known, only a listening entry counts. Unknown (older cutex, not read yet):
 * what the invite said.
 */
export function relayRouteNow(inviteRelay: boolean, status: RelayPairingStatusView | null): boolean {
  return inviteRelay && (status ? status.listening : true);
}
