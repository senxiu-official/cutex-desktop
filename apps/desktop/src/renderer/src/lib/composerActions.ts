// The `composer.action` host of one input box (docs/desktop-modules.md §31): the shown items, the access object they
// get (read / replace / focus / setOpen / onKey), and the two key passes Composer asks — an item's own command (before
// the @ / palette popups), then any open item (after them). The outlet that mounts the items is modules/ComposerActions.tsx.
import { useCallback, useMemo, useRef, useState } from "react";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, ComposerAccess, ComposerDraft, ComposerKey, ComposerKeyResult } from "../modules/slots";
import { lacks } from "./agentFeatures";
import { useAgentFeatures } from "./agentFeaturesView";
import { useHostEntryGate } from "./hostGatingView";
import { isImeComposing } from "./ime";
import { isCommandId, matchesCommand, type KeyLike } from "./keybindings";

export type ComposerActionEntry = AppSlotEntry<"composer.action">;

/** What the input box gives its actions. */
export interface ComposerBox {
  read(): ComposerDraft;
  replace(start: number, end: number, text: string, expected: string): boolean;
  focus(): void;
}

interface Registered {
  handler: ((key: ComposerKey) => ComposerKeyResult) | null;
  open: boolean;
}

export interface ComposerActionsHost {
  entries: readonly ComposerActionEntry[];
  /** The access object of one item (stable per item id). */
  accessFor(itemId: string): ComposerAccess;
  /** Some action is open: send / steer / Esc-interrupt keys are held. */
  open: boolean;
  /** Pass 1 (before the box's popups): a key bound to an item's command. True = taken (default prevented). */
  commandKey(e: KeyLike & { preventDefault(): void }): boolean;
  /** Pass 2 (after the popups): every key while an item is open. True = taken (default prevented). */
  openKey(e: KeyLike & { preventDefault(): void }): boolean;
}

const keyOf = (e: KeyLike, command: string | null): ComposerKey =>
  ({ key: e.key, ctrl: !!e.ctrlKey, meta: !!e.metaKey, alt: !!e.altKey, shift: !!e.shiftKey, command });

/** The items shown in this conversation: `mode === "show"`, not lacking the agent's features, offered by its host. */
export function useComposerActionEntries(sessionId: string, hostId: string): ComposerActionEntry[] {
  const entries = useSlot("composer.action");
  const agent = useAgentFeatures(sessionId);
  const onHost = useHostEntryGate(hostId);
  return useMemo(() => entries.filter((e) => e.mode === "show" && !(agent && e.item.agentFeature && lacks(agent, e.item.agentFeature)) && onHost(e)), [entries, agent, onHost]);
}

export function useComposerActions(sessionId: string, hostId: string, box: ComposerBox): ComposerActionsHost {
  const entries = useComposerActionEntries(sessionId, hostId);
  const boxRef = useRef(box);
  boxRef.current = box;
  const registry = useRef(new Map<string, Registered>());
  const [openIds, setOpenIds] = useState<readonly string[]>([]);
  const accesses = useRef(new Map<string, ComposerAccess>());

  const accessFor = useCallback((itemId: string): ComposerAccess => {
    let access = accesses.current.get(itemId);
    if (access) return access;
    const reg = (): Registered => {
      let r = registry.current.get(itemId);
      if (!r) registry.current.set(itemId, (r = { handler: null, open: false }));
      return r;
    };
    access = {
      read: () => boxRef.current.read(),
      replace: (start, end, text, expected) => boxRef.current.replace(start, end, text, expected),
      focus: () => boxRef.current.focus(),
      setOpen: (open) => {
        if (reg().open === open) return;
        reg().open = open;
        setOpenIds((ids) => (open ? [...ids.filter((x) => x !== itemId), itemId] : ids.filter((x) => x !== itemId)));
      },
      onKey: (handler) => { reg().handler = handler; },
    };
    accesses.current.set(itemId, access);
    return access;
  }, []);

  // Items no longer shown (module off, host lost the capability): not open any more.
  const shown = new Set<string>(entries.map((e) => e.item.id));
  const openLive = openIds.filter((id) => shown.has(id));

  const commandKey = (e: KeyLike & { preventDefault(): void }): boolean => {
    if (isImeComposing(e)) return false;
    for (const entry of entries) {
      const handler = registry.current.get(entry.item.id)?.handler;
      if (!handler) continue;
      for (const command of entry.item.commands ?? []) {
        if (!isCommandId(command) || !matchesCommand(command, e)) continue;
        if (handler(keyOf(e, command))) { e.preventDefault(); return true; }
      }
    }
    return false;
  };

  const openKey = (e: KeyLike & { preventDefault(): void }): boolean => {
    if (isImeComposing(e)) return false;
    // The most recently opened item first.
    for (const id of [...openLive].reverse()) {
      const handler = registry.current.get(id)?.handler;
      if (handler && handler(keyOf(e, null))) { e.preventDefault(); return true; }
    }
    return false;
  };

  return { entries, accessFor, open: openLive.length > 0, commandKey, openKey };
}
