import { requestFork } from "../lib/requestFork";
// Action rows under messages (ZCode-like; UI review #15, side actions back inline 2026-10-15; design 040 step 10).
// Agent reply: one row — on its left the turn's quiet status (「已回复 [avatar] Lead 的委托 #11 · 已完成」, the
// `status` slot), on its right a small floating bar (`shadow-e2`, `rounded-ctl`): 复制 · 分叉 · the modules'
// `ref.action` items marked `inline` (书签) or whose live state is on · 「⋯」; user bubble (bottom-right): 复制 ·
// 编辑并重发 · the same · 「⋯」. 「⋯」 holds the rest: the other `ref.action` items (批注, 侧边对话 … with their live
// labels, lib/refActions), 折叠 / 展开, 引用 and 回退到这里.
// The bars show on hover / keyboard focus only (they stay in the Tab order: opacity, never display:none), the
// latest reply's too; the rows always take their height, so hovering never moves the timeline. The two
// history-rewriting actions (回退 / 编辑并重发) arm first (lib/armedConfirm): picking 回退 in the menu
// puts its armed confirm button into the row. Right-click entries stay available too.
import { mentionPlainText } from "../lib/mentionWire";
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronsDownUp, ChevronsUpDown, Copy, FileClock, GitFork, History, MessageSquareQuote, MoreHorizontal, PencilLine } from "lucide-react";
import type { CutexRef } from "../modules/slots";
import { openMenuFrom, type MenuAction, type MenuEntry } from "../lib/contextMenu";
import { refActionEntries } from "../lib/refActions";
import type { MessageFold } from "../lib/foldView";
import { useI18n } from "../i18n";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";
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
import { RefActionButtons } from "./RefActions";

const ICON = 14;

function IconButton({ title, onClick, disabled, children, menu }: { title: string; onClick(): void; disabled?: boolean; children: ReactNode; /** Opens a menu at the button instead of `onClick`. */ menu?: (anchor: HTMLElement) => void }) {
  return (
    <button
      title={title}
      aria-label={title}
      aria-haspopup={menu ? "menu" : undefined}
      disabled={disabled}
      onClick={(e) => (menu ? menu(e.currentTarget) : onClick())}
      className="flex size-6 items-center justify-center rounded-ctl text-muted hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
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

/**
 * A history-rewriting action: muted icon, first click arms (danger button + "click again" hint in
 * the same row), second click runs. Disarms by itself after a few seconds. `blocked` (the reason,
 * e.g. a busy Claude agent): disabled with that tooltip, and a change of it disarms.
 */
function ArmedAction({ icon, title, armedLabel, blocked, onConfirm, onArmedChange }: { icon: ReactNode; title: string; armedLabel: string; blocked?: string | null; onConfirm(): Promise<void>; onArmedChange(armed: boolean): void }) {
  const [armed, setArmed] = useArmed(blocked);
  const [busy, setBusy] = useState(false);
  useEffect(() => onArmedChange(armed), [armed, onArmedChange]);
  if (!armed || blocked)
    return (
      <IconButton title={blocked ?? title} disabled={busy || !!blocked} onClick={() => setArmed(true)}>
        {icon}
      </IconButton>
    );
  return (
    <button
      title={title}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onConfirm().finally(() => (setBusy(false), setArmed(false)));
      }}
      className={`${ARMED_BUTTON} flex h-6 items-center gap-1 whitespace-nowrap`}
    >
      {icon}
      {armedLabel}
    </button>
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

/** One 「⋯」 menu row; `run` is what selecting it does. */
type MoreAction = { value: string; label: string; icon?: ReactNode; disabled?: boolean; title?: string; run(): void };

/** The floating action bar (design 040 step 10): an e2 pill. */
const BAR = "inline-flex h-7 items-center rounded-ctl bg-background p-0.5 shadow-e2 transition-opacity";
/** Hover / keyboard focus of the message (`group`) shows the bar. */
const ON_HOVER = "opacity-0 group-hover:opacity-100 focus-within:opacity-100";

/** Fold / unfold by hand (long-message folding) as a menu row; nothing when there is nothing to fold. */
function foldAction(fold: MessageFold | undefined, t: ReturnType<typeof useI18n>["t"]): MoreAction | null {
  if (!fold) return null;
  if (fold.overflowing) return { value: "fold", label: t("fold.unfold"), icon: <ChevronsUpDown size={ICON} />, run: () => fold.setFolded(false) };
  if (!fold.canFold) return null;
  return { value: "fold", label: t("fold.fold"), icon: <ChevronsDownUp size={ICON} />, run: () => fold.setFolded(true) };
}

/** 「⋯」: the row's own secondary actions, then the `ref.action` items for the turn (built when it opens). */
function MoreMenu({ actions, build }: { actions: MoreAction[]; build?: () => CutexRef | null }) {
  const { t } = useI18n();
  if (!actions.length && !build) return null;
  const open = (anchor: HTMLElement) => {
    const own: MenuEntry[] = actions.map((a): MenuAction => ({ label: a.label, icon: a.icon, disabled: a.disabled, title: a.title, onSelect: a.run }));
    const entries = [...own, ...(build ? refActionEntries(build(), own.length > 0, true) : [])];
    if (entries.length) openMenuFrom(anchor, entries);
  };
  return (
    <IconButton title={t("gutter.more")} onClick={() => {}} menu={open}>
      <MoreHorizontal size={ICON} />
    </IconButton>
  );
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
  const fork = () => {
    setForking(true);
    requestFork(sessionId, bar.turnId, hostId).catch(report).finally(() => setForking(false));
  };
  const more = [
    foldAction(fold, t),
    !readOnly && { value: "quote", label: t("reply.quote"), icon: <MessageSquareQuote size={ICON} />, run: () => useApp.getState().insertIntoComposer(sessionId, quoteText(bar.text), "append", undefined, hostId) },
    canRevert && { value: "revert", label: t("reply.revert"), icon: <History size={ICON} />, disabled: !!blocked, title: blocked ?? t(revertHint, { n: bar.laterTurns }), run: () => (setWithFiles(false), setArmed(true)) },
    canRevertFiles && { value: "revertFiles", label: t("reply.revertWithFiles"), icon: <FileClock size={ICON} />, disabled: !!blocked, title: blocked ?? t("reply.revertFilesHint", { n: bar.laterTurns }), run: () => (setWithFiles(true), setArmed(true)) },
  ].filter((a): a is MoreAction => !!a);
  const shown = armed || forking ? "opacity-100" : ON_HOVER;
  const build = readOnly ? undefined : () => turnRefNow(sessionId, bar.turnId, bar.text);
  return (
    <div className="flex h-7 min-w-0 items-center gap-2" data-reply-row="">
      {status}
      <span className="flex-1" />
      <div className={`${BAR} ${shown}`} data-reply-bar="" role="toolbar" aria-label={t("reply.actions")}>
      <CopyButton text={bar.text} />
      {canFork && (
        <IconButton title={forkBlocked ?? t("reply.fork")} disabled={forking || !!forkBlocked} onClick={fork}>
          <GitFork size={ICON} />
        </IconButton>
      )}
      {build && <RefActionButtons kind="turn" build={build} hoverBar />}
      <MoreMenu actions={more} build={build} />
      {armed && canRevert && !blocked && (
        <>
          <Divider />
          <ArmedConfirm
            icon={withFiles && canRevertFiles ? <FileClock size={ICON} /> : <History size={ICON} />}
            title={t(withFiles && canRevertFiles ? "reply.revertFilesHint" : revertHint, { n: bar.laterTurns })}
            label={t(withFiles && canRevertFiles ? "reply.revertFilesArmed" : "reply.revertArmed", { n: bar.laterTurns })}
            onDone={() => setArmed(false)}
            onConfirm={() => useApp.getState().revertTo(sessionId, bar.nextTurnId!, { hostId, ...(withFiles && canRevertFiles ? { rewindFiles: true } : {}) }).catch(report)}
          />
        </>
      )}
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
  const [armed, setArmed] = useState(false);
  const report = useReport();
  const hostId = useConvViewHost(sessionId);
  const texts = revertTexts(useAgentFeatures(sessionId)?.runtime);
  const more = [foldAction(fold, t)].filter((a): a is MoreAction => !!a);
  return (
    <div className="flex h-7 items-center justify-end">
    <div className={`${BAR} ${armed ? "opacity-100" : ON_HOVER}`} data-user-bar="" role="toolbar" aria-label={t("reply.actions")}>
      {text && <CopyButton text={mentionPlainText(text)} />}
      {canRevert && turnId && (
        <ArmedAction
          icon={<PencilLine size={ICON} />}
          title={t(texts.editResendHint)}
          armedLabel={t("reply.editResendArmed", { n: dropped })}
          blocked={blocked}
          onArmedChange={setArmed}
          onConfirm={() => useApp.getState().editAndResend(sessionId, turnId, text, hostId, extra).catch(report)}
        />
      )}
      {turnId && <RefActionButtons kind="turn" build={() => turnRefNow(sessionId, turnId, text)} hoverBar />}
      <MoreMenu actions={more} build={turnId ? () => turnRefNow(sessionId, turnId, text) : undefined} />
    </div>
    </div>
  );
}
