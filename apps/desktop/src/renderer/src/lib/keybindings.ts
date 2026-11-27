import { isImeComposing } from "./ime";
// Matching, showing and checking the rebindable window / pane keys. The registry and combo grammar are
// lib/keybindingCore (re-exported here); the keys in effect come from the active shortcut scheme
// (lib/keybindingSchemeStore: built-in 默认 or one of the owner's 方案). Settings → 键盘快捷键 edits it; tooltips,
// menus and hints show `bindingLabel`. Composer keys (Enter / Shift+Enter / Esc / Tab / Ctrl+Enter, the send-key
// presets) and dialog / menu navigation are not here: they stay fixed (lib/shortcuts.ts lists them).
// test/keybindings.test.ts checks that no handler still hard-codes a registry command's key.
import { isHTMLElement } from "./ownerWindow";
import { COMMANDS, commandDef, defaultBindings, formatCombo, keyPlatform, normaliseCombo, parseCombo, type CommandContext, type CommandDef, type CommandId, type Combo, type KeyPlatform } from "./keybindingCore";
import { effectiveBindings, isDefaultIn, resetSchemeBindings, resetSchemesForTests, schemesVersion, setSchemeBindings, subscribeSchemes } from "./keybindingSchemeStore";

export * from "./keybindingCore";
export { parseOverrides } from "./keybindingSchemes";

const onMac = (p: KeyPlatform = keyPlatform()) => p === "mac";
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

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

// ── The keys in effect (the active scheme) ─────────────────────────────────────────────────────────

/** The bindings in effect on `p` (this device when omitted), normalised for it. */
export function bindingsOf(id: CommandId, p?: KeyPlatform): string[] {
  return effectiveBindings(id, p);
}

/** The active scheme leaves `id` at the built-in default on this device (lib/keybindingSchemeStore isDefaultIn: another platform). */
export function isDefault(id: CommandId): boolean {
  return isDefaultIn(id);
}

/** Set `id`'s keys in the active scheme (默认 is read-only: a change made while it is active starts 「我的快捷键」). */
export function setBindings(id: CommandId, list: readonly string[], p?: KeyPlatform): void {
  const plat = p ?? keyPlatform();
  setSchemeBindings(id, list.map((x) => normaliseCombo(x, plat)).filter((x): x is string => !!x), plat);
}

export function resetBindings(id?: CommandId, p?: KeyPlatform): void {
  resetSchemeBindings(id, p);
}

export function subscribeKeybindings(listener: () => void): () => void {
  return subscribeSchemes(listener);
}

/** Changes with every edit or scheme switch (React: useSyncExternalStore snapshot). */
export function keybindingsVersion(): number {
  return schemesVersion();
}

/** Tests: back to the built-in scheme and forget storage. */
export function resetKeybindingsForTests(): void {
  resetSchemesForTests();
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
export function comboLabel(text: string, p: KeyPlatform = keyPlatform()): string {
  const c = parseCombo(text, p);
  if (!c) return text;
  if (onMac(p)) return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${keyLabel(c.key)}`;
  const meta = p === "linux" ? "Super" : "Win";
  return [c.mod && "Ctrl", c.meta && meta, c.alt && "Alt", c.shift && "Shift", keyLabel(c.key)].filter(Boolean).join("+");
}

/** A command's key as shown ("Ctrl+K"): the first one, or all joined by `sep` ("Ctrl+F · /"); "" when it has none. */
export function bindingLabel(id: CommandId, sep?: string): string {
  const all = bindingsOf(id).map((x) => comboLabel(x));
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

function comboIn(list: readonly string[], combo: string, p: KeyPlatform): boolean {
  return list.some((x) => normaliseCombo(x, p) === combo);
}

/** Two combos press the same keys (a digits family covers Digit1…9). */
function overlaps(a: string, b: string, p: KeyPlatform): boolean {
  if (a === b) return true;
  const ca = parseCombo(a, p), cb = parseCombo(b, p);
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

/** Why `combo` cannot be one of `id`'s keys on `p` (this device when omitted; empty = fine). Another command's key is listed by command. */
export function bindingConflicts(id: CommandId, combo: string, p: KeyPlatform = keyPlatform()): ConflictReason[] {
  const norm = normaliseCombo(combo, p);
  const c = norm ? parseCombo(norm, p) : null;
  if (!norm || !c) return [{ kind: "reserved" }];
  const def = commandDef(id);
  const out: ConflictReason[] = [];
  if (!!def.digits !== (c.key === "Digits")) out.push({ kind: "digits" });
  const concrete = c.key === "Digits" ? Array.from({ length: 9 }, (_, i) => norm.replace(/Digits$/, `Digit${i + 1}`)) : [norm];
  // A command's own default is allowed (macOS: ⌘⇧3 / 4 / 5 are screenshots, so the page keys 3–5 never reach the app there).
  const ownDefault = defaultBindings(id, p).some((d) => normaliseCombo(d, p) === norm);
  if (!ownDefault && (concrete.some((x) => comboIn(onMac(p) ? RESERVED_MAC : RESERVED_OTHER, x, p)) || (!onMac(p) && c.meta))) out.push({ kind: "reserved" });
  if (concrete.some((x) => comboIn(COMPOSER, x, p))) out.push({ kind: "composer" });
  // A key a focused terminal lets through would no longer reach the shell: Ctrl+letter (readline) stays its.
  if (def.terminal && !c.alt && !c.shift && (c.mod || c.ctrl) && /^Key[A-Z]$/.test(c.key)) out.push({ kind: "terminal" });
  if (isTypingCombo(c) && /^(Key[A-Z]|Digit\d|Digits|Space|Numpad\d)$/.test(c.key)) out.push({ kind: "typing" });
  for (const other of COMMANDS as readonly CommandDef[]) {
    if (other.id === id || !contextsMeet(def.context, other.context)) continue;
    if (bindingsOf(other.id, p).some((b) => overlaps(b, norm, p))) out.push({ kind: "command", id: other.id });
  }
  return out;
}

/** Every pair of commands whose keys in effect on `p` overlap (should stay empty; Settings shows them if not). */
export function currentConflicts(p: KeyPlatform = keyPlatform()): { a: CommandId; b: CommandId; combo: string }[] {
  const out: { a: CommandId; b: CommandId; combo: string }[] = [];
  const all = COMMANDS as readonly CommandDef[];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!, b = all[j]!;
      if (!contextsMeet(a.context, b.context)) continue;
      for (const x of bindingsOf(a.id, p)) if (bindingsOf(b.id, p).some((y) => overlaps(x, y, p))) out.push({ a: a.id, b: b.id, combo: x });
    }
  return out;
}
