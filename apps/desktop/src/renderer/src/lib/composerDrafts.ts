// Window-local unsent state: navigation is not a draft lifetime boundary. No disk persistence.
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

export function createComposerDraftStore(limits: { entries: number; bytes: number } = DRAFT_LIMITS) {
  // Insertion order = recency (least recently written first): an LRU over unsent drafts.
  const drafts = new Map<string, ComposerDraft>();
  const sizes = new Map<string, number>();
  let total = 0;
  // Draft generation per key, only while an async acquisition holds it: clear (send) drops it, so a
  // late continuation sees a different (or no) generation. Never a counter that grows per send.
  const generations = new Map<string, object>();
  const listeners = new Map<string, Set<() => void>>();
  const read = (key: string): ComposerDraft => drafts.get(key) ?? EMPTY;
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
  function update<K extends keyof ComposerDraft>(key: string, field: K, value: SetStateAction<ComposerDraft[K]>) {
    const previous = read(key);
    const next = typeof value === "function" ? (value as (current: ComposerDraft[K]) => ComposerDraft[K])(previous[field]) : value;
    if (Object.is(next, previous[field])) return;
    write(key, { ...previous, [field]: next });
  }
  const clear = (key: string) => {
    generations.delete(key);
    drop(key);
    emit(key);
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
    for (const key of new Set([...drafts.keys(), ...generations.keys()])) {
      const host = hostOfKey(key);
      if (host === null || keep.has(host)) continue;
      generations.delete(key);
      if (drafts.has(key)) {
        drop(key);
        emit(key);
      }
    }
  };
  return {
    read, update, clear, capture, retainHosts,
    /** Entry count / approximate bytes held (tests, diagnostics). */
    stats: () => ({ entries: drafts.size, bytes: total, generations: generations.size }),
    insert(key: string, text: string, mode: "replace" | "append", extra: unknown[] = []) {
      const previous = read(key);
      const restored = composerAttachments(extra);
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
    setText: (value: SetStateAction<string>) => composerDrafts.update(key, "text", value),
    setImages: (value: SetStateAction<DraftImage[]>) => composerDrafts.update(key, "images", value),
    setPickedSkills: (value: SetStateAction<ComposerDraft["pickedSkills"]>) => composerDrafts.update(key, "pickedSkills", value),
    clearDraft: () => composerDrafts.clear(key),
    captureDraft: () => composerDrafts.capture(key),
  }), [key]);
  const draft = useSyncExternalStore(scope.subscribe, scope.read, scope.read);
  return { ...draft, ...scope };
}
