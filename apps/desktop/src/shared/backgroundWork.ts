import type { SessionBackgroundWork } from "@cutex-desktop/protocol";

export const BACKGROUND_WORK_METHOD = "cutex/session/backgroundWork/changed";
export const BACKGROUND_WORK_FEATURE = "session-background-work";
export type BackgroundWork = SessionBackgroundWork;
export interface BackgroundWorkChange {
  cutexSessionId: string;
  runtimeGeneration: number;
  backgroundWork: BackgroundWork | null;
}

export function backgroundWorkChange(value: unknown): BackgroundWorkChange | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.cutexSessionId !== "string" || !p.cutexSessionId || !Number.isSafeInteger(p.runtimeGeneration) || (p.runtimeGeneration as number) < 0) return null;
  if (p.backgroundWork === null) return { cutexSessionId: p.cutexSessionId, runtimeGeneration: p.runtimeGeneration as number, backgroundWork: null };
  if (!p.backgroundWork || typeof p.backgroundWork !== "object") return null;
  const b = p.backgroundWork as Record<string, unknown>;
  if (typeof b.running !== "boolean" || (b.complete !== undefined && typeof b.complete !== "boolean")) return null;
  const backgroundWork: BackgroundWork = { running: b.running };
  for (const key of ["subagents", "shells", "terminals"] as const) {
    if (b[key] === undefined) continue;
    if (!Number.isSafeInteger(b[key]) || (b[key] as number) < 0) return null;
    backgroundWork[key] = b[key] as number;
  }
  if (typeof b.complete === "boolean") backgroundWork.complete = b.complete;
  return { cutexSessionId: p.cutexSessionId, runtimeGeneration: p.runtimeGeneration as number, backgroundWork };
}

interface Row {
  cutexSessionId: string;
  runtime: { runtimeGeneration: number; backgroundWork?: BackgroundWork | null };
}
interface Snapshot { active: Row[]; retired: Row[] }

/** One host/connection only. Events remain authoritative at their generation: an HTTP
 * reply (including a cached retired projection) has no event watermark. Never promote
 * a row's runtime generation using only a background-work event. */
export class BackgroundWorkProjection {
  private generations = new Map<string, number>();
  private changes = new Map<string, BackgroundWorkChange>();

  record(change: BackgroundWorkChange): void {
    const generation = this.generations.get(change.cutexSessionId) ?? -1;
    if (change.runtimeGeneration < generation) return;
    this.generations.set(change.cutexSessionId, change.runtimeGeneration);
    this.changes.set(change.cutexSessionId, change);
  }

  project<T extends Snapshot>(snapshot: T): T {
    const patch = <R extends Row>(row: R): R => {
      // Reduced/legacy archived resources may omit runtime information entirely.
      if (!row.runtime || !Number.isSafeInteger(row.runtime.runtimeGeneration)) return row;
      const id = row.cutexSessionId, generation = row.runtime.runtimeGeneration;
      const known = this.generations.get(id) ?? -1;
      if (generation > known) {
        this.generations.set(id, generation);
        this.changes.delete(id);
      }
      const change = this.changes.get(id);
      const backgroundWork = generation < (this.generations.get(id) ?? -1) ? undefined : change ? change.backgroundWork : row.runtime.backgroundWork;
      const previous = row.runtime.backgroundWork;
      if (previous === backgroundWork || (previous && backgroundWork && previous.running === backgroundWork.running &&
          previous.subagents === backgroundWork.subagents && previous.shells === backgroundWork.shells &&
          previous.terminals === backgroundWork.terminals && previous.complete === backgroundWork.complete)) return row;
      const runtime = { ...row.runtime };
      if (backgroundWork === undefined) delete runtime.backgroundWork;
      else runtime.backgroundWork = backgroundWork;
      return { ...row, runtime };
    };
    const list = <R extends Row>(rows: R[]): R[] => {
      let result = rows;
      rows.forEach((row, i) => {
        const next = patch(row);
        if (next === row) return;
        if (result === rows) result = rows.slice();
        result[i] = next;
      });
      return result;
    };
    const active = list(snapshot.active), retired = list(snapshot.retired);
    return active === snapshot.active && retired === snapshot.retired ? snapshot : { ...snapshot, active, retired };
  }
}
