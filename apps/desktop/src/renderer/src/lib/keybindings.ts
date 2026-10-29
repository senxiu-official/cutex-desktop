import { isImeComposing } from "./ime";
// The rebindable window / pane keys: one registry of commands (id, default per platform, context, meaning),
// the owner's overrides (this desktop only, localStorage) and the matcher every handler asks. Settings →
// 键盘快捷键 edits it; tooltips, menus and hints show `bindingLabel`. Composer keys (Enter / Shift+Enter /
// Esc / Tab / Ctrl+Enter, the send-key presets) and dialog / menu navigation are not here: they stay fixed
// (lib/shortcuts.ts lists them). test/keybindings.test.ts checks that no handler still hard-codes a
// registry command's key.
//
// A binding is a combo string: modifiers then one key, joined by "+", e.g. "Mod+Shift+KeyN".
//   Mod    the platform's command key: ⌘ on macOS, Ctrl elsewhere (exactly that one, not the other)
//   Ctrl   Ctrl as a second, explicit modifier (macOS: ⌃; elsewhere the same as Mod — normalised to Mod)
//   Meta   ⌘ elsewhere = the Windows / Super key (reserved there); normalised to Mod on macOS
//   Alt    Alt / ⌥;  Shift
// The key is a KeyboardEvent.code ("KeyB", "Digit1", "Comma", "F11", "ArrowLeft", "Slash" …), so Shift and
// most layouts do not change it; "Digits" stands for the family 1…9 (Alt+1…9 → the n-th page).
import type { MessageKey } from "../i18n";
import { isHTMLElement } from "./ownerWindow";

export type CommandContext = "global" | "window" | "pane" | "settings" | "conversation";

export interface CommandDef {
  id: CommandId;
  /** i18n key of the meaning (Settings → 键盘快捷键). */
  desc: MessageKey;
  /** Where it acts. Commands of different contexts may share a key only when the contexts never meet (settings / conversation). */
  context: CommandContext;
  /** Default bindings (alternatives); `mac` replaces them on macOS. */
  defaults: readonly string[];
  mac?: readonly string[];
  /** The binding is a modifier set + 1…9 ("Digits"). */
  digits?: true;
  /** A focused terminal lets this key through to the window (modules/terminal passThroughKey); bare keys excepted when `terminalBare` is false. */
  terminal?: { bare: boolean };
  /** Never while typing in a text field (Alt+← reads as a word jump there). Bare printable keys are always so. */
  notInText?: true;
}

export const COMMANDS = [
  { id: "quickSwitch", desc: "quick-switch.shortcut", context: "global", defaults: ["Mod+KeyK"] },
  { id: "sidebar", desc: "shortcuts.sidebar", context: "window", defaults: ["Mod+KeyB"] },
  { id: "settings", desc: "shortcuts.settingsToggle", context: "window", defaults: ["Mod+Comma"] },
  { id: "hostSwitcher", desc: "shortcuts.hostSwitcher", context: "window", defaults: ["Mod+Shift+KeyH"] },
  // ⌘` cycles a macOS app's windows, so macOS keeps ⌃` (VS Code's key).
  { id: "terminal", desc: "shortcuts.terminal", context: "window", defaults: ["Mod+Backquote"], mac: ["Ctrl+Backquote"], terminal: { bare: true } },
  { id: "capsule", desc: "shortcuts.capsule", context: "conversation", defaults: ["Mod+Period"] },
  { id: "threadSearch", desc: "shortcuts.threadSearch", context: "conversation", defaults: ["Mod+KeyF"] },
  { id: "settingsSearch", desc: "shell.settingsSearch.shortcut", context: "settings", defaults: ["Mod+KeyF", "Slash"] },
  { id: "tray", desc: "shortcuts.tray", context: "window", defaults: ["Mod+KeyJ"] },
  { id: "sideToggle", desc: "shortcuts.sideToggle", context: "window", defaults: ["Mod+Alt+KeyB"], terminal: { bare: true } },
  { id: "revealInTree", desc: "workspace.revealInTree", context: "window", defaults: ["Mod+Alt+KeyR"] },
  { id: "shelfPage", desc: "shortcuts.shelfPage", context: "window", defaults: ["Alt+Digits"], digits: true, terminal: { bare: true } },
  { id: "sidePage", desc: "shortcuts.sidePage", context: "window", defaults: ["Mod+Shift+Digits"], digits: true, terminal: { bare: true } },
  { id: "sideNewPage", desc: "shortcuts.sideNewPage", context: "window", defaults: ["Mod+Shift+KeyN"], terminal: { bare: true } },
  { id: "paneMaximise", desc: "shortcuts.paneMaximise", context: "pane", defaults: ["Mod+Shift+KeyM"], terminal: { bare: true } },
  { id: "paneDesktop", desc: "shortcuts.paneDesktop", context: "pane", defaults: ["Mod+Shift+KeyD"], terminal: { bare: true } },
  { id: "paneCloseTab", desc: "shortcuts.paneCloseTab", context: "pane", defaults: ["Mod+KeyW"] },
  { id: "paneNewTab", desc: "shortcuts.paneNewTab", context: "pane", defaults: ["Mod+KeyT"] },
  { id: "paneFocusLeft", desc: "shortcuts.paneFocusLeft", context: "pane", defaults: ["Mod+Alt+ArrowLeft"], terminal: { bare: true } },
  { id: "paneFocusRight", desc: "shortcuts.paneFocusRight", context: "pane", defaults: ["Mod+Alt+ArrowRight"], terminal: { bare: true } },
  { id: "paneFocusUp", desc: "shortcuts.paneFocusUp", context: "pane", defaults: ["Mod+Alt+ArrowUp"], terminal: { bare: true } },
  { id: "paneFocusDown", desc: "shortcuts.paneFocusDown", context: "pane", defaults: ["Mod+Alt+ArrowDown"], terminal: { bare: true } },
  // F11 alone stays a focused terminal's (TUIs use it); Ctrl+Shift+F and Shift+F11 come through.
  { id: "panelFullscreen", desc: "shortcuts.panelFullscreen", context: "pane", defaults: ["F11", "Mod+Shift+KeyF", "Shift+F11"], terminal: { bare: false } },
  { id: "jumpBack", desc: "shortcuts.jumpBack", context: "conversation", defaults: ["Alt+ArrowLeft"], notInText: true },
  { id: "focusNext", desc: "shortcuts.focusNext", context: "window", defaults: ["F6"], terminal: { bare: true } },
  { id: "focusPrev", desc: "shortcuts.focusPrev", context: "window", defaults: ["Shift+F6"], terminal: { bare: true } },
  { id: "zoomIn", desc: "shortcuts.zoomIn", context: "global", defaults: ["Mod+Equal", "Mod+Shift+Equal", "Mod+NumpadAdd"] },
  { id: "zoomOut", desc: "shortcuts.zoomOut", context: "global", defaults: ["Mod+Minus", "Mod+Shift+Minus", "Mod+NumpadSubtract"] },
  { id: "zoomReset", desc: "shortcuts.zoomReset", context: "global", defaults: ["Mod+Digit0", "Mod+Numpad0"] },
] as const satisfies readonly (Omit<CommandDef, "id"> & { id: string })[];

export type CommandId = (typeof COMMANDS)[number]["id"];
const BY_ID = new Map<CommandId, CommandDef>(COMMANDS.map((c) => [c.id, c as CommandDef]));

export function commandDef(id: CommandId): CommandDef {
  return BY_ID.get(id)!;
}

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === "string" && BY_ID.has(value as CommandId);
}

// ── Platform ─────────────────────────────────────────────────────────────────────────────────────

// The preload's platform (lib/openModifiers isMac); read here without importing the bridge (unit tests run without a window).
const isMac = () => (globalThis as { window?: { cutex?: { platform?: string } } }).window?.cutex?.platform === "darwin";
let platform: () => "mac" | "other" = () => (isMac() ? "mac" : "other");

/** Tests: pretend to be macOS / another platform (null = the real one). */
export function setKeybindingPlatform(value: "mac" | "other" | null): void {
  platform = value ? () => value : () => (isMac() ? "mac" : "other");
}

const onMac = () => platform() === "mac";

export function defaultBindings(id: CommandId): readonly string[] {
  const def = commandDef(id);
  return (onMac() && def.mac) || def.defaults;
}

// ── Combos ───────────────────────────────────────────────────────────────────────────────────────

export interface Combo {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** KeyboardEvent.code, or "Digits". */
  key: string;
}

const MOD_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

/** Parse a combo string (normalised for the platform: Ctrl off macOS and Meta on macOS are Mod). */
export function parseCombo(text: string): Combo | null {
  const parts = text.split("+");
  const key = parts.pop();
  if (!key || !/^(Key[A-Z]|Digit[0-9]|Digits|F([1-9]|1[0-9]|2[0-4])|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(Left|Right|Up|Down)|Comma|Period|Slash|Backslash|Backquote|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Space|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|PrintScreen|Pause|ContextMenu|IntlBackslash|IntlRo|IntlYen)$/.test(key)) return null;
  const c: Combo = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key };
  for (const p of parts) {
    if (p === "Mod") c.mod = true;
    else if (p === "Ctrl") c.ctrl = true;
    else if (p === "Meta") c.meta = true;
    else if (p === "Alt") c.alt = true;
    else if (p === "Shift") c.shift = true;
    else return null;
  }
  if (onMac()) {
    if (c.meta) c.mod = true;
    c.meta = false;
  } else {
    if (c.ctrl) c.mod = true;
    c.ctrl = false;
  }
  return c;
}

export function formatCombo(c: Combo): string {
  const on = { Mod: c.mod, Ctrl: c.ctrl, Meta: c.meta, Alt: c.alt, Shift: c.shift };
  return [...MOD_ORDER.filter((m) => on[m]), c.key].join("+");
}

/** The canonical spelling ("Ctrl+Shift+KeyN" → "Mod+Shift+KeyN" off macOS); null when not a combo. */
export function normaliseCombo(text: string): string | null {
  const c = parseCombo(text);
  return c ? formatCombo(c) : null;
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  target?: EventTarget | null;
}

const KEY_CODES: Record<string, string> = { ",": "Comma", ".": "Period", "/": "Slash", "\\": "Backslash", "`": "Backquote", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "-": "Minus", _: "Minus", "=": "Equal", "+": "Equal", " ": "Space" };

/** The code a key press stands for: its `code`, else what its `key` reads as (synthetic events, odd layouts). */
function codesOf(e: KeyLike): string[] {
  const out: string[] = [];
  if (e.code) out.push(e.code);
  const k = e.key;
  if (/^[a-z]$/i.test(k)) out.push(`Key${k.toUpperCase()}`);
  else if (/^[0-9]$/.test(k)) out.push(`Digit${k}`);
  else if (KEY_CODES[k]) out.push(KEY_CODES[k]);
  else if (/^(F\d+|Arrow\w+|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/.test(k)) out.push(k);
  return out;
}

/** The combo of a key press (modifier-only presses: null). Digit keys stay concrete ("Digit3"). */
export function comboOfEvent(e: KeyLike): Combo | null {
  const code = e.code || codesOf(e)[0];
  if (!code || MODIFIER_CODES.test(code) || /^(Control|Shift|Alt|Meta|OS|AltGraph)$/.test(e.key)) return null;
  const mac = onMac();
  return { mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac && e.ctrlKey, meta: !mac && e.metaKey, alt: e.altKey, shift: e.shiftKey, key: code };
}

function sameMods(c: Combo, e: KeyLike): boolean {
  const mac = onMac();
  const primary = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  const wantOther = mac ? c.ctrl : c.meta;
  return c.mod === primary && wantOther === other && c.alt === e.altKey && c.shift === e.shiftKey;
}

/** 1…9 when `e` is this digits combo, else null. */
function digitOf(c: Combo, e: KeyLike): number | null {
  if (c.key !== "Digits" || !sameMods(c, e)) return null;
  const code = e.code && /^Digit[1-9]$/.test(e.code) ? e.code : codesOf(e).find((x) => /^Digit[1-9]$/.test(x));
  return code ? Number(code.slice(5)) : null;
}

function comboMatches(c: Combo, e: KeyLike): boolean {
  if (c.key === "Digits") return digitOf(c, e) !== null;
  return sameMods(c, e) && codesOf(e).includes(c.key);
}

/** A bare printable key (no Ctrl / ⌘ / Alt): typing it into a field must still type. */
export function isTypingCombo(c: Combo): boolean {
  return !c.mod && !c.ctrl && !c.meta && !c.alt && !/^(F\d+|Escape|Tab|Enter|Arrow\w+|Insert|Delete|Home|End|PageUp|PageDown|PrintScreen|Pause|ContextMenu)$/.test(c.key);
}

// ── Overrides (this desktop) ─────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "cutex.keybindings";
type Overrides = Partial<Record<CommandId, string[]>>;
let overrides: Overrides = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): Overrides {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    return parseOverrides(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

/** Stored overrides: unknown commands and malformed combos dropped; `[]` = no key. */
export function parseOverrides(raw: unknown): Overrides {
  const src = raw && typeof raw === "object" && (raw as { v?: unknown }).v === 1 ? (raw as { bindings?: unknown }).bindings : null;
  if (!src || typeof src !== "object") return {};
  const out: Overrides = {};
  for (const [id, list] of Object.entries(src as Record<string, unknown>)) {
    if (!isCommandId(id) || !Array.isArray(list)) continue;
    const digits = !!commandDef(id).digits;
    const combos = list.filter((x): x is string => typeof x === "string").map((x) => normaliseCombo(x)).filter((x): x is string => !!x && x.endsWith("Digits") === digits);
    out[id] = [...new Set(combos)].slice(0, 4);
  }
  return out;
}

function save(next: Overrides): void {
  overrides = next;
  version++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, bindings: overrides }));
  } catch {
    // private mode / quota: the change still holds for this window
  }
  for (const l of listeners) l();
}

/** The bindings in effect (normalised for the platform). */
export function bindingsOf(id: CommandId): string[] {
  const list = overrides[id] ?? defaultBindings(id);
  return list.map((x) => normaliseCombo(x)).filter((x): x is string => !!x);
}

export function isDefault(id: CommandId): boolean {
  return !overrides[id];
}

export function setBindings(id: CommandId, list: readonly string[]): void {
  const norm = [...new Set(list.map((x) => normaliseCombo(x)).filter((x): x is string => !!x))];
  const defaults = defaultBindings(id).map((x) => normaliseCombo(x));
  const same = norm.length === defaults.length && norm.every((x, i) => x === defaults[i]);
  const next = { ...overrides };
  if (same) delete next[id];
  else next[id] = norm;
  save(next);
}

export function resetBindings(id?: CommandId): void {
  if (!id) return save({});
  const next = { ...overrides };
  delete next[id];
  save(next);
}

export function subscribeKeybindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Changes with every edit (React: useSyncExternalStore snapshot). */
export function keybindingsVersion(): number {
  return version;
}

/** Tests: drop the overrides and forget storage. */
export function resetKeybindingsForTests(): void {
  overrides = {};
  version++;
  recording = false;
}

// ── Matching ─────────────────────────────────────────────────────────────────────────────────────

let recording = false;

/** Settings is recording a new key: no command fires meanwhile. */
export function setRecordingKeys(on: boolean): void {
  recording = on;
}

export function isRecordingKeys(): boolean {
  return recording;
}

function inText(e: KeyLike): boolean {
  const t = e.target;
  if (typeof HTMLElement === "undefined" || !isHTMLElement(t)) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes((t as HTMLInputElement).type);
}

function allowedHere(id: CommandId, c: Combo, e: KeyLike): boolean {
  if ((commandDef(id).notInText || isTypingCombo(c)) && inText(e)) return false;
  return true;
}

/** Whether `e` is one of `id`'s keys. */
export function matchesCommand(id: CommandId, e: KeyLike): boolean {
  if (recording || isImeComposing(e)) return false;
  for (const text of bindingsOf(id)) {
    const c = parseCombo(text);
    if (c && comboMatches(c, e) && allowedHere(id, c, e)) return true;
  }
  return false;
}

/** Fixed native editing commands, shared with the composer-conflict registry below. These retain
 * their native bindings in editors; outside editors the app may constrain their content scope.
 * They are not rebindable window commands (like the other fixed composer editing keys). */
const EDITING_COMMANDS = { selectAll: ["Mod+KeyA"] } as const;
export function matchesEditingCommand(id: keyof typeof EDITING_COMMANDS, e: KeyLike): boolean {
  if (recording || isImeComposing(e)) return false;
  return EDITING_COMMANDS[id].some(text => {
    const combo = parseCombo(text);
    return !!combo && comboMatches(combo, e);
  });
}

/** For a digits command: 1…9 when `e` is its key, else null. */
export function matchDigit(id: CommandId, e: KeyLike): number | null {
  if (recording || isImeComposing(e)) return null;
  for (const text of bindingsOf(id)) {
    const c = parseCombo(text);
    const n = c ? digitOf(c, e) : null;
    if (n !== null && allowedHere(id, c!, e)) return n;
  }
  return null;
}

/** The first command (of `ids`, in order) `e` is a key of. */
export function commandOf<T extends CommandId>(e: KeyLike, ids: readonly T[]): T | null {
  return ids.find((id) => matchesCommand(id, e)) ?? null;
}

/** A focused terminal lets `e` through to the window: a key of a command marked `terminal`. */
export function terminalPassesKey(e: KeyLike): boolean {
  if (recording) return false;
  for (const def of COMMANDS as readonly CommandDef[]) {
    if (!def.terminal) continue;
    for (const text of bindingsOf(def.id)) {
      const c = parseCombo(text);
      if (!c || !comboMatches(c, e)) continue;
      if (!def.terminal.bare && !c.mod && !c.ctrl && !c.meta && !c.alt && !c.shift) continue;
      return true;
    }
  }
  return false;
}

// ── Display ──────────────────────────────────────────────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Space: "Space", NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .", NumpadEnter: "Num Enter", Digits: "1 … 9", PageUp: "PgUp", PageDown: "PgDn", Delete: "Del", Insert: "Ins" };

function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Digit\d$/.test(key)) return key.slice(5);
  if (/^Numpad\d$/.test(key)) return `Num ${key.slice(6)}`;
  return key;
}

/** One combo as shown: "Ctrl+Shift+N" / "⇧⌘N" (macOS order ⌃⌥⇧⌘). */
export function comboLabel(text: string): string {
  const c = parseCombo(text);
  if (!c) return text;
  if (onMac()) return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${keyLabel(c.key)}`;
  const meta = typeof navigator !== "undefined" && /Linux/.test(navigator.platform ?? "") ? "Super" : "Win";
  return [c.mod && "Ctrl", c.meta && meta, c.alt && "Alt", c.shift && "Shift", keyLabel(c.key)].filter(Boolean).join("+");
}

/** A command's key as shown ("Ctrl+K"): the first one, or all joined by `sep` ("Ctrl+F · /"); "" when it has none. */
export function bindingLabel(id: CommandId, sep?: string): string {
  const all = bindingsOf(id).map(comboLabel);
  return sep === undefined ? (all[0] ?? "") : all.join(sep);
}

/** A digits command's key for one digit ("Alt+3"); "" when it has none. */
export function digitBindingLabel(id: CommandId, n: number): string {
  const first = bindingsOf(id)[0];
  return first ? comboLabel(first.replace(/Digits$/, `Digit${n}`)) : "";
}

/** A module whose description names its key ({key}): the command it means (Settings → 模块). */
export const MODULE_COMMANDS: Readonly<Record<string, CommandId>> = { "quick-switch": "quickSwitch" };

/** The {key} of a text about a command: its keys, or "—" when it has none. */
export function keyVar(id: CommandId, sep?: string): { key: string } {
  return { key: bindingLabel(id, sep) || "—" };
}

// ── Conflicts ────────────────────────────────────────────────────────────────────────────────────

export type ConflictReason = { kind: "command"; id: CommandId } | { kind: "reserved" } | { kind: "composer" } | { kind: "terminal" } | { kind: "typing" } | { kind: "digits" };

// Keys the system keeps (they never reach the window, or quitting / hiding the app would be one press away).
const RESERVED_OTHER = ["Alt+F4", "Alt+Tab", "Alt+Shift+Tab", "Mod+Alt+Delete", "Mod+Escape", "Mod+Shift+Escape", "Alt+Space", "Alt+Escape", "PrintScreen", "F10", "Shift+F10", "ContextMenu"];
const RESERVED_MAC = ["Mod+KeyQ", "Mod+KeyH", "Mod+Alt+KeyH", "Mod+KeyM", "Mod+Tab", "Mod+Shift+Tab", "Mod+Space", "Ctrl+Space", "Mod+Backquote", "Mod+Shift+Backquote", "Mod+Alt+Escape", "Mod+Shift+Digit3", "Mod+Shift+Digit4", "Mod+Shift+Digit5", "Mod+Alt+KeyD", "Ctrl+ArrowLeft", "Ctrl+ArrowRight", "Ctrl+ArrowUp", "Ctrl+ArrowDown", "Mod+Ctrl+KeyF", "Mod+Ctrl+KeyQ"];
// Keys the composer and every text field need (send / newline / steer / interrupt, editing, the palette).
const COMPOSER = ["Enter", "Shift+Enter", "Mod+Enter", "Mod+Shift+Enter", "Alt+Enter", "Tab", "Shift+Tab", "Escape", "Backspace", "Delete", "Mod+Backspace", "Alt+Backspace", "Mod+Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight", "Shift+ArrowUp", "Shift+ArrowDown", "Mod+ArrowLeft", "Mod+ArrowRight", "Mod+ArrowUp", "Mod+ArrowDown", "Mod+Shift+ArrowLeft", "Mod+Shift+ArrowRight", "Home", "End", "Shift+Home", "Shift+End", "Mod+Home", "Mod+End", "PageUp", "PageDown", ...EDITING_COMMANDS.selectAll, "Mod+KeyC", "Mod+KeyV", "Mod+KeyX", "Mod+KeyZ", "Mod+KeyY", "Mod+Shift+KeyZ", "Mod+Shift+KeyV", "Mod+Insert", "Shift+Insert", "Shift+Delete"];

function comboIn(list: readonly string[], combo: string): boolean {
  return list.some((x) => normaliseCombo(x) === combo);
}

/** Two combos press the same keys (a digits family covers Digit1…9). */
function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = parseCombo(a), cb = parseCombo(b);
  if (!ca || !cb) return false;
  const mods = (c: Combo) => `${c.mod}${c.ctrl}${c.meta}${c.alt}${c.shift}`;
  if (mods(ca) !== mods(cb)) return false;
  const digit = (k: string) => /^Digit[1-9]$/.test(k);
  return (ca.key === "Digits" && digit(cb.key)) || (cb.key === "Digits" && digit(ca.key));
}

const APART: readonly (readonly [CommandContext, CommandContext])[] = [["settings", "conversation"]];
function contextsMeet(a: CommandContext, b: CommandContext): boolean {
  return !APART.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** Why `combo` cannot be one of `id`'s keys (empty = fine). Another command's key is listed by command. */
export function bindingConflicts(id: CommandId, combo: string): ConflictReason[] {
  const norm = normaliseCombo(combo);
  const c = norm ? parseCombo(norm) : null;
  if (!norm || !c) return [{ kind: "reserved" }];
  const def = commandDef(id);
  const out: ConflictReason[] = [];
  if (!!def.digits !== (c.key === "Digits")) out.push({ kind: "digits" });
  const concrete = c.key === "Digits" ? Array.from({ length: 9 }, (_, i) => norm.replace(/Digits$/, `Digit${i + 1}`)) : [norm];
  // A command's own default is allowed (macOS: ⌘⇧3 / 4 / 5 are screenshots, so the page keys 3–5 never reach the app there).
  const ownDefault = defaultBindings(id).some((d) => normaliseCombo(d) === norm);
  if (!ownDefault && (concrete.some((x) => comboIn(onMac() ? RESERVED_MAC : RESERVED_OTHER, x)) || (!onMac() && c.meta))) out.push({ kind: "reserved" });
  if (concrete.some((x) => comboIn(COMPOSER, x))) out.push({ kind: "composer" });
  // A key a focused terminal lets through would no longer reach the shell: Ctrl+letter (readline) stays its.
  if (def.terminal && !c.alt && !c.shift && (c.mod || c.ctrl) && /^Key[A-Z]$/.test(c.key)) out.push({ kind: "terminal" });
  if (isTypingCombo(c) && /^(Key[A-Z]|Digit\d|Digits|Space|Numpad\d)$/.test(c.key)) out.push({ kind: "typing" });
  for (const other of COMMANDS as readonly CommandDef[]) {
    if (other.id === id || !contextsMeet(def.context, other.context)) continue;
    if (bindingsOf(other.id).some((b) => overlaps(b, norm))) out.push({ kind: "command", id: other.id });
  }
  return out;
}

/** Every pair of commands whose keys in effect overlap (should stay empty; Settings shows them if not). */
export function currentConflicts(): { a: CommandId; b: CommandId; combo: string }[] {
  const out: { a: CommandId; b: CommandId; combo: string }[] = [];
  const all = COMMANDS as readonly CommandDef[];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!, b = all[j]!;
      if (!contextsMeet(a.context, b.context)) continue;
      for (const x of bindingsOf(a.id)) if (bindingsOf(b.id).some((y) => overlaps(x, y))) out.push({ a: a.id, b: b.id, combo: x });
    }
  return out;
}
