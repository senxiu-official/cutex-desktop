// New owner devices and the owner-local rule in the renderer (cutex 21123b6; backend contract
// docs/research/owner-devices-ui-contract-20261019.md, desktop API docs/research/owner-devices-desktop-api-20261019.md).
// Per host: the unacknowledged owner devices (`GET /v2/users/owner/new-devices`, capability
// `owner-device-notice`), kept live by the host event `cutex/access/ownerDeviceAdded` (and re-read on
// `cutex/access/changed` / a reconnect), 「知道了」 (ack) and 「移除」 (the client-token revoke). Pure parts
// are in shared/users.ts (ownerLocalActionsAllowed, accessRefusalOf, readOwnerNewDevices, …).
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import {
  deviceScopeOf,
  OWNER_DEVICE_NOTICE_FEATURE,
  ownerDeviceAddedOf,
  ownerLocalActionsAllowed,
  type OwnerDeviceAck,
  type OwnerDeviceAdded,
  type OwnerLocalAllowed,
  type OwnerNewDevice,
  type UsersRefusal,
  type UsersResult,
} from "../../../shared/users";
import { apiFor, bridge } from "../bridge";
import { useHostAccess } from "./hostAccess";
import { onHostReset } from "./hostSwitch";
import { useHostData, useHostLook } from "./useHostScope";

export type { OwnerDeviceAdded, OwnerLocalAllowed, OwnerNewDevice };

/** One host's new-devices state. */
export interface OwnerDevicesEntry {
  /** Unacknowledged owner devices (cutex order; `current` = this connection's own token). */
  devices: OwnerNewDevice[];
  /** The route answered (true) / the host has no such route (false, older cutex); null = not read yet. */
  supported: boolean | null;
  loading: boolean;
  /** The last read's refusal (owner_required, user_pending, …); null after a good read. */
  error: UsersRefusal | null;
  /** Connection epoch of the last read (null: read outside a known epoch). */
  epoch: string | null;
  /** The last `cutex/access/ownerDeviceAdded` seen on this host since the app started (null: none). */
  latest: OwnerDeviceAdded | null;
}

const EMPTY: OwnerDevicesEntry = Object.freeze({ devices: [], supported: null, loading: false, error: null, epoch: null, latest: null }) as OwnerDevicesEntry;

const useEntries = create<Record<string, OwnerDevicesEntry>>(() => ({}));
const inFlight = new Map<string, Promise<void>>();

onHostReset((hostId) => {
  inFlight.delete(hostId);
  useEntries.setState((s) => (s[hostId] ? Object.fromEntries(Object.entries(s).filter(([id]) => id !== hostId)) : s), true);
});

function patchEntry(hostId: string, patch: Partial<OwnerDevicesEntry>): void {
  useEntries.setState((s) => ({ ...s, [hostId]: { ...(s[hostId] ?? EMPTY), ...patch } }));
}

/** Non-React: a host's entry now (an empty one when never read). */
export function ownerDevicesNow(hostId: string): OwnerDevicesEntry {
  return useEntries.getState()[hostId] ?? EMPTY;
}

/** A thrown call's `code: message` (IPC keeps only the message) as a refusal value. */
export function refusalFromError(error: unknown): UsersRefusal {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const m = /\b([a-z][a-z0-9_]{2,63}): (.*)$/s.exec(text);
  return m ? { code: m[1]!, message: m[2]! } : { code: "error", message: text };
}

/**
 * Read a host's new owner devices. Once per connection epoch unless `force`; concurrent calls for the
 * same host share one read.
 */
export function loadOwnerNewDevices(hostId: string, epoch: string | null = null, force = false): Promise<void> {
  const have = useEntries.getState()[hostId];
  if (!force && have && have.supported !== null && epoch !== null && have.epoch === epoch) return Promise.resolve();
  const running = inFlight.get(hostId);
  if (running) return running;
  const host = apiFor(hostId);
  if (typeof host.ownerNewDevices !== "function") return Promise.resolve();
  patchEntry(hostId, { loading: true });
  const run = host.ownerNewDevices().then(
    (r) => {
      if (inFlight.get(hostId) !== run) return;
      if (r.ok) patchEntry(hostId, { devices: r.value ?? [], supported: r.value !== null, loading: false, error: null, epoch });
      else patchEntry(hostId, { loading: false, error: r.error, epoch });
    },
    (error) => {
      // Not readable now (disconnected mid-call): keep what was known.
      if (inFlight.get(hostId) === run) patchEntry(hostId, { loading: false, error: refusalFromError(error), epoch });
    },
  ).finally(() => {
    if (inFlight.get(hostId) === run) inFlight.delete(hostId);
  });
  inFlight.set(hostId, run);
  return run;
}

/** 「知道了」: acknowledge one new owner device (full owner connections; refusals as values). */
export async function ackOwnerDevice(hostId: string, tokenId: string): Promise<UsersResult<OwnerDeviceAck>> {
  let r: UsersResult<OwnerDeviceAck>;
  try {
    r = await apiFor(hostId).ackOwnerNewDevice(tokenId);
  } catch (error) {
    return { ok: false, error: refusalFromError(error) };
  }
  if (r.ok) dropDevice(hostId, tokenId);
  return r;
}

/** 「移除」: revoke the device's token (`DELETE /v2/client-tokens/{id}`); refusals as values. */
export async function revokeOwnerDevice(hostId: string, tokenId: string): Promise<UsersResult<{ tokenId: string; revoked: true }>> {
  try {
    await apiFor(hostId).revokeClientToken(tokenId);
  } catch (error) {
    return { ok: false, error: refusalFromError(error) };
  }
  dropDevice(hostId, tokenId);
  return { ok: true, value: { tokenId, revoked: true } };
}

function dropDevice(hostId: string, tokenId: string): void {
  const entry = useEntries.getState()[hostId];
  if (!entry) return;
  patchEntry(hostId, { devices: entry.devices.filter((d) => d.tokenId !== tokenId), ...(entry.latest?.tokenId === tokenId ? { latest: null } : {}) });
}

/** Forget the last-added notice of a host (a toast was shown / closed); the list is unchanged. */
export function clearLatestOwnerDevice(hostId: string): void {
  if (useEntries.getState()[hostId]?.latest) patchEntry(hostId, { latest: null });
}

/** `cutex/access/ownerDeviceAdded` from a host: remember it and read the list again. */
export function noteOwnerDeviceAdded(hostId: string, added: OwnerDeviceAdded): void {
  patchEntry(hostId, { latest: added });
  void loadOwnerNewDevices(hostId, useEntries.getState()[hostId]?.epoch ?? null, true);
}

// Live updates for every connected host (guarded: unit tests import this with a bridge stub).
if (typeof bridge.on === "function") {
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    const added = ownerDeviceAddedOf(envelope);
    if (added) noteOwnerDeviceAdded(hostId, added);
  });
  // The token's user / scope changed: what this connection may read changed too.
  bridge.on("accessChanged", ({ hostId }) => {
    if (useEntries.getState()[hostId]) void loadOwnerNewDevices(hostId, useEntries.getState()[hostId]?.epoch ?? null, true);
  });
}

// ---------- hooks ----------

export interface OwnerNewDevicesView extends OwnerDevicesEntry {
  /** The host has `owner-device-notice` and this connection is the owner's (else `devices` stays empty). */
  available: boolean;
  /** 「知道了」 is allowed: an owner connection with scope `full` (a narrowed device may only read). */
  canAck: boolean;
  /** 「移除」 is allowed: same rule (revoke is a write). */
  canRevoke: boolean;
  /** Unacknowledged devices other than this connection's own token. */
  others: OwnerNewDevice[];
  reload(): void;
  ack(tokenId: string): Promise<UsersResult<OwnerDeviceAck>>;
  revoke(tokenId: string): Promise<UsersResult<{ tokenId: string; revoked: true }>>;
  clearLatest(): void;
}

/** The new owner devices of one host (target-host pages pass their `useTargetHostId()`). */
export function useOwnerNewDevices(hostId: string): OwnerNewDevicesView {
  const look = useHostLook(hostId);
  const data = useHostData(hostId);
  const access = useHostAccess(hostId);
  const entry = useEntries((s) => s[hostId]) ?? EMPTY;
  const epoch = look?.view.conn?.epoch ?? null;
  const connected = data?.daemon.kind === "connected";
  const available = connected && !!data?.features.has(OWNER_DEVICE_NOTICE_FEATURE) && access.isOwner && !access.pending;
  useEffect(() => {
    if (available) void loadOwnerNewDevices(hostId, epoch);
  }, [hostId, epoch, available]);
  const full = (deviceScopeOf(access) ?? "full") === "full";
  return useMemo(() => {
    const devices = available ? entry.devices : [];
    return {
      ...entry,
      devices,
      supported: data?.featuresKnown && !data.features.has(OWNER_DEVICE_NOTICE_FEATURE) ? false : entry.supported,
      available,
      canAck: available && full,
      canRevoke: available && full,
      others: devices.filter((d) => !d.current),
      reload: () => void loadOwnerNewDevices(hostId, epoch, true),
      ack: (tokenId: string) => ackOwnerDevice(hostId, tokenId),
      revoke: (tokenId: string) => revokeOwnerDevice(hostId, tokenId),
      clearLatest: () => clearLatestOwnerDevice(hostId),
    };
  }, [entry, available, full, hostId, epoch, data]);
}

/**
 * The owner-local-only actions on one host (更换主人, 配对码, 关闭主人审批, 配对 / 启用跨主机, 读主凭据):
 * `yes` / `no`, or `unknown` while its capabilities are not read or on an older cutex (shared/users.ts
 * ownerLocalActionsAllowed: never read missing fields as `no`).
 */
export function useOwnerLocalActions(hostId: string): OwnerLocalAllowed {
  const data = useHostData(hostId);
  const access = useHostAccess(hostId);
  if (!access.known || !data?.featuresKnown) return "unknown";
  return ownerLocalActionsAllowed(access, data.features);
}
