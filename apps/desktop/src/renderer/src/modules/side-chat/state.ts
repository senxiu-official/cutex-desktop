import { create } from "zustand";
import { SIDE_FORK_BLOCKED, type SideChat, type SideOpenInput, type SideReply } from "../../../../shared/sideChat";
import { NOTE_BODY_LIMIT, type NoteAnchor, type NoteCreate } from "../../../../shared/notes";
import { useApp, viewOf } from "../../store";
import { timelineFromThreadRead } from "../../lib/timeline";
import { services } from "../app";
import { completedSummary, sideTimeline } from "./model";
import { SideForkBlockedError } from "./errors";

export interface SummaryJob {
  nonce: string; turnId: string | null; status: "requesting" | "generating" | "saving" | "saved" | "failed";
  noteId?: string; input?: NoteCreate; error?: string; prompt: string; anchorMode: string;
}
export interface SideView {
  chat: SideChat; draft: string; sending: boolean; error: string | null; summary: SummaryJob | null;
  pendingMessage: { text: string; clientMessageId: string } | null;
  unread: boolean; parentThreadId?: string;
}
export const sideKey = (hostId: string, chatId: string) => `${hostId}\0${chatId}`;
export const useSides = create<{ views: Record<string, SideView> }>(() => ({ views: {} }));
let live = true, epoch = 0;
const visible = new Map<string, number>();
const watches = new Map<string, object>();
const opens = new Map<string, Promise<string>>();
const closing = new Set<string>();
const leases = new Map<string, object>();
function lease(key: string) { const token = leases.get(key) ?? {}; leases.set(key, token); return token; }
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export const isSideGone = (e: unknown) => /side_chat_not_found|side_chat_stale/.test(errorText(e));
function patch(key: string, fields: Partial<SideView>) {
  const prior = useSides.getState().views[key];
  if (prior && prior.chat.status !== "closed") useSides.setState(s => ({ views: { ...s.views, [key]: { ...prior, ...fields } } }));
}
/** A failed call: a chat the host no longer has (e.g. a Claude adapter restart) turns stale, else the error shows. */
function fail(key: string, e: unknown) {
  const view = useSides.getState().views[key];
  if (isSideGone(e) && view) patch(key, { chat: { ...view.chat, status: "stale" } });
  else patch(key, { error: errorText(e) });
}
export function sideModuleActive(active: boolean) { live = active; epoch++; watches.clear(); }
export function setSideDraft(hostId: string, chatId: string, draft: string) { patch(sideKey(hostId, chatId), { draft }); }
export function receiveSide(hostId: string, chat: SideChat) {
  const key = sideKey(hostId, chat.id), old = useSides.getState().views[key];
  if (old?.chat.status === "closed" || (old && chat.revision < old.chat.revision)) return;
  lease(key);
  const newReply = chat.events.some(e => e.seq > (old?.chat.events.at(-1)?.seq ?? 0) && ["item/agentMessage/delta", "item/completed"].includes(e.method));
  const app = useApp.getState();
  const parentThreadId = old?.parentThreadId ?? (viewOf(app, hostId, chat.sessionId)?.timeline.threadId ?? undefined);
  useSides.setState(s => ({ views: { ...s.views, [key]: { ...(old ?? { draft: "", sending: false, summary: null, pendingMessage: null }), chat, error: null, parentThreadId,
    unread: visible.has(key) ? false : !!old?.unread || newReply } } }));
  void saveSummary(hostId, chat.id);
}

/** Only visible cards start polls. An already-issued read can settle after hide and mark unread. */
export function watchSide(hostId: string, chatId: string) {
  const key = sideKey(hostId, chatId);
  if (watches.has(key) || !live || !visible.has(key)) return;
  const token = {}, generation = epoch; watches.set(key, token);
  void (async () => {
    try {
      while (live && generation === epoch && visible.has(key) && watches.get(key) === token) {
        const view = useSides.getState().views[key];
        if (!view || view.chat.status === "closed" || view.chat.status === "stale") break;
        const { chat } = await services.daemonFor(hostId).sideRead(view.chat.sessionId, chatId, view.chat.revision, 25_000);
        if (!live || generation !== epoch || watches.get(key) !== token) break;
        receiveSide(hostId, chat);
      }
    } catch (e) {
      if (generation === epoch) {
        fail(key, e);
      }
    } finally { if (watches.get(key) === token) watches.delete(key); }
  })();
}
export function showSide(hostId: string, chatId: string): () => void {
  const key = sideKey(hostId, chatId);
  visible.set(key, (visible.get(key) ?? 0) + 1); patch(key, { unread: false }); watchSide(hostId, chatId);
  return () => { const count = visible.get(key) ?? 1; if (count === 1) visible.delete(key); else visible.set(key, count - 1); };
}
export async function loadSide(hostId: string, sessionId: string, chatId: string): Promise<void> {
  const key = sideKey(hostId, chatId), token = lease(key);
  const { chat } = await services.daemonFor(hostId).sideRead(sessionId, chatId);
  if (leases.get(key) !== token) return;
  receiveSide(hostId, chat);
  watchSide(hostId, chatId);
}
/** The instance owns an in-flight open even if its Body unmounts. Close waits and reclaims it. */
export function openSideChat(instanceId: string, hostId: string, sessionId: string, input: SideOpenInput = {}, initialText = ""): Promise<string> {
  const existing = opens.get(instanceId); if (existing) return existing;
  const promise = (async () => {
    const result = await services.daemonFor(hostId).sideOpen(sessionId, input);
    let chat: SideChat;
    if ("chat" in result) chat = result.chat;
    else if (result.error.code === SIDE_FORK_BLOCKED) throw new SideForkBlockedError(result.error.details.blockedBy);
    else chat = (await services.daemonFor(hostId).sideRead(sessionId, result.error.details.chatId)).chat;
    receiveSide(hostId, chat);
    if (initialText.trim() && !closing.has(instanceId)) {
      setSideDraft(hostId, chat.id, initialText);
      // Reattaching never silently sends a question to a different existing discussion.
      if ("chat" in result) void sendSide(hostId, chat.id);
    }
    return chat.id;
  })();
  opens.set(instanceId, promise);
  void promise.catch(() => { if (opens.get(instanceId) === promise) opens.delete(instanceId); });
  return promise;
}
export async function closeSideInstance(instanceId: string, hostId: string, sessionId: string, chatId?: string): Promise<boolean> {
  closing.add(instanceId);
  try {
    try { chatId ??= await opens.get(instanceId); }
    catch { opens.delete(instanceId); return true; }
    if (chatId && !await closeSideChat(hostId, sessionId, chatId)) return false;
    opens.delete(instanceId); return true;
  } finally { closing.delete(instanceId); }
}
export async function sendSide(hostId: string, chatId: string): Promise<void> {
  const key = sideKey(hostId, chatId), view = useSides.getState().views[key];
  if (!view || view.sending || (view.chat.status !== "ready" && !(view.pendingMessage && view.chat.status === "running")) || !view.draft.trim()) return;
  const pendingMessage = view.pendingMessage ?? { text: view.draft, clientMessageId: crypto.randomUUID() };
  const token = lease(key);
  patch(key, { sending: true, error: null, pendingMessage });
  try {
    const { chat } = await services.daemonFor(hostId).sideSend(view.chat.sessionId, chatId, pendingMessage);
    if (leases.get(key) !== token) return;
    receiveSide(hostId, chat);
    patch(key, { pendingMessage: null });
    if (useSides.getState().views[key]?.draft === pendingMessage.text) patch(key, { draft: "" });
    watchSide(hostId, chatId);
  } catch (e) { fail(key, e); }
  finally { patch(key, { sending: false }); }
}
export async function interruptSide(hostId: string, chatId: string) {
  const key = sideKey(hostId, chatId), view = useSides.getState().views[key]; if (!view) return;
  const token = lease(key);
  try { const { chat } = await services.daemonFor(hostId).sideInterrupt(view.chat.sessionId, chatId); if (leases.get(key) === token) receiveSide(hostId, chat); }
  catch (e) { fail(key, e); }
}
export async function respondSide(hostId: string, chatId: string, requestId: string | number, reply: SideReply) {
  const key = sideKey(hostId, chatId), view = useSides.getState().views[key]; if (!view) return;
  const token = lease(key);
  try { const { chat } = await services.daemonFor(hostId).sideRespond(view.chat.sessionId, chatId, requestId, reply); if (leases.get(key) === token) receiveSide(hostId, chat); }
  catch (e) { fail(key, e); }
}
export async function closeSideChat(hostId: string, sessionId: string, chatId: string): Promise<boolean> {
  const key = sideKey(hostId, chatId);
  try { await services.daemonFor(hostId).sideClose(sessionId, chatId); }
  catch (e) { if (!isSideGone(e)) { patch(key, { error: errorText(e) }); return false; } }
  watches.delete(key);
  leases.delete(key);
  const view = useSides.getState().views[key];
  if (view) patch(key, { chat: { ...view.chat, status: "closed", events: [], pendingRequests: [], activeTurnId: null }, draft: "", pendingMessage: null, summary: null, error: null, unread: false });
  // A small bounded UI tombstone, never a retained transcript. In-flight leases above still reject
  // their late responses after the tombstone is evicted.
  useSides.setState(s => {
    const closed = Object.keys(s.views).filter(k => s.views[k]!.chat.status === "closed");
    const evicted = new Set(closed.slice(0, Math.max(0, closed.length - 128)));
    return evicted.size ? { views: Object.fromEntries(Object.entries(s.views).filter(([k]) => !evicted.has(k))) } : s;
  });
  return true;
}
export async function summarizeSide(hostId: string, chatId: string, prompt: string, anchorMode = "start") {
  const key = sideKey(hostId, chatId), view = useSides.getState().views[key];
  const retryRequest = view?.summary?.status === "failed" && !view.summary.turnId;
  if (!view || (view.chat.status !== "ready" && !(retryRequest && view.chat.status === "running")) || view.sending || view.pendingMessage) return;
  if (view.summary && ["requesting", "generating", "saving"].includes(view.summary.status)) return;
  if (view.summary?.status === "failed" && view.summary.turnId && !["no-summary", "note-too-long"].includes(view.summary.error ?? "")) { await saveSummary(hostId, chatId, true); return; }
  const nonce = retryRequest ? view.summary!.nonce : crypto.randomUUID();
  const job: SummaryJob = { nonce, prompt: retryRequest ? view.summary!.prompt : prompt, anchorMode: retryRequest ? view.summary!.anchorMode : anchorMode, turnId: null, status: "requesting" };
  const token = lease(key);
  patch(key, { summary: job });
  try {
    const { chat, turnId } = await services.daemonFor(hostId).sideSend(view.chat.sessionId, chatId, { text: job.prompt, clientMessageId: nonce });
    if (leases.get(key) !== token) return;
    patch(key, { summary: { ...job, turnId, status: "generating" } }); receiveSide(hostId, chat);
    // The completion can arrive before the acknowledgement, whose older revision is discarded.
    void saveSummary(hostId, chatId); watchSide(hostId, chatId);
  } catch (e) { patch(key, { summary: { ...job, status: "failed", error: errorText(e) } }); }
}
async function summaryAnchor(hostId: string, view: SideView, mode: string): Promise<NoteAnchor> {
  let threadId = view.parentThreadId, turnId = view.chat.anchorTurnId ?? view.chat.forkedThroughTurnId;
  if (!threadId || mode === "latest") {
    const history = await services.daemonFor(hostId).history(view.chat.sessionId, null, 1);
    if (!history) throw new Error("parent-history-unavailable");
    const timeline = timelineFromThreadRead(history.native.result);
    threadId ??= timeline.threadId ?? history.threadId;
    if (mode === "latest") { threadId = timeline.threadId ?? history.threadId; turnId = timeline.turns.at(-1)?.id ?? null; }
  }
  return { sessionId: view.chat.sessionId, ...(threadId ? { threadId } : {}), ...(turnId ? { turnId } : {}) };
}
async function saveSummary(hostId: string, chatId: string, retry = false) {
  const key = sideKey(hostId, chatId), view = useSides.getState().views[key], job = view?.summary;
  if (!view || !job || (!retry && job.status !== "generating")) return;
  let input = job.input;
  const result = !input && job.turnId ? completedSummary(view.chat, job.turnId) : null;
  if (!input && !result) {
    const turn = sideTimeline(view.chat).turns.find(t => t.id === job.turnId);
    if (turn && turn.status !== "inProgress") patch(key, { summary: { ...job, status: "failed", error: "no-summary" } });
    return;
  }
  if (result && result.body.length > NOTE_BODY_LIMIT) { patch(key, { summary: { ...job, status: "failed", error: "note-too-long" } }); return; }
  // Claim before the first await so duplicate reads/acks cannot issue concurrent note writes.
  patch(key, { summary: { ...job, status: "saving", error: undefined } });
  try {
    input ??= { ...result!, clientNonce: `side-note:${chatId}:${job.nonce}`, scope: { kind: "session", id: view.chat.sessionId }, pins: [], anchor: await summaryAnchor(hostId, view, job.anchorMode) };
    patch(key, { summary: { ...job, input, status: "saving" } });
    const note = await services.daemonFor(hostId).notesCreate(input);
    patch(key, { summary: { ...job, input, status: "saved", noteId: note.id } });
  } catch (e) { patch(key, { summary: { ...job, input, status: "failed", error: errorText(e) } }); }
}
