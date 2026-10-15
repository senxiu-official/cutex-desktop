// Action rows under messages (ZCode-like; UI review #15, side actions back inline 2026-10-15). Agent
// reply (bottom-left): 复制 · 分叉 · the modules' `ref.action` items (侧聊, 批注, 书签 … as icons; live
// state as a filled icon) · 「…」; user bubble (bottom-right): 复制 · 编辑并重发 · the same items · 「…」.
// The 「…」 menu (components/Menu) keeps the rare ones: 折叠 / 展开, 引用 and 回退到这里.
// The latest reply's row always shows; other rows on hover / keyboard focus only. The rows always take
// their height (only their opacity changes), so hovering never moves the timeline. The two
// history-rewriting actions (回退 / 编辑并重发) arm first (lib/armedConfirm): picking 回退 in the menu
// puts its armed confirm button into the row. Right-click entries stay available too.
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronsDownUp, ChevronsUpDown, Copy, GitFork, History, MessageSquareQuote, MoreHorizontal, PencilLine } from "lucide-react";
import type { MessageFold } from "../lib/foldView";
import { useI18n } from "../i18n";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";
import { quoteText, SESSION_FEATURES } from "../lib/menus";
import { copyQuietly } from "../lib/copyFeedback";
import type { ReplyBar } from "../lib/replyActions";
import { selectedFeatures, useApp } from "../store";
import { lacks } from "../lib/agentFeatures";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { structuralBlockText, structuralErrorText, useStructuralBlock } from "../lib/structuralGateView";
import { turnRefNow } from "../lib/refServices";
import { Menu, type MenuItem } from "./Menu";
import { RefActionButtons } from "./RefActions";

const ICON = 14;

function IconButton({ title, onClick, disabled, children }: { title: string; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
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

/** One 「…」 menu row; `run` is what selecting it does. */
type MoreAction = MenuItem<string> & { run(): void };

/** Fold / unfold by hand (long-message folding) as a menu row; nothing when there is nothing to fold. */
function foldAction(fold: MessageFold | undefined, t: ReturnType<typeof useI18n>["t"]): MoreAction | null {
  if (!fold) return null;
  if (fold.overflowing) return { value: "fold", label: t("fold.unfold"), icon: <ChevronsUpDown size={ICON} />, run: () => fold.setFolded(false) };
  if (!fold.canFold) return null;
  return { value: "fold", label: t("fold.fold"), icon: <ChevronsDownUp size={ICON} />, run: () => fold.setFolded(true) };
}

/** 「…」: the row's secondary actions (components/Menu, opens upward). */
function MoreMenu({ actions, align }: { actions: MoreAction[]; align: "left" | "right" }) {
  const { t } = useI18n();
  if (!actions.length) return null;
  return (
    <Menu
      trigger={<MoreHorizontal size={ICON} />}
      triggerTitle={t("gutter.more")}
      items={actions}
      selected={null}
      numbered={false}
      align={align}
      onSelect={(value) => actions.find((a) => a.value === value)?.run()}
    />
  );
}

function Divider() {
  return <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />;
}

/** Fork / revert failures: a Claude agent's busy refusal as information, anything else as an error. */
function useReport() {
  return (e: unknown) => {
    const { text, refused } = structuralErrorText(e);
    useApp.getState().notify(text, refused ? "info" : "error");
  };
}

/** Under the last message of a finished agent turn. */
export function ReplyActions({ sessionId, bar, readOnly, fold }: { sessionId: string; bar: ReplyBar; readOnly: boolean; fold?: MessageFold }) {
  const { t } = useI18n();
  const agent = useAgentFeatures(sessionId);
  const canFork = useApp((s) => selectedFeatures(s).has(SESSION_FEATURES.fork)) && !readOnly && !lacks(agent, "fork");
  const canRevert = useApp((s) => selectedFeatures(s).has(SESSION_FEATURES.revert)) && !readOnly && !!bar.nextTurnId && !lacks(agent, "historyRevert");
  // A busy Claude agent refuses fork / revert (lib/structuralGate): shown disabled with the reason.
  const block = useStructuralBlock(sessionId, agent);
  const blocked = block ? structuralBlockText(block) : null;
  const [forking, setForking] = useState(false);
  const [armed, setArmed] = useArmed(blocked);
  const report = useReport();
  const fork = () => {
    setForking(true);
    useApp.getState().forkSession(sessionId, bar.turnId).catch(report).finally(() => setForking(false));
  };
  const more = [
    foldAction(fold, t),
    !readOnly && { value: "quote", label: t("reply.quote"), icon: <MessageSquareQuote size={ICON} />, run: () => useApp.getState().insertIntoComposer(sessionId, quoteText(bar.text), "append") },
    canRevert && { value: "revert", label: t("reply.revert"), icon: <History size={ICON} />, disabled: !!blocked, title: blocked ?? t("reply.revertHint", { n: bar.laterTurns }), run: () => setArmed(true) },
  ].filter((a): a is MoreAction => !!a);
  const shown = bar.latest || armed || forking ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <div className={`flex h-7 items-center gap-0.5 transition-opacity ${shown}`}>
      <CopyButton text={bar.text} />
      {canFork && (
        <IconButton title={blocked ?? t("reply.fork")} disabled={forking || !!blocked} onClick={fork}>
          <GitFork size={ICON} />
        </IconButton>
      )}
      {!readOnly && <RefActionButtons kind="turn" build={() => turnRefNow(sessionId, bar.turnId, bar.text)} />}
      <MoreMenu actions={more} align="left" />
      {armed && canRevert && !blocked && (
        <>
          <Divider />
          <ArmedConfirm
            icon={<History size={ICON} />}
            title={t("reply.revertHint", { n: bar.laterTurns })}
            label={t("reply.revertArmed", { n: bar.laterTurns })}
            onDone={() => setArmed(false)}
            onConfirm={() => useApp.getState().revertTo(sessionId, bar.nextTurnId!).catch(report)}
          />
        </>
      )}
    </div>
  );
}

/**
 * Under a user bubble, right-aligned, on hover. `dropped`: turns an edit & resend removes. `blocked`:
 * why edit & resend (a revert) is not possible right now (a busy Claude agent), shown disabled.
 */
export function UserActions({ sessionId, text, turnId, dropped, canRevert, blocked, fold }: { sessionId: string; text: string; turnId: string | null; dropped: number; canRevert: boolean; blocked?: string | null; fold?: MessageFold }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  const report = useReport();
  const more = [foldAction(fold, t)].filter((a): a is MoreAction => !!a);
  return (
    <div className={`flex h-6 items-center justify-end gap-0.5 transition-opacity ${armed ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
      <CopyButton text={text} />
      {canRevert && turnId && (
        <ArmedAction
          icon={<PencilLine size={ICON} />}
          title={t("reply.editResendHint")}
          armedLabel={t("reply.editResendArmed", { n: dropped })}
          blocked={blocked}
          onArmedChange={setArmed}
          onConfirm={() => useApp.getState().editAndResend(sessionId, turnId, text).catch(report)}
        />
      )}
      {turnId && <RefActionButtons kind="turn" build={() => turnRefNow(sessionId, turnId, text)} />}
      <MoreMenu actions={more} align="right" />
    </div>
  );
}
