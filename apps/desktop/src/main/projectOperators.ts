import { hasOperatorActionsProjection, type OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";
import type { ProjectSummary } from "@cutex-desktop/protocol";

/** Read canonical rosters on each sidebar refresh: equal-count replacements do not change project_revision. */
export async function readProjectOperators(projects: readonly ProjectSummary[], read: (id: string) => Promise<OperatorProjectWorkspace>): Promise<Record<string, string[]> | undefined> {
  const supported = projects.filter(p => Number.isSafeInteger(p.operator_count) && p.operator_count! >= 0);
  if (!supported.length) return undefined;
  const result: Record<string, string[]> = {};
  let next = 0;
  const lane = async () => {
    while (next < supported.length) {
      const project = supported[next++]!;
      if (!project.operator_count) { result[project.project_id] = []; continue; }
      try {
        const workspace = await read(project.project_id);
        if (workspace.project_id !== project.project_id || workspace.authority_epoch !== project.authority_epoch || !hasOperatorActionsProjection(workspace)) continue;
        result[project.project_id] = workspace.agent_operators.flatMap(({ grant, member }) =>
          grant.project_id === project.project_id && grant.operator_cutex_session_id === member.agent.cutex_session_id &&
          grant.operator_cutex_session_id !== project.director_cutex_session_id && member.agent.retired_at == null
            ? [grant.operator_cutex_session_id] : []);
      } catch { /* A failed or unsupported projection must not retain an old role. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, supported.length) }, lane));
  return result;
}
