import type { CopySource, CopyState, RemoteCopy } from "../../../../shared/remoteCopies";
import type { CopyRequest } from "../../../../shared/remoteCopyRequests";
import type { ModuleMock } from "../../dev/mockTypes";

const hostId = "ssh-7a3f01c2";
const source: CopySource = { hostId, hostLabel: "workstation", hostIdentity: "WORKSTATION", path: "/home/sam/reports/analysis.pdf" };
const at = new Date(Date.now() - 2 * 86400000).toISOString();
const example = (id: string, name: string, patch: Partial<RemoteCopy>): RemoteCopy => ({ id, source: { ...source, path: `/home/sam/reports/${name}` }, name, size: 8_432_190, received: 8_432_190, status: "complete", createdAt: at, downloadedAt: at, expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(), kept: false, sha256: "a".repeat(64), ...patch });
const state: CopyState = { settings: { retentionDays: 7, largeFileBytes: 200 * 1024 * 1024 }, copies: [
  example("preview-copy-1", "analysis.pdf", {}),
  example("preview-copy-2", "layout-reference.png", { kept: true, expiresAt: null, size: 482_000, received: 482_000 }),
  example("preview-copy-3", "last-week.csv", { status: "expired", downloadedAt: new Date(Date.now() - 9 * 86400000).toISOString(), expiresAt: new Date(Date.now() - 2 * 86400000).toISOString(), size: 22_140, received: 22_140 }),
  // A second host, a project-scoped copy and a failed one, so the place filter and every sort key have something to do.
  example("preview-copy-4", "fresh-run-figures-r5.3.zip", { source: { hostId: "ssh-ae3e47b1", hostLabel: "alpha", hostIdentity: "ALPHA", path: "/Users/alex/runs/fresh-run-figures-r5.3.zip" }, size: 48_211_004, received: 48_211_004, downloadedAt: new Date(Date.now() - 3600000).toISOString() }),
  example("preview-copy-5", "ema_panel_cleaned.parquet", { source: { ...source, path: "/home/sam/demo/data/ema_panel_cleaned.parquet", scope: { kind: "project", id: "demo" } }, size: 8_432_190, received: 8_432_190, downloadedAt: new Date(Date.now() - 5 * 3600000).toISOString() }),
  example("preview-copy-6", "train_log_epoch12.txt", { source: { hostId: "ssh-ae3e47b1", hostLabel: "alpha", hostIdentity: "ALPHA", path: "/Users/alex/runs/train_log_epoch12.txt" }, status: "failed", error: "connection reset while reading chunk 3", size: 1_204_331, received: 400_000, downloadedAt: null, createdAt: new Date(Date.now() - 26 * 3600000).toISOString(), expiresAt: null }),
] };
export async function mockCopyRequest<T = CopyState>(request: CopyRequest): Promise<T> {
  let result: unknown;
  const row = "id" in request ? state.copies.find(c => c.id === request.id) : undefined;
  switch (request.kind) {
    case "list": result = structuredClone(state); break;
    case "inspect": result = { source: { ...request.source, hostIdentity: "WORKSTATION", hostLabel: "workstation" }, meta: { path: request.source.path, name: request.source.path.split(/[\\/]/).pop() || "report.bin", size: /large|archive|dataset/.test(request.source.path) ? 640 * 1024 * 1024 : 8_432_190, modifiedAt: at, revision: "a".repeat(64), maxChunkBytes: 4 * 1024 * 1024 } }; break;
    case "start": {
      const id = request.replaceId ?? `preview-copy-${Date.now()}`;
      const copy = example(id, request.source.path.split(/[\\/]/).pop() || "report.bin", { source: request.source, status: "downloading", size: request.expected.size, received: 0, downloadedAt: null, expiresAt: null });
      const index = state.copies.findIndex(c => c.id === id);
      if (index >= 0) state.copies[index] = copy; else state.copies.unshift(copy);
      const timer = setInterval(() => {
        if (copy.status !== "downloading") { clearInterval(timer); return; }
        copy.received = Math.min(copy.size, copy.received + 8 * 1024 * 1024);
        if (copy.received === copy.size) { copy.status = "complete"; copy.downloadedAt = new Date().toISOString(); copy.expiresAt = state.settings.retentionDays ? new Date(Date.now() + state.settings.retentionDays * 86400000).toISOString() : null; clearInterval(timer); }
      }, 500);
      result = id; break;
    }
    case "cancel": if (row) row.status = "canceled"; break;
    case "keep": if (row) { row.kept = request.value; if (row.kept) row.expiresAt = null; } break;
    case "remove": state.copies = state.copies.filter(c => c.id !== request.id); break;
    case "settings": state.settings.retentionDays = request.retentionDays; result = state.settings; break;
    case "open": case "reveal": console.info("[mock owned copy]", request.kind, request.id); break;
  }
  return structuredClone(result) as T;
}
export const mock: ModuleMock = {
  features: { new: ["fs-file-transfer-v1"] },
};
