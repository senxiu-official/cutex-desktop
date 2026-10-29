import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConversationStructure } from "../lib/streamRender";
import { StreamRenderProvider } from "./StreamRenderProvider";
import { SLOW_START_MS, useElapsed, useRuntimeStartSince } from "../lib/runtimeStart";
import { ArrowDown, X } from "lucide-react";
import type { WorkspaceScope } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { SubAgentContext, subAgentsOf } from "../lib/subagents";
import { useSubAgentMeta } from "../lib/subagentMetaStore";
import { useAgentOnline, useSettleSubAgents, useSubAgentLive } from "../lib/background";
import { orderedEntries } from "../lib/timeline";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { offlineAutoStartNote } from "../lib/runtimeWording";
import { agentState, useApp } from "../store";
import { useConvFeatures, useConvHost, useConvScope, useConvSession, useConvSidebar } from "../lib/conversationScope";
import { Composer } from "./Composer";
import { InteractionDock } from "./InteractionDock";
import { StatusBar } from "./StatusBar";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { BusyDots } from "./BusyDots";
import { edgeOverlay, withReservation } from "../lib/overlayLayout";
import { ConversationDockContext } from "../lib/conversationDock";
import { bandPadding, leadBand, reservedBands, type Bands, type Box } from "../lib/timelineReserve";
import { ConversationOverlays } from "../modules/ConversationOverlays";
import type { OverlayLayout } from "../modules/slots";
import { openSubagentThread } from "../lib/sideOpen";
import { MemoTimelineBody } from "./Timeline";
import { useFarRows } from "../lib/farRows";
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
import { anchorRows, keepRowsUp as keepRows, onFollowAfterSend, pendingFollowKey, scrollFollow, turnFollowKey, watchScrollIntent, type RowsAnchor, type ScrollIntentWatch } from "../lib/stickToBottom";
import { useTimelineShapeRev } from "../lib/timelineShape";
import { dismissImageHistoryHint, imageHeavyHistory } from "../lib/imageHistoryHint";
import { setUiPref, useUiPrefs } from "../lib/prefs";
import { flushSync } from "react-dom";
import { composerInputMax, createShortPaneStore, measureComposerInput, measureShortPane, overlayMax, ShortPaneContext, shortPaneFold } from "../lib/shortPane";
import { UserLayoutToggleContext, type UserLayoutToggle } from "../lib/userLayoutToggle";
import { isHTMLElement } from "../lib/ownerWindow";
import { useOwnerWindow } from "../lib/ownerContext";

// The parts around the rows re-render with their own props / stores, not with every streamed frame of
// the conversation (perf baseline 2026-10-20, fix order 4). The composer reads the timeline (updated in
// place) through `timelineRev` (lib/timelineShape): text deltas do not move it.
const MemoComposer = memo(Composer);
const MemoStatusBar = memo(StatusBar);
const MemoNeedsYouStrip = memo(NeedsYouStrip);
const MemoGutterHost = memo(GutterHost);
const MemoOverlays = memo(ConversationOverlays);
const NO_QUEUE: never[] = [];

export function Conversation({ scope }: { scope: WorkspaceScope | null }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  // The scope's agent and host (lib/conversationScope; the main pane's = the selection).
  const selectedId = useConvSession();
  const hostId = useConvHost();
  // users: a non-owner whose grant has no `send` only reads this host's agents.
  const access = useHostAccess(hostId);
  const readOnly = !canSend(access);
  const view = useConversationStructure(hostId, selectedId);
  const sidebar = useConvSidebar();
  const respond = useApp((s) => s.respond);
  // The approval card names the asking runtime's sandbox (DSH's own approvals are not Codex's).
  const agentRuntime = useAgentFeatures(selectedId).runtime;
  const loadOlder = useApp((s) => s.loadOlder);
  const imageHistoryHintDone = useUiPrefs().imageHistoryHintDone;
  const scroller = useRef<HTMLDivElement>(null);

  const session = useMemo(
    () => [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === selectedId),
    [sidebar, selectedId],
  );
  // Our own 启动运行时 still waiting for cutex (lib/runtimeStart); after a while the note says so.
  const startSince = useRuntimeStartSince(hostId, selectedId);
  const startSlow = useElapsed(startSince, SLOW_START_MS);
  // Keyed on the id → name pairs (not the sidebar snapshot): every timeline row (MemoEntry) compares
  // `nameOf`, and the sidebar is refreshed every couple of seconds while any agent works.
  const namePairs = useMemo(
    () => [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map((s) => `${s.cutexSessionId}\u0000${s.displayName}`).join("\u0001"),
    [sidebar],
  );
  const nameOf = useMemo(() => {
    const names = new Map(namePairs ? namePairs.split("\u0001").map((p) => p.split("\u0000") as [string, string]) : []);
    return (id: string) => names.get(id) ?? id;
  }, [namePairs]);
  const showImageHistoryHint = !!selectedId && !!view && !view.loading && !view.error && imageHeavyHistory(view.mediaRefs) && !imageHistoryHintDone.includes(selectedId);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => (view ? orderedEntries(view.timeline) : []), [view?.version, view?.timeline]);
  // The owner's pending sends (outbox, not timeline entries): followed like new entries.
  const pendingSends = useApp((s) => (selectedId ? pendingFollowKey(agentState(s.outbox, hostId, selectedId)) : ""));
  const loadOlderFor = useCallback(() => {
    if (selectedId) void loadOlder(selectedId, { hostId });
  }, [selectedId, hostId, loadOlder]);

  // Stick to the bottom while the user is there: on entering an agent, on new entries, and when
  // content grows after layout (markdown, code blocks, images). Scrolling up releases it; the
  // jump button (or scrolling back down) re-attaches.
  const content = useRef<HTMLDivElement>(null);
  // Rows far off screen skip style / layout / paint (lib/farRows, #19).
  useFarRows(scroller, content);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // History only moves up (owner 2026-10-26; lib/stickToBottom nextSlack): while following the bottom, no row on
  // screen goes down — what would pull one down (the live line leaving at a turn's end, the 需要你 strip or a status
  // row going away, the input box or 「接下来」 getting shorter, a row getting shorter) becomes blank room under the
  // rows (the spacer after the column), which new content — or the panel growing again — fills first. The pane itself
  // getting taller (window / divider resize) is not such a change: the rows stay at the bottom, the room shrinks.
  // A manual expand / collapse is the exception (UserLayoutToggleContext): its room and any room from before reset.
  // `anchor`: the rows on screen and where they were after the last layout change, and the pane's size then.
  const spacer = useRef<HTMLDivElement>(null);
  const slack = useRef(0);
  const anchor = useRef<RowsAnchor | null>(null);
  const setRoom = useCallback((px: number) => {
    slack.current = px;
    if (spacer.current) spacer.current.style.height = px ? `${px}px` : "";
  }, []);
  const keepRowsUp = useCallback((el: HTMLDivElement) => {
    const col = content.current;
    if (col) anchor.current = keepRows(el, col, anchor.current, slack.current, setRoom);
  }, [setRoom]);
  const userToggle = useCallback<UserLayoutToggle>((update) => {
    const following = stick.current;
    // Long-message folding has its own reading anchor. Commit it first; when following, the normal
    // bottom attachment below deliberately wins over that anchor.
    flushSync(update);
    if (!following) return;
    intent.current?.reset();
    stick.current = true;
    setAtBottom(true);
    const el = scroller.current;
    const col = content.current;
    if (el && col) anchor.current = keepRows(el, col, anchor.current, slack.current, setRoom, true);
    else {
      setRoom(0);
      anchor.current = null;
    }
  }, [setRoom]);
  useEffect(() => {
    let restore: (() => void) | undefined;
    const before = subscribeBeforeFontChange(() => {
      // A new font size re-lays every row: no room kept from before.
      setRoom(0);
      anchor.current = null;
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
    setRoom(0);
    anchor.current = null;
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
  /** An upward wheel or a jump to an earlier turn lets go, including during a smooth jump. */
  const release = useCallback(() => {
    const wasJumping = jumping.current > 0;
    jumping.current = 0;
    anchor.current = null;
    stick.current = false;
    const el = scroller.current;
    if (wasJumping && el) el.scrollTo({ top: el.scrollTop, behavior: "instant" });
    setAtBottom(false);
  }, []);
  // The scroller at the last scroll event: only the owner scrolling UP lets go of the bottom — not the
  // viewport changing size (a card entering the dock above the composer) nor the browser's own
  // adjustment (scroll anchoring, clamping) when rows land or leave (lib/stickToBottom). "The owner"
  // = their wheel / touch / keys / drag reached this scroller just before (watchScrollIntent).
  const lastScroll = useRef<{ top: number; clientHeight: number } | null>(null);
  const intent = useRef<ScrollIntentWatch | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const watch = watchScrollIntent(el, undefined, release);
    intent.current = watch;
    return () => {
      watch.dispose();
      if (intent.current === watch) intent.current = null;
    };
  }, [selectedId, release]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const prev = lastScroll.current;
    lastScroll.current = { top: el.scrollTop, clientHeight: el.clientHeight };
    if (jumping.current) return;
    const next = scrollFollow(stick.current, prev, { top: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }, intent.current?.user() ?? true);
    if (next.snap) {
      el.scrollTo({ top: el.scrollHeight });
      return;
    }
    if (!next.stick) {
      anchor.current = null;
      // Scrolled up past the room: it goes (nothing on screen moves).
      if (slack.current && el.scrollTop + el.clientHeight <= el.scrollHeight - slack.current) setRoom(0);
    } else if (!anchor.current) keepRowsUp(el);
    stick.current = next.stick;
    setAtBottom(next.stick);
    reportScroll();
  };
  // 跳过去 / 回到 (lib/jump.ts): the reading position — the turn at the viewport's top and how far
  // into it, or stuck at the bottom.
  const toBottomRef = useRef(toBottom);
  toBottomRef.current = toBottom;
  // One viewport is registered at a time: the focused conversation's (panes step 2).
  const paneFocused = useConvScope()?.focused ?? true;
  useEffect(() => {
    if (!selectedId || !paneFocused) return;
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
  }, [selectedId, paneFocused]);
  useLayoutEffect(() => {
    stick.current = true;
    setAtBottom(true);
    lastScroll.current = null;
    setRoom(0);
    anchor.current = null;
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
  // Rows that only grew (streamed text) are followed by the ResizeObserver below, after layout and
  // before paint; snapping here too would force a layout per streamed frame. New / removed rows, the
  // loading line, pending sends and a turn starting / ending (its header and live line; the oldest
  // shown turn leaving the top) still snap at once.
  const turnKey = turnFollowKey(view?.timeline);
  const followed = useRef<{ session: string | null; rows: number; loading: unknown; sends: unknown; turns: string } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
      return;
    }
    const prev = followed.current;
    followed.current = { session: selectedId, rows: entries.length, loading: view?.loading, sends: pendingSends, turns: turnKey };
    if (prev && prev.session === selectedId && prev.rows === entries.length && prev.loading === view?.loading && prev.sends === pendingSends && prev.turns === turnKey) return;
    if (stick.current) el?.scrollTo({ top: el.scrollHeight });
  }, [entries, view?.loading, pendingSends, turnKey]);
  // The owner sent from the composer: back to the bottom (even from a little above it) and follow
  // the new bubble / queue entry and the reply.
  useEffect(() => {
    if (!selectedId) return;
    return onFollowAfterSend((sessionId) => {
      if (sessionId !== selectedId) return;
      const el = scroller.current;
      // A wheel just before the send does not let go of the bottom the send went back to.
      intent.current?.reset();
      stick.current = true;
      setAtBottom(true);
      el?.scrollTo({ top: el.scrollHeight });
    });
  }, [selectedId]);
  // Short pane (lib/shortPane, owner 2026-10-26 option B): 「接下来」 folds to its header line where it would leave the
  // history under max(120 px, 30 % of the pane), its list then opens as an overlay. Measured first in the observer
  // below and applied synchronously (`sync`), so the fold and the blank it leaves under the rows (keepRowsUp) land
  // in the same frame. QueuePanel asks again (store.recheck) when its folded list changes size — no layout change.
  // Then the composer's input cap (`--composer-input-max`, lib/shortPane composerInputMax), read after the fold landed:
  // the input grows only while the history keeps its minimum, then scrolls inside itself.
  const [shortPane] = useState(createShortPaneStore);
  const fitShortPane = (sc: HTMLElement, sync: boolean) => {
    const main = sc.closest("main");
    const m = main && measureShortPane(main, sc);
    if (!main || !m) return;
    const fold = shortPaneFold(m);
    if (fold !== shortPane.get()) {
      if (sync) flushSync(() => shortPane.set(fold));
      else shortPane.set(fold);
    }
    const max = `${overlayMax(sc.clientHeight)}px`;
    if (main.style.getPropertyValue("--short-pane-overlay-max") !== max) main.style.setProperty("--short-pane-overlay-max", max);
    fitComposerInput(main, sc);
  };
  const fitComposerInput = (main: HTMLElement, sc: HTMLElement) => {
    const input = measureComposerInput(main);
    if (!input) return;
    const cap = `${composerInputMax(main.clientHeight, sc.clientHeight, input)}px`;
    if (main.style.getPropertyValue("--composer-input-max") !== cap) main.style.setProperty("--composer-input-max", cap);
  };
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    shortPane.onRecheck = () => {
      if (scroller.current) fitShortPane(scroller.current, false);
    };
    const ro = new win.ResizeObserver(() => {
      const sc = scroller.current;
      if (!sc) return;
      fitShortPane(sc, true);
      if (!stick.current) return;
      sc.scrollTo({ top: sc.scrollHeight });
      keepRowsUp(sc);
    });
    // border-box: the measured bands are the column's padding — a band growing must be followed too.
    ro.observe(el, { box: "border-box" });
    // The viewport shrinks too (a card enters the dock, the queue expands): stay at the bottom.
    if (scroller.current) ro.observe(scroller.current);
    // The pane itself (keepRowsUp tells its resize from changes inside it), also when the history is 0 px tall.
    const pane = scroller.current?.closest("main");
    if (pane) ro.observe(pane);
    // The composer block (cap only): in a pane already overflowing (history 0 px) the input shrinking to its cap
    // resizes nothing the observer above watches, yet may leave room to give back — measure the cap again.
    const block = pane?.querySelector("[data-composer-block]");
    const capRo = new win.ResizeObserver(() => {
      if (pane && scroller.current) fitComposerInput(pane, scroller.current);
    });
    if (block) capRo.observe(block);
    return () => {
      ro.disconnect();
      capRo.disconnect();
      shortPane.onRecheck = null;
    };
  }, [selectedId]);

  const features = useConvFeatures();
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
  // The gutter's top entries over the column (no gutter beside it): the timeline starts below them, in flow.
  const lead = bands.lead ? bands.lead + 6 : 0;
  // Keep the reading position when the top band changes while the user is up in the history.
  const shownTop = useRef(pad.top + lead);
  useLayoutEffect(() => {
    const delta = pad.top + lead - shownTop.current;
    shownTop.current = pad.top + lead;
    const el = scroller.current;
    if (el && delta && !stick.current) el.scrollTop += delta;
    // The scroller's top edge moved (the gutter's top entries came over the column or left it) without the
    // ResizeObserver seeing it when the history is 0 px tall (a long draft in a short pane): the rows moved with the
    // pane's chrome, not inside it — measure later changes from here (a stale anchor counted the 44 px band as rows
    // going up, so a send then left too little room and the rows went down by the band).
    const col = content.current;
    if (el && col && delta && stick.current && anchor.current) {
      el.scrollTo({ top: el.scrollHeight });
      anchor.current = anchorRows(el, col);
    }
  }, [pad.top, lead]);
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

  const timelineRev = useTimelineShapeRev(view?.timeline ?? null);

  if (!selectedId) {
    if (firstRun) return <FirstRunPanel view={firstRun} daemon={daemon} />;
    return <div className="flex flex-1 items-center justify-center text-subtle">{t("conversation.empty")}</div>;
  }
  const name = session?.displayName ?? selectedId;
  const busy = !!view?.timeline.activeTurnId;
  const runtimeStatus = session?.runtime.status;
  const canAutoStart = features.has("offline-submit");
  // cute-codex starts its app-server; DSH / Claude name their own runtime (D-8).
  const offlineNote = offlineAutoStartNote(agentRuntime);
  const offlineText = "vars" in offlineNote ? t(offlineNote.key, offlineNote.vars) : t(offlineNote.key);
  const archived = isArchived(session);
  // The composer block (status row + 接下来 + input) shows: not archived, not read-only, no interaction waiting.
  const composerShown = !archived && !readOnly && !(view && view.timeline.pending.size > 0);
  const runtimeNote = archived
    ? null
    : view?.startError
      ? { tone: "text-danger", text: t(view.startErrorQueueIds?.length || view.queue.length ? "conversation.startFailed" : "conversation.runtimeStartFailed", { error: view.startError }) }
      : startSince !== null && runtimeStatus !== "online"
        ? { tone: "text-accent", text: startSlow ? t("conversation.startingSlow") : t(view?.queue.length ? "conversation.startingQueued" : "conversation.starting") }
      : runtimeStatus === "starting"
        ? { tone: "text-accent", text: t(view?.queue.length ? "conversation.startingQueued" : "conversation.starting") }
        : runtimeStatus && runtimeStatus !== "online" && canAutoStart && view?.timeline.threadId
          ? { tone: "text-subtle", text: offlineText }
          : null;

  return (
    <UserLayoutToggleContext.Provider value={userToggle}>
    <SubAgentContext.Provider value={subAgents}>
    <ConversationDockContext.Provider value={dock}>
    <ShortPaneContext.Provider value={shortPane}>
    <main className="relative flex min-w-0 flex-1 flex-col">
      <div ref={frame} data-timeline-frame className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Content dissolves into the composer area instead of being cut by a hard edge (a mask, so it
          works on any background / theme); the extra bottom padding keeps the last line clear of it. */}
      <div ref={scroller} onScroll={onScroll} data-timeline-lead={lead || undefined} style={lead ? { marginTop: lead } : undefined} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]">
        {/* The measured bands of what floats over the column (see useReservedBands); the top one also
            moves the sticky 收起 of an expanded long message (Foldable) below it. */}
        <div
          ref={content}
          data-timeline-root
          style={{ paddingTop: pad.top, paddingBottom: pad.bottom, ...(bands.top ? ({ "--fold-sticky-top": `${bands.top + 4}px` } as React.CSSProperties) : {}) }}
          className="message-body side-col min-w-0 px-6"
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
          {showImageHistoryHint && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
              <span className="min-w-0 flex-1">{t("conversation.imageHistoryHint")}</span>
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground"
                onClick={() => selectedId && setUiPref("imageHistoryHintDone", dismissImageHistoryHint(imageHistoryHintDone, selectedId))}
              >
                <X size={12} aria-hidden />
                <span className="sr-only">{t("conversation.imageHistoryDismiss")}</span>
              </button>
            </div>
          )}
          {view && <StreamRenderProvider hostId={hostId} sessionId={selectedId}><MemoTimelineBody timeline={view.timeline} entries={entries} sessionId={selectedId} nameOf={nameOf} older={view.older} onLoadOlder={loadOlderFor} pendingSends onRelease={release} /></StreamRenderProvider>}
        </div>
        {/* The room kept under the rows so the history only moves up (keepRowsUp; sized from the observer, not by React). */}
        <div ref={spacer} aria-hidden data-timeline-slack="" />
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
      <MemoOverlays key={selectedId} sessionId={selectedId} onReserve={reserve} />
      </div>

      {/* 需要你: other agents that want the owner (sidebar v2; Settings → 外观 → 侧栏). In the status row while the composer
          shows (one line with its right-side chips when its left is empty, owner 2026-10-27); here while it is hidden. */}
      {!composerShown && <MemoNeedsYouStrip sessionId={selectedId} />}
      {/* The dock (lib/conversationDock): cards that ask the owner to act (browser claim), in flow above the composer. */}
      <div ref={setDock} data-conversation-dock className="flex flex-col empty:hidden" />
      {view && view.timeline.pending.size > 0 && (
        <InteractionDock
          pending={[...view.timeline.pending.values()]}
          // Only the focused conversation's card takes the keyboard (the other column must not steal it).
          takeFocus={paneFocused}
          runtime={agentRuntime}
          onReply={(request, reply) => void respond(request.id, reply, selectedId, hostId)}
        />
      )}
      {/* Archived: read-only; restoring brings the composer back. */}
      {archived && session && <ArchivedBanner session={session} />}
      {!archived && readOnly && <ReadOnlyComposerNote hostId={hostId} />}
      {/* Kept mounted (draft survives) but hidden while an interaction blocks — ZCode pattern. */}
      {/* A flex column that may shrink (min-h-0): in a short pane 「接下来」 scrolls inside itself instead of being cut (QueuePanel). */}
      <div data-composer-block className={!composerShown ? "hidden" : "flex min-h-0 flex-col"}>
        {runtimeNote && (
          <p className={`side-col px-6 pb-1 text-xs ${runtimeNote.tone}`}>
            {runtimeNote.text}
            {access.isOwner && runtimeStatus && runtimeStatus !== "online" && runtimeStatus !== "starting" && startSince === null && (
              <button onClick={() => void sessionAction(selectedId, "cutex/runtime/online", { openVisibleTerminal: false }, hostId).catch(() => {})} className="ml-2 text-accent hover:underline">
                {t("menu.start")}
              </button>
            )}
          </p>
        )}
        {/* Status row: the items placed above the input (Settings → 通用); also where goal editing happens. */}
        <MemoStatusBar key={selectedId} sessionId={selectedId} needsYou={composerShown} />
        <MemoComposer
          key={composerDraftKey(hostId, selectedId)}
          name={name}
          busy={busy}
          queue={view?.queue ?? NO_QUEUE}
          timeline={view?.timeline ?? null}
          timelineRev={timelineRev}
          sessionId={selectedId}
          profile={session?.profile ?? session?.effectiveNextLaunch?.profile ?? null}
        />
      </div>
      {/* The gutters beside the reading column + the reference card (§19), over the whole card. */}
      <MemoGutterHost sessionId={selectedId} hostId={hostId} scroller={scroller} corner={corner} />
    </main>
    </ShortPaneContext.Provider>
    </ConversationDockContext.Provider>
    </SubAgentContext.Provider>
    </UserLayoutToggleContext.Provider>
  );
}

/**
 * The agent could not be read: which host was asked (an agent of another host opened on the wrong one
 * reads 「…不存在」 from that host) and 重新加载 (store `reloadSession`: re-routed to the host that lists it).
 */
// The pane's layout subscriptions can re-render its wrapper while the conversation's own props stay
// identical (opening a Shelf is the hot case); keep that pass out of the whole thread.
export const MemoConversation = memo(Conversation);

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
          void reload(sessionId, hostId).finally(() => setBusy(false));
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
const sameBands = (a: Bands, b: Bands) => a.top === b.top && a.bottom === b.bottom && (a.lead ?? 0) === (b.lead ?? 0);

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
  const win = useOwnerWindow();
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
          if (!isHTMLElement(child) || child.hasAttribute("data-overlay-transient")) continue;
          const cs = getComputedStyle(child);
          if (cs.display === "contents" || cs.pointerEvents === "none") visit(child);
          else out.push(child);
        }
      };
      for (const id of reserving) {
        const item = wrap.querySelector(`[data-overlay-item="${CSS.escape(id)}"]`);
        if (item) visit(item);
      }
      return out;
    };
    const strips = (): HTMLElement[] => [...main.querySelectorAll<HTMLElement>("[data-gutter-top]")];
    let frameId = 0;
    const observed = new Set<Element>();
    // The column matters for its width only (where it starts and ends): its height grows with every
    // streamed line and must not re-measure (a forced layout per delta otherwise).
    let columnWidth = -1;
    const ro = new win.ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (entry.target === content.current) {
          const width = entry.contentRect.width;
          if (width === columnWidth) continue;
          columnWidth = width;
        }
        changed = true;
      }
      if (changed) schedule();
    });
    const measure = () => {
      frameId = 0;
      const sc = scroller.current;
      const col = content.current;
      if (!sc || !col) return;
      const cs = getComputedStyle(col);
      const c = col.getBoundingClientRect();
      const column: Box = { left: c.left + parseFloat(cs.paddingLeft), right: c.right - parseFloat(cs.paddingRight), top: c.top, bottom: c.bottom };
      const els = drawn();
      const tops = strips();
      for (const el of [...els, ...tops]) if (!observed.has(el)) (observed.add(el), ro.observe(el));
      const lead = leadBand(boxOf(wrap.getBoundingClientRect()), column, tops.map((el) => boxOf(el.getBoundingClientRect())));
      const next = { ...reservedBands(boxOf(sc.getBoundingClientRect()), column, els.map((el) => boxOf(el.getBoundingClientRect()))), lead };
      setBands((old) => (sameBands(old, next) ? old : next));
    };
    function schedule() {
      if (!frameId) frameId = win.requestAnimationFrame(measure);
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
      if (frameId) win.cancelAnimationFrame(frameId);
      ro.disconnect();
      mo.disconnect();
    };
  }, [frame, scroller, content, ids, sessionId]);
  return bands;
}
