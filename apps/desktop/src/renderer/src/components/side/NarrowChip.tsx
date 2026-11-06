// 「太窄？收起 X」 on a Shelf pane (docs/design/002 做法 3; lib/narrowRoom): a preview in a Shelf of one of two
// workspaces, narrower than its comfortable width, offers to fold the other workspace to its strip — its width
// goes to this Shelf. Hover / keyboard focus foretells it; the preview and the click are the same effect
// (lib/workspaceEffects makeRoomEffect, docs/design/008). Never automatic.
import { useEffect, useState, type RefObject } from "react";
import { useI18n } from "../../i18n";
import { useStrips } from "../../lib/convStrips";
import { useForetell } from "../../lib/foretell";
import { comfortWidth, narrowChipShown } from "../../lib/narrowRoom";
import { conversationPanes, focusedConversation, paneBinding, type PaneLayout } from "../../lib/paneLayout";
import { usePanes } from "../../lib/paneStore";
import type { SideComponentEntry } from "../../lib/sideComponents";
import { shelfOfPage } from "../../lib/sideLayout";
import { useShelfLayout } from "../../lib/shelfSource";
import { useShelfPeer, type ShelfPeer } from "../../lib/shelfSourceContext";
import { makeRoomEffect, makeRoomTarget } from "../../lib/workspaceEffects";
import "../strips.css";
import { useOwnerWindow } from "../../lib/ownerContext";

/** The conversation pane whose workspace owns this Shelf: the peer's, else the focused one. */
function ownerPane(layout: PaneLayout, peer: ShelfPeer | null): string | null {
  if (!peer) return focusedConversation(layout);
  return conversationPanes(layout).find((id) => {
    const b = paneBinding(layout, id);
    return b?.hostId === peer.hostId && b.sessionId === peer.sessionId;
  }) ?? null;
}

/** Whether `el` is narrower than `comfort` (null: no element / no comfort), kept by a ResizeObserver. */
function useNarrower(box: RefObject<HTMLElement | null>, comfort: number | null): boolean {
  const win = useOwnerWindow();
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || comfort === null) return setNarrow(false);
    const measure = () => setNarrow(narrowChipShown({ width: el.getBoundingClientRect().width, comfort, canFold: true }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new win.ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [box, comfort]);
  return narrow;
}

export function NarrowChip({ box, entry, instanceId, pageId, name }: { box: RefObject<HTMLElement | null>; entry: SideComponentEntry; instanceId: string; pageId: string; name: string }) {
  const { t } = useI18n();
  const shelf = useShelfLayout();
  const peer = useShelfPeer();
  const layout = usePanes((s) => s.layout);
  useStrips((s) => s.strips); // the target follows the strips
  const kind = shelf.instances[instanceId]?.kind ?? "";
  const minW = (entry.item as { minSize?: { w: number } }).minSize?.w ?? null;
  const narrow = useNarrower(box, comfortWidth(kind, minW));
  const pane = ownerPane(layout, peer);
  const shelfId = shelfOfPage(shelf, pageId)?.id ?? null;
  const target = pane && shelfId && narrow ? makeRoomTarget(pane) : null;
  const effect = () => (pane && shelfId ? makeRoomEffect(pane, shelfId, name) : { foretell: null, run: () => {} });
  const fh = useForetell(() => effect().foretell, { disabled: !target });
  if (!target) return null;
  const tip = t("strip.makeRoomTitle", { name: target.name });
  return (
    <div data-narrow-chip={instanceId} className="narrow-chip">
      <span className="shrink-0">{t("strip.narrow")}</span>
      <button type="button" data-side-nodrag data-tip={tip} aria-label={tip} {...fh} onClick={() => effect().run()}>
        {t("strip.makeRoom", { name: target.name })}
      </button>
    </div>
  );
}
