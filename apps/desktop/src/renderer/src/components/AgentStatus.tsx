// Sidebar v2 status visuals: avatar with its status (components/Avatar `status`), and the row's status
// tail in three tiers (lib/statusTail): attention pills (需要你 / 待审核 / 出错 …), the running dot +
// elapsed time, passive muted text. Rules live in lib/agentAttention and lib/statusTail.
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { compactAttentionText, statusTail } from "../lib/statusTail";
import { useI18n } from "../i18n";
import { formatElapsed, type AgentSignal, type NeedsYou } from "../lib/agentAttention";
import { signalLabel, useNow } from "../lib/attentionView";
import { Avatar } from "./Avatar";
import { avatarPresence, type AvatarBadge } from "../lib/avatarStatus";
import { Tag, type TagTone } from "./Tag";

/** An agent avatar with its status (docs/design/040 §3.1): maps a sidebar signal onto Avatar `status` — the
 *  running ring, grey when offline, the hollow dot while unknown. `running`: ring even when another signal wins
 *  (a running agent that also needs the owner). `badge`: the corner badge (lib/avatarStatus avatarBadge); sites
 *  that show the request elsewhere (a row's 需要你 pill) leave it out. `minor`: a list row (Avatar `minor`). */
export function StatusAvatar({ name, initial, color, avatar, size, signal, running, seed, minor, badge }: { name: string; initial?: string; color?: string | null; avatar?: SessionAvatar | null; seed?: string | null; size: number; signal: AgentSignal; running?: boolean; minor?: boolean; badge?: AvatarBadge | null }) {
  return <Avatar name={name} initial={initial} color={color} avatar={avatar} seed={seed} size={size} minor={minor} status={{ running: running ?? signal === "running", badge, presence: avatarPresence(signal) }} />;
}

const ATTENTION: Record<"warn" | "danger", TagTone> = { warn: "attention", danger: "danger" };
/** Attention pill (lib/statusTail tier attention, tones warn / danger) is a Tag (design 040); tone quiet = dot + muted text. */
/** Muted tail text: 运行中 time, 完成, last activity. Fixed line box so the row never changes height. */
const TAIL_TEXT = "inline-flex h-4 shrink-0 items-center text-caption/[inherit] leading-4 whitespace-nowrap tabular-nums";

/**
 * The tail of a row that wants the owner: needs-you / 出错 = an attention pill (lib/statusTail), 完成 =
 * muted text; null for anything else. `compact` (状态标签 简略 / 自动 short of room): needs-you shows
 * only its count, still a filled pill, the full text in the tooltip / aria-label. `fit`: a sidebar row
 * measuring for 状态标签 自动 — the tail sits in a `data-fit-chip` slot with an invisible copy of the
 * full pill (`data-fit-measure`).
 */
export function StatusPill({ signal, needs, className = "", compact = false, fit = false, plain = false }: { signal: AgentSignal; needs?: NeedsYou; className?: string; compact?: boolean; fit?: boolean; plain?: boolean }) {
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
  } else if (tail.tier === "attention" && plain) {
    // Design 040 §3.1: the request is on the avatar (corner badge, with the count); beside it only the reason, as text.
    if (compact) return null;
    const word = signal === "needsYou" && (needs?.count ?? 0) > 1 ? t("agentStatus.needsYou") : label;
    pill = (
      <span data-tail-tier="attention" data-tail-tone={tail.tone} data-tail-plain="" className={`${TAIL_TEXT} font-medium ${tail.tone === "danger" ? "text-danger" : "text-warn-text"} ${className}`}>
        {word}
      </span>
    );
  } else if (tail.tier === "attention") {
    const short = compact ? compactAttentionText(signal, needs) : null;
    pill = (
      <Tag tone={ATTENTION[tail.tone === "danger" ? "danger" : "warn"]} data-tail-tier="attention" data-tail-tone={tail.tone} title={short ? label : undefined} aria-label={short ? label : undefined} role={short ? "img" : undefined} className={`tabular-nums ${className}`}>
        {short ?? label}
      </Tag>
    );
  } else if (tail.tier === "passive" && tail.kind === "done") {
    pill = <span data-tail-tier="passive" className={`${TAIL_TEXT} text-muted ${className}`}>{label}</span>;
  } else return null;
  if (!fit) return pill;
  return (
    <span data-fit-chip="" className="relative flex shrink-0">
      <Tag tone={ATTENTION[tail.tier === "attention" && tail.tone === "danger" ? "danger" : "warn"]} data-fit-measure="" aria-hidden className="pointer-events-none invisible absolute top-0 right-0 tabular-nums">
        {label}
      </Tag>
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
    <span data-tail-tier={dot ? "activity" : undefined} className={`${dot ? `${TAIL_TEXT} gap-1` : "shrink-0 text-caption/[inherit]"} text-muted tabular-nums ${className}`} title={t("agentStatus.runningFor", { time: text })}>
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
