// Store / module-host side of lib/hostGating.ts: whether a slot entry (gutter item, turn attachment,
// ref action, side launcher) may act on one host. The module host shows an entry when any host in the
// scope has its capabilities; consumers bound to a conversation / ref filter with these per host.
import { useCallback } from "react";
import { useHeldHostData } from "./heldHostData";
import { appModules } from "../modules/app";
import { useApp } from "../store";
import { entryCapabilities, hostGate, type HostFeatureView, type HostGate } from "./hostGating";

/** What gating reads of an item: its own `requires`. */
type Requiring = { requires?: { capabilities?: readonly string[] } };
type State = ReturnType<typeof useApp.getState>;
const focusOf = (s: Pick<State, "hosts">) => s.hosts?.active ?? "local";

/** A host's capabilities as the store holds them (null: neither the focus host nor followed). */
export function hostFeatureView(s: State, hostId: string): HostFeatureView | null {
  if (hostId === focusOf(s)) return { features: s.features, featuresKnown: s.featuresKnown };
  const slice = s.byHost[hostId];
  return slice ? { features: slice.features, featuresKnown: slice.featuresKnown } : null;
}

/** Capabilities a module's entry needs (module ∪ item requires). */
export function capabilitiesOf(moduleId: string, item?: Requiring): string[] {
  let module: { requires?: { capabilities?: readonly string[] } } | undefined;
  try {
    module = appModules().modules.find((m) => m.id === moduleId);
  } catch {
    module = undefined;
  }
  return entryCapabilities(module, item);
}

/** Non-React: may this entry act on `hostId` now. */
export function entryGateNow(hostId: string, entry: { moduleId: string; item?: Requiring }): HostGate {
  return hostGate(capabilitiesOf(entry.moduleId, entry.item), hostFeatureView(useApp.getState(), hostId));
}

/** Hook: a predicate "may this entry act on `hostId`", re-rendering when that host's capabilities change. */
export function useHostEntryGate(hostId: string | null | undefined): (entry: { moduleId: string; item?: Requiring }) => boolean {
  const focus = useApp((s) => !hostId || hostId === focusOf(s));
  const features = useApp((s) => (!hostId || hostId === focusOf(s) ? s.features : s.byHost[hostId]?.features ?? null));
  const liveKnown = useApp((s) => (!hostId || hostId === focusOf(s) ? s.featuresKnown : s.byHost[hostId]?.featuresKnown ?? false));
  // A Settings target that went offline: gate on what it last reported (sections stay put; UI-01).
  const held = useHeldHostData(hostId, liveKnown && (focus || !!features));
  const known = held ? held.featuresKnown : liveKnown;
  const shown = held ? held.features : features;
  return useCallback(
    (entry) => hostGate(capabilitiesOf(entry.moduleId, entry.item), hostId == null || (!focus && !shown) ? null : { features: shown!, featuresKnown: known }).ok,
    [hostId, focus, shown, known],
  );
}

/** Hook: the gate of one module on one host (e.g. a module body showing a notice instead of calling). */
export function useModuleHostGate(moduleId: string, hostId: string | null | undefined): HostGate {
  const features = useApp((s) => (hostId ? hostFeatureView(s, hostId)?.features ?? null : null));
  const known = useApp((s) => (hostId ? hostFeatureView(s, hostId)?.featuresKnown ?? false : false));
  return hostGate(capabilitiesOf(moduleId), features ? { features, featuresKnown: known } : null);
}
