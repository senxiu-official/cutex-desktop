import type { SessionBackgroundWork } from "@cutex-desktop/protocol";
import { sameClaudeDiagnostics, type ClaudeDiagnostics, type ClaudeDiagnosticsChange } from "./claudeDiagnostics";

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
  runtime: { runtimeGeneration: number; backgroundWork?: BackgroundWork | null; claudeDiagnostics?: ClaudeDiagnostics | null };
}
interface Snapshot { active: Row[]; retired: Row[] }

/** One host/connection only. Events remain authoritative at their generation: an HTTP
 * reply (including a cached retired projection) has no event watermark. Never promote
 * a row's runtime generation using only a background-work event.
 * Also carries the Claude diagnostics snapshot (claude-runtime-diagnostics-v1): the same
 * non-durable status channel and the same runtime-generation fence. */
export class BackgroundWorkProjection {
  private generations = new Map<string, number>();
  private changes = new Map<string, BackgroundWorkChange>();
  private diagnostics = new Map<string, ClaudeDiagnosticsChange>();

  /** Advance the session's fence to `generation` (dropping overlays of older generations); false = older. */
  private fence(id: string, generation: number): boolean {
    const known = this.generations.get(id) ?? -1;
    if (generation < known) return false;
    if (generation > known) {
      this.generations.set(id, generation);
      if ((this.changes.get(id)?.runtimeGeneration ?? generation) < generation) this.changes.delete(id);
      if ((this.diagnostics.get(id)?.runtimeGeneration ?? generation) < generation) this.diagnostics.delete(id);
    }
    return true;
  }

  record(change: BackgroundWorkChange): void {
    if (this.fence(change.cutexSessionId, change.runtimeGeneration)) this.changes.set(change.cutexSessionId, change);
  }

  recordClaudeDiagnostics(change: ClaudeDiagnosticsChange): void {
    if (this.fence(change.cutexSessionId, change.runtimeGeneration)) this.diagnostics.set(change.cutexSessionId, change);
  }

  project<T extends Snapshot>(snapshot: T): T {
    const patch = <R extends Row>(row: R): R => {
      // Reduced/legacy archived resources may omit runtime information entirely.
      if (!row.runtime || !Number.isSafeInteger(row.runtime.runtimeGeneration)) return row;
      const id = row.cutexSessionId, generation = row.runtime.runtimeGeneration;
      this.fence(id, generation);
      const behind = generation < (this.generations.get(id) ?? -1);
      const change = this.changes.get(id), diag = this.diagnostics.get(id);
      const backgroundWork = behind ? undefined : change ? change.backgroundWork : row.runtime.backgroundWork;
      const claudeDiagnostics = behind ? undefined : diag ? diag.claudeDiagnostics : row.runtime.claudeDiagnostics;
      const previous = row.runtime.backgroundWork;
      const sameWork = previous === backgroundWork || (!!previous && !!backgroundWork && previous.running === backgroundWork.running &&
          previous.subagents === backgroundWork.subagents && previous.shells === backgroundWork.shells &&
          previous.terminals === backgroundWork.terminals && previous.complete === backgroundWork.complete);
      const previousDiag = row.runtime.claudeDiagnostics;
      const sameDiag = previousDiag === claudeDiagnostics || (previousDiag !== undefined && claudeDiagnostics !== undefined && sameClaudeDiagnostics(previousDiag, claudeDiagnostics));
      if (sameWork && sameDiag) return row;
      const runtime = { ...row.runtime };
      if (!sameWork) {
        if (backgroundWork === undefined) delete runtime.backgroundWork;
        else runtime.backgroundWork = backgroundWork;
      }
      if (!sameDiag) {
        if (claudeDiagnostics === undefined) delete runtime.claudeDiagnostics;
        else runtime.claudeDiagnostics = claudeDiagnostics;
      }
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
