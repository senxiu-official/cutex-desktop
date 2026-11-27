import { requestFork } from "../lib/requestFork";
// Action rows under messages (ZCode-like; UI review #15, side actions back inline 2026-10-15; design 040 step 10).
// Agent reply: one row — on its left the turn's quiet status (「已回复 [avatar] Lead 的委托 #11 · 已完成」, the
// `status` slot), on its right a small floating bar, the 操作栏 (`shadow-e2`, `rounded-ctl`); user bubble: the same
// bar at the bottom-right. Each bar shows the actions the owner pinned, in pin order (owner 2026-11-28,
// lib/turnBarPins; until changed: 复制 · 分叉 / 复制 · 回退并编辑, then the `ref.action` items marked `inline` such as
// 书签), then any module action whose live state is on (a turn with notes), then 「⋯」: every action — the bar's own
// (复制, 分叉, 折叠 / 展开, 引用, 回退到这里, 回退并编辑) and the other `ref.action` items (批注, 侧边对话 … with their live
// labels, lib/refActions) — each with a pin toggle, pinned first. Right-clicking a pinned icon unpins it. A narrow
// row shows the first pins only (the rest stay in 「⋯」).
// The bars show on hover / keyboard focus only (they stay in the Tab order: opacity, never display:none), the
// latest reply's too; the rows always take their height, so hovering never moves the timeline. The two
// history-rewriting actions (回退 / 回退并编辑) arm first (lib/armedConfirm), pinned or not: the armed confirm takes
// the place of the pinned icon, or comes after a divider when picked from 「⋯」. Right-click entries stay available too.
import { mentionPlainText } from "../lib/mentionWire";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsDownUp, ChevronsUpDown, Copy, FileClock, GitFork, History, MessageSquareQuote, MoreHorizontal, PencilLine, Pin, PinOff } from "lucide-react";
import type { AppSlotEntry, CutexRef } from "../modules/slots";
import { useSlot } from "../modules/react";
import { useHostEntryGate } from "../lib/hostGatingView";
import { refActionApplies } from "../lib/refActionApplies";
import { ownerWindowOf } from "../lib/ownerWindow";
import { getUiPrefs, setUiPref, useUiPrefs } from "../lib/prefs";
import { layoutTurnBar, refPinId, turnBarCap, turnBarPins, withTurnBarPin, type TurnBar } from "../lib/turnBarPins";
import { contextMenu, openMenuFrom, type MenuEntry } from "../lib/contextMenu";
import { refActionRow } from "../lib/refActions";
import type { MessageFold } from "../lib/foldView";
import { useI18n } from "../i18n";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";
import { PRESS_ICON } from "./Button";
import { quoteText, SESSION_FEATURES } from "../lib/menus";
import { copyQuietly } from "../lib/copyFeedback";
import type { ReplyBar } from "../lib/replyActions";
import { useApp } from "../store";
import { convFeaturesOf, convNotify, useConvScope, useConvViewHost } from "../lib/conversationScope";
import { canRewindFiles, lacks } from "../lib/agentFeatures";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { revertTexts } from "../lib/runtimeWording";
import { structuralBlockText, structuralErrorText, useStructuralBlock } from "../lib/structuralGateView";
import { turnRefNow } from "../lib/refServices";

const ICON = 14;

function IconButton({ title, label = title, onClick, disabled, children, menu }: { title: string; /** Its name when the tooltip says more (a hint, a reason). */ label?: string; onClick(): void; disabled?: boolean; children: ReactNode; /** Opens a menu at the button instead of `onClick`. */ menu?: (anchor: HTMLElement) => void }) {
  return (
    <button
      data-tip={title}
      aria-label={label}
      aria-haspopup={menu ? "menu" : undefined}
      disabled={disabled}
      onClick={(e) => (menu ? menu(e.currentTarget) : onClick())}
      className={`${PRESS_ICON} flex size-6 items-center justify-center rounded-ctl text-muted hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <IconButton title={done ? t("reply.copied") : t("reply.copy")} onClick={() => void copyQuietly(text).then(() => setDone(true), () => {})}>
      {done ? <Check size={ICON} className="text-accent" /> : <Copy size={ICON} />}
    </IconButton>
  );
}

/** The armed confirm of a history-rewriting action picked from the 「…」 menu (it arms there, runs here). */
function ArmedConfirm({ icon, title, label, onConfirm, onDone }: { icon: ReactNode; title: string; label: string; onConfirm(): Promise<void>; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      title={title}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onConfirm().finally(() => (setBusy(false), onDone()));
      }}
      className={`${ARMED_BUTTON} flex h-6 items-center gap-1 whitespace-nowrap`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The floating action bar (design 040 step 10): an e2 pill. It shows and hides at once, with no opacity fade: while a
 * fade runs, Chromium composites the bar, and the next row's text that its shadow reaches is drawn in another layer
 * for those frames. At a fractional scale (1.875) that text visibly flickered as the pointer went over the message
 * (owner 2026-11-26, a delegation-result row under a reply).
 */
const BAR = "inline-flex h-7 items-center rounded-ctl bg-background p-0.5 shadow-e2";
/** Hover / keyboard focus of the message (`group`) shows the bar. */
const ON_HOVER = "opacity-0 group-hover:opacity-100 focus-within:opacity-100";

/** Fold / unfold by hand (long-message folding); nothing when there is nothing to fold. */
function foldAction(fold: MessageFold | undefined, t: ReturnType<typeof useI18n>["t"]): BarAction | null {
  if (!fold) return null;
  if (fold.overflowing) return { id: "fold", label: t("fold.unfold"), icon: <ChevronsUpDown size={ICON} />, run: () => fold.setFolded(false) };
  if (!fold.canFold) return null;
  return { id: "fold", label: t("fold.fold"), icon: <ChevronsDownUp size={ICON} />, run: () => fold.setFolded(true) };
}

function Divider() {
  return <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />;
}

/** Fork / revert failures: a Claude agent's busy refusal as information, anything else as an error. */
function useReport() {
  const conv = useConvScope();
  return (e: unknown) => {
    const { text, refused } = structuralErrorText(e);
    convNotify(conv, text, refused ? "info" : "error");
  };
}


/**
 * One of a bar's own actions (or a pinnable 「⋯」 row): `run` is what clicking its icon or its menu row does;
 * `button` replaces the plain icon on the bar (复制's done tick).
 */
type BarAction = { id: string; label: string; icon: ReactNode; disabled?: boolean; title?: string; run(): void; button?: ReactNode };

/** The `ref.action` items for turns on this host (the bar's module actions), in slot order. */
function useTurnRefEntries(hostId: string | undefined): AppSlotEntry<"ref.action">[] {
  const entries = useSlot("ref.action");
  const onHost = useHostEntryGate(hostId);
  return entries.filter((e) => refActionApplies(e, "turn") && onHost(e));
}

/** The row's width, for how many pinned icons fit (lib/turnBarPins turnBarCap). */
function useRowWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const Observer = ownerWindowOf(el).ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function setTurnBarPin(bar: TurnBar, id: string, on: boolean, inline: readonly string[]) {
  setUiPref("turnBarPins", withTurnBarPin(getUiPrefs().turnBarPins, bar, id, on, inline));
}

/** A pinned icon: right-click offers 从操作栏取消固定. */
function Pinned({ id, unpin, children }: { id: string; unpin(): void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <span className="contents" data-bar-pin={id} onContextMenu={contextMenu(() => [{ label: t("turnBar.unpin"), icon: <PinOff size={ICON} />, onSelect: unpin }])}>
      {children}
    </span>
  );
}

/**
 * A module action on the bar: pinned (always shown, in pin order), or unpinned but with its live state on (a
 * turn with notes, 书签 on) — then shown after the pins. Same `ref.action` contract as the menus.
 */
function RefBarButton({ entry, cref, build, pinned }: { entry: AppSlotEntry<"ref.action">; cref: CutexRef; build(): CutexRef | null; pinned: boolean }) {
  const { t } = useI18n();
  const conv = useConvScope();
  const state = entry.item.useState?.(cref);
  if (!pinned && !state?.active) return null;
  const Icon = entry.item.icon;
  const label = state?.tooltip ? `${t(state?.titleKey ?? entry.item.titleKey)} · ${state.tooltip}` : state?.disabledReason ?? t(state?.titleKey ?? entry.item.titleKey);
  return (
    <button
      data-tip={label}
      aria-label={label}
      aria-pressed={state?.active}
      aria-haspopup={entry.item.submenu ? "menu" : undefined}
      disabled={!!state?.disabledReason}
      className={`${PRESS_ICON} flex size-6 items-center justify-center rounded-ctl hover:bg-hover disabled:opacity-40 ${state?.active ? "text-accent" : "text-muted hover:text-foreground"}`}
      onClick={(e) => {
        const current = build();
        if (!current || state?.disabledReason) return;
        // An item with a submenu (e.g. a list to pick from) opens it at the icon, as its menu row would.
        if (entry.item.submenu) return void openSubmenu(e.currentTarget, entry, current);
        void Promise.resolve().then(() => entry.item.run(current)).catch((error) => convNotify(conv, error instanceof Error ? error.message : String(error), "error"));
      }}
    >
      <Icon size={ICON} className={state?.active ? "fill-current" : undefined} />
    </button>
  );
}

/** A pinned item with a submenu: its rows as a menu at the icon. */
async function openSubmenu(anchor: HTMLElement, entry: AppSlotEntry<"ref.action">, ref: CutexRef) {
  const { submenu } = refActionRow(entry, ref);
  const rows = typeof submenu === "function" ? await submenu() : (submenu ?? []);
  if (rows.length) openMenuFrom(anchor, rows);
}

/**
 * The bar's icons for this turn under the pins of `bar` (lib/turnBarPins), then any unpinned module action whose
 * state is on, then 「⋯」: every action with a pin toggle, pinned first. `armed`: a history-rewriting action's armed
 * confirm — in place of its icon when that is pinned, else after a divider at the end.
 */
function PinnedBar({ bar, own, build, width, armed }: { bar: TurnBar; own: BarAction[]; build?: () => CutexRef | null; width: number; armed?: { id: string; node: ReactNode } | null }) {
  const { t } = useI18n();
  const { turnBarPins: stored } = useUiPrefs();
  const cref = build?.() ?? null;
  const allRefs = useTurnRefEntries(cref?.hostId);
  const refs = cref && build ? allRefs : [];
  const inline = refs.filter((e) => e.item.inline).map((e) => refPinId(e.item.id));
  const ownById = new Map(own.map((a) => [a.id, a]));
  const refById = new Map(refs.map((e) => [refPinId(e.item.id), e]));
  const ids = [...own.map((a) => a.id), ...refs.map((e) => refPinId(e.item.id))];
  const layout = layoutTurnBar(ids, turnBarPins(stored, bar, inline), turnBarCap(width));
  const pin = (id: string, on: boolean) => setTurnBarPin(bar, id, on, inline);
  const icon = (id: string) => {
    if (armed?.id === id) return armed.node;
    const a = ownById.get(id);
    if (a) return a.button ?? <IconButton title={a.title ?? a.label} label={a.label} disabled={a.disabled} onClick={a.run}>{a.icon}</IconButton>;
    return <RefBarButton entry={refById.get(id)!} cref={cref!} build={build!} pinned />;
  };
  const openMore = (anchor: HTMLElement) => {
    const current = build?.() ?? null;
    const row = (id: string, on: boolean): MenuEntry => {
      const toggle = { on, onIcon: <Pin size={13} className="fill-current" />, offIcon: <Pin size={13} />, onLabel: t("turnBar.unpin"), offLabel: t("turnBar.pin"), onToggle: (next: boolean) => pin(id, next) };
      const a = ownById.get(id);
      if (a) return { label: a.label, icon: a.icon, disabled: a.disabled, title: a.title, onSelect: a.run, toggle };
      const e = refById.get(id);
      return e && current ? { ...refActionRow(e, current), toggle } : null;
    };
    openMenuFrom(anchor, [...layout.menuPinned.map((id) => row(id, true)), layout.menuPinned.length > 0 && layout.menuRest.length > 0 && "separator", ...layout.menuRest.map((id) => row(id, false))]);
  };
  const armedAtEnd = !!armed && !layout.shown.includes(armed.id);
  return (
    <>
      {layout.shown.map((id) => (
        <Pinned key={id} id={id} unpin={() => pin(id, false)}>
          {icon(id)}
        </Pinned>
      ))}
      {cref && build && refs.filter((e) => !layout.shown.includes(refPinId(e.item.id))).map((e) => <RefBarButton key={e.item.id} entry={e} cref={cref} build={build} pinned={false} />)}
      {/* 「⋯」 while it holds something not on the bar (an action, a pin that did not fit). */}
      {(layout.menuRest.length > 0 || layout.menuPinned.length > layout.shown.length) && (
        <IconButton title={t("gutter.more")} onClick={() => {}} menu={openMore}>
          <MoreHorizontal size={ICON} />
        </IconButton>
      )}
      {armedAtEnd && (
        <>
          <Divider />
          {armed!.node}
        </>
      )}
    </>
  );
}

/** Under the last message of a finished agent turn. */
export function ReplyActions({ sessionId, bar, readOnly, fold, status }: { sessionId: string; bar: ReplyBar; readOnly: boolean; fold?: MessageFold; /** The turn's quiet status line at the row's start (components/DelegationRows RepliedBadge `inline`). */ status?: ReactNode }) {
  const { t } = useI18n();
  const agent = useAgentFeatures(sessionId);
  const conv = useConvScope();
  const hostId = useConvViewHost(sessionId);
  const canFork = useApp((s) => convFeaturesOf(conv, s).has(SESSION_FEATURES.fork)) && !readOnly && !lacks(agent, "fork");
  const canRevert = useApp((s) => convFeaturesOf(conv, s).has(SESSION_FEATURES.revert)) && !readOnly && !!bar.nextTurnId && !lacks(agent, "historyRevert");
  // Claude agents: 回退 can also restore the files from Claude Code's checkpoints (claude-rewind-files).
  const canRevertFiles = useApp((s) => canRewindFiles(agent, convFeaturesOf(conv, s))) && canRevert;
  // DSH keeps no file checkpoints (cutex: filesRestored false, rewindFiles refused): say so, never offer files.
  const revertHint = revertTexts(agent?.runtime).revertHint;
  const [withFiles, setWithFiles] = useState(false);
  // A busy Claude agent refuses revert, and fork without forkWhileBusy (lib/structuralGate): shown
  // disabled with the reason.
  const block = useStructuralBlock(sessionId, agent, "revert");
  const blocked = block ? structuralBlockText(block) : null;
  const forkBlock = useStructuralBlock(sessionId, agent, "fork");
  const forkBlocked = forkBlock ? structuralBlockText(forkBlock) : null;
  const [forking, setForking] = useState(false);
  const [armed, setArmed] = useArmed(blocked);
  const report = useReport();
  const [rowRef, width] = useRowWidth();
  const fork = () => {
    setForking(true);
    requestFork(sessionId, bar.turnId, hostId).catch(report).finally(() => setForking(false));
  };
  const own = [
    { id: "copy", label: t("reply.copy"), icon: <Copy size={ICON} />, run: () => void copyQuietly(bar.text).catch(() => {}), button: <CopyButton text={bar.text} /> },
    canFork && { id: "fork", label: t("reply.fork"), icon: <GitFork size={ICON} />, disabled: forking || !!forkBlocked, title: forkBlocked ?? undefined, run: fork },
    foldAction(fold, t),
    !readOnly && { id: "quote", label: t("reply.quote"), icon: <MessageSquareQuote size={ICON} />, run: () => useApp.getState().insertIntoComposer(sessionId, quoteText(bar.text), "append", undefined, hostId) },
    canRevert && { id: "revert", label: t("reply.revert"), icon: <History size={ICON} />, disabled: !!blocked, title: blocked ?? t(revertHint, { n: bar.laterTurns }), run: () => (setWithFiles(false), setArmed(true)) },
    canRevertFiles && { id: "revertFiles", label: t("reply.revertWithFiles"), icon: <FileClock size={ICON} />, disabled: !!blocked, title: blocked ?? t("reply.revertFilesHint", { n: bar.laterTurns }), run: () => (setWithFiles(true), setArmed(true)) },
  ].filter((a): a is BarAction => !!a);
  const files = withFiles && canRevertFiles;
  const confirm =
    armed && canRevert && !blocked
      ? {
          id: files ? "revertFiles" : "revert",
          node: (
            <ArmedConfirm
              icon={files ? <FileClock size={ICON} /> : <History size={ICON} />}
              title={t(files ? "reply.revertFilesHint" : revertHint, { n: bar.laterTurns })}
              label={t(files ? "reply.revertFilesArmed" : "reply.revertArmed", { n: bar.laterTurns })}
              onDone={() => setArmed(false)}
              onConfirm={() => useApp.getState().revertTo(sessionId, bar.nextTurnId!, { hostId, ...(files ? { rewindFiles: true } : {}) }).catch(report)}
            />
          ),
        }
      : null;
  const shown = armed || forking ? "opacity-100" : ON_HOVER;
  const build = readOnly ? undefined : () => turnRefNow(sessionId, bar.turnId, bar.text);
  return (
    <div ref={rowRef} className="flex h-7 min-w-0 items-center gap-2" data-reply-row="">
      {status}
      <span className="flex-1" />
      <div className={`${BAR} ${shown}`} data-reply-bar="" role="toolbar" aria-label={t("reply.actions")}>
        <PinnedBar bar="reply" own={own} build={build} width={width} armed={confirm} />
      </div>
    </div>
  );
}

/**
 * Under a user bubble, right-aligned, on hover. `dropped`: turns an edit & resend removes. `blocked`:
 * why edit & resend (a revert) is not possible right now (a busy Claude agent), shown disabled.
 */
export function UserActions({ sessionId, text, extra, turnId, dropped, canRevert, blocked, fold }: { sessionId: string; text: string; /** Its image / skill input items (back in the composer with the text). */ extra?: unknown[]; turnId: string | null; dropped: number; canRevert: boolean; blocked?: string | null; fold?: MessageFold }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed(blocked ?? null);
  const report = useReport();
  const hostId = useConvViewHost(sessionId);
  const texts = revertTexts(useAgentFeatures(sessionId)?.runtime);
  const [rowRef, width] = useRowWidth();
  const plain = mentionPlainText(text);
  const canEdit = canRevert && !!turnId;
  const own = [
    !!text && { id: "copy", label: t("reply.copy"), icon: <Copy size={ICON} />, run: () => void copyQuietly(plain).catch(() => {}), button: <CopyButton text={plain} /> },
    canEdit && { id: "editResend", label: t("menu.editResend"), icon: <PencilLine size={ICON} />, disabled: !!blocked, title: blocked ?? t(texts.editResendHint), run: () => setArmed(true) },
    foldAction(fold, t),
  ].filter((a): a is BarAction => !!a);
  const confirm =
    armed && canEdit && !blocked
      ? {
          id: "editResend",
          node: (
            <ArmedConfirm
              icon={<PencilLine size={ICON} />}
              title={t(texts.editResendHint)}
              label={t("reply.editResendArmed", { n: dropped })}
              onDone={() => setArmed(false)}
              onConfirm={() => useApp.getState().editAndResend(sessionId, turnId!, text, hostId, extra).catch(report)}
            />
          ),
        }
      : null;
  return (
    <div ref={rowRef} className="flex h-7 items-center justify-end">
      <div className={`${BAR} ${armed ? "opacity-100" : ON_HOVER}`} data-user-bar="" role="toolbar" aria-label={t("reply.actions")}>
        <PinnedBar bar="user" own={own} build={turnId ? () => turnRefNow(sessionId, turnId, text) : undefined} width={width} armed={confirm} />
      </div>
    </div>
  );
}
