import type { SideChat, SideEvent } from "../../../../shared/sideChat";
import type { ModuleMock } from "../../dev/mockTypes";

/** Entirely separate from MockCore.nativeEvent: even preview Side must never change main history. */
export const mock: ModuleMock = {
  features: { new: ["side-chat"] },
  api: core => {
    const chats = new Map<string, SideChat>();
    const waiters = new Map<string, Set<() => void>>();
    const messages = new Map<string, string>();
    const get = (sessionId: string, chatId: string) => {
      const chat = chats.get(chatId);
      if (!chat || chat.sessionId !== sessionId) throw new Error("side_chat_not_found");
      return chat;
    };
    const copy = (chat: SideChat) => ({ chat: structuredClone(chat) });
    const changed = (chat: SideChat) => {
      chat.revision++; chat.updatedAt = new Date().toISOString();
      for (const resolve of waiters.get(chat.id) ?? []) resolve();
      waiters.delete(chat.id);
    };
    const event = (chat: SideChat, method: string, params: unknown) => {
      const e: SideEvent = { seq: (chat.events.at(-1)?.seq ?? 0) + 1, method, params };
      chat.events.push(e); changed(chat);
    };
    const finish = (chat: SideChat, turnId: string, answer: string) => {
      if (chat.status !== "running" || chat.activeTurnId !== turnId) return;
      event(chat, "item/started", { threadId: chat.threadId, turnId, item: { id: `${turnId}-reply`, type: "agentMessage", text: "" } });
      const midpoint = Math.floor(answer.length / 2);
      event(chat, "item/agentMessage/delta", { threadId: chat.threadId, turnId, itemId: `${turnId}-reply`, delta: answer.slice(0, midpoint) });
      setTimeout(() => {
        if (chat.status !== "running" || chat.activeTurnId !== turnId) return;
        event(chat, "item/agentMessage/delta", { threadId: chat.threadId, turnId, itemId: `${turnId}-reply`, delta: answer.slice(midpoint) });
        event(chat, "item/completed", { threadId: chat.threadId, turnId, item: { id: `${turnId}-reply`, type: "agentMessage", text: answer } });
        chat.status = "ready"; chat.activeTurnId = null;
        event(chat, "turn/completed", { threadId: chat.threadId, turn: { id: turnId, status: "completed", completedAt: Date.now() / 1000 } });
      }, 450);
    };
    return {
      async sideOpen(sessionId, input = {}) {
        core.unsupportedFor(sessionId, "sideChat");
        const old = [...chats.values()].find(c => c.sessionId === sessionId && c.status !== "closed");
        if (old) {
          return { error: { code: "side_chat_already_open", message: "side_chat_already_open", details: { chatId: old.id, anchorTurnId: old.anchorTurnId } } };
        }
        const id = crypto.randomUUID(), now = new Date().toISOString();
        const chat: SideChat = { id, sessionId, threadId: `side-${id}`, anchorTurnId: input.anchorTurnId ?? null, runtimeGeneration: 1,
          lastTurnId: input.lastTurnId ?? null, forkedThroughTurnId: input.lastTurnId ?? "turn-2",
          status: "ready", createdAt: now, updatedAt: now, activeTurnId: null, revision: 1, events: [], pendingRequests: [], truncated: false, model: input.model ?? "GPT · preview", effort: "medium" };
        chats.set(id, chat); return copy(chat);
      },
      async sideList(sessionId) { return { chats: structuredClone([...chats.values()].filter(c => c.sessionId === sessionId && c.status !== "closed")) }; },
      async sideRead(sessionId, chatId, afterRevision, waitMs = 0) {
        const chat = get(sessionId, chatId);
        if (waitMs > 0 && afterRevision === chat.revision) await new Promise<void>(resolve => {
          let timer: ReturnType<typeof setTimeout>;
          const done = () => { clearTimeout(timer); waiters.get(chatId)?.delete(done); resolve(); };
          const set = waiters.get(chatId) ?? new Set(); set.add(done); waiters.set(chatId, set);
          timer = setTimeout(done, Math.min(waitMs, 25_000));
        });
        return copy(chat);
      },
      async sideSend(sessionId, chatId, input) {
        const chat = get(sessionId, chatId), nonce = `${chatId}:${input.clientMessageId}`;
        const prior = messages.get(nonce); if (prior) return { ...copy(chat), turnId: prior };
        if (chat.status !== "ready") throw new Error("side_chat_busy");
        const turnId = crypto.randomUUID(); messages.set(nonce, turnId);
        chat.status = "running"; chat.activeTurnId = turnId;
        event(chat, "turn/started", { threadId: chat.threadId, turn: { id: turnId, status: "inProgress", startedAt: Date.now() / 1000 } });
        event(chat, "item/completed", { threadId: chat.threadId, turnId, item: { id: `${turnId}-user`, type: "userMessage", content: [{ type: "text", text: input.text }] } });
        const answer = /standalone note|总结|summariz/i.test(input.text)
          ? "# Notes 的查找规则\n\n- 默认保存为会话笔记。\n- 项目和主机总览自然收录它。\n- Pin 是额外标记，取消不会删除笔记。\n\n未决事项：无。"
          : "侧聊与主聊天隔离。未标记的笔记也能在项目和主机的全部笔记里找到；标记只帮助查找。";
        if (/审批演示|approval demo/i.test(input.text)) {
          chat.pendingRequests.push({ id: `approve-${turnId}`, method: "item/commandExecution/requestApproval", params: { threadId: chat.threadId, turnId, itemId: "mock-command", command: "Get-ChildItem", cwd: "D:\\demo", availableDecisions: ["accept", "decline"] } }); changed(chat);
        } else setTimeout(() => finish(chat, turnId, answer), 650);
        return { ...copy(chat), turnId };
      },
      async sideInterrupt(sessionId, chatId) {
        const chat = get(sessionId, chatId), turnId = chat.activeTurnId;
        chat.status = "ready"; chat.activeTurnId = null; chat.pendingRequests = [];
        if (turnId) event(chat, "turn/completed", { threadId: chat.threadId, turn: { id: turnId, status: "interrupted" } });
        else changed(chat);
        return copy(chat);
      },
      async sideRespond(sessionId, chatId, requestId, _reply) {
        const chat = get(sessionId, chatId);
        if (!chat.pendingRequests.some(r => r.id === requestId)) throw new Error("side_request_not_found");
        chat.pendingRequests = chat.pendingRequests.filter(r => r.id !== requestId); changed(chat);
        if (chat.activeTurnId) finish(chat, chat.activeTurnId, "审批回复只发送给了侧聊，主聊天未受影响。");
        return copy(chat);
      },
      async sideClose(sessionId, chatId) { const chat = get(sessionId, chatId); chat.status = "closed"; chat.activeTurnId = null; chat.pendingRequests = []; changed(chat); return { closed: true }; },
    };
  },
};
