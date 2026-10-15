/** Cutex-owned ephemeral Side state. Native events never enter the parent's durable feed. */
export interface SideEvent { seq: number; method: string; params?: unknown }
export interface SidePendingRequest { id: string | number; method: string; params?: unknown }
export interface SideChat {
  id: string;
  sessionId: string;
  threadId: string;
  anchorTurnId: string | null;
  lastTurnId: string | null;
  forkedThroughTurnId: string | null;
  runtimeGeneration: number;
  status: "opening" | "ready" | "running" | "closed" | "stale";
  createdAt: string;
  updatedAt: string;
  activeTurnId: string | null;
  revision: number;
  events: SideEvent[];
  pendingRequests: SidePendingRequest[];
  truncated: boolean;
  model: string | null;
  effort: string | null;
}
export interface SideOpenInput { anchorTurnId?: string; lastTurnId?: string; model?: string }
/** Expected refusals whose structured details must survive Electron IPC. */
export type SideOpenResult = { chat: SideChat } | { error: {
  code: "side_chat_already_open"; message: string; details: { chatId: string; anchorTurnId: string | null };
} } | { error: SideForkBlocked };
/**
 * The parent still has an unfinished External Input obligation (cutex `side_fork_blocked_external_input`,
 * natives up to r52.1): `busy` = it is working on a message or ask (wait), `held` = a message is held and
 * needs an owner retry. Counts only; cutex never sends message bodies here.
 */
export interface SideForkBlocked {
  code: "side_fork_blocked_external_input"; message: string;
  details: { blockedBy: "busy" | "held"; asks: number; messages: number };
}
export const SIDE_FORK_BLOCKED = "side_fork_blocked_external_input";
export interface SideMessageInput { text: string; clientMessageId: string }
export type SideReply = { result: unknown } | { error: { code: number; message: string } };
export const SIDE_CHAT_CAPABILITY = "side-chat";
export const SIDE_MESSAGE_LIMIT = 64_000;
