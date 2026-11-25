// Window-local unsent state: navigation is not a draft lifetime boundary. No disk persistence.
// Undo / redo (owner-approved survey C1, 2026-11-25): each draft key (host + session) keeps its own in-memory history of
// whole drafts (text, attachments, picked skills), so removing an attachment or replacing a big paste can be undone.
// - Typing coalesces into bursts (a pause of UNDO_IDLE_MS, or switching between inserting and deleting, starts a new
//   one); an IME composition never opens a step in the middle: the whole composition is one step.
// - Attachments, skills, inserts and edits marked with `markStep` (paste, picks) are steps of their own; `group`
//   makes several field changes one step.
// - Sending (`clear`) ends the history; evicted / forgotten drafts take theirs along. Bounded per key and in all.
import { useMemo, useSyncExternalStore, type SetStateAction } from "react";
import type { DraftImage } from "../../../shared/input";
import { composerAttachments } from "./queuePause";

export interface ComposerDraft {
  text: string;
  images: DraftImage[];
  pickedSkills: { name: string; path: string }[];
}

const EMPTY: ComposerDraft = { text: "", images: [], pickedSkills: [] };
export const composerDraftKey = (host: string | null | undefined, session: string): string => JSON.stringify([host ?? "local", session]);

/** Default bounds of the window-local draft map (unsent drafts are not persisted anyway). */
export const DRAFT_LIMITS = { entries: 50, bytes: 32 * 1024 * 1024 };
/** Undo history bounds: steps kept per draft, and approximate bytes of all histories (oldest steps go first). */
export const UNDO_LIMITS = { steps: 100, bytes: 32 * 1024 * 1024 };
/** A typing pause this long starts a new undo step. */
export const UNDO_IDLE_MS = 1000;

/** How a change enters the undo history: coalesced typing, a step of its own, or not at all (undo / redo itself). */
export interface DraftChange { history?: "typing" | "step" | "none"; /** An IME composition is in progress (typing). */ composing?: boolean }

/** Rough in-memory size of a draft: text plus image previews / inline data URLs (UTF-16). */
export function draftBytes(draft: ComposerDraft): number {
  let n = draft.text.length;
  for (const image of draft.images) {
    n += image.preview?.length ?? 0;
    if (image.source.kind === "data") n += image.source.url.length;
    else n += image.source.path.length;
  }
  for (const skill of draft.pickedSkills) n += skill.name.length + skill.path.length;
  return n * 2;
}

const hostOfKey = (key: string): string | null => {
  try {
    const parsed = JSON.parse(key) as unknown;
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
};

interface History {
  past: ComposerDraft[];
  future: ComposerDraft[];
  /** The open typing burst (its first change recorded the state before it). */
  burst: { kind: "insert" | "delete"; at: number; composing: boolean } | null;
  /** The next text change is a step of its own (paste, a pick). */
  stepNext: boolean;
  bytes: number;
}

export function createComposerDraftStore(limits: { entries: number; bytes: number } = DRAFT_LIMITS, undoLimits: { steps: number; bytes: number } = UNDO_LIMITS, now: () => number = Date.now) {
  // Insertion order = recency (least recently written first): an LRU over unsent drafts.
  const drafts = new Map<string, ComposerDraft>();
  const sizes = new Map<string, number>();
  let total = 0;
  // Draft generation per key, only while an async acquisition holds it: clear (send) drops it, so a
  // late continuation sees a different (or no) generation. Never a counter that grows per send.
  const generations = new Map<string, object>();
  const listeners = new Map<string, Set<() => void>>();
  const histories = new Map<string, History>();
  let historyBytes = 0;
  /** Inside `group`: changes are not recorded one by one. */
  let grouping: string | null = null;
  const read = (key: string): ComposerDraft => drafts.get(key) ?? EMPTY;
  const forgetHistory = (key: string) => {
    const h = histories.get(key);
    if (!h) return;
    historyBytes -= h.bytes;
    histories.delete(key);
  };
  /** The history of `key`, now the most recently used one (Map order = recency, like the drafts). */
  const historyOf = (key: string): History => {
    let h = histories.get(key);
    if (h) histories.delete(key);
    else h = { past: [], future: [], burst: null, stepNext: false, bytes: 0 };
    histories.set(key, h);
    // At most as many histories as drafts: the oldest ones not shown go (empty drafts keep no entry to evict by).
    if (histories.size > limits.entries) {
      for (const other of [...histories.keys()]) {
        if (histories.size <= limits.entries) break;
        if (other !== key && !listeners.has(other)) forgetHistory(other);
      }
    }
    return h;
  };
  const trimStack = (h: History, stack: ComposerDraft[], n: number) => {
    for (const gone of stack.splice(0, n)) { const b = draftBytes(gone); h.bytes -= b; historyBytes -= b; }
  };
  /**
   * Keep the bounds after any change to a history (a new step, an undo / redo): steps per stack, then bytes in all:
   * the least recently used other histories go first, then this one's oldest undo steps, then its farthest redo steps.
   */
  const enforce = (key: string) => {
    const h = histories.get(key);
    if (!h) return;
    if (h.past.length > undoLimits.steps) trimStack(h, h.past, h.past.length - undoLimits.steps);
    if (h.future.length > undoLimits.steps) trimStack(h, h.future, h.future.length - undoLimits.steps);
    if (historyBytes <= undoLimits.bytes) return;
    for (const other of [...histories.keys()]) {
      if (historyBytes <= undoLimits.bytes) break;
      if (other !== key) forgetHistory(other);
    }
    while (historyBytes > undoLimits.bytes && h.past.length) trimStack(h, h.past, 1);
    while (historyBytes > undoLimits.bytes && h.future.length) trimStack(h, h.future, 1);
  };
  /** Remember `before` as the state to undo back to; a new change drops what could be redone. */
  const pushPast = (key: string, before: ComposerDraft) => {
    const h = historyOf(key);
    trimStack(h, h.future, h.future.length);
    h.past.push(before);
    const b = draftBytes(before);
    h.bytes += b; historyBytes += b;
    enforce(key);
  };
  /** Record `before` (the state a change leaves) according to how the change enters the history. */
  const record = (key: string, field: keyof ComposerDraft, before: ComposerDraft, after: ComposerDraft, change: DraftChange) => {
    if (grouping === key) return;
    const mode = change.history ?? (field === "text" ? "typing" : "step");
    if (mode === "none") return;
    const h = historyOf(key);
    if (mode === "typing" && !h.stepNext) {
      const at = now();
      const kind = after.text.length >= before.text.length ? "insert" : "delete";
      const burst = h.burst;
      if (burst?.composing) {
        // Inside a composition: never a new step. Its committing change (no longer composing) ends the step.
        if (change.composing) burst.at = at;
        else h.burst = null;
        return;
      }
      if (burst && !change.composing && burst.kind === kind && at - burst.at < UNDO_IDLE_MS) { burst.at = at; return; }
      pushPast(key, before);
      h.burst = { kind, at, composing: !!change.composing };
      return;
    }
    h.stepNext = false;
    h.burst = null;
    pushPast(key, before);
  };
  const emit = (key: string) => listeners.get(key)?.forEach((listener) => listener());
  const drop = (key: string) => {
    total -= sizes.get(key) ?? 0;
    sizes.delete(key);
    drafts.delete(key);
  };
  // Oldest first; a draft a mounted composer shows (has listeners) and the one just written stay.
  const evict = (keep: string) => {
    if (drafts.size <= limits.entries && total <= limits.bytes) return;
    for (const key of [...drafts.keys()]) {
      if (drafts.size <= limits.entries && total <= limits.bytes) break;
      if (key === keep || listeners.has(key)) continue;
      drop(key);
      generations.delete(key);
      forgetHistory(key);
      emit(key);
    }
  };
  const write = (key: string, draft: ComposerDraft) => {
    drop(key);
    if (draft.text || draft.images.length || draft.pickedSkills.length) {
      const size = draftBytes(draft);
      drafts.set(key, draft);
      sizes.set(key, size);
      total += size;
      evict(key);
    }
    emit(key);
  };
  function update<K extends keyof ComposerDraft>(key: string, field: K, value: SetStateAction<ComposerDraft[K]>, change: DraftChange = {}) {
    const previous = read(key);
    const next = typeof value === "function" ? (value as (current: ComposerDraft[K]) => ComposerDraft[K])(previous[field]) : value;
    if (Object.is(next, previous[field])) return;
    const after = { ...previous, [field]: next };
    record(key, field, previous, after, change);
    write(key, after);
  }
  /** Send boundary: the draft and its undo history end. */
  const clear = (key: string) => {
    generations.delete(key);
    forgetHistory(key);
    drop(key);
    emit(key);
  };
  /** Several field changes as one undo step (e.g. a skill pick sets the skill and its `$name`). */
  const group = (key: string, fn: () => void) => {
    if (grouping !== null) { fn(); return; }
    const before = read(key);
    grouping = key;
    try { fn(); } finally { grouping = null; }
    const after = read(key);
    if (after === before) return;
    const h = historyOf(key);
    h.stepNext = false;
    h.burst = null;
    pushPast(key, before);
  };
  /** The next text change (a paste, an inserted pick) is an undo step of its own; typing after it starts a new one. */
  const markStep = (key: string) => { historyOf(key).stepNext = true; historyOf(key).burst = null; };
  /** Undo (or redo) one step: the draft before (after) it, or null when there is none. */
  const travel = (key: string, redo: boolean): ComposerDraft | null => {
    const h = histories.get(key);
    const from = redo ? h?.future : h?.past;
    if (!h || !from?.length) return null;
    const target = from.pop()!;
    const tb = draftBytes(target);
    h.bytes -= tb; historyBytes -= tb;
    const current = read(key);
    (redo ? h.past : h.future).push(current);
    const cb = draftBytes(current);
    h.bytes += cb; historyBytes += cb;
    h.burst = null;
    h.stepNext = false;
    enforce(key);
    write(key, target);
    return target;
  };
  /**
   * An IME composition ended (compositionend): its step is closed even when the commit changed nothing (Chromium's
   * committing input is still `isComposing`, and a commit of the shown text fires no change at all).
   */
  const endComposition = (key: string) => {
    const h = histories.get(key);
    if (h) h.burst = null;
  };
  // Async acquisitions retain the initiating host/session across navigation. Sending invalidates
  // them: a late file picker/FileReader must not resurrect an already-sent attachment.
  const capture = (key: string) => {
    let generation = generations.get(key);
    if (!generation) {
      generation = {};
      generations.set(key, generation);
      // Bounded like the drafts: dropping an old generation only fences its late continuation.
      if (generations.size > limits.entries * 4) generations.delete(generations.keys().next().value!);
    }
    const mine = generation;
    const guarded = <K extends keyof ComposerDraft>(field: K, value: SetStateAction<ComposerDraft[K]>) => {
      if (generations.get(key) === mine) update(key, field, value);
    };
    return {
      setText: (value: SetStateAction<string>) => guarded("text", value),
      setImages: (value: SetStateAction<DraftImage[]>) => guarded("images", value),
      setPickedSkills: (value: SetStateAction<ComposerDraft["pickedSkills"]>) => guarded("pickedSkills", value),
    };
  };
  /** Forget drafts (and fence pending acquisitions) of hosts no longer configured. */
  const retainHosts = (hostIds: Iterable<string>) => {
    const keep = new Set(hostIds);
    keep.add("local");
    for (const key of new Set([...drafts.keys(), ...generations.keys(), ...histories.keys()])) {
      const host = hostOfKey(key);
      if (host === null || keep.has(host)) continue;
      generations.delete(key);
      forgetHistory(key);
      if (drafts.has(key)) {
        drop(key);
        emit(key);
      }
    }
  };
  return {
    read, update, clear, capture, retainHosts, group, markStep, endComposition,
    /** The undo history ends here (a send that leaves part of the draft, e.g. the side composer's text-only send). */
    endHistory: forgetHistory,
    undo: (key: string) => travel(key, false),
    redo: (key: string) => travel(key, true),
    canUndo: (key: string) => !!histories.get(key)?.past.length,
    canRedo: (key: string) => !!histories.get(key)?.future.length,
    /** Entry count / approximate bytes held (tests, diagnostics). */
    stats: () => ({ entries: drafts.size, bytes: total, generations: generations.size, histories: histories.size, historyBytes }),
    insert(key: string, text: string, mode: "replace" | "append", extra: unknown[] = []) {
      const previous = read(key);
      const restored = composerAttachments(extra);
      const h = historyOf(key);
      h.stepNext = false;
      h.burst = null;
      pushPast(key, previous);
      write(key, {
        text: mode === "append" && previous.text.trim()
          ? (text ? `${previous.text.replace(/\s+$/, "")}\n\n${text}` : previous.text) : text,
        images: [...previous.images, ...restored.images.map((image) => ({ ...image, id: `restore-${crypto.randomUUID()}` }))],
        pickedSkills: [...previous.pickedSkills, ...restored.skills],
      });
    },
    subscribe(key: string, listener: () => void) {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
  };
}

export const composerDrafts = createComposerDraftStore();

export function insertComposerDraft(host: string | null | undefined, session: string, text: string,
  mode: "replace" | "append" = "replace", extra?: unknown[]) {
  composerDrafts.insert(composerDraftKey(host, session), text, mode, extra);
}

export function useComposerDraft(host: string | null | undefined, session: string) {
  const key = composerDraftKey(host, session);
  const scope = useMemo(() => ({
    subscribe: (listener: () => void) => composerDrafts.subscribe(key, listener),
    read: () => composerDrafts.read(key),
    /** Programmatic text changes are undo steps of their own; typing passes `{ history: "typing" }`. */
    setText: (value: SetStateAction<string>, change: DraftChange = { history: "step" }) => composerDrafts.update(key, "text", value, change),
    setImages: (value: SetStateAction<DraftImage[]>) => composerDrafts.update(key, "images", value),
    setPickedSkills: (value: SetStateAction<ComposerDraft["pickedSkills"]>) => composerDrafts.update(key, "pickedSkills", value),
    clearDraft: () => composerDrafts.clear(key),
    captureDraft: () => composerDrafts.capture(key),
    /** Undo / redo one step of this draft; the restored draft, or null when there is nothing to undo / redo. */
    undoDraft: () => composerDrafts.undo(key),
    redoDraft: () => composerDrafts.redo(key),
    groupDraft: (fn: () => void) => composerDrafts.group(key, fn),
    markDraftStep: () => composerDrafts.markStep(key),
    endDraftComposition: () => composerDrafts.endComposition(key),
    endDraftHistory: () => composerDrafts.endHistory(key),
  }), [key]);
  const draft = useSyncExternalStore(scope.subscribe, scope.read, scope.read);
  return { ...draft, ...scope };
}
