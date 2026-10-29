// React side of lib/keybindings: re-render when the owner rebinds a key, and the shown key of a command.
import { useSyncExternalStore } from "react";
import { bindingLabel, digitBindingLabel, keybindingsVersion, subscribeKeybindings, type CommandId } from "./keybindings";

export function useKeybindingsVersion(): number {
  return useSyncExternalStore(subscribeKeybindings, keybindingsVersion, keybindingsVersion);
}

/** A command's keys as shown ("Ctrl+K"; "" when it has none), updated when rebound. */
export function useBindingLabel(id: CommandId, sep?: string): string {
  useKeybindingsVersion();
  return bindingLabel(id, sep);
}

/** A digits command's key for one digit ("Alt+3"). */
export function useDigitBindingLabel(id: CommandId, n: number): string {
  useKeybindingsVersion();
  return digitBindingLabel(id, n);
}

/** "Title (Ctrl+B)", or the bare title when the command has no key. */
export function withKey(title: string, key: string): string {
  return key ? `${title} (${key})` : title;
}
