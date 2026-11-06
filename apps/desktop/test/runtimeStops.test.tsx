// @vitest-environment jsdom
// r276 runtime-stop-requested-by: an interrupted turn's end mark says who asked for the stop (an agent's
// command, the agent's own, the owner, the cutex CLI) instead of a bare 已中断; older hosts keep 已中断.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { recordRuntimeStop, runtimeStopOf, stopOfTurn, useRuntimeStops, useTurnStop, RUNTIME_STOP_REQUESTED_BY_FEATURE } from "../src/renderer/src/lib/runtimeStops";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const ON = new Set([RUNTIME_STOP_REQUESTED_BY_FEATURE]);
const OFF = new Set<string>();
const AT = "2026-11-04T10:00:00.000Z";
const SEC = Date.parse(AT) / 1000;
const event = (method: string, params: Record<string, unknown>, session = "cutex.me"): EventEnvelope =>
  ({ cutexSessionId: session, receivedAt: AT, correlation: {}, cutex: { method, params: { occurredAt: AT, ...params } } }) as unknown as EventEnvelope;

describe("who asked for a runtime stop", () => {
  it("names another agent, the agent itself, the CLI and the owner", () => {
    const other = { kind: "agent", runtimeAgentId: "claude.x", cutexSessionId: "cutex.other", name: "chief-maple" };
    expect(runtimeStopOf(event("cutex/runtime/closing", { reason: "cutex_cli", requestedBy: other }), ON)?.by).toEqual({ kind: "agent", name: "chief-maple" });
    expect(runtimeStopOf(event("cutex/runtime/closing", { reason: "cutex_cli", requestedBy: { ...other, cutexSessionId: "cutex.me" } }), ON)?.by).toEqual({ kind: "self" });
    // An agent cutex could not resolve: its runtime id.
    expect(runtimeStopOf(event("cutex/runtime/closed", { reason: "cutex_cli", requestedBy: { kind: "agent", runtimeAgentId: "claude.gone" } }), ON)?.by).toEqual({ kind: "agent", name: "claude.gone" });
    expect(runtimeStopOf(event("cutex/runtime/closing", { reason: "cutex_cli" }), ON)?.by).toEqual({ kind: "cli" });
    expect(runtimeStopOf(event("cutex/runtime/offlineRequested", {}), ON)?.by).toEqual({ kind: "owner" });
    expect(runtimeStopOf(event("cutex/runtime/offline", { reason: "owner_requested" }), ON)?.by).toEqual({ kind: "owner" });
    expect(runtimeStopOf(event("cutex/runtime/closing", {}), ON)?.at).toBe(SEC);
  });
  it("says nothing for other reasons, other events and hosts without the capability", () => {
    expect(runtimeStopOf(event("cutex/runtime/offlineRequested", { reason: "desktop runtime package run" }), ON)).toBeNull();
    expect(runtimeStopOf(event("cutex/runtime/onlineRequested", {}), ON)).toBeNull();
    expect(runtimeStopOf(event("cutex/runtime/closing", { reason: "cutex_cli", requestedBy: { kind: "agent", runtimeAgentId: "a" } }), OFF)).toBeNull();
    expect(runtimeStopOf(event("cutex/runtime/offlineRequested", {}), OFF)).toBeNull();
  });
  it("matches the turn it cut off, not an older one", () => {
    const stop = { at: SEC, by: { kind: "owner" as const } };
    expect(stopOfTurn(stop, { startedAt: SEC - 30, completedAt: SEC + 1 })).toBe(stop);
    expect(stopOfTurn(stop, { startedAt: SEC - 30, completedAt: SEC - 3 })).toBe(stop);
    expect(stopOfTurn(stop, { startedAt: SEC - 600, completedAt: SEC - 300 })).toBeNull();
    expect(stopOfTurn(stop, { startedAt: SEC + 10, completedAt: SEC + 20 })).toBeNull();
    expect(stopOfTurn(stop, { startedAt: null, completedAt: null })).toBeNull();
    expect(stopOfTurn(undefined, { startedAt: SEC, completedAt: SEC })).toBeNull();
  });
  it("ships the labels in zh-CN and en", () => {
    expect(zhCN["conversation.turnStoppedBy.agent"]).toBe("已中断 · 停止：由 {name} 的命令发起");
    for (const kind of ["agent", "self", "owner", "cli"] as const) {
      expect(zhCN[`conversation.turnStoppedBy.${kind}`]).toMatch(/^已中断 · 停止：/);
      expect(en[`conversation.turnStoppedBy.${kind}`]).toMatch(/^Interrupted · /);
    }
  });
});

let root: Root | undefined; let box: HTMLDivElement;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let seen: ReturnType<typeof useTurnStop> = null;
function Probe() { seen = useTurnStop("local", "cutex.me", { startedAt: SEC - 10, completedAt: SEC }); return null; }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; box?.remove(); useRuntimeStops.setState({ byKey: {} }); });

describe("the stop store", () => {
  it("records the stop per host and agent, keeping the requested event's time", () => {
    box = document.createElement("div"); document.body.append(box); root = createRoot(box);
    act(() => root!.render(h(Probe)));
    expect(seen).toBeNull();
    const requester = { kind: "agent", runtimeAgentId: "claude.me", cutexSessionId: "cutex.me", name: "me" };
    act(() => recordRuntimeStop("local", event("cutex/runtime/closing", { reason: "cutex_cli", requestedBy: requester }), ON));
    expect(seen?.by).toEqual({ kind: "self" });
    const first = useRuntimeStops.getState().byKey;
    act(() => recordRuntimeStop("local", { ...event("cutex/runtime/closed", { reason: "cutex_cli", requestedBy: requester }), cutex: { method: "cutex/runtime/closed", params: { occurredAt: "2026-11-04T10:00:04.000Z", reason: "cutex_cli", requestedBy: requester } } } as EventEnvelope, ON));
    expect(useRuntimeStops.getState().byKey).toBe(first);
    // Another host's agent with the same id is separate; an older host records nothing.
    act(() => recordRuntimeStop("remote", event("cutex/runtime/offlineRequested", {}), OFF));
    expect(Object.keys(useRuntimeStops.getState().byKey)).toHaveLength(1);
  });
});
