// Per-host caches that live outside the store (profile snapshots, model catalogs, workspace scopes,
// task numbering) register a reset here. Two kinds (multi-host RFC §6.2):
// - onHostSwitch: the focus host changed (or its connection was replaced) — caches of "the host the
//   app shows" start over, as with the single-host desktop;
// - onHostReset(hostId): that host's connection was replaced or it was removed — caches keyed by host
//   drop that host only (other connected hosts keep theirs).
const hooks = new Set<() => void>();
const hostHooks = new Set<(hostId: string) => void>();
let actionEpoch = 0;
const hostActionEpochs = new Map<string, number>();

/**
 * Capture the route lifetime before opening a dialog or starting an async action. Without a host:
 * ends when the focus host changes (today's single-host rule). With `hostId`: ends only when that
 * host's connection is replaced or the host removed (another host reconnecting does not matter).
 */
export function captureHostAction(hostId?: string): () => boolean {
  if (hostId !== undefined) {
    const epoch = hostActionEpochs.get(hostId) ?? 0;
    return () => (hostActionEpochs.get(hostId) ?? 0) === epoch;
  }
  const epoch = actionEpoch;
  return () => epoch === actionEpoch;
}

export function onHostSwitch(reset: () => void): () => void {
  hooks.add(reset);
  return () => hooks.delete(reset);
}

export function onHostReset(reset: (hostId: string) => void): () => void {
  hostHooks.add(reset);
  return () => hostHooks.delete(reset);
}

export function fireHostSwitch(): void {
  // Invalidate before reset listeners resolve dialogs or reenter action code.
  actionEpoch++;
  for (const reset of hooks) {
    try {
      reset();
    } catch {
      // one cache failing to clear must not keep the others
    }
  }
}

export function fireHostReset(hostId: string): void {
  hostActionEpochs.set(hostId, (hostActionEpochs.get(hostId) ?? 0) + 1);
  for (const reset of hostHooks) {
    try {
      reset(hostId);
    } catch {
      // one cache failing to clear must not keep the others
    }
  }
}
