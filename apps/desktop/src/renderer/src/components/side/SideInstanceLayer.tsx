// The instance layer (docs/desktop-modules.md §18.10): every right-side instance on screen renders
// here, at the App root, in a fixed box over its card's placeholder (lib/sideSlots), cut to what of it may
// paint (its pane, its Shelf, the work row, the window: lib/sideSlots slotBox). Moving a tab to
// another card or page, maximising and full screen only move the placeholder, so instances never
// remount (a terminal keeps its PTY view, a browser its page). Instances not on screen unmount unless
// their component asks keepAlive "hidden" (the last few stay mounted, hidden: setting sideKeepHidden) or
// holds them (SideBodyProps.keepMounted, §18.13 v1.9: outside the LRU, also across view scopes).
// Also: one hidden probe per visible instance runs the component's useTab() so page buttons, tab rows
// and tooltips have titles and badges for cards that are not in view.
// Two workspaces (§24.13, owner 2026-10-21): the other workspace's Shelf is live too (lib/sideLayoutStore
// `peers`): its instances render here as well, under its source (lib/shelfSourceContext: their view context is
// that conversation's — a follow-bound tool binds to it, not to the focused one). One list keyed by scope + id
// whichever Shelf holds an instance, so a focus switch (the peer becoming the live layout) or a pane dragged from
// one workspace's Shelf to the other's never remounts it.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SideComponentEntry } from "../../lib/sideComponents";
import { useSideRegistry, useSideView } from "../../lib/sideComponents";
import { useSideBodyProps } from "../../lib/sideBody";
import { instanceVisible, resolveBinding, type SideInstance, type SideLayout, type SideViewContext } from "../../lib/sideLayout";
import { peerView, rememberedInstances, reportTabInfo, setFocusedCard, setInstanceStateNow, useConvShelfVersion, useSide } from "../../lib/sideLayoutStore";
import { workspaceKeyFor } from "../../lib/sideComponents";
import { focusPeer, installFramePress, paneOfConversation } from "../../lib/shelfSource";
import { ShelfSourceContext, type ShelfPeer } from "../../lib/shelfSourceContext";
import { usePanes } from "../../lib/paneStore";
import { clearHeldDirty, holdKey, keepHiddenLimit, mountPlan, pruneHolds, useSideKeep, type SideHold } from "../../lib/sideKeep";
import { useUiPrefs } from "../../lib/prefs";
import { useApp } from "../../store";
import { hostEpoch } from "../../../../shared/hosts";
import { animationMovesBoxes, LAYOUT_PROPS, moving, onSlotsMotion, onSlotsRelayout, slotBox, useSideAnchors, useSideSlots, type SideSlot, type SlotBox, type SlotRect } from "../../lib/sideSlots";
import { useSideDnd } from "../../lib/sideDnd";
import { morphing } from "../../lib/dropMorph";
import { useShelfMotion } from "../../lib/shelfMotion";
import { observeSync, syncPass } from "../../lib/syncResize";
import type { SideInstanceInfo } from "../../modules/slots";
import type { ItemId, Json } from "../../modules/types";
import { ItemBoundary } from "../../modules/Outlet";
import { isElement } from "../../lib/ownerWindow";
import { useOwnerWindow } from "../../lib/ownerContext";

const sameRect = (a: SlotRect, b: SlotRect) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
const sameBox = (a: SlotBox | undefined, b: SlotBox) => !!a && sameRect(a.rect, b.rect) && sameRect(a.clip, b.clip);
/**
 * Whether a CSS animation that just started can move a placeholder: not the focus outline easing in, a spinner's
 * colour, a fade (each of those used to start the frame-by-frame follow with its `getAnimations` per frame).
 */
function animationMoves(e: AnimationEvent): boolean {
  const el = e.target as Element | null;
  if (!el || typeof el.getAnimations !== "function") return true;
  const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === e.animationName);
  return anim ? animationMovesBoxes(anim) : true;
}

/**
 * An instance's body: re-rendered when its props change (useSideBodyProps is memoised), not when only its box moved —
 * on each step of a window / column resize every tool pane's whole tree re-rendered (perf re-run 2026-10-21 §8).
 */
const InstanceBody = memo(function InstanceBody({ entry, id, props }: { entry: SideComponentEntry; id: string; props: ReturnType<typeof useSideBodyProps> }) {
  const Body = entry.item.Body;
  return (
    <ItemBoundary moduleId={entry.moduleId} resetKey={id}>
      <Body {...props} />
    </ItemBoundary>
  );
});

/**
 * The rounded corners of an instance's body: a pane card's bottom ones; in a Shelf (Rail look A) every pane's bottom
 * corner away from the rail (the rail side is square: the pane is attached there).
 */
function bodyCorners(el: HTMLElement | null): string {
  const shelf = el?.closest<HTMLElement>("[data-shelf-card]");
  if (!el || !shelf) return "rounded-b-inner";
  return shelf.dataset.shelfCard === "rail-right" ? "rounded-bl-inner" : "rounded-br-inner";
}

/**
 * One instance: a fixed box over the part of its placeholder that may paint (lib/sideSlots slotBox: cut to its
 * pane, its Shelf, the work row and the window), the body laid out at the whole placeholder inside it. A frame
 * or guest page in it is clipped by that box like any element (an iframe / <webview> is a frame in this
 * document, not a native view on top), so it never draws over another pane, the other workspace or the desktop.
 */
function Instance({ id, inst, entry, slot, box, outOfScope, peer, wsPane }: { id: string; inst: SideInstance; entry: SideComponentEntry; slot: SideSlot | null; box: SlotBox | null; outOfScope?: string; peer?: string; wsPane?: string | null }) {
  const props = useSideBodyProps(id, inst, slot ? { cardId: slot.cardId, pageId: slot.pageId } : null, outOfScope);
  // Its Shelf's box is still moving out of the rail (lib/shelfMotion): it shows once the box is there.
  const waiting = useShelfMotion((s) => !!slot && s.pages.includes(slot.pageId));
  const shown = !!slot && !!box;
  // The dragged card / tab dims with its card (pointer events are off for the whole layer meanwhile: styles.css).
  const dragged = useSideDnd((s) => (s.drag?.type === "card" && !!slot && s.drag.cardId === slot.cardId) || (s.drag?.type === "tab" && s.drag.instanceId === id));
  const clip = shown ? box.clip : null;
  const rect = shown ? box.rect : null;
  return (
    <div
      data-side-root
      data-side-instance={id}
      data-side-card-of={slot?.cardId}
      data-side-peer={peer}
      data-ws-shelf={peer && wsPane ? wsPane : undefined}
      data-side-clipped={clip && rect && !sameRect(clip, rect) ? "" : undefined}
      // In the other workspace's Shelf: that workspace takes the focus first (its Shelf becomes the live one, §24.13).
      onPointerDownCapture={slot ? () => (peer && focusPeer(peer), setFocusedCard(slot.cardId)) : undefined}
      // Not the focus going into a web page (<webview>): the agent's clicks pull it there too; main reports the owner's
      // presses in it (browser `pressed`, lib/shelfSource pressInstance).
      onFocusCapture={slot ? (e) => (peer && (e.target as Element).tagName !== "WEBVIEW" && focusPeer(peer), setFocusedCard(slot.cardId)) : undefined}
      aria-hidden={shown ? undefined : true}
      className={`fixed z-[39] overflow-hidden ${dragged ? "opacity-45" : ""}`}
      style={clip ? { left: clip.left, top: clip.top, width: clip.width, height: clip.height, ...(waiting ? { visibility: "hidden" as const } : {}) } : { left: -10000, top: 0, width: 1, height: 1, visibility: "hidden" }}
    >
      <div
        data-side-instance-body=""
        className={`absolute flex flex-col overflow-hidden ${bodyCorners(slot?.el ?? null)}`}
        style={clip && rect ? { left: rect.left - clip.left, top: rect.top - clip.top, width: rect.width, height: rect.height } : { left: 0, top: 0, width: 1, height: 1 }}
      >
        <InstanceBody entry={entry} id={id} props={props} />
      </div>
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
  const win = useOwnerWindow();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const layout = useSide((s) => s.layout);
  const peers = useSide((s) => s.peers);
  // The other workspace's conversation pane (for its boxes' workspace-drop target) and its workspace key.
  const peerKeys = Object.keys(peers).sort();
  const panesSig = usePanes(() => peerKeys.map((k) => paneOfConversation(k) ?? "").join("\n"));
  const wsSig = useApp((s) => peerKeys.map((k) => workspaceKeyFor(s, peers[k]!.hostId, peers[k]!.sessionId) ?? "").join("\n"));
  // Every instance and whose Shelf holds it: the focused one's (null), or a peer's (its convKey).
  const { owners, all, sources, ctxs } = useMemo(() => {
    const owners = new Map<string, string | null>();
    const all: Record<string, SideInstance> = { ...layout.instances };
    for (const id of Object.keys(layout.instances)) owners.set(id, null);
    const sources = new Map<string, ShelfPeer>();
    const ctxs = new Map<string, SideViewContext>();
    const wss = wsSig.split("\n");
    peerKeys.forEach((key, i) => {
      const p = peers[key]!;
      sources.set(key, { key, hostId: p.hostId, sessionId: p.sessionId, layout: peerView(p, layout) });
      ctxs.set(key, { ...ctx, hostId: p.hostId, sessionId: p.sessionId, workspaceKey: wss[i] || null });
      for (const [id, inst] of Object.entries(p.own.instances)) {
        if (owners.has(id)) continue;
        owners.set(id, key);
        all[id] = inst;
      }
    });
    return { owners, all, sources, ctxs };
  }, [layout, peers, ctx, panesSig, wsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const paneOf = (key: string) => panesSig.split("\n")[peerKeys.indexOf(key)] || null;
  // An instance's own layout and view context (the focused Shelf's, or its peer's).
  const layoutOf = (id: string): SideLayout => {
    const key = owners.get(id);
    return key ? peers[key]!.own : layout;
  };
  const ctxOf = (id: string): SideViewContext => {
    const key = owners.get(id);
    return (key && ctxs.get(key)) || ctx;
  };
  const visible = (id: string) => instanceVisible(layoutOf(id), id, ctxOf(id));
  const mode = useSide((s) => s.mode);
  const allSlots = useSideSlots();
  const allAnchors = useSideAnchors();
  // Registries are shared by every desk, but geometry and animation clocks belong to one document.
  const slots = useMemo(() => new Map([...allSlots].filter(([, slot]) => slot.el.ownerDocument === win.document)), [allSlots, win]);
  const anchors = useMemo(() => new Set([...allAnchors].filter((el) => el.ownerDocument === win.document)), [allAnchors, win]);
  const [rects, setRects] = useState<ReadonlyMap<string, SlotBox>>(new Map());
  const kept = useRef<string[]>([]);
  const scope = useSide((s) => s.scope);
  const holds = useSideKeep((s) => s.holds);
  const hosts = useApp((s) => s.hosts);
  useUiPrefs(); // re-render on a sideKeepHidden change

  // Measure every placeholder: after each render (layout / mode / slots changed), on resize of a
  // placeholder or an anchor (the work area), on window resize, and when the work area's boxes change
  // (a column narrowing, a Shelf folding, a workspace opening: the placeholders move without resizing).
  // While something there is moving (a glide, a Shelf's box: lib/sideSlots slotsMotion, or a CSS transition /
  // animation starting) it follows frame by frame until it stops. No polling otherwise — and the animations are
  // only asked for after such a signal (perf re-run 2026-10-21 §7.3 N3: `getAnimations({ subtree: true })` on
  // every DOM change forced a style recalc of the whole row per streamed delta).
  const measure = useRef<() => void>(() => {});
  const shownRects = useRef(rects);
  shownRects.current = rects;
  // The resize pass (lib/syncResize) this layer last measured in: the work row's commit already moved it.
  const measuredPass = useRef(-1);
  measure.current = () => {
    // The live drop preview moves the panes and these boxes together (transform only): nothing to measure meanwhile.
    if (morphing()) return;
    measuredPass.current = syncPass();
    const old = shownRects.current;
    const next = new Map<string, SlotBox>();
    let changed = false;
    for (const [id, slot] of slots) {
      const box = slotBox(slot.el);
      // Nothing of it shows (hidden, cut away: e.g. a work row narrower than its Shelf): not in the map.
      if (!box) continue;
      const prev = old.get(id);
      if (sameBox(prev, box)) next.set(id, prev!);
      else {
        changed = true;
        next.set(id, box);
      }
    }
    // Compared by what is in the map, not by the slots' count: a placeholder without a box used to count as
    // a change on every pass — with the layout effect below that was an endless render loop (a 1100 px
    // window with the Settings Shelf open: "Maximum update depth exceeded", a blank window). Unchanged: no
    // state update at all (no render of the layer).
    if (!changed && next.size === old.size) return;
    shownRects.current = next;
    setRects(next);
  };
  // The work row laid out again (lib/sideSlots slotsRelayout, from its layout effect): measure in the same frame.
  useEffect(() => onSlotsRelayout(() => measure.current()), []);
  // A press inside a pane's frame counts as a press in its pane (design 017).
  useEffect(() => installFramePress(), []);
  useLayoutEffect(() => measure.current());
  // A Shelf's box arrived (lib/shelfMotion): its placeholders are where they stay.
  const waitingPages = useShelfMotion((s) => s.pages);
  useEffect(() => measure.current(), [waitingPages]);
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    // Something may be moving (a motion signal): the frames ask `moving()` until it says no.
    let follow = false;
    const raf = typeof win.requestAnimationFrame === "function" ? (f: FrameRequestCallback) => win.requestAnimationFrame(f) : (f: FrameRequestCallback) => setTimeout(() => f(0), 16) as unknown as number;
    const unraf = typeof win.cancelAnimationFrame === "function" ? (n: number) => win.cancelAnimationFrame(n) : (n: number) => clearTimeout(n);
    const tick = () => {
      frame = 0;
      // These are the boxes of this animation frame. A deferred React update can paint the body at
      // last frame's coordinates while its card has already moved (especially a translate-only glide,
      // which does not notify ResizeObserver). Commit before this frame paints, like `resized` below.
      flushSync(() => measure.current());
      if (disposed || !follow) return;
      if ([...anchors].some((el) => moving(el))) frame = raf(tick);
      else follow = false;
    };
    const soon = () => {
      if (!frame) frame = raf(tick);
    };
    const motion = () => {
      follow = true;
      soon();
    };
    // Only what can move a placeholder: a transition of a box property (not a hover's colour fading).
    const onTransition = (e: Event) => {
      if (LAYOUT_PROPS.test((e as TransitionEvent).propertyName ?? "")) motion();
    };
    const onAnimation = (e: Event) => {
      if (animationMoves(e as AnimationEvent)) motion();
    };
    // Synchronously (lib/syncResize, after the work row's own pass): a ResizeObserver runs after layout, before
    // paint — a plain state update would be drawn a frame later, the instances one frame behind their panes while
    // the window is resized. The work row's commit measures already (slotsRelayout): then nothing more here.
    const resized = () => {
      if (measuredPass.current !== syncPass()) flushSync(() => measure.current());
      if (follow) soon();
    };
    const offs = [...slots.values()].map((slot) => observeSync(slot.el, resized, "follow"));
    for (const el of anchors) offs.push(observeSync(el, resized, "follow"));
    offs.push(observeSync(win.document.documentElement, resized, "follow"));
    offs.push(onSlotsMotion(motion));
    // Not for what happens inside a conversation's timeline (perf §9: every streamed delta adds nodes there, and
    // each pass read every placeholder's box): it cannot move a placeholder, and a size change it causes reaches
    // the observers above in the same frame anyway.
    const inTimeline = (n: Node) => !!(isElement(n) ? n : n.parentElement)?.closest("[data-timeline-frame]");
    const mo = typeof MutationObserver === "function" ? new MutationObserver((records) => !records.every((r) => inTimeline(r.target)) && soon()) : null;
    for (const el of anchors) mo?.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    // CSS transitions / animations in the work area (a pane easing in, a fold): follow them.
    win.document.addEventListener("transitionrun", onTransition, true);
    win.document.addEventListener("animationstart", onAnimation, true);
    return () => {
      disposed = true;
      for (const off of offs) off();
      mo?.disconnect();
      if (frame) unraf(frame);
      win.document.removeEventListener("transitionrun", onTransition, true);
      win.document.removeEventListener("animationstart", onAnimation, true);
    };
  }, [slots, anchors, win]);
  // Which instances are mounted: on screen, plus the last sideKeepHidden keepAlive "hidden" ones, plus the held ones. While
  // a card is maximised / full screen the page's other cards are not drawn; their instances stay
  // mounted (hidden) until the mode ends, so a mode never remounts anything.
  const onScreen = [...slots.keys()].filter((id) => all[id] && registry.has(all[id]!.kind));
  // (Also for the render that ends the mode: the cards register their placeholders right after it.)
  const beforeMode = useRef<string[]>([]);
  const lastMode = useRef(mode);
  useEffect(() => {
    lastMode.current = mode;
    if (!mode) beforeMode.current = onScreen;
  });
  const modeKept = mode || lastMode.current ? beforeMode.current.filter((id) => !slots.has(id) && all[id] && registry.has(all[id]!.kind) && visible(id)) : [];
  const keepable = (id: string) => {
    const inst = all[id];
    return !!inst && registry.get(inst.kind)?.item.keepAlive === "hidden" && visible(id);
  };
  // Held instances (§18.13) of the loaded scope; held ones of other scopes render hidden from their snapshot.
  const keeps = (kind: string) => registry.get(kind as ItemId)?.item.keepAlive === "hidden";
  const held = new Set(Object.values(holds).filter((h) => h.scope === scope && all[h.id] && keeps(all[h.id]!.kind)).map((h) => h.id));
  // Held ones in a conversation not on screen (an agent's own open went to its own Shelf, owner 2026-10-23) stay
  // mounted the same way, from their snapshot, until that conversation's Shelf is live again (same box key).
  useConvShelfVersion((v) => v.n);
  const remembered = rememberedInstances();
  const away: SideHold[] = Object.values(holds).filter((h) => (h.scope !== scope || (!all[h.id] && remembered[h.id])) && keeps(h.inst.kind));
  const mounts = mountPlan({ onScreen, kept: kept.current, keepable, held, modeKept, keepHidden: keepHiddenLimit() });
  useEffect(() => {
    kept.current = mounts.kept;
  });
  // Drop holds that no longer apply (tab closed, module off, host removed / new epoch), refresh the
  // snapshots of the loaded scope, and write back state set while a held instance was out of scope.
  useEffect(() => {
    const now = useSideKeep.getState().holds;
    const back = scope ? Object.values(now).filter((h) => h.scope === scope && h.dirty && all[h.id]) : [];
    for (const h of back) setInstanceStateNow(h.id, h.inst.state, h.inst.v);
    if (back.length && scope) clearHeldDirty(scope, back.map((h) => h.id));
    const known = new Set((hosts?.hosts ?? []).map((h) => h.id));
    const next = pruneHolds(useSideKeep.getState().holds, {
      scope,
      instances: { ...remembered, ...all },
      keeps,
      hostKnown: (id) => id === "local" || known.has(id),
      epochOf: (id) => hostEpoch(hosts, id),
    });
    if (next !== useSideKeep.getState().holds) useSideKeep.setState({ holds: next });
  });
  // Stable order (by scope + id) so React never moves a mounted box in the DOM (an iframe would reload);
  // a held box keeps its key when the scope switches away and back.
  const boxes = [
    ...mounts.mounted.map((id) => ({ key: holdKey(scope ?? "", id), id, inst: all[id]!, outOfScope: undefined as string | undefined })),
    ...away.map((h) => ({ key: holdKey(h.scope, h.id), id: h.id, inst: h.inst, outOfScope: h.scope as string | undefined })),
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const probes = Object.keys(all)
    .filter((id) => registry.has(all[id]!.kind) && visible(id))
    .sort();
  // Each box / probe under its Shelf's source (always a provider, so the tree keeps its shape when an
  // instance changes Shelf: nothing remounts).
  const sourceOf = (id: string): ShelfPeer | null => {
    const key = owners.get(id);
    return key ? (sources.get(key) ?? null) : null;
  };

  return (
    <>
      {boxes.map(({ key, id, inst, outOfScope }) => {
        const entry = registry.get(inst.kind)!;
        const source = outOfScope ? null : sourceOf(id);
        return (
          <ShelfSourceContext.Provider key={key} value={source}>
            {outOfScope ? (
              <Instance id={id} inst={inst} entry={entry} slot={null} box={null} outOfScope={outOfScope} />
            ) : (
              <Instance id={id} inst={inst} entry={entry} slot={slots.get(id) ?? null} box={rects.get(id) ?? null} peer={source?.key} wsPane={source ? paneOf(source.key) : null} />
            )}
          </ShelfSourceContext.Provider>
        );
      })}
      {probes.map((id) => {
        const inst = all[id]!;
        const entry = registry.get(inst.kind)!;
        return (
          <ShelfSourceContext.Provider key={`probe:${id}`} value={sourceOf(id)}>
            <ItemBoundary moduleId={entry.moduleId} resetKey={id}>
              <span hidden>
                <Probe id={id} inst={inst} entry={entry} />
              </span>
            </ItemBoundary>
          </ShelfSourceContext.Provider>
        );
      })}
    </>
  );
}
