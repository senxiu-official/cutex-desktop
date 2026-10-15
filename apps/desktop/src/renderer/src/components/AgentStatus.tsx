// Sidebar v2 status visuals: avatar with the running ring / grey offline look, and the row's status
// tail in three tiers (lib/statusTail): attention pills (需要你 / 待审核 / 出错 …), the running dot +
// elapsed time, passive muted text. Rules live in lib/agentAttention and lib/statusTail.
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { compactAttentionText, statusTail } from "../lib/statusTail";
import { useI18n } from "../i18n";
import { formatElapsed, type AgentSignal, type NeedsYou } from "../lib/agentAttention";
import { signalLabel, useNow } from "../lib/attentionView";
import { Avatar } from "./Avatar";

/** `running`: ring even when another signal wins (a running agent that also needs the owner). */
export function StatusAvatar({ name, initial, color, avatar, size, signal, running, seed }: { name: string; initial?: string; color?: string | null; avatar?: SessionAvatar | null; seed?: string | null; size: number; signal: AgentSignal; running?: boolean }) {
  const { t } = useI18n();
  const offline = signal === "offline";
  // Not confirmed yet (lib/sidebar `unknown`): dimmed, with a hollow grey dot — 「连接中」, not offline.
  const unknown = signal === "unknown";
  const dot = Math.max(5, Math.round(size * 0.32));
  return (
    <span className={`relative inline-flex shrink-0 ${offline ? "opacity-50 grayscale" : unknown ? "opacity-60" : ""}`} title={unknown ? t("status.unknown") : undefined} data-status-unknown={unknown ? "" : undefined}>
      <Avatar name={name} initial={initial} color={color} avatar={avatar} seed={seed} size={size} />
      {(running ?? signal === "running") && <span className="agent-ring" aria-hidden />}
      {unknown && (
        <span role="img" aria-label={t("status.unknown")} className="absolute -right-0.5 -bottom-0.5 rounded-full border-[1.5px] border-subtle bg-background" style={{ width: dot, height: dot }} />
      )}
    </span>
  );
}

const ATTENTION: Record<"warn" | "danger", string> = { warn: "bg-warn text-background", danger: "bg-danger text-background" };
/** Attention pill (lib/statusTail tier attention, tones warn / danger); tone quiet = dot + muted text. */
const PILL = "inline-flex h-4 shrink-0 items-center rounded-full px-1.5 text-[10px] leading-4 font-semibold whitespace-nowrap tabular-nums";
/** Muted tail text: 运行中 time, 完成, last activity. Fixed line box so the row never changes height. */
const TAIL_TEXT = "inline-flex h-4 shrink-0 items-center text-[11px] leading-4 whitespace-nowrap tabular-nums";

/**
 * The tail of a row that wants the owner: needs-you / 出错 = an attention pill (lib/statusTail), 完成 =
 * muted text; null for anything else. `compact` (状态标签 简略 / 自动 short of room): needs-you shows
 * only its count, still a filled pill, the full text in the tooltip / aria-label. `fit`: a sidebar row
 * measuring for 状态标签 自动 — the tail sits in a `data-fit-chip` slot with an invisible copy of the
 * full pill (`data-fit-measure`).
 */
export function StatusPill({ signal, needs, className = "", compact = false, fit = false }: { signal: AgentSignal; needs?: NeedsYou; className?: string; compact?: boolean; fit?: boolean }) {
  const { t } = useI18n();
  const label = signalLabel(t, signal, needs);
  if (!label) return null;
  const tail = statusTail(signal, null, needs);
  let pill;
  if (tail.tier === "attention" && tail.tone === "quiet") {
    const short = compact ? compactAttentionText(signal, needs) : null;
    pill = (
      <span data-tail-tier="attention" data-tail-tone="quiet" title={short ? label : undefined} aria-label={short ? label : undefined} role={short ? "img" : undefined} className={`${TAIL_TEXT} gap-1 text-muted ${className}`}>
        <span aria-hidden className="size-1.5 rounded-full bg-warn" />
        {short ?? label}
      </span>
    );
  } else if (tail.tier === "attention") {
    const short = compact ? compactAttentionText(signal, needs) : null;
    pill = (
      <span data-tail-tier="attention" data-tail-tone={tail.tone} title={short ? label : undefined} aria-label={short ? label : undefined} role={short ? "img" : undefined} className={`${PILL} ${ATTENTION[tail.tone === "danger" ? "danger" : "warn"]} ${className}`}>
        {short ?? label}
      </span>
    );
  } else if (tail.tier === "passive" && tail.kind === "done") {
    pill = <span data-tail-tier="passive" className={`${TAIL_TEXT} text-muted ${className}`}>{label}</span>;
  } else return null;
  if (!fit) return pill;
  return (
    <span data-fit-chip="" className="relative flex shrink-0">
      <span data-fit-measure="" aria-hidden className={`pointer-events-none invisible absolute top-0 right-0 ${PILL}`}>
        {label}
      </span>
      {pill}
    </span>
  );
}

/**
 * Running elapsed time (ticks every second for the first minute, then every 15 s). `dot`: the
 * activity-tier tail of a sidebar row (pulsing dot + 「4m」).
 */
export function RunningTime({ since, className = "", dot = false }: { since: number; className?: string; dot?: boolean }) {
  const { t } = useI18n();
  const young = Date.now() - since < 60_000;
  const now = useNow(young ? 1000 : 15_000);
  const text = formatElapsed(now - since);
  return (
    <span data-tail-tier={dot ? "activity" : undefined} className={`${dot ? `${TAIL_TEXT} gap-1` : "shrink-0 text-[10px]"} text-muted tabular-nums ${className}`} title={t("agentStatus.runningFor", { time: text })}>
      {dot && <RunningDot />}
      {text}
    </span>
  );
}

/** The activity dot (pulses while running; reduced motion: still). */
export function RunningDot({ title }: { title?: string }) {
  return <span aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title} title={title} className="size-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />;
}

/** Passive tail text (last activity, 离线 …). */
export function PassiveText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span data-tail-tier="passive" className={`${TAIL_TEXT} text-subtle ${className}`}>
      {text}
    </span>
  );
}
