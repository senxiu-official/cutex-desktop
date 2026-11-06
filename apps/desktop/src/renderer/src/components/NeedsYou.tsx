// 需要你 (owner 2026-11-05): the tray's 通知中心 button, the bell in the status row and the one list both open
// (lib/needsYouView). The tray button is always there, dim at 0; the bell shows only when something waits, as a
// status-row chip of the same height (no avatars, no role words), so the composer under it never moves. The list is a
// floating panel (design 040 浮层: rounded-inner, shadow-e2) opened away from the tray's edge, at most a page of rows
// (lib/needsYouPage); each row is avatar · name (「就在这里」 when it is on screen) and the reason in a few words.
// A row opens the agent where its need is handled (lib/attentionActivate); × hides it until its need changes.
import { useRef, useState, type RefObject } from "react";
import { Bell, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "../i18n";
import { activateAttention } from "../lib/attentionActivate";
import { ALL_HOSTS } from "../lib/hostScope";
import { dismissNeed, dismissRuntimeError, runtimeErrorFingerprint } from "../lib/needsYouDismiss";
import { traySide, type PanelSide } from "../lib/anchoredPanel";
import { needsPage } from "../lib/needsYouPage";
import { needReason, useNeedsYouView, type NeedItem } from "../lib/needsYouView";
import { usePanes } from "../lib/paneStore";
import { useUiPrefs } from "../lib/prefs";
import { useSide } from "../lib/sideLayoutStore";
import { markSeenOn } from "../lib/turnUnread";
import { setViewScope } from "../lib/useHostScope";
import { isOnScreen } from "../lib/workspaces";
import { AnchoredPanel } from "./AnchoredPanel";
import { StatusAvatar } from "./AgentStatus";
import { HostMark } from "./HostMark";
import { CountBadge, Tag } from "./Tag";

/** The tray's 通知中心: always shown; at 0 a dim bell without a number. */
export function TrayNeedsYou({ onUsed }: { onUsed(): void }) {
  const { t } = useI18n();
  const { items } = useNeedsYouView();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const n = items.length;
  const label = t("tray.needsYou", { n });
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-tray-item=""
        data-tray-needs=""
        data-empty={n === 0 ? "" : undefined}
        className="tray-needs"
        data-tip={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} strokeWidth={1.75} aria-hidden />
        {n > 0 && <CountBadge count={n} className="absolute -top-1 -right-1" />}
      </button>
      {open && <NeedsYouList anchor={trigger} side={traySide(trigger.current)} onClose={() => setOpen(false)} onUsed={onUsed} />}
    </>
  );
}

/** The bell in the status row: a chip like 「委托 2 ›」, only while something waits. Settings → 外观 keeps its switch. */
export function NeedsYouBell() {
  const { t } = useI18n();
  const { needsYouStrip } = useUiPrefs();
  const { items } = useNeedsYouView();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const n = items.length;
  if (!needsYouStrip || n === 0) return null;
  const label = t("tray.needsYou", { n });
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-needs-you-bell=""
        data-tip={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 shrink-0 self-start items-center gap-1 rounded-ctl px-1.5 text-xs font-medium tabular-nums text-warn-text hover:bg-attention-soft ${open ? "bg-attention-soft" : ""}`}
      >
        <Bell size={13} strokeWidth={1.75} aria-hidden />
        {n}
      </button>
      {open && <NeedsYouList anchor={trigger} side="above" onClose={() => setOpen(false)} />}
    </>
  );
}

export function NeedsYouList({ anchor, side, onClose, onUsed }: { anchor: RefObject<HTMLElement | null>; side: PanelSide; onClose(): void; onUsed?(): void }) {
  const { t } = useI18n();
  const { items, elsewhere, scope } = useNeedsYouView();
  // 「就在这里」 follows the panes and Shelves.
  usePanes((s) => s.layout);
  useSide((s) => s.layout);
  const [requested, setPage] = useState(0);
  const { page, pages, rows } = needsPage(items, requested);
  const open = (item: NeedItem) => {
    activateAttention(item.chip, item.need, item.host);
    onClose();
    onUsed?.();
  };
  const dismiss = (item: NeedItem) => {
    if (item.chip.signal === "needsYou") return dismissNeed(item.key, item.need);
    const fp = runtimeErrorFingerprint(item.row?.session.runtime);
    if (fp) dismissRuntimeError(item.key, fp);
    markSeenOn(item.host, item.chip.id);
  };
  const label = t("needsYou.label");

  return (
    <AnchoredPanel anchor={anchor} side={side} label={t("tray.needsYou", { n: items.length })} onClose={onClose} data-needs-list="">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="text-ui font-semibold">{label}</span>
        {items.length > 0 && <CountBadge count={items.length} />}
      </div>
      <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
        {rows.length === 0 && <p className="px-1.5 py-3 text-meta text-muted">{t("tray.needsEmpty")}</p>}
        {rows.map((item) => (
          <Row key={item.key} item={item} scopeMarks={scope.showHostMarks ? scope.host(item.host) : null} onOpen={() => open(item)} onDismiss={() => dismiss(item)} />
        ))}
      </div>
      {elsewhere > 0 && (
        <button
          type="button"
          onClick={() => {
            void setViewScope(ALL_HOSTS);
            onClose();
          }}
          data-tip={t("needsYou.otherHostsHint", { n: elsewhere })}
          className="mx-1.5 mb-1.5 flex h-7 shrink-0 items-center rounded-ctl px-2 text-meta text-warn-text hover:bg-attention-soft"
        >
          {t("needsYou.otherHosts", { n: elsewhere })}
        </button>
      )}
      {pages > 1 && (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-border px-1.5 text-meta text-muted">
          <button type="button" aria-label={t("tray.needsPrevious")} disabled={page === 0} onClick={() => setPage(page - 1)} className="flex size-6 items-center justify-center rounded-chip hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronLeft size={14} />
          </button>
          <span aria-live="polite" className="tabular-nums">{t("tray.needsPage", { page: page + 1, pages })}</span>
          <button type="button" aria-label={t("tray.needsNext")} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="flex size-6 items-center justify-center rounded-chip hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </AnchoredPanel>
  );
}

function Row({ item, scopeMarks, onOpen, onDismiss }: { item: NeedItem; scopeMarks: Parameters<typeof HostMark>[0]["host"] | null | undefined; onOpen(): void; onDismiss(): void }) {
  const { t } = useI18n();
  const { chip, row } = item;
  const here = isOnScreen({ kind: "agent", hostId: item.host, key: chip.id });
  const reason = needReason(t, item);
  const approvalsOnly = chip.signal === "needsYou" && item.need?.reasons.length === 1 && item.need.reasons[0] === "approval";
  return (
    <div data-need={item.key} className="group relative flex h-11 items-center rounded-ctl hover:bg-hover has-[:focus-visible]:bg-hover">
      <button
        type="button"
        data-need-row=""
        data-panel-row=""
        onClick={onOpen}
        data-tip={approvalsOnly ? t("needsYou.openApprovals") : `${chip.name} · ${reason}`}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-ctl pr-8 pl-1.5 text-left outline-none"
      >
        {row ? (
          <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={28} signal="idle" />
        ) : (
          <span className="size-7 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{chip.name}</span>
            {scopeMarks && <HostMark host={scopeMarks} dotOnly />}
            {here && <Tag tone="accent">{t("tray.needsHere")}</Tag>}
          </span>
          <span className={`truncate text-meta ${chip.signal === "error" ? "text-danger" : "text-warn-text"}`}>{reason}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("needsYou.dismiss")}
        data-tip={t("needsYou.dismiss")}
        className="absolute right-1.5 flex size-6 items-center justify-center rounded-chip text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}
