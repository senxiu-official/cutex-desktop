// The conversation column's own header (owner 2026-10-21, header split variant A, prototype
// .claude/preview-design-v1.html §1 `#s1-a`): everything about the conversation moved off the window bar
// into each conversation column — line 1 avatar, name, role chip, project chip + star, then online / mute /
// network (the agent's services) and the pane's own buttons in one row (.claude/preview-header.html `#a`);
// line 2 host · cwd · branch over the whole width. Two columns side by side each show their own agent. A narrow
// column folds items into a ⋯ menu, in a fixed order: network first, then mute, then the project chip
// (convHeaderOverflow).
// Non-component helpers live here so components/ConversationHeader.tsx keeps Fast Refresh.
import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { isQuickChat } from "./sidebar";
import { sharedResizeObserver } from "./resizeHub";

/** Header items that fold into the ⋯ menu when the column is narrow, in the order they fold. */
export type ConvHeaderFold = "network" | "mute" | "project";
export const CONV_HEADER_FOLD_ORDER: readonly ConvHeaderFold[] = ["network", "mute", "project"];

/** Below these widths services, notification and project controls fold in that order. */
export const CONV_HEADER_FOLD_BELOW: Readonly<Record<ConvHeaderFold, number>> = { network: 440, mute: 380, project: 320 };

/** Items folded into ⋯ at a header width (null: not measured yet → nothing folded), in fold order. */
export function convHeaderFolded(width: number | null): ConvHeaderFold[] {
  if (width === null || !(width > 0)) return [];
  return CONV_HEADER_FOLD_ORDER.filter((item) => width < CONV_HEADER_FOLD_BELOW[item]);
}

/**
 * The items folded at the header's width, kept current by a ResizeObserver ([] until measured / without one).
 * Only a fold step crossed re-renders the header: the width itself changes on every step of a window resize or a
 * column drag (perf re-run 2026-10-21 §7.3: each header re-rendered per step).
 */
export const CONV_HEADER_COMPACT_SERVICES_BELOW = 700;
export function convHeaderServicesCompact(width: number | null): boolean {
  return width !== null && width > 0 && width < CONV_HEADER_COMPACT_SERVICES_BELOW;
}

/** One discrete state for full / compact services and each overflow step; no per-pixel updates. */
export function useHeaderLayout(ref: RefObject<HTMLElement | null>) {
  const [stage, setStage] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = Math.round(el.getBoundingClientRect().width);
      const count = convHeaderFolded(width).length;
      setStage(count ? count + 1 : convHeaderServicesCompact(width) ? 1 : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = sharedResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return useMemo(() => ({ folded: CONV_HEADER_FOLD_ORDER.slice(0, Math.max(0, stage - 1)), compactServices: stage === 1 }), [stage]);
}
export function useHeaderFolded(ref: RefObject<HTMLElement | null>): ConvHeaderFold[] {
  return useHeaderLayout(ref).folded;
}

/** What one conversation header shows about its agent (pure: the pane's host's sidebar snapshot). */
export interface ConvHeaderInfo {
  session: SessionResource;
  /** The agent leads a project (the role chip, named by the {{director}} term). */
  director: boolean;
  /** The project chip: null = none (a quick chat outside any project). */
  project: { id: string | null; name: string | null } | null;
  /** Line 2's directory (empty: none). */
  cwd: string;
}

/** The session row of `sessionId` on a host's sidebar (active or retired). */
export function headerSession(sidebar: SidebarSnapshot | null, sessionId: string | null): SessionResource | undefined {
  if (!sidebar || !sessionId) return undefined;
  return sidebar.active.find((r) => r.cutexSessionId === sessionId) ?? sidebar.retired.find((r) => r.cutexSessionId === sessionId);
}

/**
 * The header of the pane bound to `sessionId` on the host whose sidebar this is. Each pane asks with its
 * own host + agent, so two columns side by side never show each other's agent.
 */
export function convHeaderInfo(sidebar: SidebarSnapshot | null, sessionId: string | null): ConvHeaderInfo | null {
  const session = headerSession(sidebar, sessionId);
  if (!sidebar || !session) return null;
  const id = session.cutexSessionId;
  const row = sidebar.hostRows[id];
  const projectId = row?.projectId ?? null;
  const project = projectId ? sidebar.projects?.projects.find((p) => p.project_id === projectId) : undefined;
  const director = !!sidebar.projects?.projects.some((p) => p.director_cutex_session_id === id);
  const chip = isQuickChat(session, row) && !projectId ? null : { id: projectId, name: projectId ? project?.presentation.display_name || row?.projectName || projectId : null };
  return { session, director, project: chip, cwd: session.cwd ?? "" };
}
