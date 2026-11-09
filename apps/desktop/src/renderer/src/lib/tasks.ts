// Small list helpers shared by the delegation and job lists (DESIGN §4.18): short colored "#5e89dd"
// tags instead of raw ids, and grouping of rows by project.

const TAG_COLORS = ["#4c8dff", "#40c057", "#f59f00", "#e64980", "#7950f2", "#12b886", "#fd7e14", "#15aabf"];
const TAG_LENGTH = 6;

/** From the id alone, so it stays the same after a restart and on every device: the first characters cutex shortens an id to (`ask-5e89dd8c…` / `delegation-5e89dd` → #5e89dd), so a tag can be quoted to an agent. */
export function taskTag(taskId: string): { label: string; color: string } {
  const short = taskId.replace(/^[a-z]+-/i, "").slice(0, TAG_LENGTH) || taskId;
  let h = 0;
  for (const ch of taskId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { label: `#${short}`, color: TAG_COLORS[h % TAG_COLORS.length]! };
}

/** Split already-sorted rows by project: sidebar project order, rows without a project last. */
export function groupByProject<T extends { projectId?: string | null }>(rows: readonly T[], projects: readonly { project_id: string }[]): { projectId: string | null; tasks: T[] }[] {
  const order = new Map(projects.map((p, i) => [p.project_id, i]));
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.projectId && order.has(row.projectId) ? row.projectId : (row.projectId ?? null);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const rank = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : (order.get(id) ?? Number.MAX_SAFE_INTEGER - 1));
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([projectId, tasks]) => ({ projectId, tasks }));
}
