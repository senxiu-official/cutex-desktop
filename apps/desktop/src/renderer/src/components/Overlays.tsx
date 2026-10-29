import { isImeComposing } from "../lib/ime";
import { ForkProfileDialog } from "./ForkProfileDialog";
// Renders the global context menu and confirm / prompt dialogs (state in lib/contextMenu.ts).
import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { translate, useI18n } from "../i18n";
import { ARMED_COUNTDOWN, ARMED_TIMEOUT_MS, showArmedExpired } from "../lib/armedConfirm";
import { closeDialog, closeMenu, normalizeEntries, runAction, selectStep, useOverlayState, watchMenuDismiss, type DialogCheck, type MenuAction, type MenuToggle } from "../lib/contextMenu";
import { foretellAfterDelay, setForetell } from "../lib/foretell";
import { MenuFlyout } from "./MenuFlyout";
import { MenuLayersContext, findMenuLayerElement, menuFlyoutRows, menuLayerContains, useMenuLayer, useMenuLayers } from "../lib/menuLayers";
import { AgentInfoDialog } from "./AgentInfoDialog";
import { StopIdleDialog } from "./StopIdleDialog";
import { FolderBrowser } from "./FolderBrowser";
import { OwnerLayer } from "./OwnerLayer";
import { useOwnerDocument, useOwnerWindow } from "../lib/ownerContext";

/** The rows' on / off buttons (MenuToggle), flipped by a click or by Space on the active row. */
interface Toggles {
  on(toggle: MenuToggle): boolean;
  flip(toggle: MenuToggle): void;
}
const TogglesContext = createContext<Toggles | null>(null);

function ContextMenuView({ x, y, items, above, minWidth }: { x: number; y: number; items: (MenuAction | "separator")[]; above?: boolean; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const layers = useMenuLayers();
  useMenuLayer(ref, layers);
  // The window it opened in (a desk window's menu renders and listens there; components/OwnerLayer).
  const win = useOwnerWindow();
  const doc = win.document;
  const [pos, setPos] = useState({ left: x, top: y });
  // Eligibility checks may insert a row. Keep keyboard focus on the same
  // action, rather than accidentally selecting whichever row takes its index.
  const [activeItem, setActiveItem] = useState<MenuAction | null>(null);
  const active = activeItem ? items.indexOf(activeItem) : -1;
  const setActive = (index: number) => {
    const item = items[index];
    setActiveItem(item && item !== "separator" ? item : null);
  };
  // Keyboard focus is inside the active row's flyout (→ entered it, ← leaves it).
  const [inFlyout, setInFlyout] = useState(false);
  const [flyoutClosed, setFlyoutClosed] = useState(false);
  // The `armed` row waiting for its second click (any menu level); disarms by itself.
  const [armed, setArmed] = useState<MenuAction | null>(null);
  // `prepare` rows: the text the row armed with, and a busy / 「没有…」 note on a row (see lib/contextMenu `prepare`).
  const [armedText, setArmedText] = useState<string | null>(null);
  const [note, setNote] = useState<RowNote | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
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
    if (item.prepare && !item.disabled && armed !== item) {
      if (note?.busy) return;
      setNote({ item, text: item.preparing ?? item.label, busy: true });
      void item.prepare().then(
        (r) => {
          if (!alive.current) return;
          if ("armed" in r) {
            setNote(null);
            setArmedText(r.armed);
            setArmed(item);
          } else {
            setNote({ item, text: r.empty, busy: false });
            setTimeout(() => alive.current && setNote((n) => (n?.item === item ? null : n)), 2500);
          }
        },
        () => alive.current && setNote(null),
      );
    } else if (selectStep(item, armed) === "arm") {
      setArmedText(null);
      setArmed(item);
    } else void runAction(item);
  };
  // Same as lib/armedConfirm's useArmed: Esc disarms (and leaves the menu open); running out leaves
  // the 「未开始」 note by the row (design 013).
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setArmed(null);
    };
    win.addEventListener("keydown", onKey, true);
    const timer = setTimeout(() => {
      const row = findMenuLayerElement(layers, "[data-armed]");
      if (row) showArmedExpired(row.getBoundingClientRect(), row.ownerDocument);
      setArmed(null);
    }, ARMED_TIMEOUT_MS);
    return () => {
      win.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
    };
  }, [armed, win, layers]);
  const actions = items.map((item, i) => ({ item, i })).filter((e): e is { item: MenuAction; i: number } => e.item !== "separator" && !e.item.disabled && !e.item.note);

  // Keep the menu inside the window (an armed row may widen it); `above`: y is the bottom edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const top = above ? y - height : y;
    setPos({ left: Math.max(4, Math.min(x, win.innerWidth - width - 4)), top: Math.max(4, Math.min(top, win.innerHeight - height - 4)) });
  }, [x, y, above, armed, win]);

  /** The enabled rows of the open flyout (item submenu or custom flyout), in order. */
  const flyoutRows = () => menuFlyoutRows(layers);
  const opensFlyout = (item: MenuAction | "separator" | undefined) => !!item && item !== "separator" && !item.disabled && (!!item.submenu || item.flyout !== undefined);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuLayerContains(layers, e.target)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (inFlyout) {
        const rows = flyoutRows();
        const at = rows.indexOf(doc.activeElement as HTMLElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!rows.length) return;
          rows[e.key === "ArrowDown" ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length]?.focus();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setInFlyout(false);
          setFlyoutClosed(true);
          ref.current?.querySelector<HTMLElement>(`[data-menu-index="${active}"]`)?.focus();
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
        setFlyoutClosed(false);
        setInFlyout(true);
        // The flyout mounts with the active row; focus its first row once it is there.
        win.requestAnimationFrame(() => (findMenuLayerElement(layers, '[data-menu-search]') ?? flyoutRows()[0])?.focus());
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
    doc.addEventListener("mousedown", onDown, true);
    doc.addEventListener("keydown", onKey);
    // Not on any `scroll`: a streaming timeline scrolls itself to the bottom (lib/contextMenu.ts).
    const unwatch = watchMenuDismiss(() => ref.current, closeMenu, win, target => menuLayerContains(layers, target));
    return () => {
      doc.removeEventListener("mousedown", onDown, true);
      doc.removeEventListener("keydown", onKey);
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
      <MenuLayersContext.Provider value={layers}><TogglesContext.Provider value={toggles}>
      <MenuItems
        items={items}
        active={active}
        flyoutClosed={flyoutClosed}
        setActive={(i) => {
          setFlyoutClosed(false);
          if (i !== active) setInFlyout(false);
          setActive(i);
        }}
        armed={armed}
        select={select}
        shown={{ armedText, note }}
      />
      </TogglesContext.Provider></MenuLayersContext.Provider>
    </div>
  );
}

/** 动作预告 of the active row (hover or arrows), after the usual delay; gone when another row / nothing is active or the menu closes. */
function useRowForetell(items: (MenuAction | "separator")[], active: number): void {
  const owner = useRef<object>({}).current;
  const item = items[active];
  const row = item && item !== "separator" && !item.disabled && item.foretell ? item : null;
  const doc = useOwnerDocument();
  useEffect(() => {
    if (!row) return;
    const cancel = foretellAfterDelay(owner, row.foretell!(), doc === document ? null : doc);
    return () => {
      cancel();
      setForetell(owner, null);
    };
  }, [row, owner, doc]);
}

/** A row's busy / empty note while a `prepare` runs (lib/contextMenu). */
interface RowNote {
  item: MenuAction;
  text: string;
  busy: boolean;
}

interface Arming {
  armed: MenuAction | null;
  select(item: MenuAction): void;
  shown: { armedText: string | null; note: RowNote | null };
}

/** Rows of one menu level; a row with `submenu` / `flyout` opens it beside itself while it is the active row. */
function MenuItems({ items, active, setActive, armed, select, shown, flyoutClosed = false }: { items: (MenuAction | "separator")[]; active: number; setActive(i: number): void; flyoutClosed?: boolean } & Arming) {
  useRowForetell(items, active);
  const base = useId();
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
          <MenuRow key={i} item={item} i={i} base={base} active={active === i} flyoutClosed={flyoutClosed} setActive={setActive} armed={armed} select={select} shown={shown} />
        ),
      )}
    </>
  );
}

/** Only the old and new active rows change while moving through a long submenu. */
const MenuRow = memo(function MenuRow({ item, i, base, active, flyoutClosed, setActive, armed, select, shown }: {
  item: MenuAction; i: number; base: string; active: boolean; flyoutClosed: boolean; setActive(i: number): void;
} & Arming) {
  return (
    // The tooltip sits on the wrapper: a disabled button gets no hover.
    <div className="relative" title={item.info ? undefined : item.title} onMouseEnter={() => setActive(i)}>
      <button
        role="menuitem"
        data-menu-index={i}
        aria-haspopup={item.submenu || item.flyout !== undefined ? "menu" : undefined}
        aria-expanded={item.submenu || item.flyout !== undefined ? active && !flyoutClosed : undefined}
        disabled={item.disabled}
        aria-describedby={item.info ? `${base}-${i}` : undefined}
        data-armed={armed === item || undefined}
        onClick={() => (item.submenu || item.flyout !== undefined ? setActive(i) : select(item))}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none focus:bg-surface-2 disabled:opacity-40 ${
          armed === item ? `${ARMED_COUNTDOWN} bg-danger-solid text-white` : `${active && !item.disabled ? "bg-surface-2" : ""} ${item.danger ? "text-danger" : ""}`
        }`}
      >
        {/* A rich row without an icon (e.g. the identity menu's avatar header) starts at the left edge. */}
        {(item.icon || !item.labelNode) && <span className={`flex w-4 justify-center ${armed === item ? "text-white" : "text-muted"}`}>{item.icon}</span>}
        {armed === item ? (
          <span className="max-w-80 min-w-0 flex-1" role="alert">
            {shown.armedText ?? item.armed}
          </span>
        ) : shown.note?.item === item ? (
          <span className={`min-w-0 flex-1 truncate text-muted ${shown.note.busy ? "animate-pulse" : ""}`} role="status">
            {shown.note.text}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{item.labelNode ?? item.label}</span>
        )}
        {item.info && armed !== item && <Info aria-hidden size={13} data-menu-info="" className={`shrink-0 ${active ? "text-muted" : "text-subtle"}`} />}
        {item.hint && armed !== item && <span className="text-xs text-subtle">{item.hint}</span>}
        {(item.submenu || item.flyout !== undefined) && <ChevronRight size={13} className="shrink-0 text-subtle" />}
        {item.toggle && <span aria-hidden className="w-6 shrink-0" />}
      </button>
      {item.info && (
        <>
          <span id={`${base}-${i}`} className="sr-only">{item.info}</span>
          {active && armed !== item && !item.disabled && (
            <div role="tooltip" aria-hidden data-menu-info-tip="" className="pointer-events-none absolute top-full right-1.5 z-50 mt-0.5 w-max max-w-60 rounded-inner bg-surface px-2.5 py-1.5 text-caption text-muted shadow-e2">
              {item.info}
            </div>
          )}
        </>
      )}
      {item.toggle && !item.disabled && <MenuToggleButton toggle={item.toggle} />}
      {item.submenu && active && !flyoutClosed && !item.disabled && <Submenu entries={item.submenu} armed={armed} select={select} shown={shown} />}
      {item.flyout !== undefined && active && !flyoutClosed && !item.disabled && <MenuFlyout>{item.flyout}</MenuFlyout>}
    </div>
  );
});

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

function Submenu({ entries, armed, select, shown }: { entries: NonNullable<MenuAction["submenu"]> } & Arming) {
  const [active, setActive] = useState(-1);
  const [loaded, setLoaded] = useState<{ source: typeof entries; items: (MenuAction | "separator")[] } | null>(null);
  useEffect(() => {
    if (typeof entries !== "function") return;
    let alive = true;
    void (async () => {
      try {
        const resolved = await entries();
        if (!alive) return;
        const result = normalizeEntries(resolved);
        const checked = await Promise.all(result.map(async (item) => {
          if (item === "separator" || !item.available) return item;
          try { return await item.available() ? item : null; }
          catch { return null; }
        }));
        if (alive) setLoaded({ source: entries, items: normalizeEntries(checked) });
      } catch (error) {
        if (alive) setLoaded({ source: entries, items: [{ label: error instanceof Error ? error.message : String(error), disabled: true, note: true, onSelect() {} }] });
      }
    })();
    return () => { alive = false; };
  }, [entries]);
  const items = useMemo(() => {
    if (typeof entries !== "function") return normalizeEntries(entries);
    if (loaded?.source !== entries) return [{ label: translate("sidebar.hostLoading"), disabled: true, note: true, onSelect() {} }];
    return loaded.items.length ? loaded.items : [{ label: "—", disabled: true, note: true, onSelect() {} }];
  }, [entries, loaded]);
  if (items.length === 0) return null;
  return (
    <MenuFlyout>
      <MenuItems items={items} active={active} setActive={setActive} armed={armed} select={select} shown={shown} />
    </MenuFlyout>
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
      if (isImeComposing(e)) return;
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
  const doc = useOwnerDocument();
  const done = (ok: boolean) => {
    closeDialog();
    resolve(ok);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
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
        <button autoFocus onClick={() => done(true)} className={`rounded-md px-3 py-1 text-sm text-white ${danger ? "bg-danger-solid" : "bg-accent"}`}>
          {notice ? t("dialog.ok") : (labels?.ok ?? t("dialog.confirm"))}
        </button>
      </div>
    </>
  );
}

export function Overlays() {
  const { menu, dialog, dialogDoc } = useOverlayState();
  return (
    <>
      {/* In the window each was opened from (a desk window's menu / dialog renders in its document). */}
      {menu && <OwnerLayer doc={menu.doc}><ContextMenuView key={`${menu.x},${menu.y}`} {...menu} /></OwnerLayer>}
      {/* 停止空闲的智能体 (design 031): its own state (lib/stopIdle). */}
      <StopIdleDialog />
      {dialog && (
        <OwnerLayer doc={dialogDoc}>
        <div className={`fixed inset-0 z-50 flex items-start justify-center bg-black/30 ${dialog.kind === "folder" ? "pt-[10vh]" : dialog.kind === "agentInfo" ? "pt-[5vh]" : "pt-[20vh]"}`} onMouseDown={(e) => e.target === e.currentTarget && (dialog.kind === "confirm" ? dialog.resolve(false) : dialog.resolve(null), closeDialog())}>
          {/* role: Esc anywhere else stops the running turn unless a dialog is open (lib/escInterrupt). */}
          <div role="dialog" aria-modal="true" className={`${dialog.kind === "folder" ? "w-[34rem] max-w-[calc(100vw-2rem)]" : dialog.kind === "forkProfile" ? "w-96 max-w-[calc(100vw-2rem)] max-h-[75vh] overflow-y-auto" : dialog.kind === "agentInfo" ? "w-96 max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto" : "w-96"} rounded-xl border border-border bg-surface p-4 shadow-2xl`}>
            {dialog.kind === "confirm" ? (
              <ConfirmView {...dialog} />
            ) : dialog.kind === "folder" ? (
              <FolderBrowser start={dialog.start} hostId={dialog.hostId} resolve={dialog.resolve} />
            ) : dialog.kind === "forkProfile" ? (
              <ForkProfileDialog {...dialog} />
            ) : dialog.kind === "agentInfo" ? (
              <AgentInfoDialog {...dialog} />
            ) : (
              <PromptView {...dialog} />
            )}
          </div>
        </div>
        </OwnerLayer>
      )}
    </>
  );
}
