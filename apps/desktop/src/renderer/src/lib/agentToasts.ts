// Small cards in one agent's conversation (「demo-writer 发布了 doodle.html · 查看」, 「Reader 想给你看：… · 打开」):
// memory only, per host + agent, newest last, a few at most, each gone after a while or on dismiss.
// Modules push them; their `conversation.overlay` renders their own (components/AgentToasts.tsx), all
// into one stack above the composer. Not owner_notify: no OS notification, nothing persisted.
// Hovering / focusing a card holds its timer (holdAgentToast); leaving gives it the time it had left,
// at least a few seconds to finish reading (releaseAgentToast).
import { create } from "zustand";

export type AgentToastIcon = "artifact" | "service";
export interface AgentToast {
  id: string;
  /** The module that renders it (its overlay shows only its own). */
  owner: string;
  hostId: string;
  sessionId: string;
  icon: AgentToastIcon;
  text: string;
  action?: { label: string; run(): void };
  /** Dedupe: a toast with the same key replaces the older one (a republish, a repeated reveal). */
  key?: string;
}

const MAX_PER_AGENT = 3;
export const AGENT_TOAST_MS = 20_000;

export const useAgentToasts = create<{ toasts: AgentToast[] }>(() => ({ toasts: [] }));

/** Time a released card gets at least, so it does not vanish the moment the pointer leaves. */
export const AGENT_TOAST_RELEASE_MS = 4_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** When each timed card is due (ms since epoch), and what was left of a held card. */
const due = new Map<string, number>();
const held = new Map<string, number>();
let seq = 0;

function arm(id: string, ms: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  due.set(id, Date.now() + ms);
  timers.set(id, setTimeout(() => dismissAgentToast(id), ms));
}

export function dismissAgentToast(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  due.delete(id);
  held.delete(id);
  useAgentToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function pushAgentToast(toast: Omit<AgentToast, "id">, ms = AGENT_TOAST_MS): string {
  const id = `toast-${++seq}`;
  const same = (t: AgentToast) => t.hostId === toast.hostId && t.sessionId === toast.sessionId;
  const replaced = useAgentToasts.getState().toasts.filter((t) => toast.key && t.key === toast.key && same(t));
  for (const t of replaced) dismissAgentToast(t.id);
  useAgentToasts.setState((s) => {
    const mine = s.toasts.filter(same);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - (MAX_PER_AGENT - 1))).map((t) => t.id));
    for (const old of drop) {
      const timer = timers.get(old);
      if (timer) clearTimeout(timer);
      timers.delete(old);
      due.delete(old);
      held.delete(old);
    }
    return { toasts: [...s.toasts.filter((t) => !drop.has(t.id)), { ...toast, id }] };
  });
  if (ms > 0) arm(id, ms);
  return id;
}

/** Pointer / focus on the card: stop its timer (a card without one stays as it is). */
export function holdAgentToast(id: string): void {
  const timer = timers.get(id);
  const at = due.get(id);
  if (!timer || at === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
  due.delete(id);
  held.set(id, Math.max(0, at - Date.now()));
}

/** Pointer / focus left: the time it had left, but at least AGENT_TOAST_RELEASE_MS. */
export function releaseAgentToast(id: string): void {
  const left = held.get(id);
  if (left === undefined) return;
  held.delete(id);
  if (!useAgentToasts.getState().toasts.some((t) => t.id === id)) return;
  arm(id, Math.max(left, AGENT_TOAST_RELEASE_MS));
}

/** Drop every toast of a module (it stopped). */
export function clearAgentToasts(owner: string): void {
  for (const t of useAgentToasts.getState().toasts) if (t.owner === owner) dismissAgentToast(t.id);
}
