// Preview mock of a child agent refused for moved folders (shared/creatorPaths). `?pathschanged`: starting any
// agent that is not online is refused with creator_paths_changed until 重新批准文件夹 (reapproveSessionPaths)
// approves it; `&nofeat=session-path-reapproval` is a host without the capability (the CLI hint shows).
import { CREATOR_PATHS_CODE, creatorPathsWire, type ReapprovePathsResult } from "../../../shared/creatorPaths";

const ON = typeof location !== "undefined" && new URLSearchParams(location.search).has("pathschanged");
const approved = new Set<string>();

/** The wire refusal for starting `id`, or null. */
export function mockCreatorPathsRefusal(id: string): string | null {
  return ON && !approved.has(id) ? creatorPathsWire({ code: CREATOR_PATHS_CODE, details: { cutexSessionId: id } }) : null;
}

export async function mockReapprovePaths(id: string, revision: number): Promise<ReapprovePathsResult> {
  await new Promise((r) => setTimeout(r, 400));
  approved.add(id);
  console.info("[mock] POST /v2/sessions/%s/reapprove-paths {}", id);
  return { cutexSessionId: id, revision: revision + 1 };
}
