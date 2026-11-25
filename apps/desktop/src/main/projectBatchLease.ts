// One 项目 table batch at a time across every window (shared/projectBatchOutcome ProjectBatchLeaseRequest). The
// renderer's own guard covers one window; this is the shared boundary. A window that reloads or crashes mid-batch
// stops renewing, and its lease lapses after LEASE_MS. Per-write revision / epoch checks on cutex stay the protection
// against anything else writing meanwhile.
import { randomUUID } from "node:crypto";
import type { ProjectBatchLeaseRequest, ProjectBatchLeaseResult } from "../shared/projectBatchOutcome";

export const PROJECT_BATCH_LEASE_MS = 60_000;
const KINDS = new Set(["archive", "restore", "pause", "resume"]);

export class ProjectBatchLease {
  private held: { token: string; kind: "archive" | "restore" | "pause" | "resume"; total: number; until: number } | null = null;
  constructor(private readonly now: () => number = Date.now) {}

  handle(request: ProjectBatchLeaseRequest): ProjectBatchLeaseResult {
    const r = request as Partial<Record<string, unknown>> | null;
    if (!r || typeof r !== "object") throw new Error("bad project batch lease request");
    const at = this.now();
    if (this.held && this.held.until <= at) this.held = null;
    if (r.op === "begin") {
      if (typeof r.kind !== "string" || !KINDS.has(r.kind) || typeof r.total !== "number" || !Number.isSafeInteger(r.total) || r.total < 1) throw new Error("bad project batch lease request");
      if (this.held) return { ok: false, busy: { kind: this.held.kind, total: this.held.total } };
      this.held = { token: randomUUID(), kind: r.kind as "archive", total: r.total, until: at + PROJECT_BATCH_LEASE_MS };
      return { ok: true, token: this.held.token };
    }
    if ((r.op === "renew" || r.op === "end") && typeof r.token === "string") {
      if (!this.held || this.held.token !== r.token) return { ok: false, busy: this.held ? { kind: this.held.kind, total: this.held.total } : null };
      if (r.op === "end") this.held = null;
      else this.held.until = at + PROJECT_BATCH_LEASE_MS;
      return { ok: true, token: r.token };
    }
    throw new Error("bad project batch lease request");
  }
}

export const projectBatchLease = new ProjectBatchLease();
