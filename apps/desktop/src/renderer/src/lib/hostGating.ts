// Per-host gating of module entries (multi-host P1): the module host activates a module when ANY
// connected host has its capabilities (docs/desktop-modules.md §4, v1.5), but an entry bound to one
// conversation / ref calls that conversation's host. These pure helpers decide, for one host, whether
// an entry may offer actions there. Store / module bindings: lib/hostGatingView.ts. No feature names.

/** What a host reports about its cutex capabilities (null: not connected / unknown). */
export interface HostFeatureView {
  features: ReadonlySet<string>;
  /** False until the host's featureList has loaded. */
  featuresKnown: boolean;
}

export interface HostGate {
  /** The entry may act on this host. */
  ok: boolean;
  /** Only because the host's featureList has not loaded yet (or the host is not connected). */
  waiting: boolean;
  /** Required capabilities the host lacks (empty while waiting). */
  missing: string[];
}

/**
 * Whether `host` satisfies `required`. Nothing required → always ok (also for an unknown host: such
 * entries never call a capability-gated route). Otherwise an unknown host or one whose features are
 * still loading is not ok (waiting): offering the entry would call a route the host may not have.
 */
export function hostGate(required: readonly string[], host: HostFeatureView | null | undefined): HostGate {
  const wanted = [...new Set(required)];
  if (!wanted.length) return { ok: true, waiting: false, missing: [] };
  if (!host || !host.featuresKnown) return { ok: false, waiting: true, missing: [] };
  const missing = wanted.filter((cap) => !host.features.has(cap));
  return { ok: missing.length === 0, waiting: false, missing };
}

/** Module ∪ item `requires.capabilities` (the same union the module host gates items with). */
export function entryCapabilities(
  module: { requires?: { capabilities?: readonly string[] } } | undefined,
  item: { requires?: { capabilities?: readonly string[] } } | undefined,
): string[] {
  return [...new Set([...(module?.requires?.capabilities ?? []), ...(item?.requires?.capabilities ?? [])])];
}

/**
 * A daemon error that means "this cutex has no such route" (an older cutex): management v2 answers
 * `route_not_found` (through IPC the message reads `route_not_found: …`); plain 404s without an app
 * error code count too, a 404 with one (`note_not_found`) does not. Safety net for callers that show
 * errors of capability-gated routes: show a calm "needs a newer cutex" text instead of the raw code.
 */
export function isRouteMissing(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = (error as { code?: unknown } | null)?.code;
  const status = (error as { status?: unknown } | null)?.status;
  // A 404 with an app code (e.g. `note_not_found`) is a real "gone", not a missing route.
  if (code === "route_not_found" || (status === 404 && (code === undefined || code === ""))) return true;
  return /\broute_not_found\b/.test(text) || /^(HTTP )?404\b/.test(text.trim());
}
