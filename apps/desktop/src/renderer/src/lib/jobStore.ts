// Job Service jobs (作业) in their own zustand store. cutex has no job events: the list is polled
// (lib/jobsView hooks: faster while something runs, only while the window is visible), and also
// refreshed (debounced) after any host event whose method mentions a job (completion deliveries).
// The app store resets this store on host switch (store.ts) and starts the sync (store.ts init).
// Multi-host (RFC §9.2): the 作业 page also lists the jobs of the scope's other hosts — their first page,
// polled while the page is open (`useHostJobs`, `refreshHostJobs`); actions on them go to that host.
import { create } from "zustand";
import type { JobOutputPage, JobResult, JobRow, JobServiceCapabilities, JobStream } from "../../../shared/ipc";
import type { MarkExternalInput } from "../../../shared/remoteJobs";
import { api, apiFor, bridge } from "../bridge";
import { JOB_SERVICE_FEATURE, mergeJobs } from "./jobs";
import { focusHostId } from "./hostKeys";
import { onHostReset } from "./hostSwitch";

export interface JobsState {
  byId: Record<string, JobRow>;
  /** The Job Service's capabilities (`humanOperations`); null until loaded or when unavailable. */
  caps: JobServiceCapabilities | null;
  /** Last list error (job_service_unavailable, …); null after a good load. */
  error: { code: string; message: string } | null;
  /** When an agent's jobs were last loaded (Date.now()). */
  agentLoadedAt: Record<string, number>;
  /** The full list (作业 page): ids in server order, the next page's cursor, last load time. */
  allIds: string[] | null;
  nextCursor: string | null;
  allLoading: boolean;
  reset(): void;
}

const EMPTY = { byId: {}, caps: null, error: null, agentLoadedAt: {}, allIds: null, nextCursor: null, allLoading: false };

export const useJobs = create<JobsState>((set) => ({
  ...EMPTY,
  reset: () => {
    capsLoading = false;
    set({ ...EMPTY });
  },
}));

interface AppHandle {
  getState(): { features: ReadonlySet<string>; selectedId: string | null };
}
let app: AppHandle | null = null;
let capsLoading = false;
const agentInFlight = new Set<string>();
let eventTimer: ReturnType<typeof setTimeout> | null = null;
const PAGE = 50;

const supported = () => !!app?.getState().features.has(JOB_SERVICE_FEATURE);

function noteError<T>(r: JobResult<T>): r is { ok: false; code: string; message: string } {
  if (!r.ok) useJobs.setState({ error: { code: r.code, message: r.message } });
  return !r.ok;
}

/** The Job Service's human operations (once; retried after a failure on the next call). */
export async function loadJobCaps(): Promise<void> {
  if (!supported() || capsLoading || useJobs.getState().caps) return;
  capsLoading = true;
  try {
    const r = await api.jobServiceCapabilities();
    if (r.ok) useJobs.setState({ caps: r.value ?? {} });
  } catch {
    // keep null: list only
  } finally {
    capsLoading = false;
  }
}

/** One agent's jobs (the newest page whose search matches its session id). */
export async function refreshAgentJobs(sessionId: string): Promise<void> {
  // The capsule and the status row may both poll the same agent.
  if (!supported() || agentInFlight.has(sessionId)) return;
  agentInFlight.add(sessionId);
  void loadJobCaps();
  try {
    const r = await api.jobs({ query: sessionId, limit: PAGE });
    if (noteError(r)) return;
    const rows = r.value.data.filter((j) => j.sessionId === sessionId);
    useJobs.setState((s) => ({ byId: mergeJobs(s.byId, rows), error: null, agentLoadedAt: { ...s.agentLoadedAt, [sessionId]: Date.now() } }));
  } catch {
    // transient; the next poll retries
  } finally {
    agentInFlight.delete(sessionId);
  }
}

/** The 作业 page's list: the first page again, or (`more`) the next page. */
export async function refreshAllJobs(more = false): Promise<void> {
  const s = useJobs.getState();
  if (!supported() || s.allLoading || (more && !s.nextCursor)) return;
  void loadJobCaps();
  useJobs.setState({ allLoading: true });
  try {
    const r = await api.jobs({ query: "", cursor: more ? s.nextCursor : null, limit: PAGE });
    if (noteError(r)) return;
    const ids = r.value.data.map((j) => j.jobId);
    useJobs.setState((st) => ({
      byId: mergeJobs(st.byId, r.value.data),
      error: null,
      allIds: more ? [...new Set([...(st.allIds ?? []), ...ids])] : ids,
      nextCursor: r.value.nextCursor,
    }));
  } catch {
    // transient
  } finally {
    useJobs.setState({ allLoading: false });
  }
}

// ---------- other hosts of the scope (作业 page) ----------

/** Another connected host's jobs: its newest page and its Job Service's human operations. */
export interface HostJobs {
  rows: JobRow[];
  caps: JobServiceCapabilities | null;
  error: { code: string; message: string } | null;
}

export const useHostJobs = create<{ byHost: Record<string, HostJobs> }>(() => ({ byHost: {} }));
const hostInFlight = new Set<string>();
onHostReset((hostId) => {
  hostInFlight.delete(hostId);
  useHostJobs.setState((s) => (s.byHost[hostId] ? { byHost: Object.fromEntries(Object.entries(s.byHost).filter(([id]) => id !== hostId)) } : s));
});

const isFocus = (hostId: string | null | undefined) => !hostId || hostId === focusHostId();

/** One page of `hostId`'s jobs (not the focus host: its jobs are `useJobs`). */
export async function refreshHostJobs(hostId: string): Promise<void> {
  if (isFocus(hostId) || hostInFlight.has(hostId)) return;
  hostInFlight.add(hostId);
  const daemon = apiFor(hostId);
  const patch = (p: Partial<HostJobs>) =>
    useHostJobs.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { rows: [], caps: null, error: null, ...s.byHost[hostId], ...p } } }));
  try {
    if (!useHostJobs.getState().byHost[hostId]?.caps) {
      const caps = await daemon.jobServiceCapabilities().catch(() => null);
      if (caps?.ok) patch({ caps: caps.value ?? {} });
    }
    const r = await daemon.jobs({ query: "", limit: PAGE });
    if (!hostInFlight.has(hostId)) return; // reset meanwhile
    if (!r.ok) patch({ error: { code: r.code, message: r.message } });
    else patch({ rows: r.value.data, error: null });
  } catch {
    // transient; the next poll retries
  } finally {
    hostInFlight.delete(hostId);
  }
}

/** Cancel a job (revision-guarded) on its host; refreshes that host's list either way. */
export async function cancelJob(job: Pick<JobRow, "jobId" | "revision" | "sessionId">, hostId?: string | null): Promise<JobResult<unknown>> {
  if (!isFocus(hostId)) {
    try {
      return await apiFor(hostId!).cancelJob(job.jobId, job.revision);
    } finally {
      void refreshHostJobs(hostId!);
    }
  }
  try {
    return await api.cancelJob(job.jobId, job.revision);
  } finally {
    void refreshAgentJobs(job.sessionId);
  }
}

/** The owner settles an external (NCI) job by hand on its host; refreshes that host's list either way. */
export async function markExternalJob(job: Pick<JobRow, "sessionId">, input: MarkExternalInput, hostId?: string | null): Promise<JobResult<unknown>> {
  if (!isFocus(hostId)) {
    try {
      return await apiFor(hostId!).markExternalJob(input);
    } finally {
      void refreshHostJobs(hostId!);
    }
  }
  try {
    return await api.markExternalJob(input);
  } finally {
    void refreshAgentJobs(job.sessionId);
    if (useJobs.getState().allIds) void refreshAllJobs();
  }
}

export function readJobOutput(jobId: string, stream: JobStream, offset: number, hostId?: string | null): Promise<JobResult<JobOutputPage>> {
  return (isFocus(hostId) ? api : apiFor(hostId!)).jobOutput(jobId, stream, offset);
}

/** Start the event-driven refresh (store.ts init). */
export function startJobSync(handle: AppHandle): void {
  if (app) return;
  app = handle;
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    if (hostId !== focusHostId()) return; // jobs of the shown host only
    const method = envelope.cutex?.method ?? "";
    if (!/job/i.test(method) || !supported()) return;
    if (eventTimer) clearTimeout(eventTimer);
    eventTimer = setTimeout(() => {
      eventTimer = null;
      const selected = handle.getState().selectedId;
      if (selected) void refreshAgentJobs(selected);
      if (useJobs.getState().allIds) void refreshAllJobs();
    }, 500);
  });
}

// ---------- output viewer (one at a time; components/JobParts JobOutputDialog) ----------

/** `hostId`: the job's host when it is not the focus host's (作业 page rows of other hosts). */
export const useJobOutputView = create<{ jobId: string | null; hostId: string | null }>(() => ({ jobId: null, hostId: null }));
export const openJobOutput = (jobId: string, hostId?: string | null) => useJobOutputView.setState({ jobId, hostId: isFocus(hostId) ? null : hostId! });
export const closeJobOutput = () => useJobOutputView.setState({ jobId: null, hostId: null });
// That host's connection was replaced or closed: its viewer goes.
onHostReset((id) => useJobOutputView.getState().hostId === id && closeJobOutput());
