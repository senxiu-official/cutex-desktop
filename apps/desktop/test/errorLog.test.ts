import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const fs = vi.hoisted(() => ({
  appendFileSync: vi.fn(), mkdirSync: vi.fn(), renameSync: vi.fn(), statSync: vi.fn(),
  appendFile: vi.fn(), mkdir: vi.fn(), rename: vi.fn(), stat: vi.fn(),
}));
vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs);
vi.mock("electron", () => ({ app: { getPath: () => "/test/userData", getVersion: () => "test-version" } }));

let logError: (typeof import("../src/main/errorLog"))["logError"];
beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  fs.mkdir.mockResolvedValue(undefined);
  fs.stat.mockResolvedValue({ size: 0 });
  fs.rename.mockResolvedValue(undefined);
  fs.appendFile.mockResolvedValue(undefined);
  fs.statSync.mockReturnValue({ size: 0 });
  ({ logError } = await import("../src/main/errorLog"));
});

describe("nonblocking send diagnostic logging", () => {
  it("uses asynchronous I/O for main and renderer reports and retains ordinary error behavior", async () => {
    logError({ source: "send-latency", method: "daemon-submit", message: "slow stage", elapsedMs: 1500 });
    logError({ source: "renderer", kind: "reported", message: "renderer send trace" });
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.statSync).not.toHaveBeenCalled();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fs.appendFile).toHaveBeenCalledTimes(2));
    const line = fs.appendFile.mock.calls[0]![1] as string;
    expect(JSON.parse(line)).toMatchObject({ source: "send-latency", method: "daemon-submit", message: "slow stage", elapsedMs: 1500, version: "test-version" });
    logError({ source: "renderer", kind: "error", message: "renderer crash" });
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  });

  it("serializes diagnostic writes and rotates the existing bounded log", async () => {
    let release!: () => void;
    fs.appendFile.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    fs.stat.mockResolvedValueOnce({ size: 3 * 1024 * 1024 });
    logError({ source: "send-latency", message: "first" });
    logError({ source: "send-latency", message: "second" });
    await vi.waitFor(() => expect(fs.appendFile).toHaveBeenCalledTimes(1));
    expect(fs.rename).toHaveBeenCalledExactlyOnceWith(join("/test/userData", "logs", "errors.jsonl"), join("/test/userData", "logs", "errors.1.jsonl"));
    expect(fs.mkdir).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(fs.appendFile).toHaveBeenCalledTimes(2));
    expect(fs.appendFile.mock.calls.map((call) => JSON.parse(call[1] as string).message)).toEqual(["first", "second"]);
  });

  it("continues after a write failure and keeps repeat suppression", async () => {
    fs.appendFile.mockRejectedValueOnce(new Error("disk unavailable"));
    logError({ source: "send-latency", message: "first" });
    logError({ source: "send-latency", message: "first" });
    logError({ source: "send-latency", message: "second" });
    await vi.waitFor(() => expect(fs.appendFile).toHaveBeenCalledTimes(2));
    expect(fs.appendFile.mock.calls.map((call) => JSON.parse(call[1] as string).message)).toEqual(["first", "second"]);
  });

  it("bounds reports queued behind a slow filesystem", async () => {
    let release!: () => void;
    fs.mkdir.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    for (let n = 0; n < 140; n++) logError({ source: "send-latency", message: `stage-${n}` });
    await vi.waitFor(() => expect(fs.mkdir).toHaveBeenCalledTimes(1));
    expect(fs.appendFile).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(fs.appendFile).toHaveBeenCalledTimes(128));
    logError({ source: "send-latency", message: "after queue drains" });
    await vi.waitFor(() => expect(fs.appendFile).toHaveBeenCalledTimes(129));
  });
});
