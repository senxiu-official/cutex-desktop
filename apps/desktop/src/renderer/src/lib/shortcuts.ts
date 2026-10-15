// Every keyboard shortcut the desktop handles, with its meaning — the list behind Settings → 键盘快捷键.
// Sourced from the actual handlers; keep in sync:
//   composer send keys      lib/sendKeys.ts (composerKeyAction) + Composer.tsx onKeyDown
//   Esc in the conversation lib/escInterrupt.ts + lib/useConversationEsc.ts (mounted by Composer.tsx)
//   slash palette / @       Composer.tsx onKeyDown (popup branch), pickPalette / pickMention
//   effort / model pickers  Composer.tsx EffortPicker onKey, ModelPicker.tsx onKey (1–9)
//   approvals / questions   InteractionDock.tsx
//   dialogs / menus         Overlays.tsx, Menu.tsx
//   window                  TitleBar.tsx (Ctrl+B, Ctrl+,), HostSwitcher.tsx (Ctrl+Shift+H), modules/terminal/terminals.ts (Ctrl+`: open / focus / back to the
//                           composer; a focused xterm lets the app keys through), StatusCapsule.tsx (Ctrl+., Esc),
//                           PendingChat.tsx, GoalBar.tsx,
//                           Settings.tsx SettingsNav (Ctrl+F, / → settings search)
//   right side              lib/useSideShortcuts.ts (mounted by App.tsx): Ctrl+Alt+B, Ctrl+Shift+1…9 / N / M,
//                           Shift+F11, F6, Esc (restore / close the narrow-window drawer)
import type { MessageKey } from "../i18n";
import type { SendKeyPreset } from "./sendKeys";

export interface Shortcut {
  /** Key combos as shown ("Ctrl+Enter"); several = alternatives. */
  keys: string[];
  /** i18n key of the plain-language meaning. */
  desc: MessageKey;
  /** Only under this send-key preset (default: both). */
  preset?: SendKeyPreset;
}

export interface ShortcutGroup {
  id: "send" | "queue" | "interrupt" | "palette" | "pickers" | "dock" | "dialogs" | "window";
  title: MessageKey;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "send",
    title: "shortcuts.group.send",
    items: [
      { keys: ["Enter"], desc: "shortcuts.enter.queueFirst", preset: "queueFirst" },
      { keys: ["Enter"], desc: "shortcuts.enter.cli", preset: "cli" },
      { keys: ["Shift+Enter"], desc: "shortcuts.newline" },
      { keys: ["↵"], desc: "shortcuts.sendButton" },
    ],
  },
  {
    id: "queue",
    title: "shortcuts.group.queue",
    items: [
      { keys: ["Ctrl+Enter"], desc: "shortcuts.ctrlEnter" },
      { keys: ["Tab"], desc: "shortcuts.tab.cli", preset: "cli" },
      { keys: ["Ctrl+Shift+Enter"], desc: "shortcuts.interruptSend" },
    ],
  },
  {
    id: "interrupt",
    title: "shortcuts.group.interrupt",
    items: [
      { keys: ["Esc"], desc: "shortcuts.esc.queueFirst", preset: "queueFirst" },
      { keys: ["Esc"], desc: "shortcuts.esc.cli", preset: "cli" },
      { keys: ["Esc"], desc: "shortcuts.escConversation" },
      { keys: ["■"], desc: "shortcuts.stopButton" },
    ],
  },
  {
    id: "palette",
    title: "shortcuts.group.palette",
    items: [
      { keys: ["/"], desc: "shortcuts.slash" },
      { keys: ["@"], desc: "shortcuts.mention" },
      { keys: ["↑", "↓"], desc: "shortcuts.paletteMove" },
      { keys: ["Enter"], desc: "shortcuts.paletteEnter" },
      { keys: ["Tab"], desc: "shortcuts.paletteTab" },
      { keys: ["Esc"], desc: "shortcuts.paletteEsc" },
    ],
  },
  {
    id: "pickers",
    title: "shortcuts.group.pickers",
    items: [
      { keys: ["1 … 9"], desc: "shortcuts.modelNumbers" },
      { keys: ["←", "→"], desc: "shortcuts.effortArrows" },
      { keys: ["Esc"], desc: "shortcuts.popoverEsc" },
    ],
  },
  {
    id: "dock",
    title: "shortcuts.group.dock",
    items: [
      { keys: ["↑", "↓", "Tab", "Shift+Tab"], desc: "shortcuts.dockMove" },
      { keys: ["Enter"], desc: "shortcuts.dockEnter" },
      { keys: ["1 … 9"], desc: "shortcuts.dockNumbers" },
      { keys: ["Esc"], desc: "shortcuts.dockEsc" },
    ],
  },
  {
    id: "dialogs",
    title: "shortcuts.group.dialogs",
    items: [
      { keys: ["Enter"], desc: "shortcuts.dialogEnter" },
      { keys: ["Ctrl+Enter"], desc: "shortcuts.dialogCtrlEnter" },
      { keys: ["Esc"], desc: "shortcuts.dialogEsc" },
      { keys: ["↑", "↓", "Enter"], desc: "shortcuts.menuKeys" },
      { keys: ["→", "←"], desc: "shortcuts.menuFlyout" },
      { keys: ["Space"], desc: "shortcuts.menuToggle" },
    ],
  },
  {
    id: "window",
    title: "shortcuts.group.window",
    items: [
      { keys: ["Ctrl+B"], desc: "shortcuts.sidebar" },
      { keys: ["Ctrl+,"], desc: "identity.settingsShortcut" },
      { keys: ["Ctrl+Shift+H"], desc: "shortcuts.hostSwitcher" },
      { keys: ["Ctrl+`"], desc: "shortcuts.terminal" },
      { keys: ["Ctrl+."], desc: "shortcuts.capsule" },
      { keys: ["Esc"], desc: "shortcuts.capsuleEsc" },
      { keys: ["Enter"], desc: "shortcuts.newChatEnter" },
      { keys: ["Ctrl+Enter"], desc: "shortcuts.goalSave" },
      { keys: ["Ctrl+F", "/"], desc: "shell.settingsSearch.shortcut" },
      { keys: ["Ctrl+Alt+B"], desc: "shortcuts.sideToggle" },
      { keys: ["Ctrl+Shift+1 … 9"], desc: "shortcuts.sidePage" },
      { keys: ["Ctrl+Shift+N"], desc: "shortcuts.sideNewPage" },
      { keys: ["Ctrl+Shift+M"], desc: "shortcuts.sideMaximise" },
      { keys: ["Shift+F11"], desc: "shortcuts.sideFullscreen" },
      { keys: ["Esc"], desc: "shortcuts.escSide" },
      { keys: ["Alt+←"], desc: "shortcuts.jumpBack" },
      { keys: ["F6", "Shift+F6"], desc: "shortcuts.focusCycle" },
    ],
  },
];

/** Groups with only the entries that apply under `preset`. */
export function shortcutsFor(preset: SendKeyPreset): ShortcutGroup[] {
  return SHORTCUT_GROUPS.map((g) => ({ ...g, items: g.items.filter((s) => !s.preset || s.preset === preset) }));
}

/** "Ctrl" → "⌘" on macOS. */
export function displayKey(key: string, mac: boolean): string {
  return mac ? key.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥") : key;
}
