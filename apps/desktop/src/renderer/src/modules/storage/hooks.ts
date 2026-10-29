import { useEffect, useMemo, useSyncExternalStore } from "react";
import { STORAGE_FEATURE, STORAGE_WALK_CHANGED } from "../../../../shared/storage";
import { apiFor, bridge } from "../../bridge";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { StorageController } from "./controller";

export function useStorage() {
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const supported = features.has(STORAGE_FEATURE);
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  // apiFor stays bound to this host even if the focus host changes mid-request.
  const controller = useMemo(() => new StorageController(apiFor(hostId)), [hostId]);
  const data = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!supported || !connected) return;
    controller.start();
    void controller.load(true);
    return controller.stop;
  }, [controller, connected, supported]);
  useEffect(() => {
    if (!supported || !connected || typeof bridge.on !== "function") return;
    return bridge.on("hostEvent", ({ hostId: from, envelope }) => {
      if (from !== hostId) return;
      if (envelope?.cutex?.method === STORAGE_WALK_CHANGED || (envelope?.cutex?.method === "cutex/storage/cleanupChanged" && (envelope.cutex.params as { state?: string })?.state !== "running")) controller.walkChanged();
    });
  }, [controller, hostId, supported, connected]);
  const running = data.view?.walk.state === "running" || data.refreshing;
  useEffect(() => {
    if (!running || !supported || !connected) return;
    const timer = window.setInterval(() => { if (!controller.getSnapshot().loading) void controller.load(); }, 2000);
    return () => window.clearInterval(timer);
  }, [controller, running, supported, connected]);
  return { ...data, controller, supported, connected, hostId };
}
