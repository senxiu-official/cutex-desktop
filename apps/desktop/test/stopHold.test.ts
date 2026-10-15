// 停止 holds everything (cutex stop-holds-ridealongs): which ride-alongs are held and why, how the
// asks pause reads (已随停止暂停 vs 暂停委托) and which resume it offers, and the words in both locales.
import { describe, expect, it } from "vitest";
import type { AdmissionNextStep, AsksPause } from "@cutex-desktop/protocol";
import { asksPauseKind, asksPausedKeys, heldKeys, rideAlongHeld, splitHeld, stopHeld } from "../src/renderer/src/lib/stopHold";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const step = (id: string, deliveryKind: string, held?: AdmissionNextStep["held"]): AdmissionNextStep => ({ id, deliveryKind, enqueuedAt: "2026-10-12T00:00:00Z", ...(held ? { held } : {}) });
const pause = (origin: AsksPause["origin"], stopHold?: boolean): AsksPause => ({ since: "2026-10-12T00:00:00Z", by: "owner", origin, ...(stopHold === undefined ? {} : { stopHold }) });

describe("stop hold state", () => {
  it("older cutex (no fields): nothing held, an explicit pause reads as before", () => {
    expect(stopHeld(null)).toBe(false);
    expect(stopHeld(pause("ownerPause"))).toBe(false);
    expect(stopHeld(pause("legacy"))).toBe(false);
    expect(asksPauseKind(pause("ownerPause"))).toBe("owner");
    expect(asksPauseKind(pause("legacy"))).toBe("owner");
    expect(asksPauseKind(null)).toBeNull();
    const items = [step("a", "answer"), step("b", "bus")];
    expect(splitHeld(items, {})).toEqual({ free: items, held: [] });
    expect(splitHeld(items, null)).toEqual({ free: items, held: [] });
  });

  it("a stop hold: origin ownerStop, or stopHold on an explicit pause", () => {
    expect(stopHeld(pause("ownerStop", true))).toBe(true);
    expect(stopHeld(pause("ownerStop"))).toBe(true);
    expect(stopHeld(pause("ownerPause", true))).toBe(true);
    expect(asksPauseKind(pause("ownerStop", true))).toBe("stop");
    // A stop on an explicit 暂停委托 keeps reading as 暂停委托 (queue resume ends only the stop hold).
    expect(asksPauseKind(pause("ownerPause", true))).toBe("owner");
  });

  it("held ride-alongs: their own `held`, else the snapshot-wide stop hold", () => {
    expect(rideAlongHeld(step("a", "answer", "ownerPause"), {})).toBe("ownerPause");
    expect(rideAlongHeld(step("b", "bus"), { ridealongsHeld: "ownerStop" })).toBe("ownerStop");
    expect(rideAlongHeld(step("c", "alarm", "ownerStop"), {})).toBe("ownerStop");
    expect(rideAlongHeld(step("d", "tell"), {})).toBeUndefined();
  });

  it("splits free / held, stop group before the delegation-pause group, order kept", () => {
    const items = [step("p1", "answer", "ownerPause"), step("f1", "bus"), step("s1", "tell", "ownerStop"), step("s2", "alarm", "ownerStop"), step("f2", "alarm")];
    const { free, held } = splitHeld(items, {});
    expect(free.map((i) => i.id)).toEqual(["f1", "f2"]);
    expect(held.map((g) => [g.reason, g.items.map((i) => i.id)])).toEqual([
      ["ownerStop", ["s1", "s2"]],
      ["ownerPause", ["p1"]],
    ]);
  });
});

describe("labels", () => {
  it("held groups: 已随停止暂停 / 委托已暂停", () => {
    expect(zhCN[heldKeys("ownerStop").strip]).toBe("已随停止暂停");
    expect(zhCN[heldKeys("ownerPause").strip]).toBe("委托已暂停");
    expect(en[heldKeys("ownerStop").strip]).toBe("Held by stop");
    expect(zhCN[heldKeys("ownerStop").hint]).toContain("继续发送");
  });

  it("the asks-paused section: a stop hold offers 继续发送 (queue resume); 暂停委托 offers 继续 (asks resume)", () => {
    const stop = asksPausedKeys(pause("ownerStop", true));
    expect(stop.resume).toBe("queue");
    expect(zhCN[stop.title]).toBe("委托已随停止暂停");
    expect(zhCN[stop.button]).toBe("继续发送");
    expect(zhCN[stop.buttonHint]).toContain("全部");
    const owner = asksPausedKeys(pause("ownerPause"));
    expect(owner).toMatchObject({ title: "asksPause.title", hint: "asksPause.titleHint", button: "asksPause.resumeShort", resume: "asks" });
    expect(asksPausedKeys(pause("ownerPause", true)).hint).toBe("asksPause.titleHintStop");
  });

  it("a closed runtime gate (runtime-gate-pause): 已暂停：上一轮被中断，工具效果不确定 · 恢复 (asks resume)", () => {
    const gate = pause("runtimeGate", false);
    expect(asksPauseKind(gate)).toBe("gate");
    expect(stopHeld(gate)).toBe(false);
    const keys = asksPausedKeys(gate);
    expect(keys.resume).toBe("asks");
    expect(zhCN[keys.title]).toBe("已暂停：上一轮被中断，工具效果不确定");
    expect(zhCN[keys.button]).toBe("恢复");
    expect(en[keys.title]).toBe("Paused: the last turn was interrupted, tool effects uncertain");
    expect(en[keys.button]).toBe("Resume");
  });
});
