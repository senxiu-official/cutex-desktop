// The collapsed sidebar (owner 2026-10-28): fully hidden — nothing in the layout, only a 3 px hint line at the
// window's left edge. Resting the pointer on that edge (a 4 px hot zone) or on the title-bar logo for ~250 ms
// pops the whole sidebar over the content (components/SidebarPeek): no width moves, nothing is pushed. 300 ms
// after the pointer leaves it — a context menu opened from it holds it — or on Esc, or after opening an agent
// from it, it retracts. 「固定」 pins the sidebar expanded (the same as Ctrl/⌘+B).
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Pin, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useMenuOwner } from "../lib/contextMenu";
import { useOwnerWindow } from "../lib/ownerContext";
import { toggleSidebarRail } from "../lib/prefs";
import { bindingLabel } from "../lib/keybindings";
import { createPeekRest, createPeekRetract } from "../lib/sidebarPeek";
import { useSidebarPeek } from "../lib/windowSidebar";
import { useWindowKey } from "../lib/windowScope";

export function SidebarPeek({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const owner = useOwnerWindow();
  const store = useSidebarPeek.of(useWindowKey());
  const popped = store((s) => s.popped);
  const menuOwner = useMenuOwner();
  const menuOpen = useRef(menuOwner);
  menuOpen.current = menuOwner;
  // The pointer is over the popped sidebar (retract armed only after it leaves; a menu holds it meanwhile).
  const inside = useRef(true);
  const rest = useMemo(() => createPeekRest(() => store.setState({ popped: true })), [store]);
  const retract = useMemo(() => createPeekRetract(() => store.setState({ popped: false })), [store]);
  // Unmount (expanded again, window gone): no timers and no popped ghost for this window.
  useEffect(() => () => { rest.leave(); retract.stay(); store.setState({ popped: false }); }, [rest, retract, store]);
  useEffect(() => {
    if (menuOwner) retract.stay();
    else if (!inside.current) retract.arm();
  }, [menuOwner, retract]);
  // Esc retracts at once — unless a menu is open (its own Esc closes that first).
  useEffect(() => {
    if (!popped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !menuOpen.current) store.setState({ popped: false });
    };
    owner.addEventListener("keydown", onKey);
    return () => owner.removeEventListener("keydown", onKey);
  }, [popped, owner, store]);
  const close = () => store.setState({ popped: false });
  const pinHint = `${t("sidebar.peek.pin")} (${bindingLabel("sidebar")})`;
  return (
    <>
      {/* The 3 px hint line (the hot zone beside it is wider and transparent). */}
      {!popped && <span aria-hidden data-sidebar-peek-line="" className="pointer-events-none fixed inset-y-0 left-0 z-40 w-[3px] bg-[color-mix(in_srgb,var(--fg)_10%,transparent)]" />}
      <div
        data-sidebar-peek-zone=""
        className="fixed inset-y-0 left-0 z-40 w-1"
        onPointerEnter={() => rest.enter()}
        onPointerLeave={() => rest.leave()}
        aria-hidden="true"
      />
      {popped && (
        <aside
          data-sidebar-mode="pop"
          data-sidebar-pop=""
          aria-label={t("sidebar.peek.label")}
          className="sidebar-card absolute inset-y-0 left-0 z-40 flex w-[max(180px,var(--sidebar-w,16rem))] flex-col"
          onPointerEnter={() => {
            inside.current = true;
            retract.stay();
          }}
          onPointerLeave={() => {
            inside.current = false;
            if (!menuOpen.current) retract.arm();
          }}
          // Opening an agent from the popped sidebar opens it and retracts (a header / section / the search keeps it).
          onClickCapture={(e) => {
            if ((e.target as Element).closest("[data-row-selectable]")) close();
          }}
        >
          <div data-sidebar-pop-bar="" className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b border-border px-1.5">
            <button onClick={() => { close(); toggleSidebarRail(); }} title={pinHint} aria-label={pinHint} data-sidebar-peek-pin=""
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-caption text-muted hover:bg-surface-2 hover:text-foreground">
              <Pin size={12} />
              {t("sidebar.peek.pin")}
            </button>
            <button onClick={close} title={`${t("sidebar.peek.close")} (Esc)`} aria-label={t("sidebar.peek.close")} data-sidebar-peek-close=""
              className="flex items-center rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground">
              <X size={13} />
            </button>
          </div>
          {children}
        </aside>
      )}
    </>
  );
}
