// Renders the global context menu and confirm / prompt dialogs (state in lib/contextMenu.ts).
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useI18n } from "../i18n";
import { ARMED_TIMEOUT_MS } from "../lib/armedConfirm";
import { closeDialog, closeMenu, normalizeEntries, runAction, selectStep, useOverlayState, watchMenuDismiss, type DialogCheck, type MenuAction, type MenuEntry, type MenuToggle } from "../lib/contextMenu";
import { placeFlyout, samePlace, type FlyoutPlace } from "../lib/flyoutPlacement";
import { AgentInfoDialog } from "./AgentInfoDialog";
import { FolderBrowser } from "./FolderBrowser";

/** The rows' on / off buttons (MenuToggle), flipped by a click or by Space on the active row. */
interface Toggles {
  on(toggle: MenuToggle): boolean;
  flip(toggle: MenuToggle): void;
}
const TogglesContext = createContext<Toggles | null>(null);

function ContextMenuView({ x, y, items, above, minWidth }: { x: number; y: number; items: (MenuAction | "separator")[]; above?: boolean; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  // Keyboard focus is inside the active row's flyout (→ entered it, ← leaves it).
  const [inFlyout, setInFlyout] = useState(false);
  // The `armed` row waiting for its second click (any menu level); disarms by itself.
  const [armed, setArmed] = useState<MenuAction | null>(null);
  const [flipped, setFlipped] = useState<ReadonlyMap<MenuToggle, boolean>>(new Map());
  const toggles: Toggles = {
    on: (toggle) => flipped.get(toggle) ?? toggle.on,
    flip(toggle) {
      const next = !(flipped.get(toggle) ?? toggle.on);
      setFlipped((m) => new Map(m).set(toggle, next));
      toggle.onToggle(next);
    },
  };
  const select = (item: MenuAction) => {
    if (selectStep(item, armed) === "arm") setArmed(item);
    else void runAction(item);
  };
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARMED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const actions = items.map((item, i) => ({ item, i })).filter((e): e is { item: MenuAction; i: number } => e.item !== "separator" && !e.item.disabled && !e.item.note);

  // Keep the menu inside the window (an armed row may widen it); `above`: y is the bottom edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const top = above ? y - height : y;
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - width - 4)), top: Math.max(4, Math.min(top, window.innerHeight - height - 4)) });
  }, [x, y, above, armed]);

  /** The enabled rows of the open flyout (item submenu or custom flyout), in order. */
  const flyoutRows = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-flyout] [role=menuitem]") ?? [])].filter((el) => !(el as HTMLButtonElement).disabled);
  const opensFlyout = (item: MenuAction | "separator" | undefined) => !!item && item !== "separator" && !item.disabled && (!!item.submenu || item.flyout !== undefined);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (inFlyout) {
        const rows = flyoutRows();
        const at = rows.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!rows.length) return;
          rows[e.key === "ArrowDown" ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length]?.focus();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setInFlyout(false);
          (document.activeElement as HTMLElement | null)?.blur();
        } else if ((e.key === "Enter" || e.key === " ") && at >= 0) {
          e.preventDefault();
          rows[at]!.click();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const at = actions.findIndex((a) => a.i === active);
        const next = e.key === "ArrowDown" ? (at + 1) % actions.length : (at - 1 + actions.length) % actions.length;
        setActive(actions[next]?.i ?? -1);
      } else if ((e.key === "ArrowRight" || e.key === "Enter") && active >= 0 && opensFlyout(items[active])) {
        e.preventDefault();
        setInFlyout(true);
        // The flyout mounts with the active row; focus its first row once it is there.
        requestAnimationFrame(() => flyoutRows()[0]?.focus());
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        select(items[active] as MenuAction);
      } else if (e.key === " " && active >= 0) {
        // Space flips the active row's on / off button (e.g. pin), the menu stays open.
        const toggle = (items[active] as MenuAction).toggle;
        if (toggle && !(items[active] as MenuAction).disabled) {
          e.preventDefault();
          toggles.flip(toggle);
        }
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    // Not on any `scroll`: a streaming timeline scrolls itself to the bottom (lib/contextMenu.ts).
    const unwatch = watchMenuDismiss(() => ref.current, closeMenu);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      unwatch();
    };
  });

  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-48 rounded-xl border border-border bg-surface p-1 text-sm shadow-xl"
      style={{ ...pos, minWidth }}
    >
      <TogglesContext.Provider value={toggles}>
      <MenuItems
        items={items}
        active={active}
        setActive={(i) => {
          if (i !== active) setInFlyout(false);
          setActive(i);
        }}
        armed={armed}
        select={select}
      />
      </TogglesContext.Provider>
    </div>
  );
}

interface Arming {
  armed: MenuAction | null;
  select(item: MenuAction): void;
}

/** Rows of one menu level; a row with `submenu` / `flyout` opens it beside itself while it is the active row. */
function MenuItems({ items, active, setActive, armed, select }: { items: (MenuAction | "separator")[]; active: number; setActive(i: number): void } & Arming) {
  return (
    <>
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="mx-2 my-1 h-px bg-border" />
        ) : item.note ? (
          item.labelNode ? (
            <div key={i} className="max-w-72 px-2.5 py-1.5">{item.labelNode}</div>
          ) : (
            <div key={i} className="max-w-96 px-2.5 py-1.5 text-xs break-all text-muted select-text">
              {item.label}
              {item.hint && <div className="mt-0.5 break-normal text-subtle">{item.hint}</div>}
            </div>
          )
        ) : (
          // The tooltip sits on the wrapper: a disabled button gets no hover.
          <div key={i} className="relative" title={item.title} onMouseEnter={() => setActive(i)}>
            <button
              role="menuitem"
              aria-haspopup={item.submenu || item.flyout !== undefined ? "menu" : undefined}
              aria-expanded={item.submenu || item.flyout !== undefined ? active === i : undefined}
              disabled={item.disabled}
              data-armed={armed === item || undefined}
              onClick={() => (item.submenu || item.flyout !== undefined ? setActive(i) : select(item))}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none focus:bg-surface-2 disabled:opacity-40 ${
                armed === item ? "bg-danger text-white" : `${active === i && !item.disabled ? "bg-surface-2" : ""} ${item.danger ? "text-danger" : ""}`
              }`}
            >
              {/* A rich row without an icon (e.g. the identity menu's avatar header) starts at the left edge. */}
              {(item.icon || !item.labelNode) && <span className={`flex w-4 justify-center ${armed === item ? "text-white" : "text-muted"}`}>{item.icon}</span>}
              {armed === item ? (
                <span className="max-w-80 min-w-0 flex-1" role="alert">
                  {item.armed}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate">{item.labelNode ?? item.label}</span>
              )}
              {item.hint && armed !== item && <span className="text-xs text-subtle">{item.hint}</span>}
              {(item.submenu || item.flyout !== undefined) && <ChevronRight size={13} className="shrink-0 text-subtle" />}
              {item.toggle && <span aria-hidden className="w-6 shrink-0" />}
            </button>
            {item.toggle && !item.disabled && <MenuToggleButton toggle={item.toggle} />}
            {item.submenu && active === i && !item.disabled && <Submenu entries={item.submenu} armed={armed} select={select} />}
            {item.flyout !== undefined && active === i && !item.disabled && <Flyout>{item.flyout}</Flyout>}
          </div>
        ),
      )}
    </>
  );
}

/** The row's trailing on / off button (lib/contextMenu MenuToggle): flips in place, the menu stays open. */
function MenuToggleButton({ toggle }: { toggle: MenuToggle }) {
  const toggles = useContext(TogglesContext);
  const on = toggles?.on(toggle) ?? toggle.on;
  const label = on ? toggle.onLabel : toggle.offLabel;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-menu-toggle
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (toggles) toggles.flip(toggle);
        else toggle.onToggle(!on);
      }}
      className={`absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md hover:bg-hover ${on ? "text-accent" : "text-subtle opacity-60 hover:opacity-100"}`}
    >
      {on ? toggle.onIcon : toggle.offIcon}
    </button>
  );
}

/**
 * Flyout frame beside its row: right of the menu, or left when there is no room; moved up when it
 * would run past the window's bottom (menus opened from the sidebar footer). Placed before the first
 * paint; a later size change (live content) keeps the side and the anchored edge (lib/flyoutPlacement).
 */
function Flyout({ children, className = "min-w-40" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<FlyoutPlace["side"]>("right");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let current: FlyoutPlace | undefined;
    // Vertical placement is written to the element directly: a ResizeObserver callback runs after
    // layout and before paint, so the re-anchored position shows in the same frame as the new size.
    const update = () => {
      const next = placeFlyout(el.parentElement!.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, current);
      if (current && samePlace(current, next)) return;
      current = next;
      el.style.top = next.anchor === "top" ? `${next.offset}px` : "auto";
      el.style.bottom = next.anchor === "bottom" ? `${next.offset}px` : "";
      setSide(next.side);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      data-flyout=""
      className={`absolute top-[-4px] z-50 rounded-xl border border-border bg-surface p-1 text-sm shadow-xl ${className} ${side === "left" ? "right-full mr-1" : "left-full ml-1"}`}
    >
      {children}
    </div>
  );
}

function Submenu({ entries, armed, select }: { entries: MenuEntry[] } & Arming) {
  const [active, setActive] = useState(-1);
  const items = normalizeEntries(entries);
  if (items.length === 0) return null;
  // A long leaf list (e.g. every agent of a project) scrolls inside the window; a level with its own
  // flyouts cannot scroll (the scroller would clip them).
  const leaf = items.every((item) => item === "separator" || (!item.submenu && item.flyout === undefined));
  return (
    <Flyout className={leaf ? "min-w-40 max-h-[calc(100vh-16px)] overflow-y-auto" : undefined}>
      <MenuItems items={items} active={active} setActive={setActive} armed={armed} select={select} />
    </Flyout>
  );
}

/** The optional checkbox of a confirm / prompt dialog; writes its state back into `check.checked`. */
function DialogCheckbox({ check }: { check: DialogCheck }) {
  const [on, setOn] = useState(check.checked);
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm" data-dialog-check="">
      <input
        type="checkbox"
        className="mt-0.5 shrink-0"
        checked={on}
        onChange={(e) => {
          check.checked = e.target.checked;
          setOn(e.target.checked);
        }}
      />
      <span className="min-w-0">
        <span className="block">{check.label}</span>
        {check.detail && <span className={`mt-0.5 block text-xs whitespace-pre-wrap ${on ? "text-muted" : "text-subtle opacity-60"}`}>{check.detail}</span>}
      </span>
    </label>
  );
}

function PromptView({ title, initial, placeholder, multiline, maxLength, hint, check, resolve }: { title: string; initial: string; placeholder?: string; multiline?: boolean; maxLength?: number; hint?: string; check?: DialogCheck; resolve(v: string | null): void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const done = (v: string | null) => {
    closeDialog();
    resolve(v);
  };
  const field = {
    autoFocus: true,
    value,
    placeholder,
    maxLength,
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onFocus: (e: { target: HTMLInputElement | HTMLTextAreaElement }) => e.target.select(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        done(value);
      }
    },
    className: "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent",
  };
  return (
    <>
      <div className="mb-3 text-sm font-medium">{title}</div>
      {multiline ? <textarea rows={4} {...field} /> : <input {...field} />}
      {hint && <div className="mt-1.5 text-xs text-subtle">{hint}</div>}
      {check && <DialogCheckbox check={check} />}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => done(null)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2">
          {t("dialog.cancel")}
        </button>
        <button onClick={() => done(value)} className="rounded-md bg-accent px-3 py-1 text-sm text-white">
          {t("dialog.ok")}
        </button>
      </div>
    </>
  );
}

function ConfirmView({ message, danger, notice, labels, check, resolve }: { message: string; danger: boolean; notice?: boolean; labels?: { ok: string; cancel: string }; check?: DialogCheck; resolve(ok: boolean): void }) {
  const { t } = useI18n();
  const done = (ok: boolean) => {
    closeDialog();
    resolve(ok);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <p className="text-sm whitespace-pre-wrap">{message}</p>
      {check && <DialogCheckbox check={check} />}
      <div className="mt-4 flex justify-end gap-2">
        {!notice && (
          <button onClick={() => done(false)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2">
            {labels?.cancel ?? t("dialog.cancel")}
          </button>
        )}
        <button autoFocus onClick={() => done(true)} className={`rounded-md px-3 py-1 text-sm text-white ${danger ? "bg-danger" : "bg-accent"}`}>
          {notice ? t("dialog.ok") : (labels?.ok ?? t("dialog.confirm"))}
        </button>
      </div>
    </>
  );
}

export function Overlays() {
  const { menu, dialog } = useOverlayState();
  return (
    <>
      {menu && <ContextMenuView key={`${menu.x},${menu.y}`} {...menu} />}
      {dialog && (
        <div className={`fixed inset-0 z-50 flex items-start justify-center bg-black/30 ${dialog.kind === "folder" ? "pt-[10vh]" : "pt-[20vh]"}`} onMouseDown={(e) => e.target === e.currentTarget && (dialog.kind === "confirm" ? dialog.resolve(false) : dialog.resolve(null), closeDialog())}>
          {/* role: Esc anywhere else stops the running turn unless a dialog is open (lib/escInterrupt). */}
          <div role="dialog" aria-modal="true" className={`${dialog.kind === "folder" ? "w-[34rem] max-w-[calc(100vw-2rem)]" : "w-96"} rounded-xl border border-border bg-surface p-4 shadow-2xl`}>
            {dialog.kind === "confirm" ? (
              <ConfirmView {...dialog} />
            ) : dialog.kind === "folder" ? (
              <FolderBrowser start={dialog.start} hostId={dialog.hostId} resolve={dialog.resolve} />
            ) : dialog.kind === "agentInfo" ? (
              <AgentInfoDialog {...dialog} />
            ) : (
              <PromptView {...dialog} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
