// Owner-initiated Director rotation (cutex `owner-rotation`): the newest rotation per project on
// each connected host. Loaded when the project page or the dialog asks; `cutex/ownerRotation/updated`
// host events ({rotation}, tagged with their host) keep it live, and the dialog polls GET {id} while a rotation runs (a
// dropped event never strands it). Once the seat moves the sidebar / projects are reloaded.
import { create } from "zustand";
import type { CutexRefusal, DirectorRotation, DirectorRotationResult, DirectorRotationStart } from "../../../../shared/ipc";
import { isTerminalRotation, OWNER_ROTATION_FEATURE, ROTATION_UPDATED_METHOD } from "../../../../shared/directorRotation";
import { api, bridge } from "../../bridge";
import { useApp } from "../../store";
import { setRotationProbe } from "../../lib/rotationProbe";

interface RotationState {
  /** `${hostId} ${projectId}` → newest rotation (null = none yet; absent = not loaded). */
  byProject: Record<string, DirectorRotation | null>;
}

export const useRotations = create<RotationState>(() => ({ byProject: {} }));

// The sidebar project menu greys 清除主管 out while one runs (lib/rotationProbe).
setRotationProbe((host, projectId) => {
  const rotation = useRotations.getState().byProject[`${host} ${projectId}`];
  return !!rotation && !isTerminalRotation(rotation.state);
});

const hostId = () => useApp.getState().hosts?.active ?? "";
const key = (projectId: string, host = hostId()) => `${host} ${projectId}`;

export function rotationSupported(): boolean {
  const s = useApp.getState();
  return s.daemon.kind === "connected" && s.features.has(OWNER_ROTATION_FEATURE);
}

/** States after which the sidebar shows the new Director. */
const SEAT_MOVED = new Set(["authority_rebound", "predecessor_disposed", "done"]);

/** Keep the newer of two records of the same rotation (revision), or the rotation that is newer. */
function apply(rotation: DirectorRotation, host = hostId()): void {
  const k = key(rotation.projectId, host);
  const current = useRotations.getState().byProject[k];
  if (current && current.rotationId === rotation.rotationId && current.revision >= rotation.revision) return;
  if (current && current.rotationId !== rotation.rotationId && current.createdAt > rotation.createdAt) return;
  useRotations.setState((s) => ({ byProject: { ...s.byProject, [k]: rotation } }));
  // Another connected host's sidebar follows its own cutex/* events (store.ts host feed).
  if (host !== hostId()) return;
  const before = current?.rotationId === rotation.rotationId ? current.state : null;
  if (SEAT_MOVED.has(rotation.state) && !(before && SEAT_MOVED.has(before))) void useApp.getState().refreshSidebar();
  else if (isTerminalRotation(rotation.state) && before !== rotation.state) void useApp.getState().refreshSidebar();
}

let subscribed = false;
function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  bridge.on("hostEvent", ({ hostId: from, envelope }) => {
    if (envelope.cutex?.method !== ROTATION_UPDATED_METHOD) return;
    const rotation = (envelope.cutex.params as { rotation?: DirectorRotation } | undefined)?.rotation;
    if (rotation && typeof rotation.rotationId === "string" && typeof rotation.projectId === "string") apply(rotation, from);
  });
}

/** `GET /v2/director-rotations?projectId=` → the newest one. */
export async function loadProjectRotation(projectId: string): Promise<void> {
  if (!rotationSupported()) return;
  subscribe();
  const host = hostId();
  try {
    const list = await api.directorRotations(projectId);
    if (hostId() !== host) return;
    const newest = list?.[0] ?? null;
    if (newest) apply(newest, host);
    else useRotations.setState((s) => ({ byProject: { ...s.byProject, [key(projectId, host)]: null } }));
  } catch {
    // Show the form (no rotation known); the next load retries.
    if (hostId() === host && useRotations.getState().byProject[key(projectId, host)] === undefined) useRotations.setState((s) => ({ byProject: { ...s.byProject, [key(projectId, host)]: null } }));
  }
}

/** `GET /v2/director-rotations/{id}` (dialog poll). */
export async function pollRotation(rotationId: string): Promise<void> {
  const host = hostId();
  try {
    const rotation = await api.directorRotation(rotationId);
    if (rotation && hostId() === host) apply(rotation, host);
  } catch {
    // keep the last known state
  }
}

async function act(call: () => Promise<DirectorRotationResult>): Promise<DirectorRotationResult> {
  subscribe();
  const host = hostId();
  try {
    const r = await call();
    if (r.ok && hostId() === host) apply(r.rotation, host);
    return r;
  } catch (error) {
    const refusal: CutexRefusal = { code: "error", message: error instanceof Error ? error.message : String(error) };
    return { ok: false, error: refusal };
  }
}

export function startRotation(request: DirectorRotationStart): Promise<DirectorRotationResult> {
  return act(() => api.startDirectorRotation(request));
}

export function cancelRotation(rotationId: string): Promise<DirectorRotationResult> {
  return act(() => api.cancelDirectorRotation(rotationId));
}

export function continueRotation(rotationId: string): Promise<DirectorRotationResult> {
  return act(() => api.continueDirectorRotation(rotationId));
}

/** The newest rotation of a project on the connected host (undefined = not loaded). */
export function useProjectRotation(projectId: string): DirectorRotation | null | undefined {
  const host = useApp((s) => s.hosts?.active ?? "");
  return useRotations((s) => s.byProject[key(projectId, host)]);
}
