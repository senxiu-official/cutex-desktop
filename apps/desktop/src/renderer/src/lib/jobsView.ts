// React hooks for the 作业 (Job Service jobs) components (kept out of components/*.tsx for Fast Refresh).
import { useEffect, useMemo } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { agentJobs, JOB_SERVICE_FEATURE, jobOperations, type AgentJobs, type JobStatus } from "./jobs";
import { refreshAgentJobs, refreshAllJobs, useJobs } from "./jobStore";
import { JOB_SERVICE_COMPONENT } from "./componentCard";
import { useComponentUsable } from "./componentView";
import { LOCAL_HOST_ID } from "../../../shared/hosts";

/** Poll while something runs, slower otherwise; never while the window is hidden. */
const FAST_MS = 10_000;
const SLOW_MS = 30_000;

/** The focus host serves jobs: the capability and a usable job-service component (lib/componentCard componentUsable). */
export function useJobsEnabled(): boolean {
  const capable = useApp((s) => s.features.has(JOB_SERVICE_FEATURE));
  const focus = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  const usable = useComponentUsable(focus, JOB_SERVICE_COMPONENT, capable);
  return capable && usable;
}

function usePoll(run: () => void, enabled: boolean, fast: boolean, key: string) {
  useEffect(() => {
    if (!enabled) return;
    run();
    const id = setInterval(() => {
      if (!document.hidden) run();
    }, fast ? FAST_MS : SLOW_MS);
    const onVisible = () => !document.hidden && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fast, key]);
}

const NONE: AgentJobs = { open: [], finished: [], finishedTotal: 0 };

/** An agent's jobs (capsule / status row), polled while `active` (the category is placed somewhere). */
export function useAgentJobs(sessionId: string, active: boolean): AgentJobs {
  const enabled = useJobsEnabled() && active;
  const byId = useJobs((s) => s.byId);
  const data = useMemo(() => (enabled ? agentJobs(byId, sessionId) : NONE), [enabled, byId, sessionId]);
  usePoll(() => void refreshAgentJobs(sessionId), enabled, data.open.length > 0, sessionId);
  return data;
}

/** The 作业 page's list, polled while the page is open. */
export function useAllJobs() {
  const enabled = useJobsEnabled();
  const byId = useJobs((s) => s.byId);
  const allIds = useJobs((s) => s.allIds);
  const running = useMemo(() => Object.values(byId).some((j) => j.state === "running" || j.state === "launch_pending"), [byId]);
  usePoll(() => void refreshAllJobs(), enabled, running, "all");
  return { enabled, byId, allIds };
}

/** What the running Job Service lets the owner do (cancel / read output). */
export function useJobOps(): { cancel: boolean; output: boolean } {
  const caps = useJobs((s) => s.caps);
  return useMemo(() => jobOperations(caps), [caps]);
}

/** The status word: "运行中", "退出码 2", or the raw state for an unknown one. */
export function useJobWord(): (status: JobStatus) => string {
  const { t } = useI18n();
  return (status) => t(`jobs.status.${status.key}` as MessageKey, { code: status.exitCode ?? "", state: status.raw });
}
