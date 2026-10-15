import { describe, expect, it } from "vitest";
import { groupByProject } from "../src/renderer/src/lib/tasks";

describe("groupByProject", () => {
  it("keeps sidebar project order, row order inside a group, and puts unassigned last", () => {
    const rows = [
      { id: 1, projectId: null },
      { id: 2, projectId: "b" },
      { id: 3, projectId: "a" },
      { id: 4, projectId: "b" },
    ];
    const groups = groupByProject(rows, [{ project_id: "a" }, { project_id: "b" }]);
    expect(groups.map((g) => [g.projectId, g.tasks.map((x) => x.id)])).toEqual([
      ["a", [3]],
      ["b", [2, 4]],
      [null, [1]],
    ]);
  });
});
