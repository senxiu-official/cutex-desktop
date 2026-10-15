// Owner pause of delegations (cutex asks-pause-v2, owner 2026-10-08): only an explicit 暂停委托
// pauses new delegations to an agent (with stop-holds-ridealongs a stop holds them too, lib/stopHold).
// 继续 or the owner's next message (started,
// steered or queued) clears it. Older daemons: no UI, today's stop/resume coupling stays.
import { useApp } from "../store";

export const ASKS_PAUSE_FEATURE = "asks-pause-v2";

/** Run a pause / resume action; failures become an error notice. */
export async function asksPauseAction(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
  }
}
