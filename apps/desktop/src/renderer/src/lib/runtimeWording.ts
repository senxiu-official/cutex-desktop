// Runtime-specific wording of conversation notes. cute-codex agents run a Codex app-server; DSH and Claude agents
// do not, so their notes name their own runtime (r265 D4, D-8).
import type { AgentFeatures } from "./agentFeatures";
import { RUNTIME_LABEL } from "./profileVariants";
import type { MessageKey } from "../i18n";

/** The offline line of an agent that a message starts again (cutex `offline-submit`). */
export function offlineAutoStartNote(runtime: AgentFeatures["runtime"]): { key: "conversation.offlineAutoStart" } | { key: "conversation.offlineAutoStartRuntime"; vars: { runtime: string } } {
  return runtime === "codex" ? { key: "conversation.offlineAutoStart" } : { key: "conversation.offlineAutoStartRuntime", vars: { runtime: RUNTIME_LABEL[runtime] } };
}

/** Revert / edit-and-resend wording: ACP runtimes (DSH, Kimi) revert the conversation only, files stay (r265 D2, r266). */
export interface RevertTexts {
  revertHint: MessageKey;
  revertConfirm: MessageKey;
  editResendHint: MessageKey;
  editResendConfirm: MessageKey;
}

const DEFAULT_REVERT: RevertTexts = { revertHint: "reply.revertHint", revertConfirm: "menu.revertConfirm", editResendHint: "reply.editResendHint", editResendConfirm: "menu.editResendConfirm" };
const RUNTIME_REVERT: Partial<Record<AgentFeatures["runtime"], RevertTexts>> = {
  dsh: { revertHint: "dsh.revertHint", revertConfirm: "dsh.revertConfirm", editResendHint: "dsh.editResendHint", editResendConfirm: "dsh.editResendConfirm" },
  kimi: { revertHint: "kimi.revertHint", revertConfirm: "kimi.revertConfirm", editResendHint: "kimi.editResendHint", editResendConfirm: "kimi.editResendConfirm" },
};

export function revertTexts(runtime: AgentFeatures["runtime"] | null | undefined): RevertTexts {
  return (runtime && RUNTIME_REVERT[runtime]) || DEFAULT_REVERT;
}
