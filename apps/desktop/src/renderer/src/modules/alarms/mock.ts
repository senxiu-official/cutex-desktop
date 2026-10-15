// Browser-preview data for 闹钟 (cutex alarms-api; dev/mockTypes.ts): Eva's alarms — two she set
// (one for Mika, one for herself, one of them failing to send), one Alden set to wake her, one the
// owner set, and a sent / cancelled one. The earliest goes off ~40 s after start (live event).
// Workstation (remote) has its own: Wave-Director's nightly check.
import type { AlarmList, AlarmView } from "../../../../shared/alarms";
import type { ModuleMock } from "../../dev/mockTypes";

const NAMES: Record<string, string> = { eva: "Eva", mika: "Mika", alden: "Alden", sora: "Sora", wave: "Wave-Director", scratch: "scratch" };
const iso = (fromNowMs: number) => new Date(Date.now() + fromNowMs).toISOString();
let n = 0;

function alarm(owner: string | null, to: string, at: string, message: string, extra: Partial<AlarmView> = {}): AlarmView {
  n += 1;
  return {
    id: `alarm-${String(n).padStart(8, "0")}-7c1e-4b2a-9f00-5d3e8a1c${String(n).padStart(4, "0")}`,
    alarmId: extra.alarmId ?? `reminder-${n}`,
    ownerKind: owner ? "agent" : "human",
    ownerCutexSessionId: owner,
    ownerName: owner ? (NAMES[owner] ?? null) : null,
    targetCutexSessionId: to,
    targetName: NAMES[to] ?? null,
    at,
    delaySeconds: null,
    state: "scheduled",
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    messagePreview: message.slice(0, 200),
    messageChars: message.length,
    messageTruncated: message.length > 200,
    ...extra,
  };
}

const local: AlarmView[] = [
  alarm("eva", "eva", iso(40_000), "检查 r225 构建有没有跑完；跑完就把 SHA 发给 Alden。", { alarmId: "check-r225-build", delaySeconds: 600 }),
  alarm("eva", "mika", iso(52 * 60_000), "提醒 Mika：composer 的草稿迁移今天要合，先跑一遍 vitest。", { alarmId: "mika-composer" }),
  alarm("alden", "eva", iso(3 * 3600_000), "协议类型重新生成后，cutex 构建前先 pull 一下 feat/desktop-api。", { alarmId: "pull-before-build" }),
  alarm(null, "eva", iso(26 * 3600_000), "明早看一下夜间测试的结果。", { alarmId: "owner-morning" }),
  alarm("eva", "sora", iso(-30 * 60_000), "DESKTOP_PARITY.md 第 3 节更新了，动 timeline 前看一眼。", { alarmId: "sora-parity", state: "queued", attempts: 1, lastAttemptAt: iso(-30 * 60_000) }),
  alarm("eva", "eva", iso(2 * 3600_000), "如果 Mika 还没回复，就再问一次。", { alarmId: "nudge-mika", state: "cancelled" }),
];
local.push(alarm("eva", "scratch", iso(8 * 60_000), "scratch 的 GPU 探针结果整理成表。", { alarmId: "scratch-gpu", attempts: 3, lastAttemptAt: iso(-20_000), lastError: "Agent Bus: target runtime offline (scratch)" }));

const remoteAlarms = new Map<string, AlarmView[]>();
function remoteOf(hostId: string): AlarmView[] {
  let list = remoteAlarms.get(hostId);
  if (!list) remoteAlarms.set(hostId, (list = [alarm("wave", "wave", iso(5 * 3600_000), "夜间 e2e 跑完后汇总失败用例。", { alarmId: "nightly-e2e" })]));
  return list;
}

function listFor(list: readonly AlarmView[], query: { sessionId?: string; state?: "pending" | "all" }): AlarmList {
  const rows = list
    .filter((a) => !query.sessionId || a.ownerCutexSessionId === query.sessionId || a.targetCutexSessionId === query.sessionId)
    .filter((a) => query.state === "all" || a.state === "scheduled")
    .map((a) => (query.sessionId ? { ...a, relation: a.ownerCutexSessionId === query.sessionId ? (a.targetCutexSessionId === query.sessionId ? "self" : "outgoing") : "incoming" } : a) as AlarmView);
  const scheduled = rows.filter((a) => a.state === "scheduled").sort((a, b) => a.at.localeCompare(b.at));
  const rest = rows.filter((a) => a.state !== "scheduled").sort((a, b) => b.at.localeCompare(a.at));
  return { hostId: "mock", alarms: structuredClone([...scheduled, ...rest]), nextAt: scheduled[0]?.at ?? null };
}

function api(list: AlarmView[], emitHost: (method: string, params: Record<string, unknown>) => void) {
  return {
    async alarms(query: { sessionId?: string; state?: "pending" | "all" }) {
      return listFor(list, query);
    },
    async cancelAlarm(alarmId: string) {
      const a = list.find((x) => x.id === alarmId);
      if (!a) return { ok: false as const, error: { code: "alarm_not_found", message: "no alarm with this id" } };
      if (a.state === "queued") return { ok: false as const, error: { code: "alarm_already_queued", message: "the alarm was already handed to the Agent Bus" } };
      a.state = "cancelled";
      emitHost("cutex/alarms/changed", { reason: "cancelled", id: a.id, alarm: structuredClone(a), ownerCutexSessionId: a.ownerCutexSessionId, targetCutexSessionId: a.targetCutexSessionId, hostId: "mock" });
      return { ok: true as const, alarm: structuredClone(a) };
    },
  };
}

export const mock: ModuleMock = {
  features: { new: ["alarms-api"] },
  api: (core) => api(local, (m, p) => core.emitHost(m, p)),
  remote: (hostId, emitHost) => api(remoteOf(hostId), emitHost),
  start(core) {
    if (core.legacy) return;
    // The earliest alarm goes off: the Agent Bus takes it (queued).
    const first = local[0]!;
    setTimeout(() => {
      if (first.state !== "scheduled") return;
      first.state = "queued";
      first.attempts = 1;
      first.lastAttemptAt = new Date().toISOString();
      core.emitHost("cutex/alarms/changed", { reason: "queued", id: first.id, alarm: structuredClone(first), ownerCutexSessionId: "eva", targetCutexSessionId: "eva", hostId: "mock" });
    }, Math.max(0, Date.parse(first.at) - Date.now()));
  },
};
