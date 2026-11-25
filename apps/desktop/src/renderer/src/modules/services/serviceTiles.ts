// Service card tiles (perf audit 2026-11-24 #4, renderer half). The daemon answers `GET /v2/services/{slug}/tile`
// by reading its whole registry, so each card's request costs more as services grow. The cards therefore:
// - take a static tile from the service list itself: a service with a `tile` and no `tilePath` is answered with
//   exactly that template (cutex services/tile.rs `answer`), and a worker without one has none;
// - ask for the others only once the card comes near the viewport, at most TILE_READS_PER_HOST at a time per host.
import { readServiceTile, type ServiceTile } from "../../../../shared/home";
import type { ServiceView } from "../../../../shared/ipc";

/** Concurrent tile requests per host; further cards wait their turn. */
export const TILE_READS_PER_HOST = 4;

/** The tile the list already answers (`{ tile }`, possibly null), or undefined when only the tile route knows it. */
export function listedTile(item: ServiceView): { tile: ServiceTile | null } | undefined {
  const raw = item as ServiceView & { tile?: unknown; tilePath?: unknown };
  if (raw.tile != null && raw.tilePath == null) return { tile: readServiceTile(raw.tile) };
  if (item.runtime === "worker" && raw.tile == null) return { tile: null };
  return undefined;
}

const lanes = new Map<string, { running: number; waiting: (() => void)[] }>();

/**
 * Runs `read` once one of the host's TILE_READS_PER_HOST slots is free. A card gone (or changed) by then —
 * `wanted()` false — gives its turn to the next without asking: resolves undefined.
 */
export async function queuedTileRead<T>(hostId: string, wanted: () => boolean, read: () => Promise<T>): Promise<T | undefined> {
  let lane = lanes.get(hostId);
  if (!lane) lanes.set(hostId, lane = { running: 0, waiting: [] });
  if (lane.running >= TILE_READS_PER_HOST) await new Promise<void>((resolve) => lane!.waiting.push(resolve));
  else lane.running++;
  // The slot is ours (taken above, or handed over by the read that finished).
  try {
    return wanted() ? await read() : undefined;
  } finally {
    const next = lane.waiting.shift();
    if (next) next();
    else if (--lane.running === 0) lanes.delete(hostId);
  }
}
