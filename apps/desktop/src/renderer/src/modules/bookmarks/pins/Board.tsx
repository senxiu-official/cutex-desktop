// 备忘 · 要处理: list, shared by the side card, the desktop widget and the conversation's tool strip: open pins by kind
// (要你定 → 要你做 → 记一下), each with the agent, its age, its links and one-click 完成; 不用了 / 重新钉上 / 删除 in ⋯;
// 回到原处 jumps to the turn it was pinned in. Resolved pins fold under 「已处理 · N」.
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CornerUpLeft, Link2, MoreHorizontal, Pin } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { Markdown } from "../../../components/Markdown";
import { CountBadge } from "../../../components/Tag";
import { useI18n, type MessageKey } from "../../../i18n";
import { openMenuFrom, contextMenu, type MenuEntry } from "../../../lib/contextMenu";
import { turnRef } from "../../../lib/refs";
import { formatAbsolute, formatWhen, useClock } from "../../../lib/time";
import { useApp } from "../../../store";
import { services } from "../../app";
import { KIND_ICON, KIND_TONE } from "./calls";
import { openByKind, pinRows, resolvedRows, rowKey, type PinRow } from "./model";
import { changePin, usePins } from "./store";


function jump(row: PinRow) {
  const { hostId, pin } = row;
  const name = pin.agentName ?? pin.agentId;
  if (pin.turnId) void services.refs.open(turnRef({ hostId, sessionId: pin.agentId, turnId: pin.turnId, agentName: name }), { how: "jump" });
  else services.agents.open(pin.agentId);
}

function PinRowView({ row, compact }: { row: PinRow; compact?: boolean }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const { hostId, pin } = row;
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const hostName = useApp((s) => s.hosts?.hosts?.find((h) => h.id === hostId)?.label ?? hostId);
  const open = pin.state === "open";
  const Icon = KIND_ICON[pin.kind];
  const created = Date.parse(pin.createdAt) / 1000;
  const menu = (): MenuEntry[] => [
    { label: t("bookmarks.memo.jump"), onSelect: () => jump(row) },
    "separator",
    open ? { label: t("bookmarks.memo.drop"), onSelect: () => void changePin(hostId, pin.pinId, { state: "dropped" }) } : { label: t("bookmarks.memo.reopen"), onSelect: () => void changePin(hostId, pin.pinId, { state: "open" }) },
    { label: t("bookmarks.memo.remove"), danger: true, armed: t("bookmarks.memo.removeArmed"), onSelect: () => void changePin(hostId, pin.pinId, { delete: true }) },
  ];
  return (
    <div className="group flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-hover" onContextMenu={contextMenu(menu)} data-owner-pin={pin.pinId}>
      <Icon size={14} className={`mt-0.5 shrink-0 ${open ? KIND_TONE[pin.kind] : "text-subtle opacity-60"}`} aria-label={t(`bookmarks.memo.kind.${pin.kind}` as MessageKey)} />
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => jump(row)} title={t("bookmarks.memo.jump")}>
        <span className={`line-clamp-2 break-words text-xs ${open ? "text-foreground" : "text-subtle line-through decoration-subtle/50"}`}>{pin.title}</span>
        {!compact && pin.detail && open && <span className="line-clamp-3 break-words whitespace-pre-wrap text-caption/[inherit] text-muted">{pin.detail}</span>}
        <span className="flex min-w-0 items-center gap-1 text-caption/[inherit] text-subtle">
          <Avatar name={pin.agentName ?? pin.agentId} seed={pin.agentId} size={16} />
          <span className="min-w-0 truncate">{pin.agentName ?? pin.agentId}</span>
          {hostId !== focus && <span className="shrink-0">· {t("bookmarks.memo.otherHost", { host: hostName })}</span>}
          <span className="shrink-0" title={Number.isFinite(created) ? formatAbsolute(created) : undefined}>· {Number.isFinite(created) ? formatWhen(created, now, locale) : ""}</span>
          {!open && <span className="shrink-0">· {t(`bookmarks.memo.state.${pin.state}` as MessageKey)}{pin.resolvedBy === "agent" ? ` (${t("bookmarks.memo.by.agent")})` : ""}</span>}
        </span>
        {!open && pin.resolution && !compact && <span className="line-clamp-2 text-caption/[inherit] text-subtle">「{pin.resolution}」</span>}
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        {open && (
          <button type="button" className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-success" aria-label={t("bookmarks.memo.done")} title={t("bookmarks.memo.done")} onClick={() => void changePin(hostId, pin.pinId, { state: "done" })} data-owner-pin-done="">
            <Check size={13} />
          </button>
        )}
        {!open && (
          <button type="button" className="rounded p-1 text-subtle opacity-0 hover:bg-surface-2 hover:text-foreground group-hover:opacity-100" aria-label={t("bookmarks.memo.reopen")} title={t("bookmarks.memo.reopen")} onClick={() => void changePin(hostId, pin.pinId, { state: "open" })}>
            <CornerUpLeft size={13} />
          </button>
        )}
        <button type="button" className="rounded p-1 text-subtle opacity-0 hover:bg-surface-2 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t("gutter.more")} title={t("gutter.more")} onClick={(e) => openMenuFrom(e.currentTarget, menu())}>
          <MoreHorizontal size={13} />
        </button>
      </span>
    </div>
  );
}

/** Links go through the app's Markdown (artifacts, files on the agent's host, web pages open the usual way). */
function Links({ row }: { row: PinRow }) {
  if (row.pin.state !== "open" || row.pin.links.length === 0) return null;
  const text = row.pin.links.map((l) => `[${(l.label ?? l.target).replace(/[[]]/g, "")}](<${l.target.replace(/[<>]/g, "")}>)`).join(" · ");
  return (
    <div className="-mt-1 mb-1 ml-8 flex min-w-0 items-start gap-1 text-caption/[inherit] text-muted" data-owner-pin-links="">
      <Link2 size={11} className="mt-1 shrink-0" />
      <div className="min-w-0 flex-1 [&_p]:my-0"><Markdown text={text} compact /></div>
    </div>
  );
}

/** The board: `agentId` limits it to one agent; `max` caps the open rows (the widget); `compact` hides details and links. */
export function PinBoard({ agentId, max, compact, showResolved = true }: { agentId?: string | null; max?: number; compact?: boolean; showResolved?: boolean }) {
  const { t } = useI18n();
  const byHost = usePins((s) => s.byHost);
  const rows = useMemo(() => pinRows(byHost, agentId), [byHost, agentId]);
  const groups = useMemo(() => openByKind(rows), [rows]);
  const resolved = useMemo(() => resolvedRows(rows), [rows]);
  const [showDone, setShowDone] = useState(false);
  let budget = max ?? Infinity;
  let hidden = 0;
  if (groups.length === 0 && (!showResolved || resolved.length === 0))
    return (
      <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center" data-owner-pins-empty="">
        <Pin size={18} className="text-subtle" aria-hidden />
        <p className="text-xs text-muted">{t(agentId ? "bookmarks.memo.agentEmpty" : "bookmarks.memo.empty", { board: t("bookmarks.memo.title") })}</p>
        {!agentId && <p className="text-caption/[inherit] text-subtle">{t("bookmarks.memo.emptyHint")}</p>}
      </div>
    );
  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const shown = g.rows.slice(0, Math.max(0, budget));
        hidden += g.rows.length - shown.length;
        budget -= shown.length;
        if (!shown.length) return null;
        return (
          <section key={g.kind} className="space-y-0.5">
            <h3 className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-caption/[inherit] font-medium text-subtle">
              {t(`bookmarks.memo.kind.${g.kind}` as MessageKey)}
              <CountBadge count={g.rows.length} tone={g.kind === "note" ? "neutral" : "accent"} />
            </h3>
            {shown.map((r) => (
              <div key={rowKey(r)}>
                <PinRowView row={r} compact={compact} />
                {!compact && <Links row={r} />}
              </div>
            ))}
          </section>
        );
      })}
      {hidden > 0 && <p className="px-2 pt-1 text-caption/[inherit] text-subtle">{t("bookmarks.memo.more", { n: hidden })}</p>}
      {showResolved && resolved.length > 0 && (
        <section className="space-y-0.5 pt-1">
          <button type="button" className="flex items-center gap-1 px-2 py-1 text-caption/[inherit] text-subtle hover:text-foreground" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t("bookmarks.memo.resolved", { n: resolved.length })}
          </button>
          {showDone && resolved.slice(0, 50).map((r) => <PinRowView key={rowKey(r)} row={r} compact={compact} />)}
        </section>
      )}
    </div>
  );
}
