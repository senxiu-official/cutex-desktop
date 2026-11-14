// @vitest-environment jsdom
// Registry 1.1/1.5: the countdown is a row-end add-on of state afterWork (timed: '{time} 内发送'); it changes the label,
// never the buttons. useWakeOverride gives the row's state / variant / time / ring; this probe prints them.
import { act, createElement as h, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionNextStep, InputWakeSchedule } from "@cutex-desktop/protocol";

const world = vi.hoisted(() => ({
  nextStep: [] as unknown[],
  ridealongsHeld: undefined as string | undefined,
  delivery: "turn",
  runtime: "codex",
  features: null as Record<string, unknown> | null,
  now: 0,
  active: [] as boolean[],
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (state: unknown) => unknown) => select({}), { getState: () => ({}) }),
  viewOf: () => ({ admission: { nextStep: world.nextStep, ridealongsHeld: world.ridealongsHeld } }),
  agentState: () => ({ delivery: { state: world.delivery } }),
  sidebarOf: () => null, featuresOf: () => new Set(), selectedFeatures: () => new Set(), agentHost: () => "h",
}));
vi.mock("../src/renderer/src/lib/viewHost", () => ({ viewRow: () => ({}), rowsOf: () => [] }));
vi.mock("../src/renderer/src/lib/agentList", () => ({ runtimeOf: () => world.runtime }));
vi.mock("../src/renderer/src/lib/agentFeatures", () => ({ agentFeaturesOf: () => ({ map: world.features }) }));
vi.mock("../src/renderer/src/lib/visibleNow", () => ({ useVisibleNow: (_ref: unknown, active: boolean) => (world.active.push(active), world.now) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key), locale: "en" }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useAgentHost: () => "h", useAgentNames: () => (id: string) => id }));
import { useWakeOverride } from "../src/renderer/src/components/AdmissionRows";

function Probe(props: { record: Parameters<typeof useWakeOverride>[0] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const o = useWakeOverride(props.record, "s", "h", ref);
  const schedule = o.state === "held" || o.state === "paused" ? "held" : o.variant === "timed" ? "countdown" : o.state === "awaitingRead" ? "readPoint" : null;
  return h("span", { ref, "data-testid": schedule ? "wake-countdown" : "plain", "data-wake-schedule": schedule ?? undefined, "data-state": o.state ?? "", "data-time": o.time ?? "" }, o.symbol, schedule === "held" ? h("span", { "data-testid": "timing-held" }) : null, o.time ? `time:${o.time}` : "");
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const queued = Date.parse("2026-11-10T10:00:00.000Z");
const wake = (patch: Partial<AdmissionNextStep> = {}): AdmissionNextStep => ({
  id: "msg-1", deliveryKind: "bus", enqueuedAt: new Date(queued).toISOString(), timing: "afterTurn", nextStepAt: new Date(queued + 120_000).toISOString(), ...patch,
});
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let record: { inputId: string; createdAt: string; wakeSchedule?: InputWakeSchedule; state: "waiting"; kind: "agentMessage" };
const show = () => act(() => root.render(h(Probe, { record })));
const plain = () => expect(container.querySelector("[data-testid=plain]")).not.toBeNull();
const el = () => container.querySelector("[data-testid=wake-countdown]");

beforeEach(() => {
  record = { inputId: "msg-1", createdAt: new Date(queued).toISOString(), state: "waiting", kind: "agentMessage" };
  Object.assign(world, { nextStep: [wake()], ridealongsHeld: undefined, delivery: "turn", runtime: "codex", features: null, now: queued + 15_000, active: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ledger wake countdown", () => {
  it("shows the server deadline as ring + afterWork timed {time} and ticks only while counting", () => {
    show();
    expect(el()?.getAttribute("data-wake-schedule")).toBe("countdown");
    expect(el()?.getAttribute("data-state")).toBe("afterWork");
    expect(container.textContent).toContain("time:1:45");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(world.active.at(-1)).toBe(true);
  });

  it("past the deadline: awaitingRead, and the clock stops", () => {
    world.now = queued + 121_000;
    show();
    expect(el()?.getAttribute("data-wake-schedule")).toBe("readPoint");
    expect(el()?.getAttribute("data-state")).toBe("awaitingRead");
    world.nextStep = [wake({ timing: "nextStep", nextStepAt: null })];
    world.active = [];
    show();
    expect(el()?.getAttribute("data-wake-schedule")).toBe("readPoint");
    expect(world.active.at(-1)).toBe(false);
  });

  it("a Claude recipient counts only with native external input", () => {
    world.runtime = "claude";
    show();
    expect(el()).toBeNull();
    plain();
    world.features = { externalInput: true };
    show();
    expect(el()?.getAttribute("data-wake-schedule")).toBe("countdown");
  });

  it("no countdown (the row keeps its own status): other record, no deadline, idle agent, DSH, native receipt pending", () => {
    for (const set of [
      () => (world.nextStep = [wake({ id: "other" })]),
      () => (world.nextStep = [wake({ nextStepAt: null })]),
      () => (world.nextStep = []),
      () => (world.delivery = "idle"),
      () => (world.runtime = "dsh"),
      () => (world.nextStep = [wake({ waitReason: "nativeReceipt" })]),
    ]) {
      Object.assign(world, { nextStep: [wake()], delivery: "turn", runtime: "codex", active: [] });
      set();
      show();
      plain();
      expect(world.active.every((a) => !a)).toBe(true);
    }
  });

  it("held by an owner stop or 暂停委托: held / paused, no ring", () => {
    world.nextStep = [wake({ held: "ownerPause" })];
    show();
    expect(container.querySelector("[data-testid=timing-held]")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(world.active.at(-1)).toBe(false);
    world.nextStep = [wake()];
    world.ridealongsHeld = "ownerStop";
    show();
    expect(container.querySelector("[data-testid=timing-held]")).not.toBeNull();
  });

  describe("the record's own wakeSchedule wins over the ride-along", () => {
    const ws = (patch: Partial<InputWakeSchedule> = {}): InputWakeSchedule => ({ nextStepAt: new Date(queued + 60_000).toISOString(), waitSecs: 60, capability: "soon", timing: "afterTurn", ...patch });

    it("counts to its nextStepAt, even with no ride-along and on a runtime the fallback rule says can't", () => {
      world.nextStep = [];
      world.runtime = "claude";
      record.wakeSchedule = ws();
      show();
      expect(container.textContent).toContain("time:0:45");
      // Its own deadline, not the ride-along's 2-minute one.
      world.nextStep = [wake()];
      show();
      expect(container.textContent).toContain("time:0:45");
    });

    it("timing nextStep: 等待插入时机; capability afterTurn / none or a frozen after-turn note: the row's own status", () => {
      record.wakeSchedule = ws({ timing: "nextStep", nextStepAt: null });
      show();
      expect(el()?.getAttribute("data-wake-schedule")).toBe("readPoint");
      for (const patch of [{ capability: "afterTurn" }, { capability: "none" }, { nextStepAt: null }, { nextStepAt: null, waitSecs: null }] as Partial<InputWakeSchedule>[]) {
        record.wakeSchedule = ws(patch);
        world.active = [];
        show();
        plain();
        expect(world.active.every((a) => !a)).toBe(true);
      }
    });

    it("held: 已暂停, also for a hold this desktop doesn't know", () => {
      for (const held of ["ownerStop", "somethingNew"]) {
        record.wakeSchedule = ws({ held });
        show();
        expect(container.querySelector("[data-testid=timing-held]")).not.toBeNull();
        expect(container.querySelector("svg")).toBeNull();
      }
    });
  });
});
