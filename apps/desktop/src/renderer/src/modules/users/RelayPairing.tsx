// 公网扫码配对 (owner 2026-11-08; cutex contract rev 9.4): the switch for the relay's public pairing entry, so the
// owner turns it off once the devices are set and on again to add one while away. A row at the bottom of the 设备
// card, and the same switch offered inline in 添加设备 when the entry is off. Low risk (paired devices, work TLS and
// LAN / Tailscale pairing do not change), so no confirm. Hosts without `relay-pairing-switch-v1` show nothing.
import { Lock } from "lucide-react";
import { accessRefusalOf, type UsersRefusal } from "../../../../shared/users";
import { Button, ErrorNote, SettingRow, SettingsGroup, Toggle } from "../../components/settings/Form";
import { accessRefusalText, useOwnerLocalLock } from "../../components/settings/OwnerDevices";
import { useI18n } from "../../i18n";
import { offerInAddDevice, RELAY_PAIRING_SWITCH_FEATURE, relayPairingKind, relayPairingReasonKey, useRelayPairing, type RelayPairingState } from "../../lib/relayPairing";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useHostScope } from "../../lib/useHostScope";

type T = ReturnType<typeof useI18n>["t"];

/** The host's switch, or null when it has none (older cutex) or this connection may not touch it. */
export function useHostRelayPairing(): { state: RelayPairingState; locked: boolean; lockHint: string | null; host: string } | null {
  const hostId = useTargetHostId();
  const supported = useTargetFeatures().has(RELAY_PAIRING_SWITCH_FEATURE);
  const lock = useOwnerLocalLock(hostId);
  const state = useRelayPairing(hostId, supported && !lock.locked);
  const host = useHostScope().host(hostId)?.view.label ?? hostId;
  return supported ? { state, locked: lock.locked, lockHint: lock.hint, host } : null;
}

function stateText(t: T, state: RelayPairingState): string | null {
  if (!state.status) return null;
  const kind = relayPairingKind(state.status);
  return kind === "failed" ? t("users.relayPairing.state.failed", { reason: t(relayPairingReasonKey(state.status.reason)) }) : t(`users.relayPairing.state.${kind}`);
}

function errorText(t: T, error: UsersRefusal, host: string): string {
  switch (error.code) {
    case "bootstrap_not_configured":
      return t("users.relayPairing.error.notConfigured");
    case "bootstrap_bind_unavailable":
      return t("users.relayPairing.error.bindUnavailable");
    case "bootstrap_unavailable":
      return t("users.relayPairing.error.unavailable");
    default:
      return accessRefusalText(t, accessRefusalOf({ ok: false, error }, { action: "pairingCode" }), host) ?? t("users.relayPairing.error.other", { message: error.message || error.code });
  }
}

/** 公网扫码配对 row (设备 card): the switch, what the entry does now, and when it is needed. */
export function RelayPairingRow() {
  const { t } = useI18n();
  const relay = useHostRelayPairing();
  if (!relay) return null;
  const { state, locked, lockHint, host } = relay;
  const status = state.status;
  const kind = status ? relayPairingKind(status) : null;
  const text = stateText(t, state);
  return (
    <div className="-mx-4 border-t border-border px-4" data-testid="relay-pairing-row" data-relay-pairing={kind ?? (locked ? "locked" : "loading")}>
      <SettingRow
        agents="access"
        source="host"
        label={t("users.relayPairing.title")}
        hint={
          <>
            {text && <span className={`block ${kind === "listening" ? "text-ok-text" : kind === "failed" ? "text-warn" : ""}`} data-testid="relay-pairing-state">{text}</span>}
            <span className="block">{locked ? lockHint : t("users.relayPairing.hint")}</span>
          </>
        }
      >
        {locked && <Lock size={12} className="text-subtle" />}
        <Toggle checked={!!status?.enabled} disabled={locked || !status || state.busy || (!status.configured && !status.enabled)} label={t("users.relayPairing.title")} onChange={(next) => void state.set(next)} />
      </SettingRow>
      {state.error && state.error.code !== "unreachable" && <ErrorNote>{errorText(t, state.error, host)}</ErrorNote>}
    </div>
  );
}

/** 添加设备: the entry exists but takes no requests now — say so and offer the switch (one click on). */
export function RelayPairingOffer() {
  const { t } = useI18n();
  const relay = useHostRelayPairing();
  if (!relay || relay.locked || !offerInAddDevice(relay.state.status)) return null;
  const { state, host } = relay;
  const failed = state.status!.enabled;
  return (
    <div className="mb-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2" data-testid="relay-pairing-offer">
      <p className="text-xs text-warn">
        {failed ? t("users.relayPairing.offerFailed", { reason: t(relayPairingReasonKey(state.status!.reason)) }) : t("users.relayPairing.offer")}
      </p>
      <div className="mt-1.5">
        <SettingsGroup agents="access" source="host">
          <Button primary disabled={state.busy} onClick={() => void state.set(true)}>{failed ? t("users.relayPairing.retry") : t("users.relayPairing.turnOn")}</Button>
        </SettingsGroup>
      </div>
      {state.error && state.error.code !== "unreachable" && <ErrorNote>{errorText(t, state.error, host)}</ErrorNote>}
    </div>
  );
}
