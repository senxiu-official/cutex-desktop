// Narrow, validated owner APIs. Never forward arbitrary native methods/thread ids from renderer.
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import type { DaemonApi } from "../shared/ipc";
import { NOTE_BODY_LIMIT, NOTE_TITLE_LIMIT, type NoteAnchor, type NoteScope } from "../shared/notes";
import { SIDE_FORK_BLOCKED, SIDE_MESSAGE_LIMIT } from "../shared/sideChat";

export function scopeId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value) || value === "." || value === "..") throw new Error("invalid resource id");
  return value;
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || value.includes("\0")) throw new Error("invalid text");
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("invalid revision");
  return value;
}
function modelName(value: unknown): string {
  const model = text(value, 200);
  if (Buffer.byteLength(model, "utf8") > 200 || /[\u0000-\u001f\u007f]/.test(model)) throw new Error("invalid model");
  return model;
}
function scope(value: NoteScope): NoteScope {
  if (value?.kind === "host") return { kind: "host" };
  if (value?.kind === "session" || value?.kind === "project") return { kind: value.kind, id: scopeId(value.id) };
  throw new Error("invalid note scope");
}
function pins(values: NoteScope[]): NoteScope[] {
  if (!Array.isArray(values) || values.length > 64) throw new Error("invalid pins");
  return values.map(scope);
}
function anchor(value: NoteAnchor | null | undefined): NoteAnchor | null {
  return value == null ? null : {
    sessionId: scopeId(value.sessionId),
    ...(value.threadId === undefined ? {} : { threadId: scopeId(value.threadId) }),
    ...(value.turnId === undefined ? {} : { turnId: scopeId(value.turnId) }),
  };
}
const notePath = (id: string) => `/v2/notes/${encodeURIComponent(scopeId(id))}`;
const sidePath = (sessionId: string, chatId?: string) => `/v2/sessions/${encodeURIComponent(scopeId(sessionId))}/side-chats${chatId === undefined ? "" : `/${encodeURIComponent(scopeId(chatId))}`}`;

export function notesApi(client: CutexClient): Pick<DaemonApi, "notesList" | "notesGet" | "notesCreate" | "notesUpdate" | "notesDelete"> {
  return {
    notesGet(id) { return client.request("GET", notePath(id)); },
    notesList(q = {}) {
      if (q.scope !== undefined && !["session", "project", "host"].includes(q.scope)) throw new Error("invalid query scope");
      if (q.limit !== undefined && (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 200)) throw new Error("invalid limit");
      return client.request("GET", "/v2/notes", { query: {
        scope: q.scope, id: q.id === undefined ? undefined : scopeId(q.id),
        pinnedOnly: q.pinnedOnly ? "true" : undefined,
        query: q.query === undefined ? undefined : text(q.query, 500, true),
        cursor: q.cursor === undefined ? undefined : text(q.cursor, 500), limit: q.limit,
      } });
    },
    notesCreate(input) {
      return client.request("POST", "/v2/notes", { body: {
        clientNonce: text(input?.clientNonce, 128), title: text(input?.title, NOTE_TITLE_LIMIT, true),
        body: text(input?.body, NOTE_BODY_LIMIT), scope: scope(input?.scope),
        pins: pins(input.pins ?? []), anchor: anchor(input.anchor),
      } });
    },
    notesUpdate(id, patch) {
      return client.request("PATCH", notePath(id), { body: {
        expectedRevision: revision(patch?.expectedRevision),
        ...(patch.title === undefined ? {} : { title: text(patch.title, NOTE_TITLE_LIMIT, true) }),
        ...(patch.body === undefined ? {} : { body: text(patch.body, NOTE_BODY_LIMIT) }),
        ...(patch.pins === undefined ? {} : { pins: pins(patch.pins) }),
      } });
    },
    notesDelete(id, expectedRevision) {
      return client.request("DELETE", notePath(id), { body: { expectedRevision: revision(expectedRevision) } });
    },
  };
}

export function sideApi(client: CutexClient): Pick<DaemonApi, "sideOpen" | "sideList" | "sideRead" | "sideSend" | "sideInterrupt" | "sideRespond" | "sideClose"> {
  return {
    async sideOpen(sessionId, input = {}) {
      try { return await client.request("POST", sidePath(sessionId), { body: {
        ...(input.anchorTurnId === undefined ? {} : { anchorTurnId: scopeId(input.anchorTurnId) }),
        ...(input.lastTurnId === undefined ? {} : { lastTurnId: scopeId(input.lastTurnId) }),
        ...(input.model === undefined ? {} : { model: modelName(input.model) }),
      } }); } catch (error) {
        if (error instanceof CutexApiError && error.code === "side_chat_already_open") {
          const details = error.details as { chatId?: unknown; anchorTurnId?: unknown } | null;
          return { error: { code: "side_chat_already_open", message: error.message, details: {
            chatId: scopeId(details?.chatId), anchorTurnId: details?.anchorTurnId == null ? null : scopeId(details.anchorTurnId),
          } } };
        }
        if (error instanceof CutexApiError && error.code === SIDE_FORK_BLOCKED) {
          const details = (error.details ?? {}) as { blockedBy?: unknown; blockingAsks?: unknown; externalInput?: unknown };
          return { error: { code: SIDE_FORK_BLOCKED, message: error.message, details: {
            blockedBy: details.blockedBy === "held" ? "held" : "busy",
            asks: Array.isArray(details.blockingAsks) ? details.blockingAsks.length : 0,
            messages: Array.isArray(details.externalInput) ? details.externalInput.length : 0,
          } } };
        }
        throw error;
      }
    },
    sideList(sessionId) { return client.request("GET", sidePath(sessionId)); },
    sideRead(sessionId, chatId, afterRevision, waitMs = 0) {
      if (afterRevision !== undefined && (!Number.isSafeInteger(afterRevision) || afterRevision < 0)) throw new Error("invalid revision");
      if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 25_000) throw new Error("invalid wait");
      return client.request("GET", sidePath(sessionId, chatId), { query: { afterRevision, waitMs } });
    },
    sideSend(sessionId, chatId, input) {
      const message = text(input?.text, SIDE_MESSAGE_LIMIT);
      if (Buffer.byteLength(message, "utf8") > 65_536) throw new Error("Side message exceeds 65536 UTF-8 bytes");
      return client.request("POST", `${sidePath(sessionId, chatId)}/messages`, { body: {
        text: message, clientMessageId: text(input?.clientMessageId, 128),
      } });
    },
    sideInterrupt(sessionId, chatId) { return client.request("POST", `${sidePath(sessionId, chatId)}/interrupt`, { body: {} }); },
    sideRespond(sessionId, chatId, requestId, reply) {
      if (!((typeof requestId === "number" && Number.isSafeInteger(requestId)) || (typeof requestId === "string" && requestId.length > 0 && requestId.length <= 200))) throw new Error("invalid request id");
      if (!reply || typeof reply !== "object" || ("result" in reply) === ("error" in reply)) throw new Error("invalid response");
      if ("error" in reply && (!reply.error || !Number.isSafeInteger(reply.error.code))) throw new Error("invalid error code");
      if (JSON.stringify(reply).length > 64_000) throw new Error("response too large");
      return client.request("POST", `${sidePath(sessionId, chatId)}/responses`, { body: {
        requestId, ...("result" in reply ? { result: reply.result } : { error: { code: reply.error.code, message: text(reply.error.message, 1000) } }),
      } });
    },
    sideClose(sessionId, chatId) { return client.request("DELETE", sidePath(sessionId, chatId)); },
  };
}
