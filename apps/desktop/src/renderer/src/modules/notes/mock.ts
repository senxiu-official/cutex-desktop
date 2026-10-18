import { NOTE_CHANGED_EVENT, type Note, type NoteScope } from "../../../../shared/notes";
import type { ModuleMock } from "../../dev/mockTypes";

/** Preview only. Real aggregation and revision checks live in Cutex. */
export const mock: ModuleMock = {
  features: { new: ["notes"] },
  api: (core) => {
    const now = new Date().toISOString();
    const notes = new Map<string, Note>([
      ["note-preview-1", { id: "note-preview-1", title: "旁注与聊天分开", body: "这份批注不会进入主对话的上下文。\n\n- 默认保留在会话中\n- 项目和主机可以汇总找到\n- 标记只影响查找，不改变来源", scope: { kind: "session", id: "eva" }, anchor: { sessionId: "eva", threadId: "thread-eva", turnId: "turn-1" }, pins: [], anchorState: "ok", anchorStateAt: null, revision: 1, createdAt: now, updatedAt: now }],
      ["note-preview-2", { id: "note-preview-2", title: "后续核对事项", body: "验证回退不会删除批注，取消标记后批注仍在全部列表中。", scope: { kind: "session", id: "eva" }, anchor: { sessionId: "eva", threadId: "thread-eva", turnId: "reverted-preview-turn" }, pins: [{ kind: "project", id: "desktop" }, { kind: "host" }], anchorState: "reverted", anchorStateAt: now, revision: 1, createdAt: now, updatedAt: now }],
      ["note-preview-3", { id: "note-preview-3", title: "项目备忘", body: "独立批注不需要先开侧边对话。", scope: { kind: "project", id: "desktop" }, anchor: null, pins: [], anchorState: "ok", anchorStateAt: null, revision: 1, createdAt: now, updatedAt: now }],
    ]);
    const nonces = new Map<string, string>();
    const membership: Record<string, string> = { eva: "desktop", alden: "desktop", mika: "desktop", rei: "desktop", old1: "desktop", wave: "waveline" };
    const same = (a: NoteScope, b: NoteScope) => a.kind === b.kind && (a.kind === "host" || b.kind !== "host" && a.id === b.id);
    const pinMatches = (note: Note, scope: NoteScope) => note.pins.some((pin) => same(pin, scope));
    const get = (id: string, revision: number) => {
      const note = notes.get(id);
      if (!note) throw new Error("note_not_found");
      if (note.revision !== revision) throw new Error("note_revision_conflict");
      return note;
    };
    const changed = (note: Note, change: string) => core.emitHost(NOTE_CHANGED_EVENT, { noteId: note.id, change, revision: note.revision, scope: note.scope, anchor: note.anchor });
    return {
      async notesGet(id) { const note = notes.get(id); if (!note) throw new Error("note_not_found"); return structuredClone(note); },
      async notesList(query = {}) {
        const scope: NoteScope = query.scope === "session" || query.scope === "project" ? { kind: query.scope, id: query.id ?? "" } : { kind: "host" };
        const search = query.query?.toLocaleLowerCase().trim();
        const matches = [...notes.values()].filter((note) => {
          const natural = scope.kind === "host" || same(note.scope, scope)
            || scope.kind === "session" && note.anchor?.sessionId === scope.id
            || scope.kind === "project" && note.scope.kind === "session" && membership[note.scope.id] === scope.id;
          if (!(natural || pinMatches(note, scope))) return false;
          if (query.pinnedOnly && !pinMatches(note, scope)) return false;
          return !search || `${note.title}\n${note.body}`.toLocaleLowerCase().includes(search);
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const offset = Math.max(0, Number(query.cursor) || 0);
        const end = offset + (query.limit ?? 100);
        return { notes: structuredClone(matches.slice(offset, end)), nextCursor: end < matches.length ? String(end) : null };
      },
      async notesCreate(input) {
        const existingId = nonces.get(input.clientNonce);
        if (existingId) {
          const existing = notes.get(existingId);
          if (!existing) throw new Error("note_already_deleted");
          return structuredClone(existing);
        }
        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const note: Note = { id, title: input.title, body: input.body, scope: input.scope, pins: input.pins ?? [], anchor: input.anchor ?? null, anchorState: "ok", anchorStateAt: null, revision: 1, createdAt, updatedAt: createdAt };
        notes.set(id, structuredClone(note));
        nonces.set(input.clientNonce, id);
        changed(note, "created");
        return note;
      },
      async notesUpdate(id, patch) {
        const previous = get(id, patch.expectedRevision);
        const note: Note = { ...previous, title: patch.title ?? previous.title, body: patch.body ?? previous.body, pins: patch.pins ?? previous.pins, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
        notes.set(id, structuredClone(note));
        changed(note, "updated");
        return note;
      },
      async notesDelete(id, expectedRevision) {
        const note = get(id, expectedRevision);
        notes.delete(id);
        changed(note, "deleted");
        return { deleted: true };
      },
    };
  },
};
