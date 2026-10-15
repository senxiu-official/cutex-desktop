import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Note, NotesQuery } from "../src/shared/notes";
import { createNotesCache, notesQueryKey, type NotesClient } from "../src/renderer/src/modules/notes/cache";
import { anchorStatus, hasPin, noteQuote, noteRef, parseList, parseNote, sourceRef, togglePin } from "../src/renderer/src/modules/notes/model";
import { parseRef, turnRef } from "../src/renderer/src/lib/refs";
import type { MockCore } from "../src/renderer/src/dev/mockTypes";
import { mock } from "../src/renderer/src/modules/notes/mock";
import { closeTurnNotes, finishTurnNote, noteFloatPosition, noteTurnRange, openTurnNotes, useNoteFloat } from "../src/renderer/src/modules/notes/floating";

const env = vi.hoisted(() => ({ listeners: [] as ((event: unknown) => void)[], off: vi.fn(), daemonFor: vi.fn(), refOpen: vi.fn().mockResolvedValue({ status: "opened", where: "peek" }) }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (_event: string, fn: (event: unknown) => void) => { env.listeners.push(fn); return env.off; } }, api: {} }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: env.daemonFor, refs: { parse: (raw: unknown) => raw, open: env.refOpen }, ui: { notice: vi.fn() }, side: { open: vi.fn() } } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(vi.fn(), { getState: () => ({ hosts: { active: "local" }, selectedId: "s" }) }) }));
const { draftFromTurn, newDraft, notesCache, setNoteDraft, startNotesSync, turnDraftKey, useNoteDrafts } = await import("../src/renderer/src/modules/notes/store");
const { openNoteSource } = await import("../src/renderer/src/modules/notes/actions");

const note = (id = "n", patch: Partial<Note> = {}): Note => ({ id, title: "A title", body: "A body", scope: { kind: "session", id: "s" }, pins: [], anchor: { sessionId: "s", turnId: "t" }, anchorState: "ok", anchorStateAt: null, revision: 1, createdAt: "2026-10-11T01:00:00Z", updatedAt: "2026-10-11T01:00:00Z", ...patch });
const client = (patch: Partial<NotesClient> = {}): NotesClient => ({ notesList: vi.fn().mockResolvedValue({ notes: [], nextCursor: null }), notesGet: vi.fn().mockResolvedValue(note()), notesCreate: vi.fn().mockResolvedValue(note()), notesUpdate: vi.fn().mockResolvedValue(note()), notesDelete: vi.fn().mockResolvedValue({ deleted: true }), ...patch });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

describe("Notes presentation and references", () => {
  it("pins are additive, default scope and explicit marking stay distinct", () => {
    const scope = { kind: "session" as const, id: "s" }, host = { kind: "host" as const };
    let pins = togglePin([], host);
    expect(hasPin(pins, scope)).toBe(false);
    pins = togglePin(pins, { kind: "project", id: "p" });
    expect(pins).toHaveLength(2);
    expect(togglePin(pins, host)).toEqual([{ kind: "project", id: "p" }]);
  });
  it("authoritative anchor status wins over a locally present turn, including no-anchor session notes", () => {
    const history = { loading: false, error: null, older: null, timeline: { threadId: "thread", turns: [{ id: "t" }] } };
    expect(anchorStatus(note(), history)).toBe("available");
    expect(anchorStatus(note("n", { anchorState: "reverted" }), history)).toBe("reverted");
    expect(anchorStatus(note("n", { anchor: null, anchorState: "sessionDeleted" }), history)).toBe("sessionDeleted");
    expect(anchorStatus(note(), undefined)).toBe("unknown");
    expect(anchorStatus(note(), { ...history, older: "cursor", timeline: { threadId: "thread", turns: [] } })).toBe("unknown");
    expect(anchorStatus(note(), { ...history, timeline: { threadId: "thread", turns: [] } })).toBe("reverted");
  });
  it("source actions produce host-bound turn refs, never instructions or an entire conversation", () => {
    const ref = sourceRef("remote", note("n", { anchor: { sessionId: "s", turnId: "t", threadId: "thread" } }), "Ada")!;
    expect(ref.kind).toBe("turn"); expect(ref.hostId).toBe("remote");
    expect(ref.params).toEqual({ sessionId: "s", turnId: "t", threadId: "thread" });
    expect(parseRef(ref)).toEqual(ref);
    expect(sourceRef("remote", note("n", { anchor: null }))?.kind).toBe("agent");
    expect(sourceRef("remote", note("n", { anchor: null, scope: { kind: "host" } }))).toBeNull();
  });
  it("single-note refs and restore params retain only a bounded pointer", () => {
    const ref = noteRef("local", note("n", { body: "x".repeat(2000) }));
    expect(ref.snapshot?.snippet).toHaveLength(500); expect(parseRef(ref)).toEqual(ref);
    expect(parseNote({ noteId: "n", body: "secret", title: "x".repeat(500) })).toEqual({ noteId: "n", title: "x".repeat(200) });
    expect(parseNote({ noteId: "" })).toBeNull(); expect(parseNote(null)).toBeNull();
    expect(parseList({ sessionId: "s", query: "x".repeat(600), body: "secret" })).toEqual({ sessionId: "s", query: "x".repeat(500) });
  });
  it("quotation is plain draft text; no submit or prompt injection transport", () => { expect(noteQuote({ title: "Title", body: "One\nTwo" })).toBe("> Title\n> \n> One\n> Two"); });
  it("container Actions use the same generic source peek/jump as the note body", async () => {
    env.refOpen.mockClear();
    await openNoteSource("remote", note(), "peek");
    expect(env.refOpen).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: "remote", kind: "turn", params: { sessionId: "s", turnId: "t" } }), { how: "peek" });
    await openNoteSource("remote", note(), "jump");
    expect(env.refOpen).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: "remote", kind: "turn" }), { how: "jump" });
    expect(await openNoteSource("remote", note("n", { anchorState: "reverted" }), "jump")).toEqual({ status: "unavailable", reason: "reverted" });
    expect(await openNoteSource("remote", note("n", { anchorState: "sessionDeleted" }), "peek")).toEqual({ status: "unavailable", reason: "gone" });
    expect(env.refOpen).toHaveBeenCalledTimes(2);
    const source = readFileSync(new URL("../src/renderer/src/modules/notes/index.ts", import.meta.url), "utf8");
    expect(source).toContain("Actions: NoteActions"); expect(source).not.toContain('"main.page"');
  });
  it("editors and search preserve the host Escape chain's modifier/IME guards", () => {
    const editor = readFileSync(new URL("../src/renderer/src/modules/notes/NoteEditor.tsx", import.meta.url), "utf8");
    for (const guard of ["!event.repeat", "!event.nativeEvent.isComposing", "!event.ctrlKey", "!event.metaKey", "!event.altKey", "!event.shiftKey"]) expect(editor).toContain(guard);
    expect(editor).not.toContain("stopPropagation");
    const search = readFileSync(new URL("../src/renderer/src/modules/notes/NotesListBody.tsx", import.meta.url), "utf8");
    for (const guard of ["!e.ctrlKey", "!e.metaKey", "!e.altKey", "!e.shiftKey"]) expect(search).toContain(guard);
  });
  it("turn actions retain a draft per host and do not overwrite an existing draft", () => {
    const ref = turnRef({ hostId: "remote", sessionId: "s", turnId: "t" });
    draftFromTurn(ref);
    const key = turnDraftKey("remote", "s", "t");
    const first = useNoteDrafts.getState().drafts[key]!;
    expect(first.anchor).toEqual({ sessionId: "s", turnId: "t" });
    expect(first.pins).toEqual([]);
    setNoteDraft(key, { ...first, body: "keep" }); draftFromTurn(ref);
    expect(useNoteDrafts.getState().drafts[key]?.body).toBe("keep");
    expect(turnDraftKey("local", "s", "t")).not.toBe(key);
    expect(newDraft({ kind: "host" }).anchor).toBeNull();
    setNoteDraft(key, null);
    const active = useNoteFloat.getState().active;
    if (active) closeTurnNotes(active.id);
  });
});

describe("turn note floating window", () => {
  it("opens the requested host/turn and retains its draft when dismissed and reopened", () => {
    const ref = turnRef({ hostId: "remote", sessionId: "float-session", turnId: "float-turn" });
    const key = turnDraftKey("remote", "float-session", "float-turn");
    draftFromTurn(ref);
    const first = useNoteFloat.getState().active!;
    expect(first).toMatchObject({ hostId: "remote", sessionId: "float-session", turnId: "float-turn", editing: true });
    setNoteDraft(key, { ...useNoteDrafts.getState().drafts[key]!, body: "unfinished annotation" });
    closeTurnNotes(first.id);
    expect(useNoteFloat.getState().active).toBeNull();
    expect(useNoteDrafts.getState().drafts[key]?.body).toBe("unfinished annotation");
    draftFromTurn(ref);
    expect(useNoteFloat.getState().active?.id).not.toBe(first.id);
    expect(useNoteDrafts.getState().drafts[key]?.body).toBe("unfinished annotation");
    closeTurnNotes(useNoteFloat.getState().active!.id); setNoteDraft(key, null);
  });
  it("a stale dismissal or save completion cannot close or change a newer window", () => {
    openTurnNotes("local", "s", "one", true);
    const first = useNoteFloat.getState().active!;
    openTurnNotes("local", "s", "two", true);
    const second = useNoteFloat.getState().active!;
    closeTurnNotes(first.id); finishTurnNote(first.id);
    expect(useNoteFloat.getState().active).toBe(second);
    finishTurnNote(second.id);
    expect(useNoteFloat.getState().active).toMatchObject({ id: second.id, turnId: "two", editing: false });
    closeTurnNotes(second.id);
  });
  it.each([
    [{ width: 1440, height: 900 }, { left: 256, right: 1000, top: 40, bottom: 760 }, { right: 940, bottom: 600 }],
    [{ width: 1440, height: 900 }, { left: 256, right: 700, top: 40, bottom: 760 }, { right: 676, bottom: 180 }],
    [{ width: 320, height: 480 }, { left: 0, right: 320, top: 40, bottom: 420 }, { right: 296, bottom: 410 }],
  ])("bottom-aligns before the next turn within the conversation, growing upwards: %j", (viewport, bounds, anchor) => {
    const position = noteFloatPosition(viewport, bounds, anchor)!;
    expect(position).not.toBeNull(); expect(position.width).toBeLessThanOrEqual(480);
    expect(viewport.height - position.bottom).toBe(anchor.bottom - 8);
    expect(viewport.height - position.bottom - position.maxHeight).toBeGreaterThanOrEqual(bounds.top + 8);
    expect(position.left).toBeGreaterThanOrEqual(bounds.left + 8);
    expect(position.left + position.width).toBeLessThanOrEqual(bounds.right - 8);
    expect(position).not.toHaveProperty("top");
  });
  it("tracks the tail rather than sticking to a viewport edge when scrolling", () => {
    const viewport = { width: 1000, height: 900 }, bounds = { left: 256, right: 900, top: 40, bottom: 760 };
    const before = noteFloatPosition(viewport, bounds, { right: 850, bottom: 600 })!;
    const after = noteFloatPosition(viewport, bounds, { right: 850, bottom: 500 })!;
    expect(after.bottom - before.bottom).toBe(100);
    expect(noteFloatPosition(viewport, bounds, { right: 850, bottom: 800 })).toBeNull();
    expect(noteFloatPosition(viewport, bounds, { right: 850, bottom: 50 })).toBeNull();
  });
  it("includes the entire turn, not only its first input row, and handles the last turn", () => {
    const markers = [null, "one", null, null, "two", null, "three", null, null];
    expect(noteTurnRange(markers, "one")).toEqual({ start: 1, end: 3, next: 4 });
    expect(noteTurnRange(markers, "three")).toEqual({ start: 6, end: 8, next: null });
    expect(noteTurnRange(markers, "gone")).toBeNull();
  });
  it("uses the existing zero-reservation overlay slot; no inline editor or expanded body", () => {
    const source = (file: string) => readFileSync(new URL(`../src/renderer/src/modules/notes/${file}`, import.meta.url), "utf8");
    const turn = source("TurnNotes.tsx"), float = source("NoteFloat.tsx");
    expect(turn).toContain("openTurnNotes"); expect(turn).not.toContain("NoteEditor"); expect(turn).not.toContain("NoteCard");
    expect(source("index.ts")).toContain('"conversation.overlay": [{ id: "notes.floating", Overlay: NoteFloatHost }]');
    expect(float).toContain("createPortal"); expect(float).toContain("reserve(null)");
    expect(float).toContain('aria-modal="false"'); expect(float).toContain("useTrackOverlay(true)");
    for (const guard of ["event.defaultPrevented", "event.repeat", "event.isComposing", "event.ctrlKey", "event.altKey", "event.metaKey", "event.shiftKey"]) expect(float).toContain(guard);
    expect(float).not.toContain("stopPropagation");
    expect(source("NoteCard.tsx")).toContain("onDismiss={onDismissEditor}");
  });
});

describe("host-bound cache and concurrent edits", () => {
  it("normalizes query identity and partitions even same note ids by host", async () => {
    expect(notesQueryKey("h", {}, false)).toBe(notesQueryKey("h", { scope: "host", query: "", pinnedOnly: false }, false));
    const local = client({ notesGet: vi.fn().mockResolvedValue(note("same", { body: "local" })) });
    const remote = client({ notesGet: vi.fn().mockResolvedValue(note("same", { body: "remote" })) });
    const cache = createNotesCache((h) => h === "local" ? local : remote);
    await Promise.all([cache.refreshNote("local", "same"), cache.refreshNote("remote", "same")]);
    expect(cache.getNote("local", "same").note?.body).toBe("local"); expect(cache.getNote("remote", "same").note?.body).toBe("remote");
  });
  it("reads all session pages for turn attachments and deduplicates repeated notes", async () => {
    const c = client({ notesList: vi.fn(async (q?: NotesQuery) => q?.cursor ? { notes: [note("a"), note("b")], nextCursor: null } : { notes: [note("a")], nextCursor: "2" }) });
    const cache = createNotesCache(() => c); await cache.refresh("remote", { scope: "session", id: "s" }, true);
    expect(cache.get("remote", { scope: "session", id: "s" }, true).notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(c.notesList).toHaveBeenLastCalledWith({ scope: "session", id: "s", limit: 100, cursor: "2" });
  });
  it("in-flight stale list replies cannot overwrite a changed note", async () => {
    const pending = deferred<{ notes: Note[]; nextCursor: null }>();
    const c = client({ notesList: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ notes: [note("new")], nextCursor: null }) });
    const cache = createNotesCache(() => c), off = cache.subscribe("h", {}, false, () => {});
    await settle(); cache.invalidate("h", "new");
    pending.resolve({ notes: [note("old")], nextCursor: null }); await settle();
    expect(cache.get("h", {}).notes.map((n) => n.id)).toEqual(["new"]); off();
  });
  it("remount while a stale request is pending still refreshes", async () => {
    const pending = deferred<{ notes: Note[]; nextCursor: null }>();
    const c = client({ notesList: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ notes: [note("fresh")], nextCursor: null }) });
    const cache = createNotesCache(() => c), off = cache.subscribe("h", {}, false, () => {}); await settle(); off(); cache.invalidate("h");
    const off2 = cache.subscribe("h", {}, false, () => {}); pending.resolve({ notes: [note("stale")], nextCursor: null }); await settle();
    expect(cache.get("h", {}).notes[0]?.id).toBe("fresh"); off2();
  });
  it("host invalidation refreshes only that host and single-note reads", async () => {
    const a = client(), b = client(); const cache = createNotesCache((h) => h === "a" ? a : b);
    const stops = [cache.subscribe("a", {}, false, () => {}), cache.subscribeNote("a", "n", () => {}), cache.subscribe("b", {}, false, () => {})];
    await settle(); cache.invalidate("a", "n"); await settle();
    expect(a.notesGet).toHaveBeenCalledTimes(2); expect(a.notesList).toHaveBeenCalledTimes(2); expect(b.notesList).toHaveBeenCalledTimes(1); stops.forEach((f) => f());
  });
  it("CAS failure reloads server state but does not discard the draft or rewrite the revision", async () => {
    const c = client({ notesUpdate: vi.fn().mockRejectedValue(new Error("note_revision_conflict")) });
    const cache = createNotesCache(() => c), off = cache.subscribeNote("h", "n", () => {}); await settle();
    const draft = { ...newDraft({ kind: "session", id: "s" }), body: "mine", revision: 1 }; setNoteDraft("cas", draft);
    await expect(cache.update("h", "n", { expectedRevision: 1, body: "mine" })).rejects.toThrow("note_revision_conflict"); await settle();
    expect(c.notesGet).toHaveBeenCalledTimes(2); expect(useNoteDrafts.getState().drafts.cas).toBe(draft); off(); setNoteDraft("cas", null);
  });
  it("deletion clears a cached note; failed reads are recoverable", async () => {
    const c = client(), cache = createNotesCache(() => c); const off = cache.subscribeNote("h", "n", () => {}); await settle();
    vi.mocked(c.notesGet).mockRejectedValueOnce(new Error("note_not_found")); await cache.remove("h", note()); await settle();
    expect(cache.getNote("h", "n").note).toBeNull(); expect(cache.getNote("h", "n").error).toContain("note_not_found");
    await cache.refreshNote("h", "n"); expect(cache.getNote("h", "n").note?.id).toBe("n"); off();
  });
  it("synchronous unavailable-host errors do not leave a stuck loading request", async () => {
    let fail = true; const c = client(); const cache = createNotesCache(() => { if (fail) throw new Error("host-offline"); return c; });
    await cache.refresh("h", {}); expect(cache.get("h", {}).loading).toBe(false); fail = false; await cache.refresh("h", {}); expect(cache.get("h", {}).error).toBeNull();
  });
  it("repeated cursors report an error instead of an endless pagination loop", async () => {
    const cache = createNotesCache(() => client({ notesList: vi.fn().mockResolvedValue({ notes: [], nextCursor: "again" }) }));
    await cache.refresh("h", {}, true); expect(cache.get("h", {}, true).error).toContain("repeated cursor");
  });
  it("host event lifecycle invalidates the event host and unsubscribes on module stop", () => {
    const controller = new AbortController(), invalid = vi.spyOn(notesCache, "invalidate");
    startNotesSync({ signal: controller.signal } as Parameters<typeof startNotesSync>[0]);
    env.listeners.at(-1)!({ hostId: "remote", envelope: { cutex: { method: "cutex/note/changed", params: { noteId: "n", change: "anchor" } } } });
    expect(invalid).toHaveBeenCalledWith("remote", "n", false); controller.abort(); expect(env.off).toHaveBeenCalled(); invalid.mockRestore();
  });
});

describe("Notes preview daemon", () => {
  it("aggregates unpinned notes, distinguishes pins, gets by id and emits host changes", async () => {
    const emitHost = vi.fn(); const api = mock.api!({ emitHost } as unknown as MockCore);
    const all = await api.notesList!({ scope: "project", id: "desktop" });
    expect(all.notes.some((n) => !n.pins.length)).toBe(true);
    const pinned = await api.notesList!({ scope: "project", id: "desktop", pinnedOnly: true }); expect(pinned.notes).toHaveLength(1);
    expect((await api.notesGet!("note-preview-2")).anchorState).toBe("reverted");
    const input = { clientNonce: "retry", title: "T", body: "B", scope: { kind: "session" as const, id: "eva" } };
    const created = await api.notesCreate!(input); expect((await api.notesCreate!(input)).id).toBe(created.id);
    expect(emitHost).toHaveBeenCalledWith("cutex/note/changed", expect.objectContaining({ noteId: created.id, change: "created" }));
    await api.notesUpdate!(created.id, { expectedRevision: 1, pins: [{ kind: "host" }] });
    await expect(api.notesDelete!(created.id, 1)).rejects.toThrow("note_revision_conflict");
  });
});
