// Host / epoch fence shared by the daemon INVOKE_CHANNEL and other host-bound IPC (e.g. the browser
// channel). Pure: no Electron imports, so it is unit-testable.
import type { HostBinding } from "../shared/hosts";

/** The slice of HostManager the fence reads. */
export interface FenceHosts<D> {
  connection(hostId: string | null | undefined): { readonly routingEpoch: string; readonly daemon: D } | undefined;
  focus(): string;
}

export interface HostFence<D> {
  /** The daemon of the connection the binding was admitted on. */
  readonly daemon: D;
  /**
   * Call before handing a reply back: throws "host switched" when that connection has since been
   * replaced or closed, its daemon reconnected (generation), or (focus calls) the focus moved.
   */
  check(): void;
}

/**
 * Admission check, before any side effect: the binding names the target host and the connection the
 * renderer saw (C-011, per host). Never upgrades an old intent. A focus binding (`bridge.api`) also
 * needs that host to still be the focus: moving the focus away fences it like a reconnect does, even
 * though the old focus host may stay connected. `getHosts` is read again at check time.
 */
export function admitHostBinding<D extends { readonly generation: number }>(
  getHosts: () => FenceHosts<D> | null | undefined,
  expected: HostBinding | null | undefined,
): HostFence<D> {
  const conn = expected && typeof expected.hostId === "string" ? getHosts()?.connection(expected.hostId) : undefined;
  const focusCall = expected?.focus === true;
  const stillFocus = () => !focusCall || getHosts()?.focus() === expected!.hostId;
  if (!conn || !expected || typeof expected.epoch !== "string" || expected.epoch !== conn.routingEpoch || !stillFocus())
    throw new Error("host binding unavailable or changed");
  const daemon = conn.daemon;
  const generation = daemon.generation;
  return {
    daemon,
    check() {
      if (daemon.generation !== generation || getHosts()?.connection(expected.hostId)?.daemon !== daemon || !stillFocus())
        throw new Error("host switched");
    },
  };
}
