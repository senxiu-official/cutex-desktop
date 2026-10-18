// The side agent view (conversation.agent; docs/research/side-agent-view-20261018.md): another agent's
// live conversation in a right-side card — header (avatar, name, status line, 在主区打开), its timeline
// (row actions stay in the main area; the agent's messages to the owner keep their cards with 回复), its
// approvals / questions, the 「接下来」 queue and a slim composer.
// The store keeps it live while this body is mounted (retainSideAgent). The agent open in the main area
// shows a placeholder here (已在主区打开 · 换回) instead of rendering twice.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUp, Square } from "lucide-react";
import { useI18n } from "../../i18n";
import { agentFeaturesOf, lacks } from "../../lib/agentFeatures";
import { formatElapsed } from "../../lib/agentAttention";
import { isArchived } from "../../lib/archivedAgent";
import { useComposerDraft } from "../../lib/composerDrafts";
import { useHostAccess } from "../../lib/hostAccess";
import { agentRetraction, retractNotify } from "../../lib/notifyEvents";
import { hasUnlandedTurn, outboxAt, visibleQueue } from "../../lib/outbox";
import { pendingFollowKey } from "../../lib/stickToBottom";
import { useKeepOnPrepend } from "../../lib/keepOnPrepend";
import { pausedSection } from "../../lib/queuePause";
import { SIDE_AGENT_COMPONENT, type SideAgentParams } from "../../lib/sideKinds";
import { stopHeld } from "../../lib/stopHold";
import { orderedEntries } from "../../lib/timeline";
import { markSeenOn } from "../../lib/turnUnread";
import { agentHost, useApp, type SessionView } from "../../store";
import { canSend } from "../../../../shared/users";
import { Avatar } from "../../components/Avatar";
import { InteractionDock } from "../../components/InteractionDock";
import { QueuePanel } from "../../components/QueuePanel";
import { TimelineBody } from "../../components/Timeline";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBodyProps } from "../slots";
import { useAgentResource, useInMain, useSince } from "./sideAgentData";
import { useNames } from "./turnPeekData";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SideAgentBody({ instance, hostId, visible, open, close }: SideBodyProps<SideAgentParams>) {
  const { t } = useI18n();
  const sessionId = instance.state.sessionId;
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const host = hostId ?? focus;
  const conn = useApp((s) => s.hosts?.hosts.find((h) => h.id === host)?.conn?.epoch ?? null);
  const inMain = useInMain(host, sessionId);
  const resource = useAgentResource(host, sessionId);
  const name = resource?.displayName ?? sessionId;
  // Live while mounted and its host is connected; again after a host switch / reconnect dropped it (the
  // store forgets that host's views).
  const ready = useApp((s) => (host === focus ? s.daemon : s.byHost[host]?.daemon)?.kind === "connected");
  useEffect(() => (ready ? useApp.getState().retainSideAgent(sessionId, host) : undefined), [ready, sessionId, host, conn, focus]);
  const live = useApp((s) => s.sideAgents[sessionId]?.hostId === host);
  const shown = visible && !inMain;
  useEffect(() => {
    if (live) useApp.getState().setSideAgentVisible(sessionId, shown);
  }, [live, sessionId, shown]);
  // Looking at it takes back its alerts and its done / failed mark, like opening it in the main area.
  useEffect(() => {
    if (!shown) return;
    const look = () => {
      if (!document.hasFocus()) return;
      markSeenOn(host, sessionId);
      retractNotify(agentRetraction(sessionId));
    };
    look();
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [shown, host, sessionId]);
  // 换回: the agent the main area showed before this one (same host).
  const selected = useApp((s) => (agentHost(s) === host ? s.selectedId : null));
  const [before, setBefore] = useState<string | null>(null);
  useEffect(() => {
    if (selected && selected !== sessionId) setBefore(selected);
  }, [selected, sessionId]);
  const names = useNames(host);

  /** 在主区打开: this agent goes to the main area, the main area's agent takes its place here. */
  const toMain = () => {
    const s = useApp.getState();
    const previous = agentHost(s) === host ? s.selectedId : null;
    void s.select(sessionId, host);
    if (previous && previous !== sessionId) {
      open(SIDE_AGENT_COMPONENT, { sessionId: previous }, { binding: { kind: "host", hostId: host }, pin: true });
      close();
    }
  };

  if (inMain) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
        <Avatar name={name} avatar={resource?.avatar} seed={sessionId} size={28} />
        <p>{t("conversation.agent.inMain", { name })}</p>
        {before && (
          <button
            onClick={() => void useApp.getState().select(before, host)}
            title={t("conversation.agent.swapBackHint", { name: names(before) })}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-hover"
          >
            {t("conversation.agent.swapBack")}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Avatar name={name} avatar={resource?.avatar} seed={sessionId} size={24} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">{name}</div>
          <StatusLine sessionId={sessionId} resource={resource} />
        </div>
        <button
          onClick={toMain}
          title={t("conversation.agent.openMainHint")}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
        >
          <ArrowLeftRight size={13} />
          {t("conversation.agent.openMain")}
        </button>
      </header>
      <SideAgentConversation sessionId={sessionId} hostId={host} name={name} resource={resource} />
    </div>
  );
}

/** 运行中 · 1m / 空闲 / 离线 / 已归档 under the name. */
function StatusLine({ sessionId, resource }: { sessionId: string; resource: SessionResource | undefined }) {
  const { t } = useI18n();
  const view = useApp((s) => s.sessions[sessionId]);
  const active = view?.timeline.activeTurnId ?? null;
  const startedAt = active ? (view?.timeline.turns.find((x) => x.id === active)?.startedAt ?? null) : null;
  const elapsed = useSince(startedAt === null ? null : startedAt * 1000);
  const status = resource?.runtime.status;
  const [text, tone] = isArchived(resource)
    ? [t("conversation.agent.archived"), "text-subtle"]
    : active
      ? [t("conversation.agent.running", { time: formatElapsed(elapsed) }), "text-accent"]
      : status === "starting"
        ? [t("conversation.agent.starting"), "text-accent"]
        : status && status !== "online"
          ? [t("conversation.agent.offline"), "text-subtle"]
          : [t("conversation.agent.idle"), "text-subtle"];
  return <div className={`truncate text-[11px] ${tone}`}>{text}</div>;
}

function SideAgentConversation({ sessionId, hostId, name, resource }: { sessionId: string; hostId: string; name: string; resource: SessionResource | undefined }) {
  const { t } = useI18n();
  const view = useApp((s) => s.sessions[sessionId]);
  const names = useNames(hostId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => (view ? orderedEntries(view.timeline) : []), [view?.version, view?.timeline]);
  const pendingSends = useApp((s) => pendingFollowKey(s.outbox[sessionId]));
  // Stick to the bottom while the owner is there (scrolling up lets go).
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries, pendingSends, view?.loading]);
  // Older turns paged in at the top (scrolling up to 加载更早): stay on the turn being read instead of
  // landing on the thread's first turns.
  useKeepOnPrepend(scroller, sessionId, view?.timeline.turns[0]?.id ?? null, stick);
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const access = useHostAccess(hostId);
  const archived = isArchived(resource);
  const pending = view && view.timeline.pending.size > 0 ? [...view.timeline.pending.values()] : null;
  return (
    <>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[13px]">
        <div ref={content}>
          {(!view || view.loading) && <p className="text-xs text-subtle">{t("conversation.loading")}</p>}
          {view?.error && (
            <p role="alert" className="text-xs text-danger">
              {view.error}{" "}
              <button onClick={() => void useApp.getState().reloadSession(sessionId)} className="text-muted underline hover:text-foreground">
                {t("conversation.reload")}
              </button>
            </p>
          )}
          {view?.resyncing && <p className="text-xs text-warn">{t("conversation.resync")}</p>}
          {view && !view.loading && !view.error && !view.timeline.threadId && !archived && <p className="text-xs text-subtle">{t("conversation.offline")}</p>}
          {view && (
            <TimelineBody
              timeline={view.timeline}
              entries={entries}
              sessionId={sessionId}
              nameOf={names}
              readOnly
              ownerNotes
              pendingSends
              older={view.older}
              onLoadOlder={() => void useApp.getState().loadOlder(sessionId)}
            />
          )}
        </div>
      </div>
      {pending && <InteractionDock pending={pending} takeFocus={false} onReply={(request, reply) => void useApp.getState().respond(request.id, reply, sessionId)} />}
      {archived ? (
        <p className="shrink-0 px-3 pb-2 text-xs text-subtle">{t("conversation.agent.archived")}</p>
      ) : !canSend(access) ? null : (
        <div className={pending ? "hidden" : undefined}>
          {view && <SideComposer sessionId={sessionId} hostId={hostId} name={name} view={view} resource={resource} />}
        </div>
      )}
    </>
  );
}

/** The 「接下来」 queue panel and a plain input: Enter sends (steers into a running turn; queues for agents without steering). */
function SideComposer({ sessionId, hostId, name, view, resource }: { sessionId: string; hostId: string; name: string; view: SessionView; resource: SessionResource | undefined }) {
  const { t } = useI18n();
  const { text, setText } = useComposerDraft(hostId, sessionId);
  const outbox = useApp((s) => s.outbox[sessionId]);
  const queueHidden = useApp((s) => s.queueHidden[sessionId]);
  const pendingSteers = useApp((s) => s.pendingSteers[sessionId]);
  const handoff = useApp((s) => !!s.queueHandoff[sessionId]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const busy = !!view.timeline.activeTurnId;
  const sendBusy = busy || hasUnlandedTurn(outbox);
  const noSteer = lacks(agentFeaturesOf(resource), "turnSteer");
  const entryCount = view.timeline.entries.size;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownQueue = useMemo(() => visibleQueue(view.queue, queueHidden, outbox, view.timeline), [view.queue, queueHidden, outbox, view.timeline, entryCount]);
  const paused = useMemo(() => pausedSection(pendingSteers ?? [], shownQueue, view.queuePause, handoff), [pendingSteers, shownQueue, view.queuePause, handoff]);
  const app = useApp.getState;
  const report = (e: unknown) => setError(errorText(e));
  const send = () => {
    const value = text;
    if (!value.trim()) return;
    // Only the text: images / skills picked in the main composer stay in the draft there.
    setText("");
    setError(null);
    void app().submit(value, sendBusy && noSteer ? "queue" : "auto", [], { sessionId }).catch(report);
  };
  const stop = () => {
    setStopping(true);
    void app().interrupt(sessionId).catch(report).finally(() => setStopping(false));
  };
  return (
    <div className="shrink-0 px-2 pb-2">
      <QueuePanel
        sessionId={sessionId}
        steers={pendingSteers ?? []}
        sendingSteers={outboxAt(outbox, "steer")}
        sendingQueue={outboxAt(outbox, "queue")}
        outbox={{
          onRetry: (id) => app().retrySend(sessionId, id),
          onEdit: (id) => app().editSend(sessionId, id),
          onDiscard: (id) => app().discardSend(sessionId, id),
        }}
        onInterruptSendSteers={() => void app().interruptAndSendSteers(sessionId).catch(report)}
        onDismissSteer={(id) => app().dismissSteer(id, sessionId)}
        paused={paused}
        onResumePaused={() => void app().resumePaused(sessionId).catch(report)}
        onRestorePaused={() => void app().restorePaused(sessionId).catch(report)}
        onClearPaused={() => void app().discardPaused(sessionId).catch(report)}
        items={shownQueue}
        canEdit={!text.trim()}
        onSendNow={noSteer && sendBusy ? undefined : (item) => void app().queueSendNow(item, sessionId).catch(report)}
        sendNowStartsTurn={!sendBusy}
        onDelete={(item) => void app().queueRemove(item, sessionId).catch(report)}
        onEdit={(item) => void app().queueTakeForEdit(item, sessionId).then((value) => setText(value), report)}
        stopHold={stopHeld(view.asksPaused)}
        running={busy}
      />
      {error && <p className="px-1 pb-1 text-[11px] text-danger">{error}</p>}
      <div className="flex items-end gap-1.5 rounded-xl border border-border bg-surface px-2 py-1.5 focus-within:border-accent/60">
        <textarea
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={busy ? t(noSteer ? "conversation.agent.busyQueue" : "conversation.agent.busySteer") : t("conversation.agent.placeholder", { name })}
          className="max-h-40 min-h-[22px] flex-1 resize-none bg-transparent text-[13px] leading-5 outline-none [field-sizing:content] placeholder:text-subtle"
        />
        {busy && (
          <button onClick={stop} disabled={stopping} title={t("conversation.agent.stop")} aria-label={t("conversation.agent.stop")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground hover:bg-hover disabled:opacity-50">
            <Square size={10} fill="currentColor" />
          </button>
        )}
        <button
          onClick={send}
          disabled={!text.trim()}
          title={t("conversation.agent.send")}
          aria-label={t("conversation.agent.send")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent/85 disabled:bg-surface-2 disabled:text-subtle"
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  );
}
