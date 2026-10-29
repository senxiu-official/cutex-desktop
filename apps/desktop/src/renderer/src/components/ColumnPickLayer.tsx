// Ctrl/⌘ + click on an agent with every column taken (design 039, lib/columnPick): each conversation column shows as a
// click target in the look of a drop preview — 「换掉 X」 on a dashed red box — and the one clicked shows the agent. Esc or
// a click anywhere else cancels. Nothing is drawn without a pick in progress. Its tint follows 拖放落点预览
// (lib/dropTint): 只要框线 keeps the dashed outline (solid under the pointer), 框线+底色 also tints it.
import { useEffect } from "react";
import { useI18n } from "../i18n";
import { DROP_TINT } from "../lib/dropTint";
import { cancelColumnPick, finishColumnPick, useColumnPick } from "../lib/columnPick";
import { conversationPanes, paneBinding } from "../lib/paneLayout";
import { usePanes } from "../lib/paneStore";
import { sidebarOf, useApp } from "../store";
import { useOwnerWindow } from "../lib/ownerContext";
import { MAIN_WINDOW, useWindowKey } from "../lib/windowScope";

/** The pick target's tint, deeper under the pointer (painted only under 框线+底色: lib/dropTint). */
const PICK_TINT = "[--drop-tint:color-mix(in_srgb,var(--danger)_10%,transparent)] hover:[--drop-tint:color-mix(in_srgb,var(--danger)_20%,transparent)]";

const cssId = (id: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"'));

/** App and every desk (components/DeskWindows) mount it: the window the pick started in draws it (its own columns). */
export function ColumnPickLayer() {
  const here = useWindowKey();
  const pick = useColumnPick((s) => !!s.pick && (s.pick.win ?? MAIN_WINDOW) === here);
  return pick ? <OpenPick /> : null;
}

function OpenPick() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const layout = usePanes((s) => s.layout);
  const names = useApp((s) => s);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelColumnPick();
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }, []);
  const zones = conversationPanes(layout).flatMap((paneId) => {
    const b = paneBinding(layout, paneId);
    const r = win.document.querySelector<HTMLElement>(`[data-conv-pane="${cssId(paneId)}"], [data-conv-single="${cssId(paneId)}"]`)?.getBoundingClientRect();
    if (!r || !b?.sessionId) return [];
    const sidebar = sidebarOf(names, b.hostId);
    const name = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((x) => x.cutexSessionId === b.sessionId)?.displayName ?? b.sessionId;
    return [{ paneId, name, r }];
  });
  return (
    <>
      <div data-column-pick-shield className="fixed inset-0 z-[70] bg-black/10" onMouseDown={cancelColumnPick} />
      {zones.map(({ paneId, name, r }) => (
        <button
          key={paneId}
          type="button"
          data-column-pick={paneId}
          onClick={() => finishColumnPick(paneId)}
          className={`fixed z-[71] flex items-center justify-center rounded-card border-2 border-dashed border-danger hover:border-solid ${DROP_TINT} ${PICK_TINT}`}
          style={{ left: r.left + 4, top: r.top + 4, width: r.width - 8, height: r.height - 8 }}
        >
          <span className="flex flex-col items-center gap-px rounded-card bg-danger-solid px-4 py-[7px] text-ui/[inherit] font-semibold whitespace-nowrap text-white shadow-e2">
            {t("columnPick.replace", { name })}
            <small className="text-caption/[inherit] font-normal opacity-90">{t("columnPick.sub")}</small>
          </span>
        </button>
      ))}
    </>
  );
}
