// The gestures of Settings → 键盘快捷键 → 点击与手势 (docs/design/039, window audit 2026-10-23; owner 2026-10-24: one
// block per kind of target, one line per gesture that does something — no matrix, no 「—」 / 「同…」 cells). One table, so
// the shortcut help or ⌘K can reuse it; the words are in i18n/gestureCatalog. Checked against the handlers (2026-10-24):
// sidebar rows / tray / ⌘K (lib/workspaceEffects agentPlan; components/AgentRows, modules/home/Dock: middle click =
// Ctrl/⌘ + click), the tray's groups (modules/home/Dock entryEffect / entryClose / menu), page entries (lib/navEntries
// runNav, components/SidebarNav), launchers and files (lib/openModifiers, components/side/TitleBarLaunchers), a {{shelf}}'s
// tabs (components/side/SideCard: middle click closes, confirming unsaved work first), the column header's ‹ / ›
// (components/ConversationHeader StripButton), the sidebar 桌面 entry (lib/paneActions revealDesktop, lib/paneKeys).
import type { CommandId } from "./keybindings";
import type { MessageKey } from "../i18n";

/** What the pointer does (drawn as icons: components/GestureIcons). `mod` = Ctrl, ⌘ on macOS. */
export const GESTURE_INPUTS = ["left", "right", "middle", "drag", "longPress"] as const;
export type GestureInput = (typeof GESTURE_INPUTS)[number];

/** One gesture: modifier keys held, then a pointer input; or a rebindable command's key ({ command: "paneDesktop" }),
 *  shown as the owner's effective binding (lib/keybindings). */
export interface Gesture {
  mods?: readonly ("mod" | "shift")[];
  input?: GestureInput;
  command?: CommandId;
  /** What is clicked, when it is a small control of the target (the × that appears on hover). */
  on?: "close";
}

/** The three meanings that stay the same everywhere (the legend at the top). */
export type GestureKind = "beside" | "background" | "close";
export const GESTURE_KINDS: readonly GestureKind[] = ["beside", "background", "close"];

export interface GestureRow {
  /** Any of these does it (shown joined by 「或」). */
  gestures: readonly Gesture[];
  result: MessageKey;
  kind?: GestureKind;
}

export const GESTURE_TARGETS = ["agent", "group", "page", "launcher", "tab", "strip", "desktop"] as const;
export type GestureTarget = (typeof GESTURE_TARGETS)[number];

export interface GestureBlock {
  id: GestureTarget;
  rows: readonly GestureRow[];
}

const left: Gesture = { input: "left" };
const right: Gesture = { input: "right" };
const middle: Gesture = { input: "middle" };
const modLeft: Gesture = { mods: ["mod"], input: "left" };
const drag: Gesture = { input: "drag" };
const r = (target: GestureTarget, name: string): MessageKey => `gestures.${target}.${name}` as MessageKey;

export const GESTURES: readonly GestureBlock[] = [
  {
    id: "agent",
    rows: [
      { gestures: [left], result: r("agent", "click") },
      { gestures: [modLeft, middle], result: r("agent", "beside"), kind: "beside" },
      { gestures: [drag], result: r("agent", "drag") },
      { gestures: [right], result: r("agent", "menu") },
    ],
  },
  {
    id: "group",
    rows: [
      { gestures: [left], result: r("group", "click") },
      { gestures: [modLeft, middle], result: r("group", "beside"), kind: "beside" },
      { gestures: [right], result: r("group", "menu") },
      { gestures: [{ input: "left", on: "close" }], result: r("group", "close") },
    ],
  },
  {
    id: "page",
    rows: [
      { gestures: [left], result: r("page", "click") },
      { gestures: [modLeft, middle], result: r("page", "beside"), kind: "beside" },
      { gestures: [right], result: r("page", "menu") },
    ],
  },
  {
    id: "launcher",
    rows: [
      { gestures: [left], result: r("launcher", "click") },
      { gestures: [modLeft, middle], result: r("launcher", "background"), kind: "background" },
      { gestures: [{ mods: ["mod", "shift"], input: "left" }], result: r("launcher", "shown") },
      { gestures: [right], result: r("launcher", "menu") },
    ],
  },
  {
    id: "tab",
    rows: [
      { gestures: [left], result: r("tab", "click") },
      { gestures: [middle], result: r("tab", "close"), kind: "close" },
      { gestures: [drag], result: r("tab", "drag") },
      { gestures: [right], result: r("tab", "menu") },
    ],
  },
  {
    id: "strip",
    rows: [
      { gestures: [left], result: r("strip", "click") },
      { gestures: [{ input: "longPress" }], result: r("strip", "hold") },
      { gestures: [right], result: r("strip", "menu") },
    ],
  },
  {
    id: "desktop",
    rows: [{ gestures: [left, { command: "paneDesktop" }], result: r("desktop", "click") }],
  },
];

/** The keycaps of a pointer gesture, joined by 「+」: its modifiers, then the input (a command's key is one keycap per binding). */
export function gestureParts(g: Gesture): { kind: "mod" | "shift" | "input"; value: string }[] {
  const out: { kind: "mod" | "shift" | "input"; value: string }[] = (g.mods ?? []).map((m) => ({ kind: m, value: m }));
  if (g.input) out.push({ kind: "input", value: g.input });
  return out;
}

/** Every message key the table uses (tests: each has text in the catalogs). */
export function gestureKeys(): MessageKey[] {
  const keys = new Set<string>(["gestures.title", "gestures.hint", "gestures.or", "gestures.mod", "gestures.shift", "gestures.on.close"]);
  for (const k of GESTURE_KINDS) keys.add(`gestures.legend.${k}`).add(`gestures.legend.${k}.for`);
  for (const i of GESTURE_INPUTS) keys.add(`gestures.input.${i}`);
  for (const b of GESTURES) {
    keys.add(`gestures.${b.id}.title`).add(`gestures.${b.id}.where`);
    for (const row of b.rows) keys.add(row.result);
  }
  return [...keys] as MessageKey[];
}
