// Status categories = `conversation.status` items (docs/desktop-modules.md §3.2, §5, §16). Each is
// placed in the status row right above the input ("bar": compact, interactive — goal editing always
// happens there), the floating capsule ("capsule": mainly display, module `status-capsule`), both,
// or nowhere; the owner's choice is a module-host placement override (Settings → 状态显示, the
// capsule's … menu). What actually shows is the effective placement (lib/statusSurfaces.ts): the
// saved choice minus surfaces that are off or unsupported. Empty items never show. Pure helpers
// (unit-tested); the React side is lib/statusItemsView.ts.
import { lacks, type AgentFeatures } from "./agentFeatures";
import type { StatusItem, StatusPlace, StatusSurfaceId } from "../modules/slots";
import type { ResolvedPlacement } from "./statusSurfaces";

export const inBar = (p: StatusPlace) => p === "bar" || p === "both";
export const inCapsule = (p: StatusPlace) => p === "capsule" || p === "both";

/** The capsule … menu's check: puts the item into the capsule or takes it out, keeping the bar side. */
export function capsuleToggle(p: StatusPlace): StatusPlace {
  switch (p) {
    case "off":
      return "capsule";
    case "bar":
      return "both";
    case "capsule":
      return "off";
    case "both":
      return "bar";
  }
}

export interface PlacedStatus {
  item: StatusItem;
  moduleId: string;
  /** The saved choice (requested). */
  place: StatusPlace;
  supported: readonly StatusSurfaceId[];
  /** requested / effective / unavailable (§16.3); layout and routing read `effective`. */
  resolved: ResolvedPlacement;
}

export const shownOn = (p: Pick<PlacedStatus, "resolved">, surface: StatusSurfaceId) => p.resolved.effective.includes(surface);

/**
 * The status items an agent shows, in slot order, with their placement: available ones (the host
 * already left out unavailable modules / capabilities) whose `agentFeature` the agent has.
 */
export function placedStatusItems(
  entries: readonly { item: StatusItem; moduleId: string; mode: string }[],
  placeOf: (item: StatusItem) => string,
  agent: AgentFeatures | null,
  resolve: (item: StatusItem, place: StatusPlace) => { supported: readonly StatusSurfaceId[]; resolved: ResolvedPlacement },
): PlacedStatus[] {
  return entries
    .filter((e) => e.mode === "show" && !(agent && e.item.agentFeature && lacks(agent, e.item.agentFeature)))
    .map((e) => {
      const place = placeOf(e.item) as StatusPlace;
      return { item: e.item, moduleId: e.moduleId, place, ...resolve(e.item, place) };
    });
}

/** Folded capsule sections (`capsuleFoldedItems`, item ids): toggles `id`. */
export function toggleFoldedId(folded: readonly string[], id: string): string[] {
  return folded.includes(id) ? folded.filter((i) => i !== id) : [...folded, id];
}
