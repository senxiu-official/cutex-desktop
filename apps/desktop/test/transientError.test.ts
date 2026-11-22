// lib/transientError.ts: which failed host reads panels retry by themselves (owner 2026-11-16: the 文件 panel stayed
// on red `git_status_busy: git status is busy; retry shortly` with no reload and no retry).
import { describe, expect, it } from "vitest";
import { errorCode, isTransientError, readIssue, retryDelay, RETRY_BACKOFF_MS } from "../src/renderer/src/lib/transientError";

const ipc = (message: string) => new Error(`Error invoking remote method 'cutex-desktop:invoke': CutexApiError: ${message}`);

describe("transient host read errors", () => {
  it("reads cutex's code from the message, with or without Electron's wrapper", () => {
    expect(errorCode(new Error("git_status_busy: git status is busy; retry shortly"))).toBe("git_status_busy");
    expect(errorCode(ipc("heavy_read_capacity_exceeded: heavy-read wait queue is full; retry shortly"))).toBe("heavy_read_capacity_exceeded");
    expect(errorCode(new Error("Something went wrong: maybe"))).toBeNull();
    expect(errorCode("not an error")).toBeNull();
  });

  it("retries cutex's retryable refusals, any *_busy / *_timeout code and dropped connections", () => {
    for (const message of [
      "git_status_busy: git status is busy; retry shortly",
      "heavy_read_capacity_exceeded: heavy-read admission wait budget expired; retry shortly",
      "admission_busy: x",
      "session_busy: x",
      "history_media_timeout: x",
      "cutex management API unreachable at http://127.0.0.1:24270 (ECONNRESET)",
      "fetch failed (UND_ERR_SOCKET)",
    ]) {
      expect(isTransientError(new Error(message)), message).toBe(true);
      expect(isTransientError(ipc(message)), message).toBe(true);
    }
  });

  it("does not retry what waiting will not fix", () => {
    for (const message of ["path_not_found: no such file", "git_failed: fatal: not a git repository", "workspace_root_too_broad: x", "route_not_found: x", "git status is busy; retry shortly"]) {
      expect(isTransientError(new Error(message)), message).toBe(false);
    }
  });

  it("backs off 1, 2, 5, 10, then every 30 s", () => {
    expect(RETRY_BACKOFF_MS).toEqual([1000, 2000, 5000, 10000, 30000]);
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000]);
  });

  it("an issue keeps the raw text for the tooltip, without Electron's wrapper", () => {
    expect(readIssue(ipc("git_status_busy: git status is busy; retry shortly"))).toEqual({ code: "git_status_busy", detail: "git_status_busy: git status is busy; retry shortly", retrying: true });
    expect(readIssue(new Error("git_failed: bad"))).toEqual({ code: "git_failed", detail: "git_failed: bad", retrying: false });
  });
});
