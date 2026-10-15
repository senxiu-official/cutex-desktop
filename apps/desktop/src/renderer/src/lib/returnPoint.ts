// 「回到」 after a jump (services.timeline.focusTurn; docs/desktop-modules.md §19.7; RFC §7.7): where the
// owner was reading before the jump, and when that offer goes away. Pure state machine; the wiring
// (capture, chip, restore) is lib/jump.ts + components/gutter/ReturnChip.tsx.
//
// Appears on a jump. Goes away when:
//   1. it was used (chip / Alt+←);
//   2. the owner sent a message in the agent being read;
//   3. the owner scrolled back to within one screen of the point (after having been further away);
//   4. the owner scrolled more than three screens away from both the target and the point;
//   5. the owner switched agents from the sidebar (a switch made by the jump itself does not count);
//   and on a view-scope (host) change.
// Chained jumps keep the FIRST point ("back to where I was reading"), no multi-level stack.

export interface ReturnPoint {
  hostId: string;
  /** The agent the owner was reading. */
  sessionId: string;
  agentName: string;
  /** The turn at the top of the viewport (null: nothing rendered). */
  turnId: string | null;
  /** px from that turn's top to the viewport's top. */
  offset: number;
  /** Was at the bottom (stuck): going back re-attaches. */
  atBottom: boolean;
  /** The point turn's ordinal (at the bottom: the last turn's), when the whole history is loaded (C-T2 later). */
  ordinal: number | null;
}

export interface ReturnState {
  point: ReturnPoint;
  /** The last jump's target. */
  target: { sessionId: string; turnId: string };
  /** The view has been more than one screen away from the point (rule 3 applies only after that). */
  armed: boolean;
}

export type ReturnEvent =
  | { type: "jump"; point: ReturnPoint; target: { sessionId: string; turnId: string } }
  | { type: "used" }
  | { type: "sent"; sessionId: string }
  /** Distances in screens from the viewport to the point / target; null = not measurable (other agent, not rendered). */
  | { type: "scroll"; sessionId: string; fromPoint: number | null; fromTarget: number | null }
  | { type: "select"; sessionId: string | null; byJump: boolean }
  | { type: "scope" };

export function returnReduce(state: ReturnState | null, e: ReturnEvent): ReturnState | null {
  switch (e.type) {
    case "jump":
      return state ? { ...state, target: e.target } : { point: e.point, target: e.target, armed: false };
    case "used":
    case "scope":
      return null;
    case "sent":
      return state && (e.sessionId === state.target.sessionId || e.sessionId === state.point.sessionId) ? null : state;
    case "select":
      return state && !e.byJump ? null : state;
    case "scroll": {
      if (!state) return null;
      const near = (d: number | null) => d !== null && d <= 1;
      const far = (d: number | null) => d === null || d > 3;
      const samePoint = e.sessionId === state.point.sessionId;
      const fromPoint = samePoint ? e.fromPoint : null;
      if (state.armed && near(fromPoint)) return null;
      if (e.sessionId === state.target.sessionId && e.fromTarget !== null && e.fromTarget > 3 && far(fromPoint)) return null;
      if (!state.armed && fromPoint !== null && fromPoint > 1) return { ...state, armed: true };
      return state;
    }
  }
}

export type ReturnLabel = { key: "gutter.return.agent"; vars: { name: string } } | { key: "gutter.return.ordinal"; vars: { n: number } } | { key: "gutter.return.place"; vars: Record<string, never> };

/** 「回到 Helper」 after a cross-agent jump; 「回到 #250」 when the ordinal is known; else 「回到刚才的位置」. */
export function returnLabel(state: ReturnState, selectedId: string | null): ReturnLabel {
  if (state.point.sessionId !== selectedId) return { key: "gutter.return.agent", vars: { name: state.point.agentName } };
  if (state.point.ordinal !== null) return { key: "gutter.return.ordinal", vars: { n: state.point.ordinal } };
  return { key: "gutter.return.place", vars: {} };
}
