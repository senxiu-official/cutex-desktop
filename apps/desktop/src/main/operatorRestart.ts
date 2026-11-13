import type { SessionResource } from "@cutex-desktop/protocol";
import type { OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";
import { projectOperatorIds } from "../shared/projectOperatorMembers";

/** UI-only notice: a role changed while this runtime still had its old launch-time tools. */
export class OperatorRestartNotices {
  private readonly generations = new Map<string, number>();
  require(session: SessionResource): void { this.generations.set(session.cutexSessionId, session.runtime.runtimeGeneration); }
  current(sessions: readonly SessionResource[]): string[] {
    const byId = new Map(sessions.map(s => [s.cutexSessionId, s]));
    for (const [id, generation] of this.generations) {
      const session = byId.get(id);
      if (!session || session.lifecycle === "retired" || session.runtime.status !== "online" || session.runtime.runtimeGeneration !== generation) this.generations.delete(id);
    }
    return [...this.generations.keys()];
  }
  clear(id: string): void { this.generations.delete(id); }
}

/** A launch-time permission change requires an explicit owner restart for every online runtime. */
export async function recordOperatorRuntimeNotice(options: {
  read(): Promise<SessionResource>;
  current(): boolean;
  notices: OperatorRestartNotices;
}): Promise<{ state: "required" | "offline" }> {
  const session = await options.read();
  if (!options.current()) throw Error("host_changed");
  if (session.lifecycle === "retired" || session.runtime.status !== "online") {
    options.notices.clear(session.cutexSessionId); return { state: "offline" };
  }
  options.notices.require(session);
  return { state: "required" };
}

/**
 * Main-process handler body for operatorRuntimeNotice: a fresh project read must show the owner's management view
 * and the agent as an active member or a valid Operator of this project (never the Director) before any record.
 */
export async function projectOperatorRuntimeNotice(options: {
  projectId: string; sessionId: string;
  project(): Promise<OperatorProjectWorkspace>;
  read(): Promise<SessionResource>;
  current(): boolean;
  notices: OperatorRestartNotices;
}): Promise<{ state: "required" | "offline" }> {
  const { projectId, sessionId } = options;
  const workspace = await options.project();
  const member = workspace.active_agents.some(row => row.agent.cutex_session_id === sessionId) || projectOperatorIds(workspace, projectId).has(sessionId);
  if (!options.current() || workspace.access_role !== "human_management" || !member || workspace.director?.cutex_session_id === sessionId) throw Error("operator_unavailable");
  return recordOperatorRuntimeNotice({ read: options.read, notices: options.notices, current: options.current });
}
