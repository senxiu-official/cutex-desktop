import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { STORAGE_CLEANUP_FEATURE } from "../../../../shared/storageCleanup";
import { apiFor, bridge } from "../../bridge";
import { hostAccessNow, useHostAccess } from "../../lib/hostAccess";
import { hostData } from "../../lib/hostScope";
import { captureHostAction, onHostReset } from "../../lib/hostSwitch";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { CleanupController } from "./cleanupController";
import { cleanupPending } from "./cleanupPending";
import { canCleanup } from "./cleanupAccess";
export function useCleanup() {
  const hostId = useTargetHostId(); const features = useTargetFeatures(); const access = useHostAccess(hostId);
  const supported = features.has(STORAGE_CLEANUP_FEATURE);
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const allowed = canCleanup(access, features, !!connected);
  const [connectionEpoch, reset] = useState(0);
  const controller = useMemo(() => {
    const live = captureHostAction(hostId);
    return new CleanupController(apiFor(hostId), () => {
      const data = hostData(useApp.getState(), hostId); const current = hostAccessNow(hostId);
      return live() && !!data && canCleanup(current, data.features, data.daemon.kind === "connected");
    }, cleanupPending(hostId));
  }, [hostId, connectionEpoch]);
  const data = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => onHostReset((id) => { if (id === hostId) { controller.stop(); reset((n) => n + 1); } }), [hostId, controller]);
  useEffect(() => { if (!supported || !connected) return; controller.start(); void controller.loadHistory(); return controller.stop; }, [controller, connected, supported]);
  useEffect(() => { if (!allowed) controller.clearPreview(); }, [allowed, controller]);
  useEffect(() => {
    if (!supported || !connected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = bridge.on("hostEvent", ({ hostId: from, envelope }) => {
      if (from !== hostId || envelope.cutex?.method !== "cutex/storage/cleanupChanged" || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void controller.loadHistory();
        const run = controller.getSnapshot().run;
        if (run) void controller.loadRun(run.runId);
      }, 150);
    });
    return () => { off(); clearTimeout(timer); };
  }, [controller, hostId, supported, connected]);
  const running = data.run?.state === "running" || data.history.some((run) => run.state === "running");
  useEffect(() => { if (!running || !connected || !supported) return; const timer = window.setInterval(() => { const run = controller.getSnapshot().run; if (run?.state === "running") void controller.loadRun(run.runId); else void controller.loadHistory(); }, 2000); return () => window.clearInterval(timer); }, [running, connected, supported, controller]);
  return { ...data, controller, allowed, supported, connected, hostId };
}
