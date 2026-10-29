// 「需要你」 strip above the composer (sidebar v2): one chip per agent of any project of the hosts in the
// view scope that needs the owner, just finished a turn or failed — except the open agent. Click opens
// it in place (owner approvals only: the 审批 page; a delegation waiting for your review only: the
// agent with that delegation's detail beside it, where 批准 / 拒绝 are). Settings → 外观 → 侧栏 「输入框上方显示『需要你』」. Multi-host (RFC §10, ★ Q15):
// what waits on connected hosts outside the view scope is one 「其他主机 N 项」 chip at the end (click =
// show 所有设备). Each agent chip has a × (also middle-click) that dismisses it without opening: done /
// failed = the turn is marked seen as opening would (the sidebar pill goes too); a runtime error = hidden
// while it is the same error (member + runtimeGeneration + lastError); needs-you = hidden until the need
// changes (lib/needsYouDismiss; the sidebar keeps the real state).
// Redesign (owner report 2026-10-15: it had become a long sideways scroller with a scrollbar over the
// chips): one line, never scrolling. A chip is avatar + name + one status word (no dots); 需要你 /
// 出错 first and tinted; two or more 完成 are one 「N 个已完成」 chip (its menu opens each, or
// 全部清除); what does not fit sits behind 「+N」 (a keyboard-navigable menu; lib/stripFit). The row
// shares the status row's and composer's column and edges (side-col-composer).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, X } from "lucide-react";
import { useI18n } from "../i18n";
import { openMenuAbove, type MenuEntry } from "../lib/contextMenu";
import { fitCount, stripItems, type StripItem } from "../lib/stripFit";
import { attentionChips, type AttentionChip } from "../lib/agentAttention";
import { signalLabel } from "../lib/attentionView";
import { chipTone, type ChipTone } from "../lib/statusChips";
import { hostKey } from "../lib/hostKeys";
import { useScopedAttention, useScopedSidebar } from "../lib/scopedSidebarView";
import type { AgentRow } from "../lib/sidebar";
import { markSeenOn, turnMarksOn } from "../lib/turnUnread";
import { chipDismissed, dismissNeed, dismissRuntimeError, errorKey, needFingerprint, pruneStoredDismissals, runtimeErrorFingerprint, useDismissals } from "../lib/needsYouDismiss";
import { useUiPrefs } from "../lib/prefs";
import { activateAttention } from "../lib/attentionActivate";
import { useOutOfScopeAttention } from "../lib/hostLists";
import { ALL_HOSTS } from "../lib/hostScope";
import { setViewScope } from "../lib/useHostScope";
import { useApp } from "../store";
import { useConvHost } from "../lib/conversationScope";
import { StatusAvatar } from "./AgentStatus";
import { HostMark } from "./HostMark";
import { sharedResizeObserver } from "../lib/resizeHub";

// Colour budget (lib/statusChips chipTone): tinted only for 出错 and pending decisions; the rest is a
// neutral chip whose state is the muted word.
const TONE: Record<ChipTone, string> = {
  urgent: "bg-attention-soft hover:bg-attention/25",
  error: "bg-danger-soft hover:bg-danger/20",
  quiet: "bg-surface-2 hover:bg-hover",
};
const LABEL_TONE: Record<ChipTone, string> = { urgent: "text-warn-text", error: "text-danger", quiet: "text-muted" };
const CHIP = "group flex shrink-0 items-center rounded-full text-meta";
const CLOSE =
  "mx-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-subtle opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100";

/** `inline`: inside the status row (components/StatusBar), which sets its width, line and edges. */
export function NeedsYouStrip({ sessionId, inline = false }: { sessionId: string | null; inline?: boolean }) {
  const { needsYouStrip } = useUiPrefs();
  if (!needsYouStrip) return null;
  return <Strip sessionId={sessionId} inline={inline} />;
}

function Strip({ sessionId, inline }: { sessionId: string | null; inline: boolean }) {
  const { t } = useI18n();
  // Every host of the view scope (RFC §10): rows, signals and needs are keyed by row key (host + id).
  const scoped = useScopedSidebar();
  const { rows, signals, needs, marks } = useScopedAttention(scoped.model, scoped.scope);
  const focus = scoped.scope.focus;
  const openHost = useConvHost();
  const exclude = sessionId ? hostKey(openHost, sessionId) : null;
  const dismissals = useDismissals();
  const markOf = useMemo(() => (row: AgentRow) => ((row.hostId ?? focus) === focus ? marks[row.id] : turnMarksOn(row.hostId!)[row.id]), [marks, focus]);
  const all = useMemo(() => attentionChips(rows, signals, needs, markOf, null), [rows, signals, needs, markOf]);
  const byKey = useMemo(() => new Map(rows.map((r) => [hostKey(r.hostId ?? focus, r.id), r])), [rows, focus]);
  const runtimeErrorOf = (c: AttentionChip) => runtimeErrorFingerprint(byKey.get(hostKey(c.hostId ?? focus, c.id))?.session.runtime);
  const chips = useMemo(
    () => all.filter((c) => {
      if (c.key === exclude) return false;
      const row = byKey.get(hostKey(c.hostId ?? focus, c.id));
      return !chipDismissed(dismissals, hostKey(c.hostId ?? focus, c.id), c, needs.get(c.key), row, !!(row && markOf(row)?.failed));
    }),
    [all, exclude, dismissals, needs, focus, byKey, markOf],
  );
  // Dismissals of agents in view whose need or runtime error is gone or changed go (a new one shows the chip again).
  useEffect(() => {
    const current = new Map(all.filter((c) => c.signal === "needsYou").map((c) => [hostKey(c.hostId ?? focus, c.id), needFingerprint(needs.get(c.key))]));
    for (const r of rows) {
      const fp = runtimeErrorFingerprint(r.session.runtime);
      if (fp) current.set(errorKey(hostKey(r.hostId ?? focus, r.id)), fp);
    }
    pruneStoredDismissals(current, new Set(rows.map((r) => hostKey(r.hostId ?? focus, r.id))));
  }, [all, rows, needs, focus]);
  const elsewhere = useOutOfScopeAttention();
  const items = useMemo(() => stripItems(chips), [chips]);
  const strip = useRef<HTMLDivElement>(null);
  const moreWidth = useRef(36);
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY);
  // What the chips' widths depend on, as one string: `items` / `needs` are new objects whenever any
  // agent's session changes (each streamed delta), and the measure below forces a layout.
  const layoutKey = items
    .map((item) => {
      if (item.kind === "done") return `done:${item.chips.map((c) => c.key).join(",")}`;
      const c = item.chip;
      const n = needs.get(c.key);
      return `${c.key}|${c.name}|${chipTone(c.signal, n)}|${signalLabel(t, c.signal, n) ?? ""}`;
    })
    .join("\n") + `\n${elsewhere}|${scoped.scope.showHostMarks}`;
  useLayoutEffect(() => {
    const row = strip.current;
    if (!row) return;
    const measure = () => {
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap) || 0;
      const content = row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const fixed = [...row.querySelectorAll<HTMLElement>(":scope > [data-strip-fixed]")].reduce((sum, el) => sum + el.offsetWidth + gap, 0);
      const more = row.querySelector<HTMLElement>(":scope > [data-strip-more]");
      if (more && more.offsetWidth > 0) moreWidth.current = more.offsetWidth;
      const widths = [...row.querySelectorAll<HTMLElement>(":scope > [data-strip-item]")].map((el) => el.offsetWidth);
      setFit(fitCount(widths, content - fixed, gap, moreWidth.current));
    };
    measure();
    const observer = sharedResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [layoutKey]);
  if (chips.length === 0 && elsewhere === 0) return null;

  const hostOf = (c: AttentionChip) => c.hostId ?? focus;
  // Where its need is handled (lib/attentionActivate; the sidebar's 「现在」 cards do the same).
  const activate = (c: AttentionChip) => activateAttention(c, needs.get(c.key), hostOf(c));
  const dismiss = (c: AttentionChip) => {
    if (c.signal === "needsYou") return dismissNeed(hostKey(hostOf(c), c.id), needs.get(c.key));
    // 出错 from a runtime error: remember this error; a failed / finished turn is marked seen as before.
    const runtimeError = c.signal === "error" ? runtimeErrorOf(c) : null;
    if (runtimeError) dismissRuntimeError(hostKey(hostOf(c), c.id), runtimeError);
    markSeenOn(hostOf(c), c.id);
  };
  const avatarOf = (c: AttentionChip) => {
    const row = byKey.get(hostKey(hostOf(c), c.id));
    return row ? <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={16} signal="idle" /> : undefined;
  };
  const entryOf = (c: AttentionChip): MenuEntry => ({ label: `${c.name} · ${signalLabel(t, c.signal, needs.get(c.key)) ?? ""}`, icon: avatarOf(c), onSelect: () => activate(c) });
  const clearDone = (done: AttentionChip[]) => {
    for (const c of done) dismiss(c);
  };
  const doneMenu = (done: AttentionChip[]): MenuEntry[] => [...done.map(entryOf), "separator", { label: t("needsYou.clearDone"), icon: <CheckCheck size={13} />, title: t("needsYou.clearDoneHint"), onSelect: () => clearDone(done) }];
  const hidden = items.slice(Math.min(fit, items.length));
  const hiddenCount = hidden.reduce((n, item) => n + (item.kind === "chip" ? 1 : item.chips.length), 0);
  const hiddenMenu = (): MenuEntry[] =>
    hidden.flatMap((item, i): MenuEntry[] => (item.kind === "chip" ? [entryOf(item.chip)] : [i > 0 ? "separator" : null, ...doneMenu(item.chips)]));

  const renderItem = (item: StripItem<AttentionChip>, over: boolean) => {
    // Past the room: still laid out (its width is measured) but clipped, invisible and inert.
    const shared = { "data-strip-item": "", "aria-hidden": over || undefined, inert: over || undefined } as const;
    const place = over ? "invisible order-last" : "";
    if (item.kind === "done") {
      const label = t("needsYou.doneGroup", { n: item.chips.length });
      return (
        <div key="done-group" {...shared} data-chip-group="done" className={`${CHIP} ${TONE.quiet} ${place}`}>
          <button
            onClick={(e) => openMenuAbove(e.currentTarget, doneMenu(item.chips), { minWidth: 200 })}
            aria-haspopup="menu"
            title={item.chips.map((c) => c.name).join("、")}
            className="flex min-w-0 items-center gap-1.5 rounded-l-full py-0.5 pl-1.5"
          >
            <span className="flex -space-x-1.5">{item.chips.slice(0, 3).map((c) => <span key={c.key} className="rounded-full ring-1 ring-background">{avatarOf(c)}</span>)}</span>
            <span className="whitespace-nowrap text-muted">{label}</span>
          </button>
          <button type="button" onClick={() => clearDone(item.chips)} aria-label={t("needsYou.clearDone")} title={t("needsYou.clearDoneHint")} className={CLOSE}>
            <X className="size-3" />
          </button>
        </div>
      );
    }
    const c = item.chip;
    const host = hostOf(c);
    const n = needs.get(c.key);
    const look = scoped.scope.showHostMarks ? scoped.scope.host(host) : null;
    const approvalsOnly = c.signal === "needsYou" && n?.reasons.length === 1 && n.reasons[0] === "approval";
    const tone = chipTone(c.signal, n);
    const label = signalLabel(t, c.signal, n);
    return (
      <div key={c.key} {...shared} data-chip={c.key} data-chip-tone={tone} className={`${CHIP} ${TONE[tone]} ${place}`}>
        <button
          onClick={() => activate(c)}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault(); // no autoscroll
          }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            dismiss(c);
          }}
          title={approvalsOnly ? t("needsYou.openApprovals") : `${c.name} · ${label ?? ""}`}
          className="flex min-w-0 items-center gap-1.5 rounded-l-full py-0.5 pl-0.5"
        >
          {avatarOf(c)}
          {look && <HostMark host={look} dotOnly />}
          <span className="max-w-[9rem] truncate font-medium">{c.name}</span>
          <span className={`whitespace-nowrap ${LABEL_TONE[tone]}`}>{label}</span>
        </button>
        <button type="button" onClick={() => dismiss(c)} aria-label={t("needsYou.dismiss")} title={t("needsYou.dismiss")} className={CLOSE}>
          <X className="size-3" />
        </button>
      </div>
    );
  };

  return (
    <div ref={strip} data-needs-you-strip="" className={`flex min-w-0 items-center gap-1.5 overflow-hidden ${inline ? "" : "side-col side-col-composer w-full px-6 pb-1.5"}`}>
      <span data-strip-fixed="" className="shrink-0 text-caption text-subtle">
        {t("needsYou.label")}
      </span>
      {items.map((item, i) => renderItem(item, i >= fit))}
      {hidden.length > 0 && (
        <button
          data-strip-more=""
          aria-haspopup="menu"
          aria-label={t("needsYou.more", { n: hiddenCount })}
          title={t("needsYou.more", { n: hiddenCount })}
          onClick={(e) => openMenuAbove(e.currentTarget, hiddenMenu(), { minWidth: 220 })}
          className="flex shrink-0 items-center rounded-full bg-surface-2 px-2 py-0.5 text-meta font-medium whitespace-nowrap text-muted hover:bg-hover hover:text-foreground"
        >
          +{hiddenCount}
        </button>
      )}
      {elsewhere > 0 && (
        <button
          data-strip-fixed=""
          onClick={() => void setViewScope(ALL_HOSTS)}
          title={t("needsYou.otherHostsHint", { n: elsewhere })}
          className="flex shrink-0 items-center rounded-full bg-attention-soft px-2 py-0.5 text-meta whitespace-nowrap text-warn-text hover:bg-attention/25"
        >
          {t("needsYou.otherHosts", { n: elsewhere })}
        </button>
      )}
    </div>
  );
}
