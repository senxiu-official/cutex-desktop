// Browser-preview data for projects (dev/mockTypes.ts): cutex `project-optional-director`
// (create_project / assign_director / clear_director; the mutations live in dev/mockBridge.ts with
// the rest of the project state). `?legacy` drops it: a Director is then required on create.
//
// `owner-rotation` (轮换主管): /v2/director-rotations with a scripted state machine. The successor
// is created and the seat moved through the core's own createAgent / projectMutation, so the sidebar
// and the project page follow. `?rot=` picks the script:
//   (none)    the note arrives after 5 s, then one step every 1.4 s → done
//   timeout   the note never comes; the deadline is 8 s in → timeout (继续 / 取消)
//   fail      the seat move is refused → failed (the successor stays a member)
//   wait      the note never comes; the deadline is the chosen one (stays 等待交接)
//   running   kks starts with a rotation waiting for its note (banner, 查看 opens the progress)
import type { DirectorRotation, DirectorRotationResult, DirectorRotationStart, DirectorRotationState } from "../../../../shared/ipc";
import { isTerminalRotation, nextSuccessorName, ROTATION_UPDATED_METHOD, rotationCancellable, rotationWaiting } from "../../../../shared/directorRotation";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const SCENARIO = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("rot") ?? "") : "";
const NOTE_MS = 5000;
const STEP_MS = 1400;
const MOCK_TIMEOUT_MS = 8000;

const rotations: DirectorRotation[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const refuse = (code: string, message: string): DirectorRotationResult => ({ ok: false, error: { code, message } });
const stamp = (ms = Date.now()) => iso(ms).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function publish(core: MockCore, r: DirectorRotation): void {
  r.revision += 1;
  r.updatedAt = iso();
  core.emitHost(ROTATION_UPDATED_METHOD, { rotation: structuredClone(r) });
}

function to(core: MockCore, r: DirectorRotation, state: DirectorRotationState, note?: string): void {
  r.state = state;
  r.attempts = 0;
  r.history.push({ state, at: iso(), ...(note ? { note } : {}) });
  if (isTerminalRotation(state)) r.finishedAt = iso();
  publish(core, r);
}

function later(r: DirectorRotation, ms: number, run: () => void): void {
  const list = timers.get(r.rotationId) ?? [];
  list.push(setTimeout(run, ms));
  timers.set(r.rotationId, list);
}

function clearTimers(r: DirectorRotation): void {
  for (const timer of timers.get(r.rotationId) ?? []) clearTimeout(timer);
  timers.delete(r.rotationId);
}

/** successor_created → authority_rebound → predecessor_disposed → done, through the core api. */
function proceed(core: MockCore, r: DirectorRotation): void {
  r.successorCreateStartedAt = iso();
  later(r, STEP_MS, () => {
    void (async () => {
      const spec = r.successorSpec;
      const created = await window.cutex.api.createAgent({ name: spec.name, projectId: r.projectId, cwd: spec.cwd, ...(spec.profile ? { profile: spec.profile } : {}), start: false });
      r.successorCutexSessionId = created.cutexSessionId;
      to(core, r, "successor_created");
      later(r, STEP_MS, () => {
        void (async () => {
          if (SCENARIO === "fail") {
            r.error = { code: "rebind_failed", message: `conflict: successor_not_director_candidate: ${spec.name} cannot hold the Director seat (Operator grant)` };
            r.warnings.push(`${spec.name} was created and stays a member of ${r.projectName}`);
            return to(core, r, "failed");
          }
          const expected = { authorityEpoch: r.expectedAuthorityEpoch, projectRevision: 0 };
          await window.cutex.api.projectMutation(r.projectId, expected, { kind: "clear_director" });
          await window.cutex.api.projectMutation(r.projectId, expected, { kind: "assign_director", cutex_session_id: created.cutexSessionId });
          r.authorityEpoch = r.expectedAuthorityEpoch + 1;
          to(core, r, "authority_rebound");
          later(r, STEP_MS, () => {
            if (r.disposition === "archive") r.warnings.push(`${r.predecessor.name}: 2 open delegations were cancelled with the archive`);
            to(core, r, "predecessor_disposed");
            later(r, STEP_MS, () => to(core, r, "done"));
          });
        })();
      });
    })();
  });
}

function waitForNote(core: MockCore, r: DirectorRotation): void {
  const deadline = Date.parse(r.handoff.deadline!);
  if (SCENARIO === "" || SCENARIO === "fail") {
    later(r, NOTE_MS, () => {
      r.handoff.writtenAt = iso();
      to(core, r, "handoff_written");
      proceed(core, r);
    });
    return;
  }
  later(r, Math.max(0, deadline - Date.now()), () => to(core, r, "timeout", "no handoff note before the deadline"));
}

async function start(core: MockCore, request: DirectorRotationStart): Promise<DirectorRotationResult> {
  if (rotations.some((x) => !isTerminalRotation(x.state) && (x.projectId === request.projectId || x.predecessor.cutexSessionId === request.expectedDirectorCutexSessionId))) {
    return refuse("rotation_in_progress", "rotation is still running for this Project or Director");
  }
  const replay = rotations.find((x) => x.requestId === request.requestId);
  if (replay) return { ok: true, rotation: structuredClone(replay) };
  const sidebar = await window.cutex.api.sidebar();
  const project = sidebar.projects?.projects.find((p) => p.project_id === request.projectId);
  if (!project) return refuse("project_not_found", "the Project does not exist on this host");
  if (project.director_cutex_session_id !== request.expectedDirectorCutexSessionId || project.authority_epoch !== request.expectedAuthorityEpoch) {
    return refuse("stale_project_authority", `the Project's Director is ${project.director_cutex_session_id} at epoch ${project.authority_epoch}; reload and try again`);
  }
  const director = [...sidebar.active, ...sidebar.retired].find((s) => s.cutexSessionId === request.expectedDirectorCutexSessionId);
  const name = director?.formalAgentName || director?.displayName || request.expectedDirectorCutexSessionId;
  const cwd = request.successor.cwd ?? director?.cwd ?? project.workspace_root ?? "D:\\Programs";
  const base = project.workspace_root ?? director?.cwd ?? cwd;
  const now = Date.now();
  const timeoutSecs = request.handoffTimeoutSecs ?? 600;
  const deadline = SCENARIO === "timeout" ? now + MOCK_TIMEOUT_MS : now + timeoutSecs * 1000;
  const r: DirectorRotation = {
    rotationId: `rot-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    requestId: request.requestId,
    projectId: project.project_id,
    projectName: project.presentation.display_name,
    state: "requested",
    predecessor: { cutexSessionId: request.expectedDirectorCutexSessionId, name },
    expectedAuthorityEpoch: request.expectedAuthorityEpoch,
    disposition: request.predecessor,
    successorSpec: {
      name: request.successor.name ?? nextSuccessorName(name),
      profile: request.successor.profile ?? director?.profile ?? null,
      model: request.successor.model ?? null,
      reasoningEffort: request.successor.reasoningEffort ?? null,
      cwd,
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
    },
    handoff: { path: `${base}\\handoff\\${stamp(now)}.md`, timeoutSecs, requestedAt: null, deadline: null, writtenAt: null, skipped: false },
    successorCutexSessionId: null,
    successorCreateStartedAt: null,
    authorityEpoch: null,
    predecessorDelegations: project.project_id === "desktop" ? { requested: 2, handling: 1 } : { requested: 0, handling: 0 },
    attempts: 0,
    error: null,
    warnings: [],
    history: [{ state: "requested", at: iso(now) }],
    createdAt: iso(now),
    updatedAt: iso(now),
    finishedAt: null,
    revision: 1,
  };
  rotations.unshift(r);
  later(r, 400, () => {
    r.handoff.requestedAt = iso();
    r.handoff.deadline = iso(deadline);
    to(core, r, "handoff_requested");
    waitForNote(core, r);
  });
  return { ok: true, rotation: structuredClone(r) };
}

export const mock: ModuleMock = {
  features: { new: ["project-optional-director", "owner-rotation", "project-create-workspace-root"] },
  api(core) {
    return {
      async directorRotations(projectId) {
        if (core.legacy) return null;
        return structuredClone(rotations.filter((r) => r.projectId === projectId));
      },
      async directorRotation(rotationId) {
        const r = rotations.find((x) => x.rotationId === rotationId);
        return r ? structuredClone(r) : null;
      },
      async startDirectorRotation(request) {
        return start(core, request);
      },
      async cancelDirectorRotation(rotationId) {
        const r = rotations.find((x) => x.rotationId === rotationId);
        if (!r) return refuse("rotation_not_found", "no such rotation");
        if (r.state === "cancelled") return { ok: true, rotation: structuredClone(r) };
        if (!rotationCancellable(r)) return refuse("rotation_not_cancellable", `the rotation is ${r.state}; the successor is already being created`);
        clearTimers(r);
        to(core, r, "cancelled", "cancelled by the owner");
        return { ok: true, rotation: structuredClone(r) };
      },
      async continueDirectorRotation(rotationId) {
        const r = rotations.find((x) => x.rotationId === rotationId);
        if (!r) return refuse("rotation_not_found", "no such rotation");
        if (r.handoff.skipped) return { ok: true, rotation: structuredClone(r) };
        if (!rotationWaiting(r)) return refuse("rotation_not_waiting", `the rotation is ${r.state}`);
        clearTimers(r);
        r.handoff.skipped = true;
        publish(core, r);
        proceed(core, r);
        return { ok: true, rotation: structuredClone(r) };
      },
    };
  },
  start(core) {
    if (SCENARIO !== "running" || core.legacy) return;
    // kks: a rotation already waiting for kks-director's note (the page shows the banner).
    // Deferred: window.cutex is installed after the module mocks start.
    setTimeout(() => {
      void start(core, {
        requestId: "mock-kks-rotation",
        projectId: "kks",
        expectedDirectorCutexSessionId: "kks-dir",
        expectedAuthorityEpoch: 1,
        predecessor: "member",
        handoffTimeoutSecs: 1200,
        successor: {},
      });
    }, 0);
  },
};
