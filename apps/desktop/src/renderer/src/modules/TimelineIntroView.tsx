// The `timeline.intro` outlet (docs/desktop-modules.md §19.3): a session's opening — portrait plus
// greeting — above the first turn. Rendered only while the session's start is really on screen
// (nothing earlier to load: no hidden turns, no older history page; not while the first page is
// still loading or failed), never in read-only timelines (sub-agent views, the reference card), and
// only with 设置 → 对话 → 显示会话开场 on. At most one item per session: the first available by
// order whose `when` accepts it; `when` and the render factory both run guarded, and the rendered
// tree sits in an ItemBoundary, so a throwing module costs this block alone. memo'd with primitive
// props and primitive-only store selectors: TimelineBody re-renders per stream event, this doesn't.
import { memo, useMemo } from "react";
import { profileOf } from "../lib/agentList";
import { useUiPrefs } from "../lib/prefs";
import { bridge } from "../bridge";
import { agentHost, sidebarOf, useApp } from "../store";
import { useSlot } from "./react";
import { ItemBoundary } from "./Outlet";
import { pickTimelineIntroItem, timelineAtStart } from "./timelineIntroLogic";
import type { AppSlotEntry, TimelineIntroProps } from "./slots";

type Entry = AppSlotEntry<"timeline.intro">;

/** One bad item must not take the timeline down (the boundary keeps mount-phase errors; these are
 *  the pick and factory calls, which run during this component's own render). */
function reportIntroThrow(moduleId: string, error: unknown): void {
  const e = error instanceof Error ? error : new Error(String(error));
  void bridge.shell?.logError({ kind: "error", message: `[${moduleId}] ${e.message}`, stack: e.stack }).catch(() => {});
}

/** Picks and renders the winning item inside the boundary, with the item's own module attribution. */
function IntroItem({ entries, props }: { entries: readonly Entry[]; props: TimelineIntroProps }) {
  // A throwing `when` skips that item (reported under its own module id), never the whole slot.
  const entry = pickTimelineIntroItem(entries, props, (bad, error) => reportIntroThrow(bad.moduleId, error));
  if (!entry) return null;
  return (
    <ItemBoundary moduleId={entry.moduleId} resetKey={`${props.hostId}\u0000${props.sessionId}`}>
      <ItemRender entry={entry} props={props} />
    </ItemBoundary>
  );
}

function ItemRender({ entry, props }: { entry: Entry; props: TimelineIntroProps }) {
  try {
    return <>{entry.item.render(props)}</>;
  } catch (e) {
    reportIntroThrow(entry.moduleId, e);
    return null;
  }
}

/** The session row on its own host (sidebar snapshots change per stream event; the selectors below
 *  return primitives, so those patches never re-render the intro). */
function sessionRow(s: ReturnType<typeof useApp.getState>, hostId: string, sessionId: string) {
  const sidebar = sidebarOf(s, hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((x) => x.cutexSessionId === sessionId) ?? null;
}

/** The opening's read-only props: who this session is (host, profile name, provider hint, name). */
function useIntroIdentity(sessionId: string): Pick<TimelineIntroProps, "hostId" | "profileName" | "providerKind" | "agentName"> {
  const hostId = useApp(agentHost);
  const profileName = useApp((s) => {
    const row = sessionRow(s, hostId, sessionId);
    return row ? profileOf(row) : null;
  });
  // The one provider the host knows without a profile list; the item resolves everything else.
  const providerKind = useApp((s) => {
    const row = sessionRow(s, hostId, sessionId);
    return row?.effectiveNextLaunch?.source === "claude_subscription" ? "claude" : null;
  });
  const agentName = useApp((s) => sessionRow(s, hostId, sessionId)?.displayName ?? null);
  return { hostId, profileName, providerKind, agentName };
}

export const TimelineIntro = memo(function TimelineIntro({ sessionId, hiddenTurns, olderCursor, loading, failed }: { sessionId: string; hiddenTurns: number; olderCursor: string | null; /** The session view is still loading its first page (SessionView.loading). */ loading: boolean; /** The session view failed to load (SessionView.error set). */ failed: boolean }) {
  const { timelineIntro: enabled } = useUiPrefs();
  const entries = useSlot("timeline.intro");
  const identity = useIntroIdentity(sessionId);
  const props = useMemo(() => ({ sessionId, ...identity }), [sessionId, identity]);
  if (!enabled || loading || failed || !timelineAtStart(hiddenTurns, olderCursor)) return null;
  return (
    <section data-timeline-intro={sessionId} className="timeline-intro">
      {/* key: switching sessions within a host remounts the item (a broken image, the pool sample
          and the profile lookup all start fresh per session). */}
      <IntroItem key={`${identity.hostId}\u0000${sessionId}`} entries={entries} props={props} />
    </section>
  );
});
