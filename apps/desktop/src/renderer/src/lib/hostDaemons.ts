import type { ScopeSource } from "./hostScope";

type Daemons = ScopeSource["byHost"];
const projections = new WeakMap<Daemons, Daemons>();
let previous: Daemons = {};

/** Host looks read connectivity only; sidebar, services and approval refreshes keep this snapshot. */
export function hostDaemonsOf(byHost: Daemons): Daemons {
  const cached = projections.get(byHost);
  if (cached) return cached;
  const ids = Object.keys(byHost);
  if (ids.length !== Object.keys(previous).length || ids.some(id => previous[id]?.daemon !== byHost[id]!.daemon)) {
    previous = Object.fromEntries(ids.map(id => [id, { daemon: byHost[id]!.daemon }]));
  }
  projections.set(byHost, previous);
  return previous;
}
