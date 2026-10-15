// Mock owner-notify (agent → owner messages) for the browser preview: a few records on Eva / Mika,
// the settings block, and the session methods. `?ownerdemo` adds a new urgent message after 5 s.
// ntf-s1 / ntf-s2 are cutex system notices (origin system: no 回复); every record can be deleted.
import type { OwnerNotification, OwnerNotifySettings } from "@cutex-desktop/protocol";
import type { DesktopApi, OwnerNotifyResult } from "../../../../shared/ipc";
import { isPending, isAlerting, sanitizeOwnerNotifyPatch } from "../../../../shared/ownerNotify";
import type { ModuleMock } from "../../dev/mockTypes";

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

function record(over: Partial<OwnerNotification> & Pick<OwnerNotification, "notificationId" | "agentId" | "text">): OwnerNotification {
  return {
    agentName: null,
    origin: "agent",
    level: "info",
    requestedLevel: over.level ?? "info",
    downgraded: null,
    muted: false,
    channels: ["desktop"],
    needsReply: false,
    delegation: null,
    job: null,
    turnId: null,
    state: "open",
    createdAt: iso(60),
    acknowledgedAt: null,
    reply: null,
    closedAt: null,
    ...over,
  };
}

const mockOwnerNotes: OwnerNotification[] = [
  record({ notificationId: "ntf-a1", agentId: "eva", agentName: "Eva", turnId: "turn-1", createdAt: iso(880), state: "acknowledged", acknowledgedAt: iso(800), text: "协议类型已经从 `codex app-server generate-ts` 重新生成，**没有手写改动**。" }),
  record({
    notificationId: "ntf-a2",
    agentId: "eva",
    agentName: "Eva",
    turnId: "turn-3",
    createdAt: iso(190),
    level: "info",
    requestedLevel: "attention",
    downgraded: { from: "attention", reason: "rateLimit" },
    channels: [],
    job: "job-7f3a",
    text: "构建任务排上队了，大约 10 分钟出结果。",
  }),
  record({
    notificationId: "ntf-a3",
    agentId: "eva",
    agentName: "Eva",
    turnId: "turn-4",
    createdAt: iso(20),
    level: "urgent",
    channels: ["desktop", "phone", "bigAlert"],
    needsReply: true,
    delegation: "ask-42",
    text: "生产库迁移卡在第 3 步：`users` 表的外键约束和旧数据冲突。\n\n要我**回滚到迁移前的快照**，还是先手动清理那 12 行孤儿数据？",
  }),
  record({
    notificationId: "ntf-s1",
    agentId: "eva",
    origin: "system",
    createdAt: iso(120),
    level: "attention",
    channels: ["desktop", "phone"],
    text: "消息没能送达（tsa_7c1e9 → mika）：event_too_large: the message message (912340 bytes of text, 913002 bytes as a model item) is larger than the recipient accepts (786432)",
  }),
  record({ notificationId: "ntf-s2", agentId: "mika", origin: "system", createdAt: iso(7200), state: "acknowledged", acknowledgedAt: iso(7000), level: "attention", delegation: "ask-17", text: "委托 ask-17（整理 composer 快捷键，交给 Mika）已经 14 天没有变化（状态 running）。需要的话接受、追问或关闭它；它在关闭 30 天后归档。" }),
  // Long text: a path without spaces, a wide code line and many lines (wraps, clamps, 「展开」).
  record({
    notificationId: "ntf-a4",
    agentId: "eva",
    agentName: "Eva",
    createdAt: iso(60),
    level: "attention",
    channels: ["desktop"],
    text: [
      "夜间构建失败，日志在 `/srv/builds/nightly/2026-10-15/artifacts/desktop/linux-x64/logs/electron-builder-packaging-step-04-verbose.log`。",
      "",
      "```text",
      "Error: ENOENT: no such file or directory, open '/srv/builds/nightly/2026-10-15/artifacts/desktop/linux-x64/resources/app.asar.unpacked/node_modules/some-native-module/build/Release/binding.node'",
      "```",
      "",
      "已经试过：",
      "1. 清掉缓存重跑一次，同样的错；",
      "2. 换成上一版的 lockfile，同样的错；",
      "3. 在本机复现，正常。",
      "",
      "怀疑是构建机上的 node-gyp 版本不对。要我去改构建机的环境，还是先把这个原生模块钉回旧版本？",
    ].join("\n"),
  }),
  record({ notificationId: "ntf-m1", agentId: "mika", agentName: "Mika", createdAt: iso(400), level: "attention", channels: ["desktop", "phone"], text: "Composer 的队列面板接好了，你有空看一眼交互？" }),
  record({ notificationId: "ntf-m0", agentId: "mika", agentName: "Mika", createdAt: iso(5000), state: "answered", needsReply: true, closedAt: iso(4000), acknowledgedAt: iso(4500), reply: { text: "用 shadcn 的那个。", repliedAt: iso(4000), clientUserMessageId: "owner-notify-reply-ntf-m0" }, text: "按钮用 shadcn 的还是 ZCode 的样式？" }),
];

const mockOwnerSettings: OwnerNotifySettings = {
  delivery: { info: ["desktop"], attention: ["desktop", "phone"], urgent: ["desktop", "phone", "bigAlert"] },
  deliveryDefault: { info: ["desktop"], attention: ["desktop", "phone"], urgent: ["desktop", "phone", "bigAlert"] },
  bigAlertSound: true,
  toolAudience: "ownerFacing",
  rateLimit: { perHour: 12, urgentPerHour: 3 },
  agentOverrides: { scratch: "mute" },
  phonePaired: typeof location !== "undefined" && new URLSearchParams(location.search).has("phone"),
  channels: ["desktop", "phone", "bigAlert"],
  toolAudienceOptions: ["ownerFacing", "everyone", "directors", "none"],
};

const ownerNotesOf = (agentId: string) => structuredClone(mockOwnerNotes.filter((r) => r.agentId === agentId));

type Emit = (agentId: string, method: string, params: Record<string, unknown>) => void;

function mockOwnerNotifyApi(emit: Emit, settingsView: () => unknown): Pick<DesktopApi, "ownerNotifications" | "ownerNotifyAction" | "patchOwnerNotify"> {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("ownerdemo")) {
    setTimeout(() => {
      const r = record({ notificationId: `ntf-live-${Date.now()}`, agentId: "mika", agentName: "Mika", level: "urgent", channels: ["desktop", "phone", "bigAlert"], needsReply: true, createdAt: new Date().toISOString(), text: "测试服务器磁盘只剩 2%，要我清理旧的构建产物吗？" });
      mockOwnerNotes.push(r);
      emit(r.agentId, "cutex/ownerNotify/created", { notification: structuredClone(r) });
    }, 5000);
  }
  return {
    async ownerNotifications({ filter = "all", agentId, limit = 100 }) {
      return structuredClone(
        mockOwnerNotes
          .filter((r) => (!agentId || r.agentId === agentId) && (filter === "all" || (filter === "pending" ? isPending(r) : isAlerting(r))))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, limit),
      );
    },
    async ownerNotifyAction(agentId, action, notificationId, text): Promise<OwnerNotifyResult> {
      const r = mockOwnerNotes.find((x) => x.notificationId === notificationId && x.agentId === agentId);
      if (!r) return { ok: false, error: { code: "notification_not_found", message: "no such notification" } };
      if (action === "delete") {
        mockOwnerNotes.splice(mockOwnerNotes.indexOf(r), 1);
        emit(r.agentId, "cutex/ownerNotify/deleted", { notificationId, agentId });
        console.info("[mock] cutex/ownerNotify/delete", notificationId);
        return { ok: true, notification: structuredClone(r) };
      }
      if (action === "reply" && (r.origin === "system" || !r.needsReply)) return { ok: false, error: { code: "notification_not_replyable", message: "this notice takes no reply" } };
      const final = r.state === "answered" || r.state === "dismissed";
      if (action === "reply" && final) return { ok: false, error: { code: "notification_closed", message: "already answered or dismissed" } };
      if (!final) {
        const now = new Date().toISOString();
        if (action === "ack" && r.state === "open") Object.assign(r, { state: "acknowledged", acknowledgedAt: now });
        if (action === "reply") Object.assign(r, { state: "answered", acknowledgedAt: r.acknowledgedAt ?? now, closedAt: now, reply: { text: text ?? "", repliedAt: now, clientUserMessageId: `owner-notify-reply-${r.notificationId}` } });
        if (action === "dismiss") Object.assign(r, { state: "dismissed", acknowledgedAt: r.acknowledgedAt ?? now, closedAt: now });
        emit(r.agentId, "cutex/ownerNotify/updated", { notification: structuredClone(r) });
      }
      console.info(`[mock] cutex/ownerNotify/${action}`, notificationId, text ?? "");
      return { ok: true, notification: structuredClone(r) };
    },
    async patchOwnerNotify(patch) {
      const p = sanitizeOwnerNotifyPatch(patch);
      if (p.delivery) Object.assign(mockOwnerSettings.delivery, p.delivery);
      if (p.bigAlertSound !== undefined) mockOwnerSettings.bigAlertSound = p.bigAlertSound;
      if (p.toolAudience) mockOwnerSettings.toolAudience = p.toolAudience;
      if (p.rateLimit) Object.assign(mockOwnerSettings.rateLimit, p.rateLimit);
      if (p.agentOverrides) {
        const next: Record<string, "mute" | "force"> = {};
        for (const [k, v] of Object.entries(p.agentOverrides)) if (v) next[k] = v;
        mockOwnerSettings.agentOverrides = next;
      }
      console.info("[mock] PATCH /v2/settings ownerNotify", p);
      return settingsView() as never;
    },
  };
}

export const mock: ModuleMock = {
  api: (core) => mockOwnerNotifyApi((agentId, method, params) => core.emitCutex(agentId, method, params), () => core.settingsView()),
  cutexState: (sessionId, core) => (core.legacy ? {} : { ownerNotifications: ownerNotesOf(sessionId) }),
  settings: () => ({ ownerNotify: structuredClone(mockOwnerSettings) }),
};
