import { describe, expect, it } from "vitest";
import { pendingWakeLabel, readWakeBusyWait, wakeHintOf } from "../src/renderer/src/lib/wakeBusyWait";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

describe("wake-busy-wait (cutex r220)", () => {
  it("reads agentBus.wakeBusyWaitSecs from /v2/settings", () => {
    expect(readWakeBusyWait({ agentBus: { wakeBusyWaitSecs: 120 } })).toBe(120);
    expect(readWakeBusyWait({ agentBus: { wakeBusyWaitSecs: 0 } })).toBe(0);
    expect(readWakeBusyWait({ agentBus: { wakeBusyWaitSecs: null } })).toBeNull();
    // A negative value means never early, like cutex.
    expect(readWakeBusyWait({ agentBus: { wakeBusyWaitSecs: -1 } })).toBeNull();
    // Older cutex: no agentBus block.
    expect(readWakeBusyWait({})).toBeUndefined();
    expect(readWakeBusyWait(null)).toBeUndefined();
  });

  it("labels a pending wake to a busy agent by what really happens", () => {
    expect(pendingWakeLabel(true, "codex", 120)).toEqual({ key: "busyWait", secs: 120 });
    expect(pendingWakeLabel(true, "codex", 0)).toEqual({ key: "nextStep" });
    expect(pendingWakeLabel(true, "codex", 2.6)).toEqual({ key: "busyWait", secs: 3 });
    // The old 本轮结束后处理: no capability, never early, not loaded yet, a Claude agent.
    expect(pendingWakeLabel(false, "codex", 120)).toEqual({ key: "afterTurn" });
    expect(pendingWakeLabel(true, "codex", null)).toEqual({ key: "afterTurn" });
    expect(pendingWakeLabel(true, "codex", undefined)).toEqual({ key: "afterTurn" });
    expect(pendingWakeLabel(true, "claude", 120)).toEqual({ key: "afterTurn" });
  });

  it("words the 唤醒 tooltip of timeline bus-message rows like the 待读留言 tag", () => {
    const hint = (supported: boolean, runtime: "codex" | "claude", wait: number | null | undefined) => wakeHintOf(pendingWakeLabel(supported, runtime, wait));
    // The configured wait, rounded like the tag; 0 = the next step at once.
    expect(hint(true, "codex", 120)).toEqual({ key: "agentMsg.pending.busyWaitHint", n: 120 });
    expect(hint(true, "codex", 2.6)).toEqual({ key: "agentMsg.pending.busyWaitHint", n: 3 });
    expect(hint(true, "codex", 0)).toEqual({ key: "agentMsg.pending.nextStepHint" });
    // The old after-turn hint: host without the capability, never early (empty / null), setting not loaded, Claude recipient.
    for (const old of [hint(false, "codex", 120), hint(true, "codex", null), hint(true, "codex", undefined), hint(true, "claude", 120)]) {
      expect(old).toEqual({ key: "agentMsg.kind.wakeHint" });
    }
    for (const catalog of [zhCN, en] as Record<string, string>[]) {
      expect(catalog["agentMsg.pending.busyWaitHint"]).toContain("{n}");
      expect(catalog["agentMsg.pending.nextStepHint"]).toBeTruthy();
      expect(catalog["agentMsg.kind.wakeHint"]).toBeTruthy();
    }
  });

  it("ships the label in both locales with the seconds placeholder", () => {
    for (const catalog of [zhCN, en] as Record<string, string>[]) {
      expect(catalog["agentMsg.pending.busyWait"]).toContain("{n}");
      expect(catalog["agentMsg.pending.busyWaitHint"]).toContain("{n}");
      expect(catalog["agentMsg.pending.nextStep"]).toBeTruthy();
      expect(catalog["agentMsg.pending.afterTurn"]).toBeTruthy();
    }
    expect(zhCN["agentMsg.pending.afterTurn"]).toBe("本轮结束后处理");
  });
});
