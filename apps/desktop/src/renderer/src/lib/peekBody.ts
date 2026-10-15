// The reference card's component props (SideBodyProps with where "peek", docs/desktop-modules.md §19.4)
// and its moves to the right side: 在右侧打开 (pinned, the state carried over), ⤢ / ⛶ (the same, then
// maximised / full screen), its icon dragged onto a page button / a "new page" target (the same, into
// that page). The card closes with them.
import { useMemo } from "react";
import { translate, type MessageKey } from "../i18n";
import type { SideBodyProps, SideInstanceInfo, SideOpenOptions } from "../modules/slots";
import type { Json } from "../modules/types";
import { useApp } from "../store";
import { closePeek, setPeekState, usePeek, type PeekInstance } from "./peekStore";
import { sideRegistry, useSideView } from "./sideComponents";
import { pageForDrop } from "./sideDnd";
import { resolveBinding } from "./sideLayout";
import { setInstanceStateNow, updateLayout, useSide } from "./sideLayoutStore";
import { sideOpen } from "./sideServices";

export function usePeekBodyProps(peek: PeekInstance): SideBodyProps<Json> {
  const ctx = useSideView();
  const revealed = usePeek((s) => s.revealed);
  const { hostId, sessionId } = resolveBinding(peek.binding, ctx);
  const instance = useMemo<SideInstanceInfo<Json>>(() => ({ id: peek.id, kind: peek.kind, binding: peek.binding, state: peek.state, pinned: false }), [peek.id, peek.kind, peek.binding, peek.state]);
  return useMemo(
    () => ({
      instance,
      hostId,
      sessionId,
      setState: (next: Json) => setPeekState(peek.id, next, sideRegistry().get(peek.kind)?.item.stateVersion ?? 1),
      visible: true,
      active: false,
      mode: "normal" as const,
      where: "peek" as const,
      revealed,
      close: () => closePeek(),
      open: (kind, params, opts) => sideOpen(kind, params ?? null, opts),
      // A reference card is never held (§18.13): it closes with the next peek.
      keepMounted: () => false,
      keep: () => {},
      held: false,
    }),
    [instance, hostId, sessionId, revealed, peek.id, peek.kind],
  );
}

/** Pins the reference card into the right side with its state; false = it could not open (a notice says why). */
function pinPeek(opts: SideOpenOptions): boolean {
  const peek = usePeek.getState().peek;
  if (!peek) return false;
  const r = sideOpen(peek.kind, peek.params, { ...opts, focus: true, pin: true, binding: peek.binding });
  if (r.status !== "opened") {
    const reason = r.status === "stale" ? translate("side.reason.stale") : translate(`side.reason.${r.reason}` as MessageKey);
    useApp.getState().notify(translate("side.unavailable", { what: translate("gutter.peek"), reason }), "error");
    return false;
  }
  setInstanceStateNow(r.instanceId, peek.state, peek.v);
  closePeek({ focus: false });
  return true;
}

/** 在右侧打开 (⤢ / ⛶: and maximise / full-screen that card): pinned, with the card's state. */
export function peekToRight(target: "page" | "maximised" | "fullscreen" = "page"): void {
  pinPeek({ target });
}

/**
 * The card's icon dropped on a page button / the column (that page) or a "new page" target (RFC §3.7
 * last row, §7.4): pinned there like 在右侧打开; no override is remembered (the reference card has its
 * own rules). The same reference already pinned somewhere is revealed there (the new page, still
 * empty, goes away by itself); when nothing opens, the layout goes back to how it was.
 */
export function peekToDrop(target: { page: string } | { newPage: true }): void {
  if (!usePeek.getState().peek) return;
  const before = useSide.getState().layout;
  const page = pageForDrop(target);
  const launched = useSide.getState().layout;
  // 9 pages already (no new page): by the placement rules instead (never refused).
  if (!pinPeek(page ? { page } : {})) updateLayout((l) => (l === launched ? before : l));
}
