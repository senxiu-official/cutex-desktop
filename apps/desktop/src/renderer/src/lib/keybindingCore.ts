// The rebindable window / pane keys: one registry of commands (id, default per platform, context, meaning) and
// the combo grammar. lib/keybindingSchemes keeps the owner's schemes (方案) over these defaults; lib/keybindings
// matches, shows and checks them (and re-exports this file, so callers import lib/keybindings only).
//
// A binding is a combo string: modifiers then one key, joined by "+", e.g. "Mod+Shift+KeyN".
//   Mod    the platform's command key: ⌘ on macOS, Ctrl elsewhere (exactly that one, not the other)
//   Ctrl   Ctrl as a second, explicit modifier (macOS: ⌃; elsewhere the same as Mod — normalised to Mod)
//   Meta   ⌘ elsewhere = the Windows / Super key (reserved there); normalised to Mod on macOS
//   Alt    Alt / ⌥;  Shift
// "Mod" keeps a stored binding platform-neutral: a scheme written on Windows means ⌘ on a Mac.
// The key is a KeyboardEvent.code ("KeyB", "Digit1", "Comma", "F11", "ArrowLeft", "Slash" …), so Shift and
// most layouts do not change it; "Digits" stands for the family 1…9 (Alt+1…9 → the n-th page).
import type { MessageKey } from "../i18n";

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
  // 输入优化 (module input-refinement; 提示词增强 owner 2026-11-24): the focused input box asks the module's
  // composer.action (§31) only. Ctrl+Shift+E (the id stays, so rebinding survives): free in the composer, the window
  // and the system; Ctrl+Alt would be AltGr (it types characters) on many layouts, so the template picker has no
  // default key (the ▾ beside the wand button opens it; bind one in 设置 → 快捷键).
  { id: "promptEnhance", desc: "shortcuts.promptEnhance", context: "conversation", defaults: ["Mod+Shift+KeyE"] },
  { id: "inputRefinementPick", desc: "shortcuts.inputRefinementPick", context: "conversation", defaults: [] },
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

/** Where a binding is pressed. Windows and Linux share the defaults; Linux shows the Meta key as Super. */
export type KeyPlatform = "windows" | "linux" | "mac";
export const KEY_PLATFORMS: readonly KeyPlatform[] = ["windows", "mac", "linux"];

// The preload's platform (lib/openModifiers isMac); read here without importing the bridge (unit tests run without a window).
function devicePlatform(): KeyPlatform {
  const p = (globalThis as { window?: { cutex?: { platform?: string } } }).window?.cutex?.platform;
  return p === "darwin" ? "mac" : p === "linux" ? "linux" : "windows";
}
let platform: () => KeyPlatform = devicePlatform;

/** Tests: pretend to be macOS / another platform ("other" = Windows; null = the real one). */
export function setKeybindingPlatform(value: KeyPlatform | "other" | null): void {
  const fixed: KeyPlatform | null = value === "other" ? "windows" : value;
  platform = fixed ? () => fixed : devicePlatform;
}

/** This device's platform. */
export function keyPlatform(): KeyPlatform {
  return platform();
}

export const isMacPlatform = (p: KeyPlatform = platform()): boolean => p === "mac";

/** The built-in default of `id` on `p` (this device when omitted). */
export function defaultBindings(id: CommandId, p: KeyPlatform = platform()): readonly string[] {
  const def = commandDef(id);
  return (p === "mac" && def.mac) || def.defaults;
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

/** Parse a combo string (normalised for the platform: Ctrl off macOS and Meta on macOS are Mod). */
export function parseCombo(text: string, p: KeyPlatform = platform()): Combo | null {
  const parts = text.split("+");
  const key = parts.pop();
  if (!key || !/^(Key[A-Z]|Digit[0-9]|Digits|F([1-9]|1[0-9]|2[0-4])|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(Left|Right|Up|Down)|Comma|Period|Slash|Backslash|Backquote|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Space|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|PrintScreen|Pause|ContextMenu|IntlBackslash|IntlRo|IntlYen)$/.test(key)) return null;
  const c: Combo = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key };
  for (const part of parts) {
    if (part === "Mod") c.mod = true;
    else if (part === "Ctrl") c.ctrl = true;
    else if (part === "Meta") c.meta = true;
    else if (part === "Alt") c.alt = true;
    else if (part === "Shift") c.shift = true;
    else return null;
  }
  if (p === "mac") {
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
export function normaliseCombo(text: string, p: KeyPlatform = platform()): string | null {
  const c = parseCombo(text, p);
  return c ? formatCombo(c) : null;
}
