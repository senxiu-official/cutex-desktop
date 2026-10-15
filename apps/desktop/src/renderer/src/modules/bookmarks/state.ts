import { create } from "zustand";
import type { MessageKey } from "../../i18n";
import type { AppModuleContext, CutexRef, RefOpenResult } from "../slots";
import type { Json } from "../types";
import { addBookmark, BookmarkError, checkedRef, EMPTY_BOOKMARKS, readBookmarks, refKey, renameBookmark as renamed, scopeBookmark, type BookmarkScope, type BookmarkDocument, type BookmarkProblem, type BookmarkRecord } from "./model";

export const useBookmarks = create<{ document: BookmarkDocument; storageError: BookmarkProblem | null; actionError: string | null; failures: Record<string, string> }>(() => ({ document: EMPTY_BOOKMARKS, storageError: null, actionError: null, failures: {} }));
let context: AppModuleContext | null = null;
const opens = new Map<string, number>();
const PREF_KEY = "saved";
export function problemKey(p: BookmarkProblem): MessageKey { return ({ "invalid-ref": "bookmarks.invalidRef", "invalid-storage": "bookmarks.invalidStorage", "storage-full": "bookmarks.storageFull", "storage-failed": "bookmarks.storageFailed", "module-off": "bookmarks.moduleOff" } as const)[p]; }
function ctx(): AppModuleContext { if (!context || context.signal.aborted) throw new BookmarkError("module-off"); return context; }
function report(error: unknown): void {
  const message = context?.t(problemKey(error instanceof BookmarkError ? error.code : "invalid-ref")) ?? String(error);
  useBookmarks.setState({ actionError: message }); context?.services.ui.notice(message, "error");
}
export function activateBookmarks(current: AppModuleContext): void {
  context = current;
  let loading = false;
  const load = () => {
    if (loading || current.signal.aborted || context !== current) return;
    loading = true;
    try {
      const result = readBookmarks(current.prefs.get(PREF_KEY, null), current.services.refs.parse);
      if (result.migrated) {
        try {
          current.prefs.set(PREF_KEY, JSON.parse(JSON.stringify(result.document)) as Json);
          current.services.ui.notice(result.discarded ? current.t("bookmarks.migrated", { n: result.discarded }) : current.t("bookmarks.migratedPlain"));
        } catch { result.error = "storage-failed"; }
      }
      useBookmarks.setState({ document: result.document, storageError: result.error, actionError: null, failures: {} });
    } finally { loading = false; }
  };
  load();
  const off = current.prefs.subscribe(load);
  current.signal.addEventListener("abort", () => { off(); if (context === current) { context = null; useBookmarks.setState({ actionError: null, failures: {} }); } }, { once: true });
}
function persist(document: BookmarkDocument): void {
  const current = ctx();
  const checked = readBookmarks(document, current.services.refs.parse);
  if (checked.error) throw new BookmarkError(checked.error);
  try { current.prefs.set(PREF_KEY, JSON.parse(JSON.stringify(checked.document)) as Json); } catch { throw new BookmarkError("storage-failed"); }
  useBookmarks.setState({ document: checked.document, storageError: null, actionError: null });
}
function writable() { const current = ctx(), state = useBookmarks.getState(); if (state.storageError) throw new BookmarkError(state.storageError); return { current, document: state.document }; }
export function saveBookmark(raw: unknown, scope?: BookmarkScope): boolean {
  try {
    const { current, document } = writable();
    let next = addBookmark(document, raw, current.services.refs.parse, undefined, undefined, scope);
    if (next === document && scope?.projectExplicit === true) {
      const ref = checkedRef(raw, current.services.refs.parse);
      const existing = document.records.find(r => refKey(r.ref) === refKey(ref))!;
      next = scopeBookmark(document, existing.id, { ...existing.scope, sessionId: existing.scope?.sessionId ?? existing.ref.params.sessionId ?? scope.sessionId, projectId: scope.projectId, projectExplicit: true });
    }
    if (next !== document) persist(next);
    current.services.ui.notice(current.t(next === document ? "bookmarks.existing" : "bookmarks.saved")); return true;
  } catch (e) { report(e); return false; }
}
export function toggleBookmark(raw: CutexRef, scope?: BookmarkScope): void {
  try {
    const { current, document } = writable(), ref = checkedRef(raw, current.services.refs.parse);
    const existing = document.records.find((r) => refKey(r.ref) === refKey(ref));
    if (existing) removeBookmark(existing.id); else saveBookmark(ref, scope);
  } catch (e) { report(e); }
}
export function removeBookmark(id: string): boolean {
  try { const { document } = writable(); persist({ version: 3, records: document.records.filter((r) => r.id !== id) }); return true; } catch (e) { report(e); return false; }
}
export function editBookmark(id: string, title: string, scope: BookmarkScope): boolean {
  try { const { current, document } = writable(); persist(scopeBookmark(renamed(document, id, title, current.services.refs.parse), id, scope)); return true; } catch (e) { report(e); return false; }
}
export function renameBookmark(id: string, title: string): boolean {
  try { const { current, document } = writable(); persist(renamed(document, id, title, current.services.refs.parse)); return true; } catch (e) { report(e); return false; }
}
/** Explicit confirmed reset is the only action allowed to replace a malformed document. */
export function resetBookmarkData(): boolean {
  try { persist({ version: 3, records: [] }); useBookmarks.setState({ failures: {} }); return true; } catch (e) { report(e); return false; }
}
export function currentRefs(): readonly CutexRef[] {
  try { const current = ctx(); return current.services.refs.here().map((r) => current.services.refs.parse(r)).filter((r): r is CutexRef => !!r); } catch { return []; }
}
export async function openBookmark(record: BookmarkRecord, how: "auto" | "peek" | "page" | "jump" = "peek"): Promise<RefOpenResult> {
  const current = ctx();
  const serial = (opens.get(record.id) ?? 0) + 1;
  opens.set(record.id, serial);
  let result: RefOpenResult;
  try {
    const ref = checkedRef(record.ref, current.services.refs.parse);
    result = await current.services.refs.open(ref, { how });
  } catch { result = { status: "unavailable", reason: "bad-ref" }; }
  if (context === current && !current.signal.aborted && opens.get(record.id) === serial) {
    useBookmarks.setState((s) => {
      const failures = { ...s.failures };
      if (result.status === "opened") delete failures[record.id]; else failures[record.id] = result.status === "stale" ? "stale" : result.reason;
      return { failures };
    });
  }
  return result;
}
