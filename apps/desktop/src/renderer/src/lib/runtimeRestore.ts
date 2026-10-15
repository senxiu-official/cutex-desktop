// Restore after an unclean stop (cutex runtime-restore-candidates, shared/runtimeRestore.ts): the
// owner brings back the agents that were online before a power loss / crash. Sequential on purpose
// (each start spawns a native runtime; cutex serialises launches anyway) and per agent, so one
// failure never hides the others.
import type { RestoreCandidate } from "../../../shared/runtimeRestore";
import { errorText } from "./agentMessages";

export interface RestoreOutcome {
  cutexSessionId: string;
  displayName: string;
  /** null = online again. */
  error: string | null;
}

/** Start each agent in order; `start` is the ordinary `cutex/runtime/online`. */
export async function restoreSequentially(
  items: readonly RestoreCandidate[],
  start: (cutexSessionId: string) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreOutcome[]> {
  const outcomes: RestoreOutcome[] = [];
  for (const item of items) {
    let error: string | null = null;
    try {
      await start(item.cutexSessionId);
    } catch (e) {
      error = errorText(e instanceof Error ? e.message : e) ?? "failed";
    }
    outcomes.push({ cutexSessionId: item.cutexSessionId, displayName: item.displayName, error });
    onProgress?.(outcomes.length, items.length);
  }
  return outcomes;
}

/** The candidates the owner ticked, in list order. */
export function chosenCandidates(items: readonly RestoreCandidate[], chosen: ReadonlySet<string>): RestoreCandidate[] {
  return items.filter((item) => chosen.has(item.cutexSessionId));
}
