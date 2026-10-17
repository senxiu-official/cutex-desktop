// Context menus + small modal dialogs (DESIGN §4.12). One global menu at a time; the same item
// lists back the right-click menu and the hover "⋯" buttons, so actions never diverge.
import { useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { AgentInfo, AgentInfoOptions } from "./avatar";
import { captureHostAction, onHostSwitch } from "./hostSwitch";

export interface MenuAction {
  label: string;
  /** Rendered instead of `label` in the row (a `ref.action` item's live state, lib/refActions.tsx); `label` stays the text. */
  labelNode?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned hint, e.g. a shortcut or "·" for planned. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip of the row, e.g. why it is disabled right now. */
  title?: string;
  /** Non-interactive text row (e.g. a full file path; selectable, wraps); `hint` goes below. Set `disabled` too. */
  note?: boolean;
  /** Ask before running (destructive / interrupting actions). */
  confirm?: string;
  /**
   * Confirm in place instead (click twice, lib/armedConfirm.ts): the first select keeps the menu open
   * and turns the row into this text in the danger style; a second select within ARMED_TIMEOUT_MS runs it.
   */
  armed?: string;
  /** A "›" row: hovering / clicking opens these items beside it (`onSelect` is not used). */
  submenu?: MenuEntry[];
  /**
   * A "›" row whose flyout is custom content (mounted only while open, e.g. live quota rows); its
   * clickable rows use `role="menuitem"` so → / ↑ ↓ / Enter reach them. `onSelect` is not used.
   */
  flyout?: ReactNode;
  /** A small on / off button at the row's end (e.g. pin a launcher to the title bar); clicking it keeps the menu open. */
  toggle?: MenuToggle;
  onSelect(): void | Promise<void>;
}
export interface MenuToggle {
  on: boolean;
  onIcon: ReactNode;
  offIcon: ReactNode;
  /** Tooltip / label while on (what clicking does: e.g. 取消固定) and while off. */
  onLabel: string;
  offLabel: string;
  onToggle(next: boolean): void;
}
export type MenuEntry = MenuAction | "separator" | null | false | "" | 0 | undefined;

interface MenuState {
  x: number;
  y: number;
  items: (MenuAction | "separator")[];
  /** `y` is the menu's bottom edge (opens upwards, e.g. from the sidebar footer). */
  above?: boolean;
  /** Who opened it (a trigger shows itself pressed while its menu is open). */
  owner?: string;
  minWidth?: number;
}

/**
 * An optional checkbox under a confirm / prompt dialog (e.g. 「同时归档主管」). The dialog writes the
 * box's final state back into `checked` before it resolves; `detail` is shown below the label.
 */
export interface DialogCheck {
  label: string;
  detail?: string;
  checked: boolean;
}

type Dialog =
  | { kind: "confirm"; message: string; danger: boolean; /** Only an OK button (refusal reasons). */ notice?: boolean; /** Button texts instead of 确定 / 取消 (a choice between two actions). */ labels?: ConfirmLabels; check?: DialogCheck; resolve(ok: boolean): void }
  | { kind: "prompt"; title: string; initial: string; placeholder?: string; multiline?: boolean; maxLength?: number; hint?: string; check?: DialogCheck; resolve(value: string | null): void }
  /** In-app folder browser over a host's daemon (`fs-dir-browse`; remote hosts; null host = the focus host). */
  | { kind: "folder"; start: string | null; hostId: string | null; resolve(value: string | null): void }
  /** 编辑信息: an agent's avatar + note (name / color only for the preview). */
  | { kind: "agentInfo"; name: string; color: string | null; seed: string; initial: AgentInfo; options: AgentInfoOptions; resolve(value: AgentInfo | null): void };

interface State {
  menu: MenuState | null;
  dialog: Dialog | null;
}

let state: State = { menu: null, dialog: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useOverlayState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** Drop falsy entries and leading/trailing/double separators. */
export function normalizeEntries(entries: MenuEntry[]): (MenuAction | "separator")[] {
  const out: (MenuAction | "separator")[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === "separator" && (out.length === 0 || out[out.length - 1] === "separator")) continue;
    out.push(e);
  }
  while (out[out.length - 1] === "separator") out.pop();
  return out;
}

export function openMenuAt(x: number, y: number, entries: MenuEntry[]): void {
  const items = normalizeEntries(entries);
  if (items.length) set({ menu: { x, y, items } });
}

/** `onContextMenu` handler factory. Items are built lazily so menus always reflect current state. */
export function contextMenu(build: () => MenuEntry[]) {
  return (e: ReactMouseEvent) => {
    // Selected text inside the target: leave it to the native menu (Copy / Search), see main/index.ts.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim() && sel.containsNode(e.target as Node, true)) return;
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, build());
  };
}

/** Open below a "⋯" trigger button. */
export function openMenuFrom(el: HTMLElement, entries: MenuEntry[], options: { owner?: string } = {}): void {
  const r = el.getBoundingClientRect();
  const items = normalizeEntries(entries);
  if (items.length) set({ menu: { x: r.left, y: r.bottom + 4, items, ...options } });
}

/**
 * Open above a trigger (sidebar footer): left-aligned with it, at least as wide as `minWidth`;
 * `owner` lets the trigger read whether its menu is open (`useMenuOwner`).
 */
export function openMenuAbove(el: HTMLElement, entries: MenuEntry[], options: { owner?: string; minWidth?: number } = {}): void {
  const r = el.getBoundingClientRect();
  const items = normalizeEntries(entries);
  if (items.length) set({ menu: { x: r.left, y: r.top - 4, items, above: true, ...options } });
}

/** The `owner` of the open menu (null: none open / opened without one). */
export function useMenuOwner(): string | null {
  return useSyncExternalStore(subscribe, () => state.menu?.owner ?? null);
}

export function closeMenu(): void {
  if (state.menu) set({ menu: null });
}

/**
 * Close the open menu on the window losing focus or resizing, and on the user scrolling outside it
 * (wheel / touch). Not on `scroll` events: code scrolls all the time — a streaming timeline sticking
 * to the bottom, scroll anchoring after a sidebar re-render — and a menu must survive those (it is
 * position: fixed, so nothing under it moving changes where it is). A scrollbar drag starts with a
 * mousedown, which closes it already; wheel / touch inside the menu (a long submenu) keeps it.
 */
export function watchMenuDismiss(menu: () => Element | null, close: () => void, win: Window = window): () => void {
  const outside = (e: Event) => {
    if (!menu()?.contains(e.target as Node)) close();
  };
  const opts = { capture: true, passive: true } as const;
  win.addEventListener("blur", close);
  win.addEventListener("resize", close);
  win.document.addEventListener("wheel", outside, opts);
  win.document.addEventListener("touchmove", outside, opts);
  return () => {
    win.removeEventListener("blur", close);
    win.removeEventListener("resize", close);
    win.document.removeEventListener("wheel", outside, opts);
    win.document.removeEventListener("touchmove", outside, opts);
  };
}

/** What selecting a row does now: arm it in place first (`armed` rows), else run it. */
export function selectStep(action: MenuAction, armedNow: MenuAction | null): "arm" | "run" {
  return action.armed && !action.disabled && !action.submenu && !action.flyout && armedNow !== action ? "arm" : "run";
}

export async function runAction(action: MenuAction): Promise<void> {
  const current = captureHostAction();
  if (action.submenu || action.flyout) return;
  closeMenu();
  if (action.disabled) return;
  if (action.confirm && !(await confirmDialog(action.confirm, action.danger))) return;
  if (!current()) return;
  await action.onSelect();
}

export interface ConfirmLabels {
  ok: string;
  cancel: string;
}

/** `check`: an optional checkbox; its final state is written back to `check.checked`. */
export function confirmDialog(message: string, danger = false, labels?: ConfirmLabels, check?: DialogCheck): Promise<boolean> {
  return new Promise((resolve) => set({ dialog: { kind: "confirm", message, danger, labels, check, resolve } }));
}

/** A message with a single OK button (e.g. why cutex refused a delete). */
export function noticeDialog(message: string): Promise<void> {
  return new Promise((resolve) => set({ dialog: { kind: "confirm", message, danger: false, notice: true, resolve: () => resolve() } }));
}

/** Electron has no window.prompt — this is the replacement. Resolves null on cancel. */
export function promptDialog(title: string, initial = "", options: { placeholder?: string; multiline?: boolean; maxLength?: number; hint?: string; check?: DialogCheck } = {}): Promise<string | null> {
  return new Promise((resolve) => set({ dialog: { kind: "prompt", title, initial, ...options, resolve } }));
}

/** Pick a folder on `hostId` (default: the focus host) with the in-app browser; null on cancel. */
export function folderDialog(start?: string | null, hostId?: string): Promise<string | null> {
  return new Promise((resolve) => set({ dialog: { kind: "folder", start: start?.trim() || null, hostId: hostId ?? null, resolve } }));
}

/** Edit an agent's avatar and note; null on cancel. */
export function agentInfoDialog(name: string, color: string | null, seed: string, initial: AgentInfo, options: AgentInfoOptions): Promise<AgentInfo | null> {
  return new Promise((resolve) => set({ dialog: { kind: "agentInfo", name, color, seed, initial, options, resolve } }));
}

export function closeDialog(): void {
  set({ dialog: null });
}

// A host-owned overlay must not authorize an old action using the new host's IPC binding.
onHostSwitch(() => {
  const dialog = state.dialog;
  set({ menu: null, dialog: null });
  if (dialog?.kind === "confirm") dialog.resolve(false);
  else dialog?.resolve(null);
});
