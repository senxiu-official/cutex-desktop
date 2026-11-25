import { featuresOf, useApp } from "../../store";
import { DebugErrorDetails } from "../../components/DebugErrorDetails";
import { isImeComposing } from "../../lib/ime";
import { useEffect, useMemo, useRef } from "react";
import { ArrowUp, CornerUpLeft, Loader2, MessageSquareQuote, StickyNote, Square, X } from "lucide-react";
import { Markdown } from "../../components/Markdown";
import { AgentMarkdownScope } from "../../components/AgentMarkdownScope";
import { InteractionDock } from "../../components/InteractionDock";
import { ModelName } from "../../components/ModelName";
import { useI18n } from "../../i18n";
import { orderedEntries, type TimelineEntry } from "../../lib/timeline";
import { toolDetail, toolOutput } from "../../lib/workGroups";
import { services } from "../app";
import { useModulePref, useModuleStatuses } from "../react";
import { SIDE_MESSAGE_LIMIT } from "../../../../shared/sideChat";
import { sideErrorText } from "./errors";
import { quoteLines, sideError, sideTimeline, splitQuoted, SUMMARY_PROMPT } from "./model";
import { interruptSide, loadSide, respondSide, sendSide, setSideDraft, setSideQuote, sideKey, summarizeSide, useSides } from "./state";
import { useTurnLabel } from "./hooks";
import { turnRef } from "../../lib/refs";
import { btn } from "../../components/Button";
import { SelectionActions } from "../../components/SelectionActions";

/** Replies use the conversation renderer (components/Markdown: math, highlighted code, CJK, file / cutex links). */
export function SideEntry({ entry }: { entry: TimelineEntry }) {
  const { t } = useI18n();
  if (entry.kind === "user") {
    // 批注追问: a message starting with a quote (model.quotedMessage) shows it as one, the note below.
    const quoted = splitQuoted(entry.text);
    return <SelectionActions className="selectable ml-auto max-w-[90%] rounded-2xl bg-surface-2 px-4 py-3 whitespace-pre-wrap break-words text-sm">
      {quoted ? <><div data-side-sent-quote="" className="border-l-2 border-subtle/50 pl-2.5 text-muted">{quoted.quote}</div>{quoted.note && <div className="mt-2">{quoted.note}</div>}</> : entry.text}
    </SelectionActions>;
  }
  if (entry.kind === "agent" || entry.kind === "plan" || entry.kind === "review") return <div className="min-w-0" data-side-markdown=""><Markdown text={entry.text} streaming={entry.kind !== "review" && entry.streaming} /></div>;
  if (entry.kind === "tool" || entry.kind === "other") return <details className="min-w-0 rounded-lg border border-border px-3 py-2 text-xs text-muted"><summary className="cursor-pointer truncate">{toolDetail(entry.item) || entry.item.type}</summary><SelectionActions as="pre" className="selectable mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{toolOutput(entry.item) ?? JSON.stringify(entry.item, null, 2)}</SelectionActions></details>;
  if (entry.kind === "reasoning") return <details className="text-xs text-subtle"><summary className="cursor-pointer">{t("side-chat.reasoning")}</summary><div className="mt-2"><Markdown text={[...entry.summary, ...entry.content].join("\n\n")} streaming={entry.streaming} compact /></div></details>;
  return null;
}

/** Self-contained Body: no selectedId, no container chrome, transient drafts live in module store. */
export function SideChatBody({ hostId: host, sessionId, chatId, revealed, visible }: { hostId: string; sessionId: string; chatId: string; revealed: number; visible: boolean }) {
  const { t } = useI18n();
  const optionsV1 = useApp(s => featuresOf(s, host).has("user-input-options-v1"));
  const view = useSides(s => s.views[sideKey(host, chatId)]);
  const [prompt] = useModulePref("side-chat", "summaryPrompt", SUMMARY_PROMPT);
  const [anchorMode] = useModulePref("side-chat", "summaryAnchor", "start");
  const notesActive = useModuleStatuses().get("notes")?.state.kind === "active";
  const entries = useMemo(() => view ? orderedEntries(sideTimeline(view.chat)) : [], [view?.chat]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (visible && revealed) input.current?.focus(); }, [visible, revealed, !!view]);
  const following = useRef(true);
  useEffect(() => { if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [view?.chat.revision]);
  if (!view) return <p className="p-4 text-sm text-muted">{t("side-chat.loading")}</p>;
  const { chat, summary } = view;
  const busy = chat.status === "running";
  const generating = !!summary && ["requesting", "generating", "saving"].includes(summary.status);
  const ready = (chat.status === "ready" || (!!view.pendingMessage && chat.status === "running")) && !view.sending && !generating;
  const canSummarize = ready || (chat.status === "running" && summary?.status === "failed" && !summary.turnId && !view.sending);
  const error = view.error ?? sideError(chat);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={e => {
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !isImeComposing(e) && !e.defaultPrevented && !e.repeat && busy && chat.pendingRequests.length === 0) {
      e.preventDefault();
      void interruptSide(host, chatId);
    }
  }}>
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-2 text-xs text-subtle">
      <span>{t("side-chat.temporary")}</span><ModelName id={chat.model} className="ml-auto truncate" />
    </div>
    <div ref={scroller} onScroll={e => { const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
        {chat.anchorTurnId && <SourceTurn hostId={host} sessionId={sessionId} turnId={chat.anchorTurnId} />}
        {chat.truncated && <p className="text-xs text-muted">{t("side-chat.truncated")}</p>}
        {entries.length === 0 && <p className="py-8 text-center text-sm text-subtle">{t("side-chat.empty")}</p>}
        <AgentMarkdownScope paneId={`side-chat:${chatId}`} hostId={host} sessionId={sessionId} visible={visible}>{entries.map(entry => <SideEntry key={entry.id} entry={entry} />)}</AgentMarkdownScope>
        {busy && <div className="flex items-center gap-2 text-xs text-subtle"><Loader2 size={13} className="animate-spin" />{t("side-chat.running")}</div>}
        {error && <div role="alert" data-error-source={view.error ? "request" : "runtime"} className="rounded-lg border border-danger/30 p-3 text-xs text-danger">{view.error ? sideErrorText(error, t) : t("side-chat.runtimeError", { message: sideErrorText(error, t) ?? error })}<button className="ml-3 underline" onClick={() => void loadSide(host, sessionId, chatId).catch(() => {})}>{t("side-chat.retry")}</button><DebugErrorDetails error={error} source={view.error ? "side-chat.request" : "side-chat.runtime"} /></div>}
        {chat.status === "stale" && <p className="text-sm text-muted">{t("side-chat.stale")}</p>}
        {chat.status === "closed" && <p className="text-sm text-muted">{t("side-chat.closed")}</p>}
        {summary?.status === "saved" && summary.noteId && <button className="self-start rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent" onClick={() => void services.refs.open({ hostId: host, kind: "notes.note", key: summary.noteId!, title: summary.input?.title ?? t("side-chat.saved"), params: { noteId: summary.noteId! } })}>{t("side-chat.saved")} →</button>}
        {summary?.error && <p role="alert" className="text-xs text-danger">{summary.error === "no-summary" ? t("side-chat.noSummary") : summary.error === "note-too-long" ? t("side-chat.noteTooLong") : sideErrorText(summary.error, t)}</p>}
      </div>
    </div>
    <InteractionDock optionsV1={optionsV1} draftScope={{ hostId: host, sessionId: JSON.stringify([sessionId, "side-chat", chat.id]), runtimeGeneration: chat.runtimeGeneration }} pending={chat.pendingRequests.map(r => ({ ...r, params: r.params ?? {} }))} onReply={(request, reply) => void respondSide(host, chatId, request.id, reply)} />
    <div className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!notesActive || !canSummarize || !!view.pendingMessage || entries.length === 0} title={!notesActive ? t("side-chat.notesOff") : undefined} className={btn({ size: "sm" })} onClick={() => void summarizeSide(host, chatId, String(prompt), String(anchorMode))}>
          <StickyNote size={13} />{summary?.status === "saving" ? t("side-chat.saving") : generating ? t("side-chat.summarizing") : summary?.status === "failed" && summary.input ? t("side-chat.retrySave") : t("side-chat.summary")}
        </button>
        {busy && <button className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10" onClick={() => void interruptSide(host, chatId)}><Square size={11} />{t("side-chat.stop")}</button>}
      </div>
      <form className="rounded-2xl border border-border bg-surface px-3 py-2" onSubmit={e => { e.preventDefault(); if (!isImeComposing(e) && ready) void sendSide(host, chatId); }}>
        {view.quote && <QuoteChip hostId={host} sessionId={sessionId} chatId={chatId} locked={!!view.pendingMessage} />}
        <div className="flex items-end gap-2">
        <textarea ref={input} aria-label={t(view.quote ? "side-chat.annotatePlaceholder" : "side-chat.placeholder")} placeholder={t(view.quote ? "side-chat.annotatePlaceholder" : "side-chat.placeholder")} value={view.draft}
          maxLength={view.quote ? Math.max(0, SIDE_MESSAGE_LIMIT - quoteLines(view.quote.text).length - 2) : SIDE_MESSAGE_LIMIT} rows={2} disabled={chat.status === "stale" || chat.status === "closed" || !!view.pendingMessage} className="max-h-44 min-h-12 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none" onChange={e => setSideDraft(host, chatId, e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); if (ready) void sendSide(host, chatId); }
        }} />
        <button type="submit" disabled={!ready || !(view.draft.trim() || view.quote)} aria-label={t(view.pendingMessage ? "side-chat.retrySend" : "side-chat.send")} title={t(view.pendingMessage ? "side-chat.retrySend" : "side-chat.send")} className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40"><ArrowUp size={17} /></button>
        </div>
      </form>
    </div>
  </div>;
}

/** Back to the turn a passage / the side chat came from: the main timeline scrolls to it (services.refs jump). */
function useJumpToTurn(hostId: string, sessionId: string) {
  const { t } = useI18n();
  return async (turnId: string) => {
    const result = await services.refs.open(turnRef({ hostId, sessionId, turnId }), { how: "jump" });
    if (result.status !== "opened") services.ui.notice(t("side-chat.jumpFailed"), "error");
  };
}

/** The side chat's start turn (from the host: chat.anchorTurnId), with a link back to it. */
function SourceTurn({ hostId, sessionId, turnId }: { hostId: string; sessionId: string; turnId: string }) {
  const { t } = useI18n();
  const label = useTurnLabel(hostId, sessionId, turnId);
  const jump = useJumpToTurn(hostId, sessionId);
  return <div className="flex min-w-0 items-center gap-2 text-xs text-subtle" data-side-source="">
    <span className="truncate" title={turnId}>{t("side-chat.source", { turn: label })}</span>
    <button type="button" className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline" onClick={() => void jump(turnId)}><CornerUpLeft size={12} aria-hidden />{t("side-chat.quoteJump")}</button>
  </div>;
}

/** 批注追问: the quoted passage above the composer, its source link, and remove. */
function QuoteChip({ hostId, sessionId, chatId, locked }: { hostId: string; sessionId: string; chatId: string; locked: boolean }) {
  const { t } = useI18n();
  const quote = useSides(s => s.views[sideKey(hostId, chatId)]?.quote);
  const label = useTurnLabel(hostId, sessionId, quote?.turnId);
  const jump = useJumpToTurn(hostId, sessionId);
  if (!quote) return null;
  return <div data-side-quote="" className="mb-2 rounded-lg border-l-2 border-accent bg-surface-2 px-2.5 py-1.5 text-xs">
    <div className="flex min-w-0 items-center gap-2 text-subtle">
      <MessageSquareQuote size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{quote.turnId ? t("side-chat.quoteFrom", { turn: label }) : t("side-chat.quoteLabel")}</span>
      {quote.turnId && <button type="button" data-side-quote-jump="" className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline" onClick={() => void jump(quote.turnId!)}><CornerUpLeft size={12} aria-hidden />{t("side-chat.quoteJump")}</button>}
      <button type="button" disabled={locked} aria-label={t("side-chat.quoteRemove")} title={t("side-chat.quoteRemove")} className="ml-auto shrink-0 rounded p-0.5 hover:bg-hover disabled:opacity-40" onClick={() => setSideQuote(hostId, chatId, null)}><X size={12} /></button>
    </div>
    <p className="selectable mt-1 line-clamp-3 whitespace-pre-wrap break-words text-muted">{quote.text}</p>
  </div>;
}
