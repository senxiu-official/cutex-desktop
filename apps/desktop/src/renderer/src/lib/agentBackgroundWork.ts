import type { SessionRuntime } from "@cutex-desktop/protocol";
import { showsRunningRing, type AgentSignal } from "./agentAttention";

export const BACKGROUND_WORK_FEATURE = "session-background-work";

/** The busy ring owns foreground work; disconnected/stale rows carry no live signal. */
export function showsBackgroundWork(runtime: SessionRuntime, signal: AgentSignal, supported: boolean): boolean {
  return supported && signal !== "offline" && signal !== "unknown"
    && runtime.status === "online" && runtime.appServerConnected
    && !showsRunningRing(signal, { runtime }) && runtime.backgroundWork?.running === true;
}
