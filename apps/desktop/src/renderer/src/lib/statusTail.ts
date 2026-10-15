// The status tail of a sidebar agent row (right end of its first line): one system, three tiers.
//   attention — the owner has to do something (需要你 / 待审核 / 待审批 / 有提问 / 出错 …). Colour budget
//               (owner 2026-10-14, lib/statusChips chipTone): a filled pill only for 出错 (danger) and a
//               pending decision (等待确认 / 有提问 / 待审批: warn); the rest (待审核 / 待验收 / 结果未知 /
//               owner messages) is muted text after a small warn dot (tone quiet);
//   activity  — something is happening (运行中): a dot (pulsing while running) + short muted text;
//               a bare dot only with a tooltip;
//   passive   — nothing to do (完成, 空闲, 离线, 连接中): muted text (完成, else the last activity).
// Pure, so it is unit-tested (statusTail.test.ts); components/AgentStatus renders it.
import type { AgentSignal, NeedsYou } from "./agentAttention";
import { chipTone } from "./statusChips";

export type TailTier = "attention" | "activity" | "passive";

export function tailTier(signal: AgentSignal): TailTier {
  switch (signal) {
    case "needsYou":
    case "error":
      return "attention";
    case "running":
      return "activity";
    default:
      return "passive";
  }
}

export type StatusTail =
  /** `tone`: danger for 出错, warn for a pending decision, quiet for the other needs-you reasons. */
  | { tier: "attention"; tone: "warn" | "danger" | "quiet" }
  /** `since`: start of the running turn (ms), null when unknown (dot only, text in the tooltip). */
  | { tier: "activity"; kind: "running"; since: number | null }
  /** `done`: the 完成 text; `lastActivity`: the relative time of the last activity. */
  | { tier: "passive"; kind: "done" | "lastActivity" };

export function statusTail(signal: AgentSignal, since: number | null = null, needs?: NeedsYou): StatusTail {
  switch (tailTier(signal)) {
    case "attention": {
      const tone = chipTone(signal, needs);
      return { tier: "attention", tone: tone === "error" ? "danger" : tone === "urgent" ? "warn" : "quiet" };
    }
    case "activity":
      return { tier: "activity", kind: "running", since };
    default:
      return { tier: "passive", kind: signal === "done" ? "done" : "lastActivity" };
  }
}

/**
 * Text of an attention pill when the row is short of room (状态标签 简略 / 自动): needs-you shrinks to
 * its count (「3」, 「9+」), still a filled pill with the full label in its tooltip; 出错 keeps its
 * label (already short). Null: no shorter form (use the full label).
 */
export function compactAttentionText(signal: AgentSignal, needs: NeedsYou | undefined): string | null {
  if (signal !== "needsYou") return null;
  const count = Math.max(1, needs?.count ?? 1);
  return count > 9 ? "9+" : String(count);
}
