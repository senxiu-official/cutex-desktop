import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AppModuleContext, CutexRef, RefOpenResult } from "../src/renderer/src/modules/slots";
import { agentRef, parseRef, turnRef } from "../src/renderer/src/lib/refs";
import { addBookmark, BOOKMARK_LIMIT, checkedRef, EMPTY_BOOKMARKS, groupBookmarks, matchingBookmarks, readBookmarks, refKey, renameBookmark as renameModel, type BookmarkDocument } from "../src/renderer/src/modules/bookmarks/model";
import { activateBookmarks, currentRefs, editBookmark, openBookmark, removeBookmark, renameBookmark, resetBookmarkData, saveBookmark, toggleBookmark, useBookmarks } from "../src/renderer/src/modules/bookmarks/state";
import { previewBookmarks } from "../src/renderer/src/modules/bookmarks/mock";

const at = "2026-10-11T01:00:00Z";
const ref = (hostId = "local", sessionId = "s", turnId = "t") => turnRef({ hostId, sessionId, turnId, agentName: sessionId, snippet: "A saved snippet", at });
const add = (doc: BookmarkDocument, target: CutexRef, id = "one") => addBookmark(doc, target, parseRef, id, at);
const controllers: AbortController[] = [];
afterEach(() => { controllers.splice(0).forEach((c) => c.abort()); });
function harness(raw: unknown = null) {
  let saved = raw;
  const controller = new AbortController(); controllers.push(controller);
  const listeners = new Set<() => void>();
  const set = vi.fn((_key: string, next: unknown) => { saved = structuredClone(next); listeners.forEach((l) => l()); });
  const parse = vi.fn(parseRef), open = vi.fn<(ref: CutexRef, opts?: { how?: string }) => Promise<RefOpenResult>>().mockResolvedValue({ status: "opened", where: "peek" });
  const notice = vi.fn(), here = vi.fn(() => [ref()]);
  const ctx = { signal: controller.signal, host: { id: "local" }, t: (key: string) => key, prefs: { get: () => saved, set, subscribe: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); } }, services: { refs: { parse, open, here }, ui: { notice } } } as unknown as AppModuleContext;
  activateBookmarks(ctx);
  return { controller, ctx, set, parse, open, notice, here, saved: () => saved, listenerCount: () => listeners.size };
}

describe("Bookmarks v3 data model", () => {
  it("stores pointers and short fallback snapshots, roundtrips using the shared parser", () => {
    const target = ref(); target.snapshot!.snippet = "x".repeat(3000);
    const parse = vi.fn(parseRef), doc = addBookmark(EMPTY_BOOKMARKS, target, parse, "one", at);
    expect(doc.version).toBe(3); expect(doc.records[0]?.ref.snapshot?.snippet).toHaveLength(500);
    expect(doc.records[0]).not.toHaveProperty("hostId"); expect(doc.records[0]).not.toHaveProperty("target");
    expect(readBookmarks(JSON.parse(JSON.stringify(doc)), parse).document).toEqual(doc);
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it("partitions identity and searches by host, even for colliding session and turn ids", () => {
    let doc = add(EMPTY_BOOKMARKS, ref("local")); doc = add(doc, ref("remote"), "two");
    expect(refKey(doc.records[0]!.ref)).not.toBe(refKey(doc.records[1]!.ref));
    expect(matchingBookmarks(doc, "", "remote")).toHaveLength(1);
    expect(matchingBookmarks(doc, "saved snippet", "local")).toHaveLength(1);
    expect(matchingBookmarks(doc, "absent")).toHaveLength(0);
    expect(add(doc, ref("remote"), "three")).toBe(doc);
  });
  it("groups current agent first, then the current host and other hosts", () => {
    let doc = add(EMPTY_BOOKMARKS, ref("remote", "s")); doc = add(doc, ref("local", "other"), "two"); doc = add(doc, ref("local", "s"), "three");
    const groups = groupBookmarks(doc.records, "local", "s");
    expect(groups.map((g) => [g.hostId, g.sessionId, g.current])).toEqual([["local", "s", true], ["local", "other", false], ["remote", "s", false]]);
  });
  it("enforces 500 records and the total preference budget", () => {
    let doc = EMPTY_BOOKMARKS;
    for (let n = 0; n < BOOKMARK_LIMIT; n++) doc = add(doc, ref("local", "s", `t${n}`), `r${n}`);
    expect(doc.records).toHaveLength(500); expect(() => add(doc, ref("local", "s", "overflow"), "extra")).toThrow("storage-full");
    const huge = { ...ref(), params: Object.fromEntries(Array.from({ length: 32 }, (_, n) => [`p${n}`, "x".repeat(8000)])) };
    doc = EMPTY_BOOKMARKS;
    expect(() => { for (let n = 0; n < 12; n++) doc = add(doc, { ...huge, key: String(n) }, `r${n}`); }).toThrow("storage-full");
  });
  it("rejects malformed/newer storage and unknown authority-bearing fields", () => {
    for (const raw of [{ version: 4, records: [] }, { version: 2, records: [null] }, { version: 2, records: [{ id: "a", createdAt: at, ref: { ...ref(), params: { bad: {} } } }] }]) expect(readBookmarks(raw, parseRef).error).not.toBeNull();
    const doc = add(EMPTY_BOOKMARKS, ref());
    expect(readBookmarks({ ...doc, records: [...doc.records, ...doc.records] }, parseRef).error).toBe("invalid-storage");
    const withUnknown = { ...ref(), execute: "evil", params: JSON.parse('{"__proto__":"evil"}') };
    expect(() => checkedRef(withUnknown, parseRef)).toThrow("invalid-ref");
  });
  it("migrates only non-snapshot v1 records and drops full frozen copies", () => {
    const raw = { version: 1, records: [
      { id: "legacy-page", hostId: "remote", createdAt: at, target: { kind: "main.page", key: "x", title: "Page", params: { page: "projects.page", pageParams: "{}" } } },
      { id: "legacy-copy", hostId: "local", createdAt: at, target: { kind: "conversation.snapshot", key: "s:now", title: "Old copy", params: { body: "whole conversation" } } },
    ] };
    const result = readBookmarks(raw, parseRef);
    expect(result).toMatchObject({ error: null, migrated: true, discarded: 1 });
    expect(result.document.records).toHaveLength(1); expect(result.document.records[0]?.ref.hostId).toBe("remote");
    expect(JSON.stringify(result.document)).not.toContain("whole conversation");
    expect(() => add(EMPTY_BOOKMARKS, { ...ref(), kind: "conversation.snapshot" })).toThrow("invalid-ref");
  });
  it("rename changes only the label and revalidates it", () => {
    const doc = add(EMPTY_BOOKMARKS, ref()), next = renameModel(doc, "one", "New label", parseRef);
    expect(next.records[0]?.ref.title).toBe("New label"); expect(next.records[0]?.ref.params).toEqual(doc.records[0]?.ref.params);
    expect(() => renameModel(doc, "one", " ", parseRef)).toThrow(); expect(() => renameModel(doc, "one", "a".repeat(201), parseRef)).toThrow();
  });
});

describe("Bookmarks scoped state and generic opening", () => {
  it("persists explicit project choice without duplicating a saved target; quick save never clears it", () => {
    harness();
    saveBookmark(ref(), { sessionId: "s", projectId: "p", projectExplicit: false });
    expect(useBookmarks.getState().document.records[0]?.scope?.projectExplicit).toBe(false);
    saveBookmark(ref(), { sessionId: "s", projectId: "p", projectExplicit: true });
    const record = useBookmarks.getState().document.records[0]!;
    expect(useBookmarks.getState().document.records).toHaveLength(1);
    saveBookmark(ref());
    expect(useBookmarks.getState().document.records[0]?.scope?.projectExplicit).toBe(true);
    expect(editBookmark(record.id, "Scoped title", { ...record.scope, projectExplicit: false })).toBe(true);
    expect(useBookmarks.getState().document.records[0]).toMatchObject({ ref: { title: "Scoped title" }, scope: { projectId: "p", projectExplicit: false } });
  });
  it("toggles a single reference without affecting its other-host counterpart", () => {
    const h = harness(); toggleBookmark(ref()); toggleBookmark(ref("remote"));
    expect(useBookmarks.getState().document.records).toHaveLength(2);
    toggleBookmark(ref()); expect(useBookmarks.getState().document.records).toHaveLength(1);
    expect(useBookmarks.getState().document.records[0]?.ref.hostId).toBe("remote");
    expect(h.set).toHaveBeenCalledTimes(3);
  });
  it("storage failure is surfaced and never appears as a successful save", () => {
    const h = harness(); h.set.mockImplementation(() => { throw new Error("quota"); });
    expect(saveBookmark(ref())).toBe(false); expect(useBookmarks.getState().document.records).toHaveLength(0);
    expect(h.saved()).toBeNull(); expect(useBookmarks.getState().actionError).toBe("bookmarks.storageFailed");
    expect(h.notice).not.toHaveBeenCalledWith("bookmarks.saved");
  });
  it("preserves malformed storage until the explicitly confirmed reset action", () => {
    const malformed = { version: 200, records: [{ precious: true }] }, h = harness(malformed);
    expect(saveBookmark(ref())).toBe(false); expect(removeBookmark("x")).toBe(false); expect(h.set).not.toHaveBeenCalled(); expect(h.saved()).toEqual(malformed);
    expect(resetBookmarkData()).toBe(true); expect(h.saved()).toEqual({ version: 3, records: [] });
  });
  it("successful migration persists once and its notice is not repeated on reactivation", () => {
    const h = harness({ version: 1, records: [{ id: "old", hostId: "local", createdAt: at, target: { kind: "conversation.snapshot", key: "s", title: "copy", params: { body: "old body" } } }] });
    expect(h.set).toHaveBeenCalledTimes(1); expect(h.notice).toHaveBeenCalledWith("bookmarks.migrated");
    const raw = h.saved(); h.controller.abort(); const next = harness(raw);
    expect(next.set).not.toHaveBeenCalled(); expect(next.notice).not.toHaveBeenCalledWith("bookmarks.migrated");
  });
  it("failed migration leaves old bytes intact and prevents accidental replacement", () => {
    const h = harness(); h.set.mockImplementation(() => { throw new Error("quota"); }); h.controller.abort();
    let value: unknown = { version: 1, records: [] };
    const ctl = new AbortController(); controllers.push(ctl);
    activateBookmarks({ ...h.ctx, signal: ctl.signal, prefs: { get: () => value, set: () => { throw new Error("quota"); }, subscribe: () => () => {} } } as unknown as AppModuleContext);
    expect(useBookmarks.getState().storageError).toBe("storage-failed"); expect(saveBookmark(ref())).toBe(false); expect(value).toEqual({ version: 1, records: [] });
  });
  it("open reparses the pointer and delegates to refs.open: no parent selection, history or rendering", async () => {
    const h = harness(); saveBookmark(ref()); const record = useBookmarks.getState().document.records[0]!;
    h.parse.mockClear(); await openBookmark(record);
    expect(h.parse).toHaveBeenCalledWith(record.ref); expect(h.open).toHaveBeenCalledWith(record.ref, { how: "peek" });
    await openBookmark(record, "jump"); expect(h.open).toHaveBeenLastCalledWith(record.ref, { how: "jump" });
    // No other services exist in this harness. Content peeks cannot accidentally select an agent.
  });
  it.each(["gone", "reverted", "module-off", "capability", "host-offline", "host-changed", "bad-ref"] as const)("keeps unavailable %s targets and marks the row, then allows retry", async (reason) => {
    const h = harness(add(EMPTY_BOOKMARKS, ref())); const record = useBookmarks.getState().document.records[0]!;
    h.open.mockResolvedValueOnce({ status: "unavailable", reason }); await openBookmark(record);
    expect(useBookmarks.getState().failures[record.id]).toBe(reason); expect(useBookmarks.getState().document.records).toHaveLength(1);
    await openBookmark(record, "page"); expect(useBookmarks.getState().failures[record.id]).toBeUndefined();
  });
  it("invalid references cannot reach the opener", async () => {
    const h = harness(add(EMPTY_BOOKMARKS, ref())); const record = useBookmarks.getState().document.records[0]!;
    h.parse.mockReturnValue(null); await openBookmark(record); expect(h.open).not.toHaveBeenCalled(); expect(useBookmarks.getState().failures[record.id]).toBe("bad-ref");
  });
  it("late opens cannot mutate state after module deactivation", async () => {
    const h = harness(add(EMPTY_BOOKMARKS, ref())); const record = useBookmarks.getState().document.records[0]!;
    let resolve!: (r: RefOpenResult) => void; h.open.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const pending = openBookmark(record); h.controller.abort(); resolve({ status: "unavailable", reason: "gone" }); await pending;
    expect(useBookmarks.getState().failures).toEqual({}); expect(h.listenerCount()).toBe(0); expect(saveBookmark(ref())).toBe(false);
  });
  it("older failed opens cannot override a newer successful retry", async () => {
    const h = harness(add(EMPTY_BOOKMARKS, ref())); const record = useBookmarks.getState().document.records[0]!;
    let resolve!: (r: RefOpenResult) => void; h.open.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const old = openBookmark(record); await openBookmark(record); resolve({ status: "unavailable", reason: "gone" }); await old;
    expect(useBookmarks.getState().failures[record.id]).toBeUndefined();
  });
  it("current refs use the generic here/parse service, and rename preserves pointer identity", () => {
    const h = harness(); expect(currentRefs()).toEqual([ref()]); expect(h.here).toHaveBeenCalledOnce(); saveBookmark(agentRef("remote", "s", "Ada"));
    const record = useBookmarks.getState().document.records[0]!;
    expect(renameBookmark(record.id, "My label")).toBe(true); expect(useBookmarks.getState().document.records[0]?.ref).toMatchObject({ title: "My label", hostId: "remote", params: { sessionId: "s" } });
  });
});

describe("Bookmarks contribution boundaries", () => {
  it("uses existing gutter/side/ref/attachment slots and no legacy modal or target provider", () => {
    const source = readFileSync(new URL("../src/renderer/src/modules/bookmarks/index.ts", import.meta.url), "utf8");
    for (const slot of ["conversation.gutter", "side.component", "ref.action", "timeline.turnAttachment"]) expect(source).toContain(slot);
    expect(source).not.toContain('"ref.target"'); expect(source).not.toContain('"app.overlay"'); expect(source).not.toContain('"main.page"');
    const list = readFileSync(new URL("../src/renderer/src/modules/bookmarks/BookmarksList.tsx", import.meta.url), "utf8");
    expect(list).toContain("if (!docked) close()"); expect(list).not.toContain('role="dialog"'); expect(list).not.toContain("aria-modal");
    for (const guard of ["!e.ctrlKey", "!e.metaKey", "!e.altKey", "!e.shiftKey"]) expect(list.match(new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(3); // rename editor, side-list search, gutter 全部 search
    const ribbon = readFileSync(new URL("../src/renderer/src/modules/bookmarks/BookmarkRibbon.tsx", import.meta.url), "utf8");
    expect(ribbon).toContain('where === "inline"');
  });
  it("preview supplies validated turn, agent, note, file and offline refs with short snapshots", () => {
    const parsed = readBookmarks(previewBookmarks(), parseRef); expect(parsed.error).toBeNull(); const doc = parsed.document;
    expect(doc.records.some((r) => r.ref.params.turnId === "reverted-preview-turn")).toBe(true);
    expect(new Set(doc.records.map((r) => r.ref.kind))).toEqual(new Set(["turn", "agent", "notes.note", "workspace.preview"]));
    expect(doc.records.every((r) => (r.ref.snapshot?.snippet?.length ?? 0) <= 500)).toBe(true);
  });
});
