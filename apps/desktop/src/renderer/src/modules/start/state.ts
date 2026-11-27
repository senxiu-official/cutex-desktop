// 接下来可以试试 (onboarding v3): after the first message from 开始使用, the agent it went to gets a card of next things
// to try at the top of its conversation. Per device (localStorage), like the guides' seen state. Collapsed = a chip;
// dismissed = gone until 帮助 → 开始使用 brings it back. Also the sample project's agent, so 打开示例项目 reopens it.
import { useSyncExternalStore } from "react";

export type TryNextItem = "side" | "delegate" | "device" | "assistant" | "customize";
export const TRY_NEXT_ITEMS: readonly TryNextItem[] = ["side", "delegate", "device", "assistant", "customize"];

export interface AgentRef {
  hostId: string;
  sessionId: string;
}

export interface StartState {
  /** The agent the first message went to (where 接下来可以试试 shows); null = none yet. */
  agent: AgentRef | null;
  collapsed: boolean;
  dismissed: boolean;
  /** Items the owner finished. */
  done: TryNextItem[];
  /** The sample project's agent per host. */
  sample: Record<string, string>;
}

export const START_KEY = "cutex-desktop.start";
const EMPTY: StartState = { agent: null, collapsed: false, dismissed: false, done: [], sample: {} };

function isRef(v: unknown): v is AgentRef {
  return !!v && typeof v === "object" && typeof (v as AgentRef).hostId === "string" && typeof (v as AgentRef).sessionId === "string";
}

function load(): StartState {
  try {
    const raw = JSON.parse(localStorage.getItem(START_KEY) ?? "null") as Partial<StartState> | null;
    if (!raw || typeof raw !== "object") return EMPTY;
    const sample = raw.sample && typeof raw.sample === "object" ? Object.fromEntries(Object.entries(raw.sample).filter(([, v]) => typeof v === "string")) : {};
    return {
      agent: isRef(raw.agent) ? { hostId: raw.agent.hostId, sessionId: raw.agent.sessionId } : null,
      collapsed: raw.collapsed === true,
      dismissed: raw.dismissed === true,
      done: Array.isArray(raw.done) ? raw.done.filter((x): x is TryNextItem => TRY_NEXT_ITEMS.includes(x as TryNextItem)) : [],
      sample,
    };
  } catch {
    return EMPTY;
  }
}

let state = load();
const listeners = new Set<() => void>();

function save(next: StartState): void {
  state = next;
  try {
    localStorage.setItem(START_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: kept for this run
  }
  listeners.forEach((l) => l());
}

export function getStartState(): StartState {
  return state;
}

export function useStartState(): StartState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => state,
  );
}

/** The first message went to `agent`: 接下来可以试试 shows there, open. */
export function noteFirstAgent(agent: AgentRef): void {
  save({ ...state, agent, collapsed: false, dismissed: false });
}

export function setTryNextCollapsed(collapsed: boolean): void {
  save({ ...state, collapsed });
}

export function dismissTryNext(): void {
  save({ ...state, dismissed: true });
}

/** 帮助 → 开始使用: shown again, open. */
export function reopenTryNext(): void {
  save({ ...state, dismissed: false, collapsed: false });
}

export function markTryNextDone(item: TryNextItem): void {
  if (!state.done.includes(item)) save({ ...state, done: [...state.done, item] });
}

/** Whether `agent` is where 接下来可以试试 shows (open or as its chip). */
export function tryNextFor(s: StartState, hostId: string, sessionId: string): boolean {
  return !s.dismissed && !!s.agent && s.agent.hostId === hostId && s.agent.sessionId === sessionId;
}

export function rememberSample(hostId: string, sessionId: string): void {
  save({ ...state, sample: { ...state.sample, [hostId]: sessionId } });
}

/** Tests: read storage again. */
export function reloadStartState(): void {
  state = load();
  listeners.forEach((l) => l());
}
