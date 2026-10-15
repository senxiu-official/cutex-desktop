// The props a right-side component gets (docs/desktop-modules.md §18.2): its instance, the binding
// resolved, setState, open / close, where it is shown and the keep-mounted hold (§18.13, v1.9). The
// instance layer (Body) and the card header (Actions) build them the same way.
import { useMemo, useRef } from "react";
import type { SideBodyProps, SideInstanceInfo } from "../modules/slots";
import type { Json } from "../modules/types";
import { closeTab } from "./sideActions";
import { sideRegistry, useSideView } from "./sideComponents";
import { holdKey, setHeldState, setSideHold, useSideKeep } from "./sideKeep";
import { pinInstance, resolveBinding, type SideInstance } from "./sideLayout";
import { setInstanceStateNow, updateLayout, useSide } from "./sideLayoutStore";
import { sideOpen } from "./sideServices";

export interface SidePlaceInfo {
  cardId: string;
  pageId: string;
}

/** SideBodyProps.keep (v1.11): transient → kept (pinned), idempotent; a held instance of another scope: no-op. */
export function keepTab(id: string, outOfScope?: string): void {
  if (!outOfScope) updateLayout((l) => pinInstance(l, id));
}

/**
 * SideBodyProps for instance `id` shown in card `where` (null = not on screen). `outOfScope` = a held
 * instance of another view scope's layout (§18.13): rendered hidden from its snapshot; setState is kept
 * on the snapshot (written back when that scope loads again), close() only releases the hold.
 */
export function useSideBodyProps(id: string, inst: SideInstance, where: SidePlaceInfo | null, outOfScope?: string): SideBodyProps<Json> {
  const ctx = useSideView();
  const loaded = useSide((s) => s.scope);
  const scope = outOfScope ?? loaded;
  const mode = useSide((s) => (!outOfScope && where && s.mode && s.layout.activePage === where.pageId && (!s.mode.card || s.mode.card === where.cardId) ? s.mode.kind : "normal"));
  const active = useSide((s) => !outOfScope && !!where && s.focusedCard === where.cardId);
  const revealed = useSide((s) => (outOfScope ? 0 : (s.revealed[id] ?? 0)));
  const held = useSideKeep((s) => !!scope && !!s.holds[holdKey(scope, id)]);
  const { hostId, sessionId } = resolveBinding(inst.binding, ctx);
  const instance = useMemo<SideInstanceInfo<Json>>(() => ({ id, kind: inst.kind, binding: inst.binding, state: inst.state, pinned: inst.pinned }), [id, inst.kind, inst.binding, inst.state, inst.pinned]);
  const pageId = where?.pageId;
  // The hold snapshots the instance as it is when asked; the layer refreshes it while its scope is loaded.
  const instRef = useRef(inst);
  instRef.current = inst;
  return useMemo(
    () => ({
      instance,
      hostId,
      sessionId,
      setState: (next: Json) => {
        const v = sideRegistry().get(inst.kind)?.item.stateVersion ?? 1;
        if (outOfScope) setHeldState(outOfScope, id, next, v);
        else setInstanceStateNow(id, next, v);
      },
      visible: !!where,
      active,
      mode,
      where: "card" as const,
      revealed,
      close: () => (outOfScope ? void setSideHold(outOfScope, id, instRef.current, "hidden", false) : closeTab(id)),
      open: (kind, params, opts) => sideOpen(kind, params ?? null, { ...(pageId ? { page: pageId } : {}), ...opts }),
      keepMounted: (hold: boolean) => setSideHold(scope, id, instRef.current, sideRegistry().get(inst.kind)?.item.keepAlive, hold),
      held,
      keep: () => keepTab(id, outOfScope),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instance, hostId, sessionId, !!where, active, mode, revealed, pageId, id, inst.kind, scope, outOfScope, held],
  );
}
