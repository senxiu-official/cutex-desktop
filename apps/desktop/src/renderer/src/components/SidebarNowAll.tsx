// Sidebar layout B 「现在 / 全部」 (design 040 §4 B, step 14; Settings → 左侧栏 → 侧栏布局). The upper half 「现在」: one
// card per agent that needs the owner (avatar 36 · name · one line · a direct button — 回复 / 批准… / 回答 / 打开 —
// which opens where that is done, as the card does: lib/attentionActivate), longest waiting first, then the agents
// open in the conversation columns (左 / 右 with two); at most NOW_MAX cards, the rest behind 「还有 N」 (lib/nowCards).
// A card keeps its place until its own event changes; cards come and go with a height + opacity transition
// (--motion-medium). The lower half 「全部」 is the roster in compact rows (lib/allRowsCompact) with a filter, drawn by
// components/Sidebar; the divider between them is dragged (or moved with ↑ / ↓) and its place kept in prefs.
// No icon row of its own: the entries are in the window bar (sidebar v5, §4.1). What was closed in the 需要你 strip
// (a need, a runtime error: lib/needsYouDismiss chipDismissed) has no card here either.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { attentionChips, formatElapsed, type AttentionChip } from "../lib/agentAttention";
import { activateAttention } from "../lib/attentionActivate";
import { signalLabel, useNow, type Attention } from "../lib/attentionView";
import { openMenuFrom } from "../lib/contextMenu";
import { hostKey } from "../lib/hostKeys";
import { chipDismissed, needFingerprint, useDismissals } from "../lib/needsYouDismiss";
import { nowCards, stableOrder, type NowCard, type SinceMemo } from "../lib/nowCards";
import { conversationPanes, paneBinding } from "../lib/paneLayout";
import { usePanes } from "../lib/paneStore";
import { clampNowHeight, getUiPrefs, NOW_HEIGHT, setUiPref } from "../lib/prefs";
import { rowKey, type AgentRow } from "../lib/sidebar";
import { turnMarksOn } from "../lib/turnUnread";
import { useApp } from "../store";
import { StatusAvatar } from "./AgentStatus";
import { btn } from "./Button";
import { CountBadge, Tag } from "./Tag";

const LEAVE_MS = 240;

/** Items plus the ones that just left (kept LEAVE_MS at their old place, `leaving`), for the exit transition. */
function usePresence<T extends { key: string }>(items: readonly T[]): (T & { leaving?: boolean })[] {
  const [, rerender] = useState(0);
  const prev = useRef<readonly T[]>(items);
  const gone = useRef(new Map<string, { item: T; index: number; timer: ReturnType<typeof setTimeout> }>());
  const keys = new Set(items.map((i) => i.key));
  prev.current.forEach((item, index) => {
    if (keys.has(item.key) || gone.current.has(item.key)) return;
    const timer = setTimeout(() => {
      gone.current.delete(item.key);
      rerender((n) => n + 1);
    }, LEAVE_MS);
    gone.current.set(item.key, { item, index, timer });
  });
  for (const [key, g] of gone.current) {
    if (!keys.has(key)) continue;
    clearTimeout(g.timer);
    gone.current.delete(key);
  }
  prev.current = items;
  useEffect(() => () => gone.current.forEach((g) => clearTimeout(g.timer)), []);
  const out: (T & { leaving?: boolean })[] = [...items];
  for (const g of [...gone.current.values()].sort((a, b) => a.index - b.index)) out.splice(Math.min(g.index, out.length), 0, { ...g.item, leaving: true });
  return out;
}

const ACTION_KEY: Record<NonNullable<NowCard["action"]>, MessageKey> = { reply: "sidebar.now.act.reply", answer: "sidebar.now.act.answer", approve: "sidebar.now.act.approve", open: "sidebar.now.act.open" };

function NowCardView({ card, row, attention, since, leaving, own, onActivate }: { card: NowCard; row: AgentRow; attention: Attention; since: number | null; leaving?: boolean; own: boolean; onActivate(): void }) {
  const { t } = useI18n();
  // The last message, one line (the focus host's agents; only this card re-renders when it changes).
  const preview = useApp((s) => (own ? s.activity?.[row.id]?.text : undefined));
  const now = useNow(30_000, since !== null);
  const signal = attention.signals.get(card.key) ?? "idle";
  const need = attention.needs.get(card.key);
  const status = card.chip ? signalLabel(t, card.chip.signal, need) : null;
  const line = [status, preview].filter(Boolean).join(" · ");
  const name = row.name;
  return (
    <div
      data-now-card={card.key}
      data-leaving={leaving ? "" : undefined}
      aria-hidden={leaving || undefined}
      onClick={onActivate}
      className="now-card group/now flex shrink-0 cursor-pointer items-center gap-2.5 rounded-card bg-surface p-2 hover:bg-hover"
    >
      <StatusAvatar name={name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={32} signal={signal} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" tabIndex={leaving ? -1 : 0} onClick={(e) => (e.stopPropagation(), onActivate())} className="min-w-0 truncate text-left text-ui font-semibold text-foreground outline-none focus-visible:underline">
            {name}
          </button>
          {card.column && <Tag data-now-column={card.column}>{t(card.column === "left" ? "sidebar.now.left" : "sidebar.now.right")}</Tag>}
          {since !== null && <span className="ml-auto shrink-0 text-caption text-subtle tabular-nums" title={t("sidebar.now.waiting")}>{formatElapsed(now - since)}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-meta ${card.chip ? "text-foreground" : "text-muted"}`}>{line || (card.open ? t("sidebar.now.open") : "")}</span>
          {card.action && (
            <button type="button" tabIndex={leaving ? -1 : 0} data-now-action={card.action} onClick={(e) => (e.stopPropagation(), onActivate())} className={`${btn({ variant: card.action === "approve" ? "primary" : "secondary", size: "sm" })} h-[22px]`}>
              {t(ACTION_KEY[card.action])}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 「现在」: header (现在 · count · 按等待时间), `notice` (the abnormal-shutdown line), the cards, 「还有 N」. `focus`: the
 * focus host (rows without a host are its).
 */
export function NowSection({ attention, focus, height, notice }: { attention: Attention; focus: string; height: number; notice?: ReactNode }) {
  const { t } = useI18n();
  const { rows, signals, needs, marks } = attention;
  const layout = usePanes((s) => s.layout);
  const byKey = useMemo(() => new Map(rows.map((r) => [rowKey(r), r])), [rows]);
  const byHostKey = useMemo(() => new Map(rows.map((r) => [hostKey(r.hostId ?? focus, r.id), r])), [rows, focus]);
  const dismissals = useDismissals();
  const chips = useMemo(() => {
    const markOf = (row: AgentRow) => ((row.hostId ?? focus) === focus ? marks[row.id] : turnMarksOn(row.hostId!)[row.id]);
    return attentionChips(rows, signals, needs, markOf, null).filter((c) => {
      if (c.signal === "done") return false;
      const key = hostKey(c.hostId ?? focus, c.id);
      const row = byHostKey.get(key);
      return !chipDismissed(dismissals, key, c, needs.get(c.key), row, !!(row && markOf(row)?.failed));
    });
  }, [rows, signals, needs, marks, focus, dismissals, byHostKey]);
  // Stable order: a card's `since` changes only when its need does (lib/nowCards stableOrder).
  const memo = useRef<Map<string, SinceMemo>>(new Map());
  const order = useMemo(() => {
    const items = chips.map((c) => ({ key: c.key, fp: `${c.signal}|${needFingerprint(needs.get(c.key))}`, at: byKey.get(c.key)?.lastActivity || null }));
    const next = stableOrder(memo.current, items, Date.now());
    memo.current = next.memo;
    return next.order;
  }, [chips, needs, byKey]);
  const columns = useMemo(
    () =>
      conversationPanes(layout).map((id) => {
        const b = paneBinding(layout, id);
        const row = b?.sessionId ? byHostKey.get(hostKey(b.hostId, b.sessionId)) : undefined;
        return row ? rowKey(row) : null;
      }),
    [layout, byHostKey],
  );
  const { shown, rest } = useMemo(() => nowCards(chips, order, columns), [chips, order, columns]);
  const cards = usePresence(shown);
  const activate = (card: NowCard) => {
    const row = byKey.get(card.key);
    if (!row) return;
    const host = row.hostId ?? focus;
    if (card.chip) activateAttention(card.chip, needs.get(card.key), host);
    else void useApp.getState().openAgent(row.id, host);
  };
  const restMenu = (el: HTMLElement) =>
    openMenuFrom(
      el,
      rest.flatMap((card) => {
        const row = byKey.get(card.key);
        if (!row) return [];
        const label = card.chip ? signalLabel(t, card.chip.signal, needs.get(card.key)) : null;
        return [{ label: label ? `${row.name} · ${label}` : row.name, onSelect: () => activate(card) }];
      }),
      { owner: "sidebar.nowRest" },
    );
  return (
    <section aria-label={t("sidebar.now")} data-sidebar-now="" style={{ height }} className="flex min-h-0 shrink-0 flex-col gap-1.5 overflow-y-auto px-2 pt-2 pb-1.5 [scrollbar-width:thin]">
      <div className="flex shrink-0 items-center gap-1.5 px-0.5">
        <span className="text-meta font-semibold text-muted">{t("sidebar.now")}</span>
        {chips.length > 0 && <CountBadge count={chips.length} />}
        <span className="ml-auto text-caption text-subtle">{t("sidebar.now.byWait")}</span>
      </div>
      {notice}
      {cards.map((card) => {
        const row = byKey.get(card.key);
        if (!row) return null;
        return <NowCardView key={card.key} card={card} row={row} attention={attention} since={card.chip ? (memo.current.get(card.key)?.since ?? null) : null} leaving={card.leaving} own={(row.hostId ?? focus) === focus} onActivate={() => activate(card)} />;
      })}
      {shown.length === 0 && <p className="px-1 py-2 text-meta text-subtle">{t("sidebar.now.empty")}</p>}
      {rest.length > 0 && (
        <button type="button" data-now-rest="" onClick={(e) => restMenu(e.currentTarget)} aria-haspopup="menu" className="shrink-0 self-start rounded-ctl px-1.5 py-0.5 text-meta text-muted hover:bg-hover hover:text-foreground">
          {t("sidebar.now.more", { n: rest.length })}
        </button>
      )}
    </section>
  );
}

/** The divider between 「现在」 and 「全部」: drag (or ↑ / ↓, 16 px) to move it; the height is kept in prefs. */
export function NowSplitter({ height, onLive }: { height: number; onLive(px: number | null): void }) {
  const { t } = useI18n();
  const set = (px: number) => setUiPref("sidebarNowHeight", clampNowHeight(px));
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("sidebar.nowResize")}
      aria-valuenow={height}
      aria-valuemin={NOW_HEIGHT.min}
      aria-valuemax={NOW_HEIGHT.max}
      tabIndex={0}
      title={t("sidebar.nowResize")}
      data-now-splitter=""
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        set(getUiPrefs().sidebarNowHeight + (e.key === "ArrowUp" ? -16 : 16));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const start = height;
        let last = start;
        const move = (ev: PointerEvent) => {
          last = clampNowHeight(start + ev.clientY - startY);
          onLive(last);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          set(last);
          onLive(null);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      className="group/split flex h-2 shrink-0 cursor-row-resize items-center justify-center outline-none"
    >
      <span className="h-[3px] w-12 rounded-full bg-border group-hover/split:bg-subtle group-focus-visible/split:bg-accent" />
    </div>
  );
}
