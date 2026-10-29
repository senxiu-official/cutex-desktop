import type { SessionResource } from "@cutex-desktop/protocol";
import { featuresOf, sidebarOf, useApp, viewOf } from "../store";
import { MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE, modelOverloadRetryOf } from "./modelOverloadRetry";

type RetrySidebarSnapshot = NonNullable<ReturnType<typeof sidebarOf>>;
const resourcesBySnapshot = new WeakMap<RetrySidebarSnapshot, Map<string, SessionResource>>();

function resourceOf(snapshot: RetrySidebarSnapshot | null, sessionId: string): SessionResource | undefined {
  if (!snapshot) return undefined;
  let resources = resourcesBySnapshot.get(snapshot);
  if (!resources) {
    resources = new Map();
    for (const resource of snapshot.active) resources.set(resource.cutexSessionId, resource);
    resourcesBySnapshot.set(snapshot, resources);
  }
  return resources.get(sessionId);
}

/** Host-specific, narrow subscription: token streaming does not change the selected wait object. */
export function useModelOverloadRetry(sessionId: string | null | undefined, hostId?: string | null) {
  return useApp((s) => {
    if (!sessionId) return null;
    const host = hostId ?? s.hosts?.active ?? "local";
    const features = featuresOf(s, host);
    if (!features.has(MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE)) return null;
    const resource = resourceOf(sidebarOf(s, host), sessionId);
    return modelOverloadRetryOf({ features, resource, view: viewOf(s, host, sessionId) });
  });
}
