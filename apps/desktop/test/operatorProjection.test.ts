import { expect, it, vi } from "vitest";
import type { OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { readProjectOperators } from "../src/main/projectOperators";

const project = (id = "p", count: number | undefined = 1) => ({ project_id: id, authority_epoch: 2, operator_count: count, director_cutex_session_id: "director" }) as ProjectSummary;
const workspace = (id = "p", operator = "member"): OperatorProjectWorkspace => ({ project_id: id, authority_epoch: 2, operator_grant_revision: 1,
  presentation: { display_name: id, badge_label: id, color: "blue" }, active_agents: [], retired_agents: [],
  agent_operators: [{ grant: { project_id: id, operator_cutex_session_id: operator, grant_revision: 1, granted_at: "now", granted_by_primary_director_session: "director" },
    member: { agent: { cutex_session_id: operator, spec: { name: operator } }, lifecycle: "active" } }] });
it("does not probe old hosts or empty rosters", async () => {
  const read = vi.fn(async () => workspace());
  const old = project(); delete old.operator_count;
  expect(await readProjectOperators([old], read)).toBeUndefined();
  expect(await readProjectOperators([project("empty", 0)], read)).toEqual({ empty: [] }); expect(read).not.toHaveBeenCalled();
});
it("reads canonical identities on every refresh, including equal-count replacements", async () => {
  const read = vi.fn(async () => workspace());
  expect(await readProjectOperators([project()], read)).toEqual({ p: ["member"] });
  read.mockResolvedValue(workspace("p", "replacement"));
  expect(await readProjectOperators([project()], read)).toEqual({ p: ["replacement"] });
});
it("drops unsupported, stale-authority, failed, mismatched and Director rosters", async () => {
  const old = workspace(); delete old.operator_grant_revision;
  const changed = workspace(); changed.authority_epoch++;
  const read = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(old).mockResolvedValueOnce(changed)
    .mockResolvedValueOnce(workspace("other")).mockResolvedValueOnce(workspace("p", "director"));
  for (let n = 0; n < 4; n++) expect(await readProjectOperators([project()], read)).toEqual({});
  expect(await readProjectOperators([project()], read)).toEqual({ p: [] });
});
it("limits concurrent roster reads to four", async () => {
  let active = 0, peak = 0;
  const read = async (id: string) => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return workspace(id); };
  const result = await readProjectOperators(Array.from({ length: 20 }, (_, n) => project(String(n))), read);
  expect(Object.keys(result!)).toHaveLength(20); expect(peak).toBeLessThanOrEqual(4);
});
