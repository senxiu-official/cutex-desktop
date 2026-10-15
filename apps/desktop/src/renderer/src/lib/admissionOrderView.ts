// The connected host's `queue.ownerMayPassAsks` (lib/admissionOrder.ts) for the queue panel: read
// from `/v2/settings` once per capabilities load (a reconnect or host switch replaces the `features`
// set, which reloads it); the Settings row writes the new value through `setOwnerMayPassAsks`, and a
// `passing_not_allowed` refusal reloads it (another client may have changed it).
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../bridge";
import { useApp } from "../store";
import { ADMISSION_ORDER_FEATURE, readOwnerMayPassAsks } from "./admissionOrder";

const useStore = create<{ mayPass: boolean | undefined; loadedFor: ReadonlySet<string> | null }>(() => ({ mayPass: undefined, loadedFor: null }));

function load(features: ReadonlySet<string>): void {
  useStore.setState({ loadedFor: features });
  api.getSettings().then(
    (s) => {
      if (useStore.getState().loadedFor === features) useStore.setState({ mayPass: readOwnerMayPassAsks(s) });
    },
    () => {},
  );
}

/** The Settings row saved a new value (the PATCH answer's view). */
export function setOwnerMayPassAsks(mayPass: boolean | undefined): void {
  useStore.setState({ mayPass, loadedFor: useApp.getState().features });
}

/** cutex refused a move as passing: the setting changed elsewhere; read it again. */
export function reloadOwnerMayPassAsks(): void {
  const features = useApp.getState().features;
  if (features.has(ADMISSION_ORDER_FEATURE)) load(features);
}

/** `queue.ownerMayPassAsks` of the connected host; true (cutex's default) while unknown. */
export function useOwnerMayPassAsks(enabled: boolean): boolean {
  const features = useApp((s) => s.features);
  const supported = features.has(ADMISSION_ORDER_FEATURE);
  const { mayPass, loadedFor } = useStore();
  useEffect(() => {
    if (!enabled || !supported || useStore.getState().loadedFor === features) return;
    useStore.setState({ mayPass: undefined });
    load(features);
  }, [enabled, supported, features]);
  return !supported || loadedFor !== features ? true : (mayPass ?? true);
}
