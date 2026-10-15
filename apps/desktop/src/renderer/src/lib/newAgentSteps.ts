// New agent page sequencing (agent-config.newAgent): create → (Director) → start.
// An agent's runtime reads its MCP tool list from cutex once, when it starts. A new agent that
// becomes a project's Director must therefore be created stopped, made Director, and only then
// started — started as a plain member it never sees the Director-only tools until a restart.
import type { ExtraInput } from "../../../shared/ipc";

export type NewAgentStep = "create" | "appearance" | "director" | "start" | "message";

/** A step failed; `progress` says what already exists, so a retry resumes after it. */
export class NewAgentStepError extends Error {
  constructor(
    readonly step: NewAgentStep,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NewAgentStepError";
  }
}

/** Steps already done (kept by the page between attempts). */
export interface NewAgentProgress {
  agent: string | null;
  directorAssigned: boolean;
  started?: boolean;
  messageSent?: boolean;
  appearanceSaved?: boolean;
}

export const NO_PROGRESS: NewAgentProgress = { agent: null, directorAssigned: false };

export interface NewAgentOps {
  /** Creates the agent; `start` = cutex starts it right away. Returns its cutex session id. */
  create(start: boolean): Promise<string>;
  /** Optional draft avatar, applied to the created session before opening it. */
  saveAppearance?(agent: string): Promise<void>;
  refresh(): Promise<void>;
  assignDirector(agent: string): Promise<void>;
  /** Starts an existing agent (cutex/runtime/online; launch options were fixed at creation). */
  start(agent: string): Promise<void>;
  /** Optional first task, submitted to this exact host/session with a stable message id. */
  submit?(agent: string, text: string, extra: ExtraInput[]): Promise<void>;
}

/**
 * Runs the remaining steps. `plan.director` = make it the project's Director; `plan.start` = start
 * it. Once the Director was assigned, a retry keeps the deferred start even though the page no
 * longer offers the Director option (the project now has one).
 */
export async function runNewAgentSteps(ops: NewAgentOps, plan: { start: boolean; director: boolean; message?: string; extra?: ExtraInput[] }, progress: NewAgentProgress, onProgress: (p: NewAgentProgress) => void): Promise<string> {
  let p = progress;
  const text = plan.message?.trim() ?? "";
  const extra = plan.extra ?? [];
  const hasMessage = !!text || extra.length > 0;
  const start = plan.start || hasMessage;
  const director = plan.director || p.directorAssigned;
  const update = (patch: Partial<NewAgentProgress>) => {
    p = { ...p, ...patch };
    onProgress(p);
  };
  let agent = p.agent;
  if (!agent) {
    try {
      agent = await ops.create(start && !director);
    } catch (e) {
      throw new NewAgentStepError("create", e);
    }
    update({ agent });
  }
  if (ops.saveAppearance && !p.appearanceSaved) {
    try {
      await ops.saveAppearance(agent);
    } catch (e) {
      throw new NewAgentStepError("appearance", e);
    }
    update({ appearanceSaved: true });
  }
  await ops.refresh();
  if (director && !p.directorAssigned) {
    try {
      await ops.assignDirector(agent);
    } catch (e) {
      throw new NewAgentStepError("director", e);
    }
    update({ directorAssigned: true });
    await ops.refresh();
  }
  if (director && start && !p.started) {
    try {
      await ops.start(agent);
      update({ started: true });
    } catch (e) {
      throw new NewAgentStepError("start", e);
    }
  }
  if (hasMessage && !p.messageSent) {
    try {
      if (!ops.submit) throw new Error("No first-message sender configured");
      await ops.submit(agent, text, extra);
    } catch (e) {
      throw new NewAgentStepError("message", e);
    }
    update({ messageSent: true });
  }
  return agent;
}
