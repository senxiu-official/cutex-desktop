import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { WorkspaceScope } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { SubAgentContext, subAgentsOf } from "../lib/subagents";
import { useSubAgentMeta } from "../lib/subagentMetaStore";
import { useAgentOnline, useSettleSubAgents, useSubAgentLive } from "../lib/background";
import { orderedEntries } from "../lib/timeline";
import { agentHost, selectedFeatures, selectedSidebar, useApp } from "../store";
import { Composer } from "./Composer";
import { InteractionDock } from "./InteractionDock";
import { StatusBar } from "./StatusBar";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { BusyDots } from "./BusyDots";
import { edgeOverlay, withReservation } from "../lib/overlayLayout";
import { ConversationDockContext } from "../lib/conversationDock";
import { bandPadding, reservedBands, type Bands, type Box } from "../lib/timelineReserve";
import { ConversationOverlays } from "../modules/ConversationOverlays";
import type { OverlayLayout } from "../modules/slots";
import { openSubagentThread } from "../lib/sideOpen";
import { TimelineBody } from "./Timeline";
import { resetFolds } from "../lib/foldView";
import { composerDraftKey } from "../lib/composerDrafts";
import { isArchived } from "../lib/archivedAgent";
import { ArchivedBanner } from "./ArchivedBanner";
import { FirstRunPanel } from "./FirstRun";
import { firstRunView } from "../lib/firstRun";
import { hasNoHost, isRemote } from "../lib/hosts";
import { ReadOnlyComposerNote } from "./AccessNotices";
import { useHostAccess } from "../lib/hostAccess";
import { canSend } from "../../../shared/users";
import { registerViewport, reportScroll } from "../lib/jump";
import { GutterHost } from "./gutter/GutterHost";
import { ReturnChip } from "./gutter/ReturnChip";
import { subscribeBeforeFontChange, subscribeFontChanges } from "../lib/appearance";
import { captureFontScrollAnchor } from "../lib/fontScrollAnchor";
import { onFollowAfterSend, pendingFollowKey, scrollFollow } from "../lib/stickToBottom";

export function Conversation({ scope }: { scope: WorkspaceScope | null }) {
  const { t } = useI18n();
  const selectedId = useApp((s) => s.selectedId);
  const hostId = useApp(agentHost);
  // users: a non-owner whose grant has no `send` only reads this host's agents.
  const access = useHostAccess(hostId);
  const readOnly = !canSend(access);
  const view = useApp((s) => (s.selectedId ? s.sessions[s.selectedId] : undefined));
  const sidebar = useApp(selectedSidebar);
  const respond = useApp((s) => s.respond);
  const loadOlder = useApp((s) => s.loadOlder);
  const scroller = useRef<HTMLDivElement>(null);

  const session = useMemo(
    () => [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === selectedId),
    [sidebar, selectedId],
  );
  const nameOf = useMemo(() => {
    const names = new Map([...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map((s) => [s.cutexSessionId, s.displayName]));
    return (id: string) => names.get(id) ?? id;
  }, [sidebar]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => (view ? orderedEntries(view.timeline) : []), [view?.version, view?.timeline]);
  // The owner's pending sends (outbox, not timeline entries): followed like new entries.
  const pendingSends = useApp((s) => (s.selectedId ? pendingFollowKey(s.outbox[s.selectedId]) : ""));

  // Stick to the bottom while the user is there: on entering an agent, on new entries, and when
  // content grows after layout (markdown, code blocks, images). Scrolling up releases it; the
  // jump button (or scrolling back down) re-attaches.
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    let restore: (() => void) | undefined;
    const before = subscribeBeforeFontChange(() => {
      const el = scroller.current;
      restore = el ? captureFontScrollAnchor(el, stick.current) : undefined;
    });
    const after = subscribeFontChanges(() => {
      restore?.();
      restore = undefined;
    });
    return () => { before(); after(); };
  }, [selectedId]);
  // While a smooth jump animates, its own scroll events must not read as "user scrolled up".
  const jumping = useRef(0);
  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    if (smooth) {
      // The animation targets the height at its start; snap again once it has really ended.
      jumping.current += 1;
      const done = () => {
        jumping.current = Math.max(0, jumping.current - 1);
        if (stick.current) el.scrollTo({ top: el.scrollHeight });
      };
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        done();
      };
      el.addEventListener("scrollend", finish, { once: true });
      window.setTimeout(finish, 1500); // no scrollend if nothing moved
    }
  };
  /** A jump to an earlier turn (focusTurn / focusDelegation) lets go of the bottom. */
  const release = () => {
    stick.current = false;
    setAtBottom(false);
  };
  // The scroller at the last scroll event: only the owner scrolling UP lets go of the bottom — not the
  // viewport changing size (a card entering the dock above the composer) nor the browser's own
  // adjustment (scroll anchoring) in the frame where a new row landed (lib/stickToBottom).
  const lastScroll = useRef<{ top: number; clientHeight: number } | null>(null);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const prev = lastScroll.current;
    lastScroll.current = { top: el.scrollTop, clientHeight: el.clientHeight };
    if (jumping.current) return;
    const next = scrollFollow(stick.current, prev, { top: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    if (next.snap) {
      el.scrollTo({ top: el.scrollHeight });
      return;
    }
    stick.current = next.stick;
    setAtBottom(next.stick);
    reportScroll();
  };
  // 跳过去 / 回到 (lib/jump.ts): the reading position — the turn at the viewport's top and how far
  // into it, or stuck at the bottom.
  const toBottomRef = useRef(toBottom);
  toBottomRef.current = toBottom;
  useEffect(() => {
    if (!selectedId) return;
    return registerViewport({
      sessionId: selectedId,
      scroller: () => scroller.current,
      toBottom: () => toBottomRef.current(true),
      capture: () => {
        const el = scroller.current;
        if (!el) return null;
        const top = el.getBoundingClientRect().top;
        let turnId: string | null = null;
        let offset = 0;
        for (const a of el.querySelectorAll<HTMLElement>("[data-turn-id]")) {
          const r = a.getBoundingClientRect();
          if (turnId !== null && r.top > top + 1) break;
          turnId = a.dataset.turnId ?? null;
          offset = Math.round(top - r.top);
        }
        return { turnId, offset, atBottom: stick.current };
      },
    });
  }, [selectedId]);
  useLayoutEffect(() => {
    stick.current = true;
    setAtBottom(true);
    lastScroll.current = null;
    // Folded / unfolded-by-hand messages go back to the settings' defaults on switching agents.
    resetFolds();
  }, [selectedId]);
  // History pages: older turns are prepended above what the user is reading. Note the distance
  // from the bottom while the old content is still in the DOM (render phase) and restore it after
  // the commit, so the view does not jump.
  const firstTurn = view?.timeline.turns[0]?.id ?? null;
  const shownFirst = useRef<{ session: string | null; turn: string | null }>({ session: null, turn: null });
  const keepFromBottom = useRef<number | null>(null);
  if (shownFirst.current.session === selectedId && shownFirst.current.turn !== null && shownFirst.current.turn !== firstTurn && scroller.current && !stick.current) {
    keepFromBottom.current = scroller.current.scrollHeight - scroller.current.scrollTop;
  }
  shownFirst.current = { session: selectedId, turn: firstTurn };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
      return;
    }
    if (stick.current) el?.scrollTo({ top: el.scrollHeight });
  }, [entries, view?.loading, pendingSends]);
  // The owner sent from the composer: back to the bottom (even from a little above it) and follow
  // the new bubble / queue entry and the reply.
  useEffect(() => {
    if (!selectedId) return;
    return onFollowAfterSend((sessionId) => {
      if (sessionId !== selectedId) return;
      const el = scroller.current;
      stick.current = true;
      setAtBottom(true);
      el?.scrollTo({ top: el.scrollHeight });
    });
  }, [selectedId]);
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    });
    // border-box: the measured bands are the column's padding — a band growing must be followed too.
    ro.observe(el, { box: "border-box" });
    // The viewport shrinks too (a card enters the dock, the queue expands): stay at the bottom.
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, [selectedId]);

  const features = useApp(selectedFeatures);
  const daemon = useApp((s) => s.daemon);
  const remote = useApp((s) => isRemote(s.hosts));
  const agentCount = useApp((s) => (s.sidebar ? s.sidebar.active.length + s.sidebar.retired.length : null));
  const noHost = useApp((s) => hasNoHost(s.hosts));
  const firstRun = firstRunView(daemon, remote, agentCount, noHost);
  const sessionAction = useApp((s) => s.sessionAction);
  // Overlays (`conversation.overlay`, e.g. the status capsule) report the space they need; only the
  // column-anchored ones get the content inset, window-edge ones sit beside the column.
  const [reserved, setReserved] = useState<ReadonlyMap<string, OverlayLayout>>(() => new Map());
  const reserve = useCallback((id: string, layout: OverlayLayout | null) => setReserved((m) => withReservation(m, id, layout)), []);
  // What stays floating over the column (a reserving overlay's boxes, the gutter's top entries) is
  // measured: the column gets that band as padding (lib/timelineReserve), so nothing hides the first /
  // last message. A transient box (`data-overlay-transient`, e.g. the capsule's popover) reserves nothing.
  const frame = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const bands = useReservedBands(frame, scroller, content, reserved, selectedId);
  const pad = bandPadding(bands);
  // Keep the reading position when the top band changes while the user is up in the history.
  const shownTop = useRef(pad.top);
  useLayoutEffect(() => {
    const delta = pad.top - shownTop.current;
    shownTop.current = pad.top;
    const el = scroller.current;
    if (el && delta && !stick.current) el.scrollTop += delta;
  }, [pad.top]);
  // The gutters (§19) keep clear of an overlay floating beside the column at a window-edge corner.
  const edge = edgeOverlay(reserved.values());
  const edgeSide = edge?.side;
  const edgeAnchor = edge?.anchor;
  const corner = useMemo(() => (edgeSide && edgeAnchor ? { side: edgeSide, anchor: edgeAnchor } : null), [edgeSide, edgeAnchor]);
  const subAgentLive = useSubAgentLive(selectedId);
  const subAgentMeta = useSubAgentMeta();
  useSettleSubAgents(selectedId, view?.timeline ?? null, view?.version ?? 0, useAgentOnline(selectedId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subAgents = useMemo(() => ({ agents: subAgentsOf(view?.timeline ?? null, subAgentLive, subAgentMeta), open: openSubagentThread }), [view?.version, view?.timeline, subAgentLive, subAgentMeta]);

  if (!selectedId) {
    if (firstRun) return <FirstRunPanel view={firstRun} daemon={daemon} />;
    return <div className="flex flex-1 items-center justify-center text-subtle">{t("conversation.empty")}</div>;
  }
  const name = session?.displayName ?? selectedId;
  const busy = !!view?.timeline.activeTurnId;
  const runtimeStatus = session?.runtime.status;
  const canAutoStart = features.has("offline-submit");
  const archived = isArchived(session);
  const runtimeNote = archived
    ? null
    : view?.startError
      ? { tone: "text-danger", text: t("conversation.startFailed", { error: view.startError }) }
      : runtimeStatus === "starting"
        ? { tone: "text-accent", text: t(view?.queue.length ? "conversation.startingQueued" : "conversation.starting") }
        : runtimeStatus && runtimeStatus !== "online" && canAutoStart && view?.timeline.threadId
          ? { tone: "text-subtle", text: t("conversation.offlineAutoStart") }
          : null;

  return (
    <SubAgentContext.Provider value={subAgents}>
    <ConversationDockContext.Provider value={dock}>
    <main className="relative flex min-w-0 flex-1 flex-col">
      <div ref={frame} className="relative flex min-h-0 flex-1 flex-col">
      {/* Content dissolves into the composer area instead of being cut by a hard edge (a mask, so it
          works on any background / theme); the extra bottom padding keeps the last line clear of it. */}
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]">
        {/* The measured bands of what floats over the column (see useReservedBands); the top one also
            moves the sticky 收起 of an expanded long message (Foldable) below it. */}
        <div
          ref={content}
          data-timeline-root
          style={{ paddingTop: pad.top, paddingBottom: pad.bottom, ...(bands.top ? ({ "--fold-sticky-top": `${bands.top + 4}px` } as React.CSSProperties) : {}) }}
          className="side-col px-6"
        >
          {view?.loading && <p className="text-subtle">{t("conversation.loading")}</p>}
          {view?.error && <LoadError sessionId={selectedId} hostId={hostId} error={view.error} />}
          {view?.resyncing && <p className="text-warn">{t("conversation.resync")}</p>}
          {view && !view.loading && !view.error && !view.timeline.threadId && !archived && <p className="text-subtle">{t("conversation.offline")}</p>}
          {view && !view.loading && !view.error && archived && view.timeline.turns.length === 0 && (
            <p className="text-subtle">{t(features.has("offline-history") ? "archive.history.empty" : "archive.history.unsupported")}</p>
          )}
          {view?.historySource === "offline" && <p className="mb-2 text-center text-xs text-subtle">{t("conversation.offlineHistory")}</p>}
          {view?.historySource === "archived" && view.timeline.turns.length > 0 && <p className="mb-2 text-center text-xs text-subtle">{t("archive.history.note")}</p>}
          {view && <TimelineBody timeline={view.timeline} entries={entries} sessionId={selectedId} nameOf={nameOf} older={view.older} onLoadOlder={() => void loadOlder(selectedId)} pendingSends onRelease={release} />}
        </div>
      </div>
      {/* 到底部 + 回到 (after a jump, §19.7) share the bottom centre. */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-[6] flex -translate-x-1/2 items-center gap-2">
      <ReturnChip sessionId={selectedId} />
      {!atBottom && (
        <button
          onClick={() => toBottom(true)}
          title={t("conversation.toBottom")}
          className="group pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-lg hover:text-foreground"
        >
          {busy ? (
            <>
              <BusyDots className="group-hover:hidden" />
              <ArrowDown size={16} className="hidden group-hover:block" />
            </>
          ) : (
            <ArrowDown size={16} />
          )}
        </button>
      )}
      </div>
      <ConversationOverlays key={selectedId} sessionId={selectedId} onReserve={reserve} />
      </div>

      {/* 需要你: other agents that want the owner (sidebar v2; Settings → 外观 → 侧栏). */}
      <NeedsYouStrip sessionId={selectedId} />
      {/* The dock (lib/conversationDock): cards that ask the owner to act (browser claim), in flow above the composer. */}
      <div ref={setDock} data-conversation-dock className="flex flex-col empty:hidden" />
      {view && view.timeline.pending.size > 0 && (
        <InteractionDock
          pending={[...view.timeline.pending.values()]}
          onReply={(request, reply) => void respond(request.id, reply)}
        />
      )}
      {/* Archived: read-only; restoring brings the composer back. */}
      {archived && session && <ArchivedBanner session={session} />}
      {!archived && readOnly && <ReadOnlyComposerNote hostId={hostId} />}
      {/* Kept mounted (draft survives) but hidden while an interaction blocks — ZCode pattern. */}
      <div className={archived || readOnly || (view && view.timeline.pending.size > 0) ? "hidden" : undefined}>
        {runtimeNote && (
          <p className={`side-col px-6 pb-1 text-xs ${runtimeNote.tone}`}>
            {runtimeNote.text}
            {access.isOwner && runtimeStatus && runtimeStatus !== "online" && runtimeStatus !== "starting" && (
              <button onClick={() => void sessionAction(selectedId, "cutex/runtime/online", { openVisibleTerminal: false }).catch(() => {})} className="ml-2 text-accent hover:underline">
                {t("menu.start")}
              </button>
            )}
          </p>
        )}
        {/* Status row: the items placed above the input (Settings → 通用); also where goal editing happens. */}
        <StatusBar key={selectedId} sessionId={selectedId} />
        <Composer
          key={composerDraftKey(hostId, selectedId)}
          name={name}
          busy={busy}
          queue={view?.queue ?? []}
          timeline={view?.timeline ?? null}
          sessionId={selectedId}
          profile={session?.profile ?? session?.effectiveNextLaunch?.profile ?? null}
        />
      </div>
      {/* The gutters beside the reading column + the reference card (§19), over the whole card. */}
      <GutterHost sessionId={selectedId} hostId={hostId} scroller={scroller} corner={corner} />
    </main>
    </ConversationDockContext.Provider>
    </SubAgentContext.Provider>
  );
}

/**
 * The agent could not be read: which host was asked (an agent of another host opened on the wrong one
 * reads 「…不存在」 from that host) and 重新加载 (store `reloadSession`: re-routed to the host that lists it).
 */
function LoadError({ sessionId, hostId, error }: { sessionId: string; hostId: string; error: string }) {
  const { t } = useI18n();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label) ?? hostId;
  const reload = useApp((s) => s.reloadSession);
  const [busy, setBusy] = useState(false);
  const notFound = /^session_not_found\b/.test(error);
  return (
    <div role="alert" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-danger">
      <span>{notFound ? t("conversation.notFoundOnHost", { host }) : t("conversation.loadFailedOnHost", { host, error })}</span>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void reload(sessionId).finally(() => setBusy(false));
        }}
        className="rounded-md px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
      >
        {t("conversation.reload")}
      </button>
      {notFound && <span className="w-full text-xs text-subtle">{error}</span>}
    </div>
  );
}

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const sameBands = (a: Bands, b: Bands) => a.top === b.top && a.bottom === b.bottom;

/**
 * The boxes floating over the timeline that keep it clear: what the overlay items with a reservation
 * draw (`[data-overlay-item]`, pointer-transparent frames looked through, transient boxes skipped) and
 * the gutter's top entries. Re-measured on resize and DOM changes (one frame later, at most once per frame).
 */
function useReservedBands(
  frame: React.RefObject<HTMLDivElement | null>,
  scroller: React.RefObject<HTMLDivElement | null>,
  content: React.RefObject<HTMLDivElement | null>,
  reserved: ReadonlyMap<string, OverlayLayout>,
  sessionId: string | null,
): Bands {
  const [bands, setBands] = useState<Bands>({ top: 0, bottom: 0 });
  const ids = [...reserved.keys()].join("\n");
  useEffect(() => {
    const wrap = frame.current;
    const main = wrap?.closest("main");
    if (!wrap || !main) return;
    const reserving = ids ? ids.split("\n") : [];
    const drawn = (): HTMLElement[] => {
      const out: HTMLElement[] = [];
      const visit = (el: Element) => {
        for (const child of el.children) {
          if (!(child instanceof HTMLElement) || child.hasAttribute("data-overlay-transient")) continue;
          const cs = getComputedStyle(child);
          if (cs.display === "contents" || cs.pointerEvents === "none") visit(child);
          else out.push(child);
        }
      };
      for (const id of reserving) {
        const item = wrap.querySelector(`[data-overlay-item="${CSS.escape(id)}"]`);
        if (item) visit(item);
      }
      for (const top of main.querySelectorAll<HTMLElement>("[data-gutter-top]")) out.push(top);
      return out;
    };
    let frameId = 0;
    const observed = new Set<Element>();
    const ro = new ResizeObserver(() => schedule());
    const measure = () => {
      frameId = 0;
      const sc = scroller.current;
      const col = content.current;
      if (!sc || !col) return;
      const cs = getComputedStyle(col);
      const c = col.getBoundingClientRect();
      const column: Box = { left: c.left + parseFloat(cs.paddingLeft), right: c.right - parseFloat(cs.paddingRight), top: c.top, bottom: c.bottom };
      const els = drawn();
      for (const el of els) if (!observed.has(el)) (observed.add(el), ro.observe(el));
      const next = reservedBands(boxOf(sc.getBoundingClientRect()), column, els.map((el) => boxOf(el.getBoundingClientRect())));
      setBands((old) => (sameBands(old, next) ? old : next));
    };
    function schedule() {
      if (!frameId) frameId = requestAnimationFrame(measure);
    }
    ro.observe(wrap);
    if (content.current) ro.observe(content.current);
    // The gutter places its top entries by inline style; the overlays add / remove their boxes.
    // (Only these two layers: the timeline's own churn while streaming is not watched.)
    const mo = new MutationObserver(schedule);
    for (const layer of [wrap.querySelector("[data-overlay-root]"), main.querySelector("[data-gutter-layer]")])
      if (layer) mo.observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "data-overlay-transient"] });
    schedule();
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      ro.disconnect();
      mo.disconnect();
    };
  }, [frame, scroller, content, ids, sessionId]);
  return bands;
}
