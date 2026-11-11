// 保存到这台电脑 (lib/remoteCopies saveArtifact): a pinned artifact version is saved from any host with the artifact
// store — this computer's included — while a plain file is still downloaded only from a remote host.
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  call: vi.fn(),
  open: vi.fn(),
  features: new Map<string, Set<string>>(),
  state: { features: {}, byHost: {}, hosts: { hosts: [{ id: "local", kind: "local", label: "This computer", conn: { epoch: "e1" } }, { id: "far", kind: "ssh", label: "far", conn: { epoch: "e2" } }] } },
}));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { shell: { remoteCopies: f.call } }, api: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({ openSide: f.open }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => f.state },
  featuresOf: (_s: unknown, hostId: string) => f.features.get(hostId) ?? new Set(),
}));

const { canDownload, canSaveArtifact, saveArtifact, useCopies } = await import("../src/renderer/src/lib/remoteCopies");

describe("save an artifact to this computer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.features = new Map([["local", new Set(["artifacts"])], ["far", new Set(["artifacts", "fs-file-transfer-v1"])]]);
    useCopies.setState({ state: { copies: [], settings: { retentionDays: null, largeFileBytes: 1000 } }, pending: null, busy: false, error: null });
  });

  it("is offered on the local host with an artifact store, not without one; plain downloads stay remote-only", () => {
    expect(canSaveArtifact("local")).toBe(true);
    expect(canDownload("local")).toBe(false);
    expect(canDownload("far")).toBe(true);
    f.features.set("local", new Set());
    expect(canSaveArtifact("local")).toBe(false);
  });

  it("inspects and starts the pinned version through main, opening the 下载 page for progress", async () => {
    const meta = { path: "af-1@3", name: "deck.pdf", size: 10, modifiedAt: "", revision: "a".repeat(64), maxChunkBytes: 4 };
    f.call.mockImplementation(async (req: { kind: string; source?: unknown }) => req.kind === "inspect" ? { source: { ...(req.source as object), hostIdentity: "H" }, meta } : req.kind === "list" ? useCopies.getState().state : "id-1");
    await saveArtifact("local", { artifactId: "af-1", version: 3 }, { kind: "project", id: "p1" });
    expect(f.open).toHaveBeenCalledWith("remote-copies.list", {}, { binding: { kind: "host", hostId: "local" } });
    expect(f.call.mock.calls[0]![0]).toEqual({ kind: "inspect", source: { hostId: "local", hostLabel: "This computer", hostIdentity: "", path: "af-1@3", scope: { kind: "project", id: "p1" }, artifact: { id: "af-1", version: 3 } }, binding: { hostId: "local", epoch: "e1" } });
    expect(f.call.mock.calls.some(([req]) => req.kind === "start")).toBe(true);
    expect(useCopies.getState().error).toBeNull();
  });

  it("says why when the host cannot save artifacts", async () => {
    f.features.set("local", new Set());
    await saveArtifact("local", { artifactId: "af-1", version: 3 });
    expect(f.call).not.toHaveBeenCalled();
    expect(useCopies.getState().error).toContain("没有成果库");
  });
});
