import { describe, expect, it, vi } from "vitest";
import { agentFeaturesOf, CODEX_FEATURES } from "../src/renderer/src/lib/agentFeatures";
import { structuralBlock, structuralRefusal } from "../src/renderer/src/lib/structuralGate";
import { runSlash, SLASH_COMMANDS, slashUnavailable, type SlashContext } from "../src/renderer/src/lib/slashCommands";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const claude = agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset", capabilities: { features: { fork: true, historyRevert: true } } } } });

// claude-r21: fork while busy (adapter feature forkWhileBusy).
const claudeR21 = agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset", capabilities: { features: { fork: true, historyRevert: true, forkWhileBusy: true } } } } });

describe("structuralBlock", () => {
  it("blocks fork / revert only for a busy Claude agent without forkWhileBusy", () => {
    expect(structuralBlock(claude, true, "fork")).toBe("claudeBusy");
    expect(structuralBlock(claude, true, "revert")).toBe("claudeBusy");
    expect(structuralBlock(claude, false, "fork")).toBeNull();
    expect(structuralBlock(claude, false, "revert")).toBeNull();
  });

  it("lets a busy Claude agent with forkWhileBusy fork, but revert still waits for idle", () => {
    expect(structuralBlock(claudeR21, true, "fork")).toBeNull();
    expect(structuralBlock(claudeR21, true, "revert")).toBe("claudeBusyRevert");
    expect(structuralBlock(claudeR21, false, "revert")).toBeNull();
    // Only an explicit true counts.
    const unknown = agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset", capabilities: { features: { forkWhileBusy: null } } } } });
    expect(structuralBlock(unknown, true, "fork")).toBe("claudeBusy");
  });

  it("never blocks a Codex agent (cutex forks a busy one, interrupts before reverting)", () => {
    for (const op of ["fork", "revert"] as const) {
      expect(structuralBlock(CODEX_FEATURES, true, op)).toBeNull();
      expect(structuralBlock(CODEX_FEATURES, false, op)).toBeNull();
    }
    // A Codex map with forkWhileBusy changes nothing.
    expect(structuralBlock({ runtime: "codex", map: { forkWhileBusy: false } }, true, "revert")).toBeNull();
  });
});

describe("structuralRefusal", () => {
  // What reaches the renderer: main's CutexApiError over IPC, cutex wrapping the adapter's -32009.
  const ipc = (code: string, text: string) => new Error(`Error invoking remote method 'cutex-desktop:invoke': CutexApiError: ${code}: app-server request failed with -32009: ${text}`);

  it("recognises the adapter's busy refusals of revert and fork", () => {
    expect(structuralRefusal(ipc("history_revert_failed", "interrupt the active turn before changing session history"))).toBe("activeTurn");
    expect(structuralRefusal(ipc("session_fork_failed", "interrupt the active turn before changing session history"))).toBe("activeTurn");
    expect(structuralRefusal(ipc("session_fork_failed", "finish or explicitly clear queued inputs and notes before changing session history"))).toBe("queued");
    expect(structuralRefusal("history_revert_failed: finish or explicitly clear queued inputs and notes before changing session history")).toBe("queued");
  });

  it("recognises claude-r21's retryable busy-fork refusal", () => {
    expect(structuralRefusal(ipc("session_fork_failed", "the running turn has just started; retry in a moment"))).toBe("transcriptBehind");
    expect(structuralRefusal(ipc("session_fork_failed", "the native transcript has not caught up with the selected turn yet; retry in a moment"))).toBe("transcriptBehind");
    expect(structuralRefusal("session_fork_failed: native_transcript_behind")).toBe("transcriptBehind");
  });

  it("leaves other errors alone", () => {
    expect(structuralRefusal(ipc("history_revert_failed", "native history mapping changed"))).toBeNull();
    expect(structuralRefusal(new Error("session_offline: agent is offline"))).toBeNull();
    expect(structuralRefusal(null)).toBeNull();
  });
});

describe("/fork on a busy Claude agent", () => {
  const fork = SLASH_COMMANDS.find((c) => c.id === "fork")!;
  const features = new Set(["session-fork"]);

  it("is unavailable while busy, available when idle; Codex is unaffected", () => {
    expect(slashUnavailable(fork, features, claude, true)).toBe("claudeBusy");
    expect(slashUnavailable(fork, features, claude, false)).toBeUndefined();
    expect(slashUnavailable(fork, features, claude)).toBeUndefined();
    expect(slashUnavailable(fork, features, CODEX_FEATURES, true)).toBeUndefined();
    // Only fork is structural: the other commands don't care about busy.
    expect(SLASH_COMMANDS.filter((c) => slashUnavailable(c, features, claude, true) === "claudeBusy").map((c) => c.id)).toEqual(["fork"]);
    // A cutex gap / unsupported feature still wins.
    expect(slashUnavailable(fork, new Set(), claude, true)).toBe("forkGap");
    const noFork = agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset", capabilities: { features: { fork: false } } } } });
    expect(slashUnavailable(fork, features, noFork, true)).toBe("agentUnsupported");
  });

  it("is available on a busy claude-r21 agent (forkWhileBusy)", () => {
    expect(slashUnavailable(fork, features, claudeR21, true)).toBeUndefined();
  });

  it("says why instead of forking", async () => {
    const notify = vi.fn();
    const forkFn = vi.fn();
    const ctx = { online: true, hasGoal: false, planActive: false, features, agent: claude, busy: true, notify, fork: forkFn } as unknown as SlashContext;
    await runSlash("fork", "", ctx);
    expect(forkFn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("structural.claudeBusy");
    await runSlash("fork", "", { ...ctx, busy: false });
    expect(forkFn).toHaveBeenCalledTimes(1);
  });

  it("has the texts in both locales", () => {
    for (const key of ["structural.claudeBusy", "structural.claudeBusyRevert", "structural.busyHint", "structural.refused.activeTurn", "structural.refused.queued", "structural.refused.transcriptBehind", "slash.unavailable.claudeBusy"] as const) {
      expect(zhCN[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});
