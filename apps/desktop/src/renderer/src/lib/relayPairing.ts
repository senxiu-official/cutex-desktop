// 公网扫码配对 (cutex contract rev 9.4, `relay-pairing-switch-v1`): the owner's live switch for the relay's public
// pairing entry, read and set per host. The 设备 card's row and 添加设备 share one status per host, so turning
// it on in one shows in the other. Owner-local: nothing is read while the host refuses this connection.
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { RELAY_PAIRING_SWITCH_FEATURE } from "@cutex-desktop/cutex-client";
import type { RelayPairingStatusView } from "../../../shared/ipc";
import type { UsersRefusal } from "../../../shared/users";
import { apiFor } from "../bridge";

export { RELAY_PAIRING_SWITCH_FEATURE };
export * from "./relayPairingModel";

/** The switch may change from the CLI or another window: read again this often while it is on screen. */
export const RELAY_PAIRING_POLL_MS = 15_000;

interface Entry {
  status: RelayPairingStatusView | null;
  error: UsersRefusal | null;
  busy: boolean;
}
const EMPTY: Entry = { status: null, error: null, busy: false };

const useStatuses = create<{ byHost: Record<string, Entry> }>(() => ({ byHost: {} }));
const patch = (hostId: string, next: Partial<Entry>) =>
  useStatuses.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { ...(s.byHost[hostId] ?? EMPTY), ...next } } }));

async function read(hostId: string): Promise<void> {
  try {
    const r = await apiFor(hostId).relayPairing();
    patch(hostId, r.ok ? { status: r.value, error: null } : { error: r.error });
  } catch (e) {
    patch(hostId, { error: { code: "unreachable", message: e instanceof Error ? e.message : String(e) } });
  }
}

export interface RelayPairingState extends Entry {
  /** On / off; a refusal stays in `error` and the status is read again (a failed on keeps the owner's choice). */
  set(enabled: boolean): Promise<void>;
  reload(): Promise<void>;
}

/** One host's switch; `active` false (no capability, or not owner-local) reads nothing. */
export function useRelayPairing(hostId: string, active: boolean): RelayPairingState {
  const entry = useStatuses((s) => s.byHost[hostId]) ?? EMPTY;
  const reload = useCallback(() => (active ? read(hostId) : Promise.resolve()), [hostId, active]);
  useEffect(() => {
    if (!active) return;
    void read(hostId);
    const timer = setInterval(() => void read(hostId), RELAY_PAIRING_POLL_MS);
    return () => clearInterval(timer);
  }, [hostId, active]);
  const set = useCallback(
    async (enabled: boolean) => {
      if (!active) return;
      patch(hostId, { busy: true, error: null });
      try {
        const r = await apiFor(hostId).setRelayPairing(enabled);
        if (r.ok) patch(hostId, { status: r.value });
        else {
          patch(hostId, { error: r.error });
          await read(hostId).then(() => patch(hostId, { error: r.error }));
        }
      } catch (e) {
        patch(hostId, { error: { code: "unreachable", message: e instanceof Error ? e.message : String(e) } });
      } finally {
        patch(hostId, { busy: false });
      }
    },
    [hostId, active],
  );
  return { ...entry, set, reload };
}

/** Test helper. */
export function resetRelayPairingForTests(): void {
  useStatuses.setState({ byHost: {} });
}
