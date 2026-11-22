// Unsaved drafts in Settings (Director 2026-11-18, cross-review of the window-bar fix): a Settings page whose edits
// are not saved yet reports them here while it has them (useSettingsDraft). Closing a covering Settings for a
// window-bar entry (lib/openSettings leaveCoveringSettings) unmounts its pages and would drop such a draft
// silently, so with one present it asks first, in place next to the clicked button: 「设置里有未保存的修改」
// [保存并前往] [放弃并前往] [取消]. Per renderer (each app window has its own Settings), in memory only.
//
// What counts (Director 2026-11-18, final review: never guessed from a button press or Enter). A Settings card is
// unsaved from the first change of any control in it until it reports a successful save, or is discarded / closed:
// - A page that saves from here reports { dirty, save, discard } (useSettingsDraft) and marks its element
//   [data-settings-draft]; its controls are its own business.
// - A form with its own save (添加 / 保存 / 创建) is a card (useSettingsCard): any change in it counts until it calls
//   `saved()` after a successful save (`discarded()` for a 取消 that keeps it open). A refused save keeps it unsaved.
// - Elsewhere in the Settings Shelf's page (watchSettingsEdits): a field typed in, a native select / box changed,
//   counts until it is back to its value before the change, or gone (its form closed).
// - Controls that save by themselves (TextField, NumberField, Form's switches / choices outside a card or page draft)
//   report their own result (settingsControlChanged): unsaved until that save succeeded, kept when it failed.
// The nearest one wins: a card inside a page draft (the Profile's 运行时变体 rows) is the card's. Filters never count.
// 保存并前往 is offered only when every unsaved edit belongs to a page draft (cards save on their page); a change of
// any control while it saves keeps Settings open.
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { translate } from "../i18n";
import { activeAppDocument } from "./appWindowSet";
import { openMenuAt, openMenuFrom, type MenuEntry } from "./contextMenu";
import { isDom, ownerWindowOf } from "./ownerWindow";

export interface SettingsDraft {
  /** It has edits not saved yet. */
  dirty: boolean;
  /** Saves it the page's own way (its errors show on the page); `true` when it is saved. */
  save(): Promise<boolean>;
  /** Drops it (the page's 撤销). */
  discard(): void;
}

const NO_DRAFT: SettingsDraft = { dirty: false, save: async () => true, discard() {} };
const drafts = new Set<{ current: SettingsDraft }>();

/**
 * A Settings page reports its draft while mounted: pass it each render, or (a page that returns early while loading)
 * call this first with nothing and set `.current` once its draft is known; each render starts from "no draft".
 */
export function useSettingsDraft(draft?: SettingsDraft): MutableRefObject<SettingsDraft> {
  const ref = useRef<SettingsDraft>(NO_DRAFT);
  ref.current = draft ?? NO_DRAFT;
  useEffect(() => {
    drafts.add(ref);
    return () => {
      drafts.delete(ref);
    };
  }, []);
  return ref;
}

const dirtyOnes = () => [...drafts].filter((d) => d.current.dirty);

type Control = Element;
/** A change of a Settings control by the owner (Form's switches and choices, custom pickers): bubbles. `autosave`: the
 *  control saved it itself (it reports its own result), not a draft of its card. */
export const SETTINGS_CHANGE = "cutex-settings-change";
const PAGE_DRAFT = "[data-settings-draft]";
const SCOPES = "[data-settings-draft], [data-settings-card]";
const FILTERS = '[data-settings-filter], [data-settings-list-filter], [role="search"]';
/**
 * Unsaved changes, by control (or card). `base`: the saved value to compare with (null: none, a picker / a card);
 * `rev`: the revision of its latest change (final review 2026-11-18: a save result applies only up to the revision it
 * carried, so an older save never settles a newer edit); `pending`: its own saves still running.
 */
interface Unsaved {
  base: string | null;
  rev: number;
  pending: number;
}
const unsaved = new Map<Control, Unsaved>();
let revision = 0;
/** A change of `el`: a new revision of its entry (created with `base` when it has none). */
const touch = (el: Control, base: () => string | null): Unsaved => {
  const entry = unsaved.get(el) ?? { base: base(), rev: 0, pending: 0 };
  entry.rev = ++revision;
  unsaved.set(el, entry);
  return entry;
};
/** Settled: its next change starts from the value it shows then (React keeps a field's default value at its value). */
const forget = (el: Control) => {
  unsaved.delete(el);
  focusValue.delete(el);
};
const isUnsaved = (el: Control, e: Unsaved) => e.pending > 0 || e.base === null || valueOf(el) !== e.base;
const focusValue = new WeakMap<Control, string>();
const roots = new Set<HTMLElement>();
const watched = (el: Element) => [...roots].some((r) => r.contains(el));

type NativeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isNative = (el: EventTarget | null): el is NativeControl =>
  isDom(el, "HTMLInputElement") || isDom(el, "HTMLTextAreaElement") || isDom(el, "HTMLSelectElement");
const isBox = (el: Element) => isDom(el, "HTMLInputElement") && (el.type === "checkbox" || el.type === "radio");
const valueOf = (el: Control): string | null => (isNative(el) ? (isBox(el) ? String((el as HTMLInputElement).checked) : el.value) : null);
/** A native control's value before this change: when it got focus, else its rendered (default) value. */
const before = (el: NativeControl): string | null => {
  if (isBox(el)) return String(!(el as HTMLInputElement).checked);
  return focusValue.get(el) ?? (isDom(el, "HTMLSelectElement") ? null : el.defaultValue);
};
/** Where a change belongs: a page draft (its own business), a card, or (null) the control itself. */
const scopeOf = (el: Element): Element | null => el.closest(SCOPES);

/** Nothing unsaved in `scope` up to revision `upTo` (its save carried that); a card inside it has its own. */
function settleWithin(scope: Element, upTo: number): void {
  for (const [el, e] of [...unsaved]) if (scopeOf(el) === scope && e.rev <= upTo) forget(el);
}

/** The Settings Shelf's page (components/SettingsShelf): it notes changes of its controls; returns the cleanup. */
export function watchSettingsEdits(root: HTMLElement): () => void {
  roots.add(root);
  const onFocus = (e: Event) => {
    const el = e.target;
    if (isNative(el) && !unsaved.has(el)) focusValue.set(el, el.value);
  };
  const onChange = (e: Event) => {
    const el = e.target as Element | null;
    if (!el || typeof el.closest !== "function" || el.closest(FILTERS)) return;
    const scope = scopeOf(el);
    if (scope?.matches(PAGE_DRAFT)) return;
    if (e.type === SETTINGS_CHANGE) {
      // A Form control / picker in a card: the card is unsaved (one that saved itself reports its own result).
      if (scope && !(e as CustomEvent<{ autosave?: boolean }>).detail?.autosave) touch(scope, () => null);
      return;
    }
    // Form's controls report their changes themselves (settingsControlChanged), whatever their native events.
    if (!isNative(el) || el.closest("[data-settings-control]") || (el as HTMLInputElement).readOnly) return;
    touch(el, () => before(el));
  };
  root.addEventListener("focusin", onFocus);
  root.addEventListener("input", onChange);
  root.addEventListener("change", onChange);
  root.addEventListener(SETTINGS_CHANGE, onChange);
  return () => {
    roots.delete(root);
    root.removeEventListener("focusin", onFocus);
    root.removeEventListener("input", onChange);
    root.removeEventListener("change", onChange);
    root.removeEventListener(SETTINGS_CHANGE, onChange);
  };
}

const emitChange = (el: Element, autosave: boolean) => {
  const { CustomEvent } = ownerWindowOf(el) as Window & typeof globalThis;
  el.dispatchEvent(new CustomEvent(SETTINGS_CHANGE, { bubbles: true, detail: { autosave } }));
};
const thenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";

/**
 * A Settings control changed by the owner (Form's switches and choices; custom pickers), with what its handler returned.
 * In a card or page draft it is part of that draft. Elsewhere it saved itself: with a promise, unsaved while that runs.
 * Its success settles the control only when nothing changed since (else the submitted value becomes the saved one to
 * compare with); a rejected / `false` save leaves it unsaved, never touching a newer change.
 */
export function settingsControlChanged(el: Element | null | undefined, result?: unknown): void {
  if (!el) return;
  const inDraft = !!scopeOf(el);
  if (inDraft || !watched(el)) unsaved.delete(el);
  else if (!thenable(result)) {
    if (!unsaved.get(el)?.pending) unsaved.delete(el);
  } else {
    const entry = touch(el, () => null);
    const carried = entry.rev;
    const submitted = valueOf(el);
    entry.pending += 1;
    const done = (ok: boolean) => {
      entry.pending -= 1;
      if (unsaved.get(el) !== entry || !ok) return;
      if (entry.rev === carried) forget(el);
      else if (submitted !== null) entry.base = submitted;
    };
    result.then((ok) => done(ok !== false), () => done(false));
  }
  emitChange(el, !inDraft);
}

export interface SettingsCard {
  /** On the card's element (marks it [data-settings-card]); a card may span several elements. */
  ref(el: HTMLElement | null): void;
  /** On an element inside a Settings card (Section): that whole card is this card. */
  inSection(el: HTMLElement | null): void;
  /** A change the DOM does not show (a picker of the form's own): the card is unsaved. */
  changed(): void;
  /** The revision a save starting now carries: pass it to `saved` (changes made while it runs stay unsaved). */
  revision(): number;
  /** Its save succeeded: nothing unsaved in it up to `upTo` (default: every change). Only after a successful save. */
  saved(upTo?: number): void;
  /** Its 取消 / 撤销 put it back while it stays open (a closed form is forgotten anyway). */
  discarded(): void;
}

/**
 * A Settings form that saves with its own button (添加 / 保存 / 创建): its changes count until `saved()`. A form that
 * knows whether it differs from what is saved passes `dirty`: not dirty, nothing in it counts (saved, or put back).
 */
export function useSettingsCard(dirty?: boolean): SettingsCard {
  const els = useRef(new Set<HTMLElement>());
  const card = useMemo<SettingsCard>(() => {
    const live = () => [...els.current].filter((e) => {
      if (!e.isConnected) els.current.delete(e);
      return e.isConnected;
    });
    const add = (node: HTMLElement | null | undefined) => {
      if (!node) return;
      node.setAttribute("data-settings-card", "");
      els.current.add(node);
    };
    const settle = (upTo: number) => {
      for (const e of live()) settleWithin(e, upTo);
    };
    return {
      ref: add,
      inSection: (node) => add(node?.closest("section")),
      changed() {
        const [first] = live();
        if (first) emitChange(first, false);
      },
      revision: () => revision,
      saved: (upTo = Infinity) => settle(upTo),
      discarded: () => settle(Infinity),
    };
  }, []);
  useEffect(() => {
    if (dirty === false) card.discarded();
  }, [dirty, card]);
  return card;
}

/** Unsaved changes outside the page drafts (only their page saves them; leaving drops them). */
export function unsavedSettingsEdits(): Control[] {
  const out: Control[] = [];
  for (const [el, e] of unsaved) {
    if (!el.isConnected) unsaved.delete(el);
    else if (isUnsaved(el, e)) out.push(el);
  }
  return out;
}

export const hasSettingsDrafts = (): boolean => dirtyOnes().length > 0 || unsavedSettingsEdits().length > 0;

/** Saves every draft, one after another; stops at the first that is not saved (Settings stays to show why). */
export async function saveSettingsDrafts(): Promise<boolean> {
  for (const d of dirtyOnes()) {
    let ok = false;
    try {
      ok = await d.current.save();
    } catch {
      ok = false;
    }
    if (!ok) return false;
  }
  return true;
}

export function discardSettingsDrafts(): void {
  for (const d of dirtyOnes()) d.current.discard();
  unsaved.clear();
}

export const SETTINGS_DRAFTS_MENU = "settings-drafts";

/**
 * The in-place confirm before leaving Settings with a draft: next to `anchor` (the clicked button; else the window
 * bar's entry group). 保存并前往 runs `leave` only when every draft saved; 取消 / Esc / a click elsewhere keeps all.
 */
export function confirmLeaveWithDrafts(anchor: HTMLElement | null | undefined, leave: () => void): void {
  const onPageOnly = unsavedSettingsEdits().length > 0;
  const entries: MenuEntry[] = [
    { label: translate("settings.drafts.title"), disabled: true, note: true, onSelect() {} },
    {
      label: translate("settings.drafts.saveGo"),
      disabled: onPageOnly,
      title: onPageOnly ? translate("settings.drafts.saveOnPage") : undefined,
      onSelect: async () => {
        // A change of any control while it saves (review 2026-11-18): newer than what was saved, so Settings stays.
        const doc = activeAppDocument();
        let changedMeanwhile = false;
        const note = () => void (changedMeanwhile = true);
        const kinds = ["input", "change", SETTINGS_CHANGE];
        for (const k of kinds) doc.addEventListener(k, note, true);
        try {
          if ((await saveSettingsDrafts()) && !changedMeanwhile) leave();
        } finally {
          for (const k of kinds) doc.removeEventListener(k, note, true);
        }
      },
    },
    { label: translate("settings.drafts.discardGo"), danger: true, onSelect: () => { discardSettingsDrafts(); leave(); } },
    { label: translate("settings.drafts.cancel"), onSelect() {} },
  ];
  const at = anchor?.isConnected ? anchor : activeAppDocument().querySelector<HTMLElement>('[data-window-bar="entries"]');
  if (at) openMenuFrom(at, entries, { owner: SETTINGS_DRAFTS_MENU, toggle: false });
  else openMenuAt(16, 40, entries, { owner: SETTINGS_DRAFTS_MENU });
}

/** Tests: forget every reported draft. */
export function resetSettingsDrafts(): void {
  drafts.clear();
  unsaved.clear();
}

/** A callback ref for the element whose controls are watched (components/SettingsShelf's page column). */
export function useSettingsEditWatch(): (el: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    stop.current?.();
    stop.current = el ? watchSettingsEdits(el) : null;
  }, []);
}
