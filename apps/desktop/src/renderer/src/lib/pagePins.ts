// Pinned pages (tray + desktop tiles, pin kind `page`, key `<pageId>:<argument>`; cutex
// `user-home-page-pins`): the module that owns a page (e.g. a project's overview pane) registers how its
// pin looks and opens; the module that keeps the pin list (built-in `home`) draws it from here without
// naming that module. Not registered (the module is off): a plain tile with the stored title. Shell code:
// names no feature.
import type { ReactNode } from "react";
import { create } from "zustand";

/** What a pinned page shows now. */
export interface PagePinView {
  /** The page's name (e.g. the project's), falling back to the stored title. */
  name: string;
  /** What kind of page this is, one short line (desktop tiles of size m and up). */
  subtitle?: string;
  /** The icon in a square of `size` px. */
  icon(size: number): ReactNode;
  /** The 需要你 count (0: none) — an amber number on the tray icon and the tile. */
  needs: number;
  /** Gone, or its host offline: drawn dimmed. */
  dim: boolean;
}

export interface PagePinKind {
  /** The page id in the key (`[a-z][a-z0-9._-]{0,63}`). */
  id: string;
  /** Hook: the live look of the pin (`arg` = the key after `<id>:`; `title` = the stored title). */
  usePin(hostId: string, arg: string, title: string | null): PagePinView;
  /** Opens the page; false: it could not be. */
  open(hostId: string, arg: string): boolean | Promise<boolean>;
  /** The kind's name in the 「＋ 固定」 picker (a message key, e.g. the pane kind's title). */
  titleKey?: string;
  /** What can be pinned now, for the 「＋ 固定」 picker (desktop and tray); absent: not offered there. */
  candidates?(): PagePinCandidate[];
}

/** One page the 「＋ 固定」 picker offers. */
export interface PagePinCandidate {
  hostId: string;
  /** The key after `<id>:`. */
  arg: string;
  title: string;
}

const usePagePinKinds = create<{ kinds: Readonly<Record<string, PagePinKind>> }>(() => ({ kinds: {} }));

/** Registers a page kind; returns the unregister (a module's deactivate). */
export function registerPagePin(kind: PagePinKind): () => void {
  usePagePinKinds.setState((s) => ({ kinds: { ...s.kinds, [kind.id]: kind } }));
  return () =>
    usePagePinKinds.setState((s) => {
      if (s.kinds[kind.id] !== kind) return s;
      const { [kind.id]: _gone, ...rest } = s.kinds;
      return { kinds: rest };
    });
}

/** The registered page kind (live; undefined: none). */
export function usePagePinKind(pageId: string | null): PagePinKind | undefined {
  return usePagePinKinds((s) => (pageId ? s.kinds[pageId] : undefined));
}

export function pagePinKindNow(pageId: string): PagePinKind | undefined {
  return usePagePinKinds.getState().kinds[pageId];
}

/** Every registered page kind now (the 「＋ 固定」 picker). */
export function pagePinKindsNow(): PagePinKind[] {
  return Object.values(usePagePinKinds.getState().kinds);
}

/** The pin key of a page. */
export const pagePinKey = (pageId: string, arg: string): string => `${pageId}:${arg}`;
