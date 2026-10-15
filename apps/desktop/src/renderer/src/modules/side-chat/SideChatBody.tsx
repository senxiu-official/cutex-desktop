import { useEffect, useMemo, useRef } from "react";
import { ArrowUp, Loader2, StickyNote, Square } from "lucide-react";
import { Streamdown } from "streamdown";
import { InteractionDock } from "../../components/InteractionDock";
import { ModelName } from "../../components/ModelName";
import { useI18n } from "../../i18n";
import { useStreamdownTranslations } from "../../lib/streamdownTranslations";
import { orderedEntries, type TimelineEntry } from "../../lib/timeline";
import { toolDetail, toolOutput } from "../../lib/workGroups";
import { services } from "../app";
import { useModulePref, useModuleStatuses } from "../react";
import { SIDE_MESSAGE_LIMIT } from "../../../../shared/sideChat";
import { sideErrorText } from "./errors";
import { sideError, sideTimeline, SUMMARY_PROMPT } from "./model";
import { interruptSide, loadSide, respondSide, sendSide, setSideDraft, sideKey, summarizeSide, useSides } from "./state";

function SideEntry({ entry }: { entry: TimelineEntry }) {
  const { t } = useI18n();
  const translations = useStreamdownTranslations();
  if (entry.kind === "user") return <div className="ml-auto max-w-[90%] rounded-2xl bg-surface-2 px-4 py-3 whitespace-pre-wrap break-words text-sm">{entry.text}</div>;
  if (entry.kind === "agent" || entry.kind === "plan" || entry.kind === "review") return <div className="min-w-0 text-sm"><Streamdown mode="static" className="markdown" translations={translations}>{entry.text}</Streamdown></div>;
  if (entry.kind === "tool" || entry.kind === "other") return <details className="min-w-0 rounded-lg border border-border px-3 py-2 text-xs text-muted"><summary className="cursor-pointer truncate">{toolDetail(entry.item) || entry.item.type}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{toolOutput(entry.item) ?? JSON.stringify(entry.item, null, 2)}</pre></details>;
  if (entry.kind === "reasoning") return <details className="text-xs text-subtle"><summary className="cursor-pointer">{t("side-chat.reasoning")}</summary><div className="mt-2 whitespace-pre-wrap">{[...entry.summary, ...entry.content].join("\n")}</div></details>;
  return null;
}

/** Self-contained Body: no selectedId, no container chrome, transient drafts live in module store. */
export function SideChatBody({ hostId: host, sessionId, chatId, revealed, visible }: { hostId: string; sessionId: string; chatId: string; revealed: number; visible: boolean }) {
  const { t } = useI18n();
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
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing && !e.defaultPrevented && !e.repeat && busy && chat.pendingRequests.length === 0) {
      e.preventDefault();
      void interruptSide(host, chatId);
    }
  }}>
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-2 text-xs text-subtle">
      <span>{t("side-chat.temporary")}</span><ModelName id={chat.model} className="ml-auto truncate" />
    </div>
    <div ref={scroller} onScroll={e => { const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
        {chat.anchorTurnId && <div className="truncate text-xs text-subtle" title={chat.anchorTurnId}>{t("side-chat.source", { turn: chat.anchorTurnId })}</div>}
        {chat.truncated && <p className="text-xs text-muted">{t("side-chat.truncated")}</p>}
        {entries.length === 0 && <p className="py-8 text-center text-sm text-subtle">{t("side-chat.empty")}</p>}
        {entries.map(entry => <SideEntry key={entry.id} entry={entry} />)}
        {busy && <div className="flex items-center gap-2 text-xs text-subtle"><Loader2 size={13} className="animate-spin" />{t("side-chat.running")}</div>}
        {error && <div role="alert" className="rounded-lg border border-danger/30 p-3 text-xs text-danger">{sideErrorText(error, t)}<button className="ml-3 underline" onClick={() => void loadSide(host, sessionId, chatId).catch(() => {})}>{t("side-chat.retry")}</button></div>}
        {chat.status === "stale" && <p className="text-sm text-muted">{t("side-chat.stale")}</p>}
        {chat.status === "closed" && <p className="text-sm text-muted">{t("side-chat.closed")}</p>}
        {summary?.status === "saved" && summary.noteId && <button className="self-start rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent" onClick={() => void services.refs.open({ hostId: host, kind: "notes.note", key: summary.noteId!, title: summary.input?.title ?? t("side-chat.saved"), params: { noteId: summary.noteId! } })}>{t("side-chat.saved")} →</button>}
        {summary?.error && <p role="alert" className="text-xs text-danger">{summary.error === "no-summary" ? t("side-chat.noSummary") : summary.error === "note-too-long" ? t("side-chat.noteTooLong") : sideErrorText(summary.error, t)}</p>}
      </div>
    </div>
    <InteractionDock pending={chat.pendingRequests.map(r => ({ ...r, params: r.params ?? {} }))} onReply={(request, reply) => void respondSide(host, chatId, request.id, reply)} />
    <div className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!notesActive || !canSummarize || !!view.pendingMessage || entries.length === 0} title={!notesActive ? t("side-chat.notesOff") : undefined} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-40" onClick={() => void summarizeSide(host, chatId, String(prompt), String(anchorMode))}>
          <StickyNote size={13} />{summary?.status === "saving" ? t("side-chat.saving") : generating ? t("side-chat.summarizing") : summary?.status === "failed" && summary.input ? t("side-chat.retrySave") : t("side-chat.summary")}
        </button>
        {busy && <button className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10" onClick={() => void interruptSide(host, chatId)}><Square size={11} />{t("side-chat.stop")}</button>}
      </div>
      <form className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2" onSubmit={e => { e.preventDefault(); if (ready) void sendSide(host, chatId); }}>
        <textarea ref={input} aria-label={t("side-chat.placeholder")} placeholder={t("side-chat.placeholder")} value={view.draft} maxLength={SIDE_MESSAGE_LIMIT} rows={2} disabled={chat.status === "stale" || chat.status === "closed" || !!view.pendingMessage} className="max-h-44 min-h-12 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none" onChange={e => setSideDraft(host, chatId, e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (ready) void sendSide(host, chatId); }
        }} />
        <button type="submit" disabled={!ready || !view.draft.trim()} aria-label={t(view.pendingMessage ? "side-chat.retrySend" : "side-chat.send")} title={t(view.pendingMessage ? "side-chat.retrySend" : "side-chat.send")} className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"><ArrowUp size={17} /></button>
      </form>
    </div>
  </div>;
}
