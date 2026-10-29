// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CopyState } from "../src/shared/remoteCopies";
const f = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { shell: { remoteCopies: f.call } } }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({ openSide: f.open }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return { useApp: create(() => ({ features: new Set<string>(), byHost: {}, hosts: { active: "remote", hosts: [{ id: "remote", kind: "ssh", label: "Remote", conn: { epoch: "epoch-1" } }] } })), featuresOf: (s: { features: Set<string> }) => s.features };
});
import { useApp } from "../src/renderer/src/store";
import { canDownload, dismissCopy, requestCopy, startPrepared, useCopies } from "../src/renderer/src/lib/remoteCopies";
const state: CopyState = { copies: [], settings: { retentionDays: 7, largeFileBytes: 200 * 1024 * 1024 } };
function prepared(size: number) { return { source: { hostId: "remote", hostLabel: "Remote", hostIdentity: "daemon-a", path: "/work/data.bin" }, meta: { name: "data.bin", path: "/work/data.bin", size, modifiedAt: "2026-10-28T00:00:00Z", revision: "a".repeat(64), maxChunkBytes: 4194304 } }; }
beforeEach(() => {
  vi.clearAllMocks(); dismissCopy();
  useCopies.setState({ state, pending: null, busy: false, starting: false, error: null });
  useApp.setState({ features: new Set(["fs-file-transfer-v1"]) });
});
describe("download owner flow", () => {
  it("does not issue an inspect or transfer when the source lacks the capability", async () => {
    useApp.setState({ features: new Set() });
    expect(canDownload("remote")).toBe(false);
    await requestCopy("remote", "/work/data.bin");
    expect(f.call).not.toHaveBeenCalled();
    expect(useCopies.getState().error).toContain("missingFeature");
  });
  it("shows metadata before a large file starts and preserves the observed connection for confirmation", async () => {
    f.call.mockImplementation(async req => req.kind === "inspect" ? prepared(640 * 1024 * 1024) : req.kind === "start" ? "copy-id" : state);
    await requestCopy("remote", "/work/data.bin");
    expect(useCopies.getState().pending?.meta.size).toBe(640 * 1024 * 1024);
    expect(f.call.mock.calls.map(c => c[0].kind)).toEqual(["inspect"]);
    await startPrepared();
    expect(f.call).toHaveBeenCalledWith(expect.objectContaining({ kind: "start", binding: { hostId: "remote", epoch: "epoch-1" }, expected: { revision: "a".repeat(64), size: 640 * 1024 * 1024 } }));
    expect(useCopies.getState().pending).toBeNull();
  });
  it("starts small files only after metadata and preserves explicit workspace scope", async () => {
    f.call.mockImplementation(async req => req.kind === "inspect" ? { ...prepared(5), source: req.source } : req.kind === "start" ? "copy-id" : state);
    await requestCopy("remote", "data.bin", { kind: "project", id: "p-a" });
    expect(f.call.mock.calls.map(c => c[0].kind)).toEqual(["inspect", "start", "list"]);
    expect(f.call.mock.calls[1]![0].source.scope).toEqual({ kind: "project", id: "p-a" });
  });
  it("dismissal fences late metadata, and server refusals do not fall back to another reader", async () => {
    let resolve!: (value: unknown) => void;
    f.call.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const pending = requestCopy("remote", "/work/data.bin");
    dismissCopy(); resolve(prepared(5)); await pending;
    expect(useCopies.getState().pending).toBeNull();
    expect(f.call).toHaveBeenCalledTimes(1);
    f.call.mockRejectedValueOnce(Error("403"));
    await requestCopy("remote", "/work/data.bin");
    expect(f.call).toHaveBeenCalledTimes(2);
    expect(useCopies.getState().error).toContain("403");
  });
  it("refuses refresh when an identically named desktop host now points at another daemon", async () => {
    f.call.mockResolvedValueOnce(prepared(5));
    await requestCopy("remote", "/work/data.bin", undefined, undefined, "old-copy", { ...prepared(5).source, hostIdentity: "previous-daemon" });
    expect(useCopies.getState().error).toContain("offline");
    expect(f.call).toHaveBeenCalledTimes(1);
  });
});
