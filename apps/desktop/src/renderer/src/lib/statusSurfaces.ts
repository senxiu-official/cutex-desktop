// Status surfaces (docs/desktop-modules.md §16, contract 1.2): which providers show the
// `conversation.status` items, the effective placement of an item (requested = the saved StatusPlace,
// never rewritten at runtime), the reveal order, and the registration checks. Pure (unit-tested); the
// React / app binding is lib/statusItemsView.ts.
import type { ModuleState } from "../modules/types";
import {
  STATUS_SURFACES,
  type RevealIntent,
  type RevealResult,
  type StatusItem,
  type StatusPlace,
  type StatusSurfaceId,
  type StatusSurfaceItem,
  type SurfaceUnavailable,
  type SurfaceUnavailableReason,
} from "../modules/slots";

/** The surfaces a saved place asks for. */
export function placeSurfaces(place: StatusPlace): StatusSurfaceId[] {
  switch (place) {
    case "bar":
      return ["bar"];
    case "capsule":
      return ["capsule"];
    case "both":
      return ["bar", "capsule"];
    case "off":
      return [];
  }
}

/** Declared surfaces, or (v1.1 items) derived from the renderers: "bar" only with a Bar. */
export function itemSurfaces(item: Pick<StatusItem, "supportedSurfaces" | "Bar">): readonly StatusSurfaceId[] {
  if (item.supportedSurfaces) return item.supportedSurfaces;
  return item.Bar ? ["bar", "capsule"] : ["capsule"];
}

export type ProviderState =
  | { surface: StatusSurfaceId; available: true; moduleId: string; item: StatusSurfaceItem }
  | { surface: StatusSurfaceId; available: false; moduleId: string | null; reason: Exclude<SurfaceUnavailableReason, "unsupported"> };
export type SurfaceProviders = Readonly<Record<StatusSurfaceId, ProviderState>>;

interface DefinitionLike {
  id: string;
  contributes?: { readonly "conversation.statusSurface"?: readonly StatusSurfaceItem[] };
}

const reasonOf = (state: ModuleState | undefined): Exclude<SurfaceUnavailableReason, "unsupported"> => {
  switch (state?.kind) {
    case "disabled":
      return "disabled";
    case "unavailable":
      return "unavailable";
    case "failed":
      return "failed";
    case undefined:
      return "absent";
    default:
      return "not-ready"; // activating / stopping (an active provider whose item is not shown yet)
  }
};

/**
 * The provider of each surface: the first registered module that statically declares it (the
 * registration check rejects a second one). Available = its item is in the slot snapshot ("show").
 * Dynamic contributions never count, so a module cannot take over a surface at runtime.
 */
export function surfaceProviders(
  modules: readonly DefinitionLike[],
  statuses: ReadonlyMap<string, { state: ModuleState }>,
  shown: readonly { item: StatusSurfaceItem; moduleId: string; mode: string }[],
): SurfaceProviders {
  const out = {} as Record<StatusSurfaceId, ProviderState>;
  for (const surface of STATUS_SURFACES) {
    const owner = modules.find((m) => m.contributes?.["conversation.statusSurface"]?.some((i) => i.surface === surface));
    if (!owner) {
      out[surface] = { surface, available: false, moduleId: null, reason: "absent" };
      continue;
    }
    const declared = owner.contributes!["conversation.statusSurface"]!.find((i) => i.surface === surface)!;
    const entry = shown.find((e) => e.item === declared && e.moduleId === owner.id && e.mode === "show");
    out[surface] = entry
      ? { surface, available: true, moduleId: owner.id, item: declared }
      : { surface, available: false, moduleId: owner.id, reason: reasonOf(statuses.get(owner.id)?.state) };
  }
  return out;
}

export interface ResolvedPlacement {
  requested: StatusPlace;
  effective: readonly StatusSurfaceId[];
  unavailable: readonly SurfaceUnavailable[];
}

/**
 * requested ∩ supported ∩ available providers. With the capsule off: bar → bar, both → bar,
 * capsule → none, off → none; the saved choice stays as it is.
 */
export function resolvePlacement(requested: StatusPlace, supported: readonly StatusSurfaceId[], providers: SurfaceProviders): ResolvedPlacement {
  const effective: StatusSurfaceId[] = [];
  const unavailable: SurfaceUnavailable[] = [];
  for (const surface of placeSurfaces(requested)) {
    const provider = providers[surface];
    if (!supported.includes(surface)) unavailable.push({ surface, reason: "unsupported" });
    else if (!provider.available) unavailable.push({ surface, reason: provider.reason });
    else effective.push(surface);
  }
  return { requested, effective, unavailable };
}

/** Some surface shows the item now (null = its module is off). No → e.g. the full checklist in the timeline. */
export const shownSomewhere = (resolved: ResolvedPlacement | null): boolean => !!resolved && resolved.effective.length > 0;

/**
 * Can the owner pick `place` for the item now (Settings)? Its surfaces must be supported and their
 * providers registered and on — whether a conversation is mounted does not matter. "off" always.
 */
export function placeSelectable(place: StatusPlace, supported: readonly StatusSurfaceId[], providers: SurfaceProviders): boolean {
  return placeSurfaces(place).every((s) => supported.includes(s) && providers[s].available);
}

/**
 * Where a reveal goes, in order: the effective surfaces that serve the intent (the bar first, as
 * before for "both"), then the item's bar panel as a temporary fallback. Empty = unavailable.
 */
export function revealTargets(
  resolved: ResolvedPlacement,
  supported: readonly StatusSurfaceId[],
  providers: SurfaceProviders,
  intent: RevealIntent,
  hasBarPanel: boolean,
): StatusSurfaceId[] {
  const serves = (s: StatusSurfaceId) => {
    const p = providers[s];
    return p.available && p.item.intents.includes(intent) && (s !== "bar" || hasBarPanel);
  };
  const targets = STATUS_SURFACES.filter((s) => resolved.effective.includes(s) && serves(s));
  if (!targets.includes("bar") && supported.includes("bar") && serves("bar")) targets.push("bar");
  return targets;
}

export interface RevealScope {
  hostId: string;
  sessionId: string;
}

export interface RevealEnv {
  /** The current host and selected agent (stale check at entry). */
  current(): { hostId: string; sessionId: string | null };
  /** The item as the agent sees it now; null = not shown for it (module off, agent lacks the feature). */
  item(itemId: string): { supported: readonly StatusSurfaceId[]; resolved: ResolvedPlacement } | null;
  providers(): SurfaceProviders;
}

/**
 * `statusPresentation.reveal` (§16.4). The scope is captured when the caller rendered; a different
 * host or agent now → "stale" (never switches to the new one). A provider that is not mounted is
 * skipped ("not-ready"), the next target tried; nothing queues.
 */
export function revealStatus(env: RevealEnv, scope: RevealScope, itemId: string, intent: RevealIntent, openBarPanel?: () => void): RevealResult {
  const now = env.current();
  if (now.hostId !== scope.hostId || now.sessionId !== scope.sessionId) return { status: "stale" };
  const state = env.item(itemId);
  if (!state) return { status: "unavailable", unavailable: [] };
  const providers = env.providers();
  const unavailable: SurfaceUnavailable[] = [...state.resolved.unavailable];
  for (const surface of revealTargets(state.resolved, state.supported, providers, intent, !!openBarPanel)) {
    if (surface === "bar") {
      openBarPanel!();
      return { status: "opened", surface };
    }
    const provider = providers[surface];
    if (!provider.available || !provider.item.reveal) continue;
    if (provider.item.reveal({ sessionId: scope.sessionId, itemId }) === "opened") return { status: "opened", surface };
    unavailable.push({ surface, reason: "not-ready" });
  }
  return { status: "unavailable", unavailable };
}

/** v1.1 `home` derived from the effective placement: "capsule" only when the capsule alone shows it. */
export const legacyHome = (resolved: ResolvedPlacement): "bar" | "capsule" =>
  resolved.effective.includes("capsule") && !resolved.effective.includes("bar") ? "capsule" : "bar";

interface StatusDefinition extends DefinitionLike {
  contributes?: DefinitionLike["contributes"] & { readonly "conversation.status"?: readonly StatusItem[] };
}

/**
 * Registration checks of the v1.2 status contract, before anything registers. `existing` = the
 * definitions already registered (they keep their surfaces). Returns the rejected modules with why;
 * an earlier module (in `existing`, then in input order) keeps a surface, a later duplicate fails.
 */
export function checkStatusContributions(candidates: readonly StatusDefinition[], existing: readonly StatusDefinition[] = []): Map<string, string> {
  const errors = new Map<string, string>();
  const owners = new Map<StatusSurfaceId, string>();
  for (const def of existing) {
    for (const s of def.contributes?.["conversation.statusSurface"] ?? []) if (!owners.has(s.surface)) owners.set(s.surface, def.id);
  }
  for (const def of candidates) {
    const fail = (message: string) => !errors.has(def.id) && errors.set(def.id, message);
    const claimed: StatusSurfaceId[] = [];
    for (const s of def.contributes?.["conversation.statusSurface"] ?? []) {
      if (!STATUS_SURFACES.includes(s.surface)) fail(`unknown status surface "${String(s.surface)}" (${s.id})`);
      else if (owners.has(s.surface) || claimed.includes(s.surface)) fail(`status surface "${s.surface}" already provided by ${owners.get(s.surface) ?? def.id} (${s.id})`);
      else claimed.push(s.surface);
      if (!Array.isArray(s.intents) || s.intents.some((i) => i !== "view" && i !== "edit")) fail(`invalid reveal intents (${s.id})`);
    }
    for (const item of def.contributes?.["conversation.status"] ?? []) {
      const declared = item.supportedSurfaces;
      if (declared) {
        if (declared.some((s) => !STATUS_SURFACES.includes(s)) || new Set(declared).size !== declared.length) fail(`invalid supportedSurfaces (${item.id})`);
        if (declared.includes("bar") && !item.Bar) fail(`supportedSurfaces has "bar" without a Bar (${item.id})`);
      }
      const supported = itemSurfaces(item);
      if (!placeSurfaces(item.defaultPlace).every((s) => supported.includes(s))) fail(`defaultPlace "${item.defaultPlace}" is not supported (${item.id})`);
    }
    if (!errors.has(def.id)) for (const s of claimed) owners.set(s, def.id);
  }
  return errors;
}
