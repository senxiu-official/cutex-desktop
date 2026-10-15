// Model picker helpers: per-profile pinned models (Claude-style "first few + More models").
// Pins are a desktop UI preference (ui prefs `modelPins`, keyed by host id, then profile name).

/** Without explicit pins, the first few models of the catalog are shown up front. */
export const DEFAULT_PINNED = 4;

export function splitPinned<T extends { model: string }>(models: readonly T[], pins: readonly string[] | undefined): { pinned: T[]; rest: T[] } {
  const pinned = pins ? pins.map((p) => models.find((m) => m.model === p)).filter((m): m is T => !!m) : models.slice(0, DEFAULT_PINNED);
  return { pinned, rest: models.filter((m) => !pinned.includes(m)) };
}

/** Pin list after toggling `model`; starts from the implicit default pins the first time. */
export function togglePinned(models: readonly { model: string }[], pins: readonly string[] | undefined, model: string): string[] {
  const current = pins ? [...pins] : models.slice(0, DEFAULT_PINNED).map((m) => m.model);
  return current.includes(model) ? current.filter((m) => m !== model) : [...current, model];
}

export type ModelPins = Record<string, Record<string, string[]>>;

/** The pins of one profile on one host (undefined = never pinned: the catalog's first few). */
export function pinsFor(all: ModelPins, hostId: string, profile: string): string[] | undefined {
  const host = all[hostId];
  const pins = host && typeof host === "object" && !Array.isArray(host) ? host[profile] : undefined;
  return Array.isArray(pins) ? pins : undefined;
}

/** `all` with one profile's pins replaced on one host (other hosts / profiles untouched). */
export function withPins(all: ModelPins, hostId: string, profile: string, pins: string[]): ModelPins {
  const host = all[hostId];
  const current = host && typeof host === "object" && !Array.isArray(host) ? host : {};
  return { ...all, [hostId]: { ...current, [profile]: pins } };
}
