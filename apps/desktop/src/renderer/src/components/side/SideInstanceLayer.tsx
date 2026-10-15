// The instance layer (docs/desktop-modules.md §18.10): every right-side instance on screen renders
// here, at the App root, in a fixed box over its card's placeholder (lib/sideSlots). Moving a tab to
// another card or page, maximising and full screen only move the placeholder, so instances never
// remount (a terminal keeps its PTY view, a browser its page). Instances not on screen unmount unless
// their component asks keepAlive "hidden" (the last few stay mounted, hidden: setting sideKeepHidden) or
// holds them (SideBodyProps.keepMounted, §18.13 v1.9: outside the LRU, also across view scopes).
// Also: one hidden probe per visible instance runs the component's useTab() so page buttons, tab rows
// and tooltips have titles and badges for cards that are not in view.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SideComponentEntry } from "../../lib/sideComponents";
import { useSideRegistry, useSideView } from "../../lib/sideComponents";
import { useSideBodyProps } from "../../lib/sideBody";
import { instanceVisible, resolveBinding, type SideInstance } from "../../lib/sideLayout";
import { reportTabInfo, setFocusedCard, setInstanceStateNow, useSide } from "../../lib/sideLayoutStore";
import { clearHeldDirty, holdKey, keepHiddenLimit, mountPlan, pruneHolds, useSideKeep, type SideHold } from "../../lib/sideKeep";
import { useUiPrefs } from "../../lib/prefs";
import { useApp } from "../../store";
import { hostEpoch } from "../../../../shared/hosts";
import { useSideAnchors, useSideSlots, type SideSlot } from "../../lib/sideSlots";
import { useSideDnd } from "../../lib/sideDnd";
import type { SideInstanceInfo } from "../../modules/slots";
import type { ItemId, Json } from "../../modules/types";
import { ItemBoundary } from "../../modules/Outlet";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const sameRect = (a: Rect | undefined, b: Rect) => !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

function Instance({ id, inst, entry, slot, rect, outOfScope }: { id: string; inst: SideInstance; entry: SideComponentEntry; slot: SideSlot | null; rect: Rect | null; outOfScope?: string }) {
  const props = useSideBodyProps(id, inst, slot ? { cardId: slot.cardId, pageId: slot.pageId } : null, outOfScope);
  const Body = entry.item.Body;
  const shown = !!slot && !!rect && rect.width > 0 && rect.height > 0;
  // The dragged card / tab dims with its card (pointer events are off for the whole layer meanwhile: styles.css).
  const dragged = useSideDnd((s) => (s.drag?.type === "card" && !!slot && s.drag.cardId === slot.cardId) || (s.drag?.type === "tab" && s.drag.instanceId === id));
  return (
    <div
      data-side-root
      data-side-instance={id}
      data-side-card-of={slot?.cardId}
      onPointerDownCapture={slot ? () => setFocusedCard(slot.cardId) : undefined}
      onFocusCapture={slot ? () => setFocusedCard(slot.cardId) : undefined}
      aria-hidden={shown ? undefined : true}
      className={`fixed z-[39] flex flex-col overflow-hidden rounded-b-[13px] ${dragged ? "opacity-45" : ""}`}
      style={shown ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { left: -10000, top: 0, width: 1, height: 1, visibility: "hidden" }}
    >
      <ItemBoundary moduleId={entry.moduleId} resetKey={id}>
        <Body {...props} />
      </ItemBoundary>
    </div>
  );
}

function Probe({ id, inst, entry }: { id: string; inst: SideInstance; entry: SideComponentEntry }) {
  const ctx = useSideView();
  const { hostId, sessionId } = resolveBinding(inst.binding, ctx);
  const instance: SideInstanceInfo<Json> = { id, kind: inst.kind, binding: inst.binding, state: inst.state, pinned: inst.pinned };
  const info = entry.item.useTab({ instance, hostId, sessionId });
  useEffect(() => reportTabInfo(id, info));
  useEffect(() => () => reportTabInfo(id, null), [id]);
  return null;
}

export function SideInstanceLayer() {
  const registry = useSideRegistry();
  const ctx = useSideView();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const slots = useSideSlots();
  const anchors = useSideAnchors();
  const [rects, setRects] = useState<ReadonlyMap<string, Rect>>(new Map());
  const kept = useRef<string[]>([]);
  const scope = useSide((s) => s.scope);
  const holds = useSideKeep((s) => s.holds);
  const hosts = useApp((s) => s.hosts);
  useUiPrefs(); // re-render on a sideKeepHidden change

  // Measure every placeholder: after each render (layout / mode / slots changed), on resize of a
  // placeholder or an anchor (the work area), and on window resize. No continuous polling.
  const measure = useRef<() => void>(() => {});
  measure.current = () => {
    setRects((old) => {
      const next = new Map<string, Rect>();
      let changed = old.size !== slots.size;
      for (const [id, slot] of slots) {
        const r = slot.el.getBoundingClientRect();
        const rect = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
        if (!sameRect(old.get(id), rect)) changed = true;
        next.set(id, sameRect(old.get(id), rect) ? old.get(id)! : rect);
      }
      return changed ? next : old;
    });
  };
  useLayoutEffect(() => measure.current());
  useEffect(() => {
    const ro = new ResizeObserver(() => measure.current());
    for (const slot of slots.values()) ro.observe(slot.el);
    for (const el of anchors) ro.observe(el);
    ro.observe(document.documentElement);
    const onResize = () => measure.current();
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [slots, anchors]);
  // Which instances are mounted: on screen, plus the last sideKeepHidden keepAlive "hidden" ones, plus the held ones. While
  // a card is maximised / full screen the page's other cards are not drawn; their instances stay
  // mounted (hidden) until the mode ends, so a mode never remounts anything.
  const onScreen = [...slots.keys()].filter((id) => layout.instances[id] && registry.has(layout.instances[id]!.kind));
  // (Also for the render that ends the mode: the cards register their placeholders right after it.)
  const beforeMode = useRef<string[]>([]);
  const lastMode = useRef(mode);
  useEffect(() => {
    lastMode.current = mode;
    if (!mode) beforeMode.current = onScreen;
  });
  const modeKept = mode || lastMode.current ? beforeMode.current.filter((id) => !slots.has(id) && layout.instances[id] && registry.has(layout.instances[id]!.kind) && instanceVisible(layout, id, ctx)) : [];
  const keepable = (id: string) => {
    const inst = layout.instances[id];
    return !!inst && registry.get(inst.kind)?.item.keepAlive === "hidden" && instanceVisible(layout, id, ctx);
  };
  // Held instances (§18.13) of the loaded scope; held ones of other scopes render hidden from their snapshot.
  const keeps = (kind: string) => registry.get(kind as ItemId)?.item.keepAlive === "hidden";
  const held = new Set(Object.values(holds).filter((h) => h.scope === scope && layout.instances[h.id] && keeps(layout.instances[h.id]!.kind)).map((h) => h.id));
  const away: SideHold[] = Object.values(holds).filter((h) => h.scope !== scope && keeps(h.inst.kind));
  const mounts = mountPlan({ onScreen, kept: kept.current, keepable, held, modeKept, keepHidden: keepHiddenLimit() });
  useEffect(() => {
    kept.current = mounts.kept;
  });
  // Drop holds that no longer apply (tab closed, module off, host removed / new epoch), refresh the
  // snapshots of the loaded scope, and write back state set while a held instance was out of scope.
  useEffect(() => {
    const now = useSideKeep.getState().holds;
    const back = scope ? Object.values(now).filter((h) => h.scope === scope && h.dirty && layout.instances[h.id]) : [];
    for (const h of back) setInstanceStateNow(h.id, h.inst.state, h.inst.v);
    if (back.length && scope) clearHeldDirty(scope, back.map((h) => h.id));
    const known = new Set((hosts?.hosts ?? []).map((h) => h.id));
    const next = pruneHolds(useSideKeep.getState().holds, {
      scope,
      instances: useSide.getState().layout.instances,
      keeps,
      hostKnown: (id) => id === "local" || known.has(id),
      epochOf: (id) => hostEpoch(hosts, id),
    });
    if (next !== useSideKeep.getState().holds) useSideKeep.setState({ holds: next });
  });
  // Stable order (by scope + id) so React never moves a mounted box in the DOM (an iframe would reload);
  // a held box keeps its key when the scope switches away and back.
  const boxes = [
    ...mounts.mounted.map((id) => ({ key: holdKey(scope ?? "", id), id, inst: layout.instances[id]!, outOfScope: undefined as string | undefined })),
    ...away.map((h) => ({ key: holdKey(h.scope, h.id), id: h.id, inst: h.inst, outOfScope: h.scope as string | undefined })),
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const probes = Object.keys(layout.instances)
    .filter((id) => registry.has(layout.instances[id]!.kind) && instanceVisible(layout, id, ctx))
    .sort();

  return (
    <>
      {boxes.map(({ key, id, inst, outOfScope }) => {
        const entry = registry.get(inst.kind)!;
        return outOfScope ? (
          <Instance key={key} id={id} inst={inst} entry={entry} slot={null} rect={null} outOfScope={outOfScope} />
        ) : (
          <Instance key={key} id={id} inst={inst} entry={entry} slot={slots.get(id) ?? null} rect={rects.get(id) ?? null} />
        );
      })}
      {probes.map((id) => {
        const inst = layout.instances[id]!;
        const entry = registry.get(inst.kind)!;
        return (
          <ItemBoundary key={`probe:${id}`} moduleId={entry.moduleId} resetKey={id}>
            <span hidden>
              <Probe id={id} inst={inst} entry={entry} />
            </span>
          </ItemBoundary>
        );
      })}
    </>
  );
}
