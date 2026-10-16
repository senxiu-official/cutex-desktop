// Mock claude-safety-grants for the browser preview: agent ifm-ema-plots (`ifm-plot`) under full
// access had three commands stopped by Claude Code safety checks — one the owner did not approve,
// one approved once and used, and one still waiting (需要你, card with 批准一次 / 不批准). The notices
// arrive with the agent's bootstrap and, for the waiting one, as a live `cutex/ownerNotify/created`
// shortly after start so 需要你 shows before the agent is opened.
import type { OwnerNotification, SafetyBlock } from "@cutex-desktop/protocol";
import type { SafetyCheckResult } from "../../../../shared/ipc";
import type { ModuleMock } from "../../dev/mockTypes";

const AGENT = "ifm-plot";
const THREAD = "thread-ifm-plot";
const HINT =
  "Full access does not cover this Claude Code safety check. Rewrite the command in a form the check can verify: a literal path, or variables guarded with ${NAME:?}, and no rm inside sh -c. If this exact command is truly necessary, do not retry it and do not work around the check: stop, explain to the owner what the command is and why it is needed, then end the turn. The owner has been shown this command and may approve it once.";

const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const sec = (secondsAgo: number) => Math.floor(Date.now() / 1000) - secondsAgo;

interface Stop {
  block: string;
  turn: string;
  item: string;
  command: string;
  reason: string;
  ago: number;
}

const STOPS: Stop[] = [
  { block: "sb-mock-1", turn: "ifm-plot-t1", item: "ifm-plot-c1", ago: 5400, command: 'rm -rf "$BUILD_DIR"/$target', reason: "Dangerous rm operation on possibly-empty variable path: $target" },
  { block: "sb-mock-2", turn: "ifm-plot-t2", item: "ifm-plot-c2", ago: 2700, command: "sh -c 'cd results/bootstrap && rm -rf run-*/tmp'", reason: "rm inside sh -c could not be parsed for a safety check" },
  { block: "sb-mock-3", turn: "ifm-plot-t4", item: "ifm-plot-c4", ago: 240, command: 'rm -rf $OUT/$run "$OUT"/cache/$run.lock\n# 清掉上一轮 bootstrap 的输出和锁文件，再重跑 200 次', reason: "Dangerous rm operation on possibly-empty variable path: $OUT/$run" },
];

function block(s: Stop, state: SafetyBlock["state"], decidedAgo?: number): SafetyBlock {
  return {
    blockId: s.block,
    runtime: "claude",
    threadId: THREAD,
    turnId: s.turn,
    itemId: s.item,
    toolName: "Bash",
    toolInput: { command: s.command, description: "清理旧的输出" },
    command: s.command,
    reason: s.reason,
    state,
    blockedAt: at(s.ago),
    decidedAt: decidedAgo === undefined ? null : at(decidedAgo),
    expiresAt: state === "granted" || state === "used" ? at((decidedAgo ?? 0) - 1800) : null,
    usedAt: state === "used" ? at((decidedAgo ?? 0) - 60) : null,
    grantSeconds: 1800,
  };
}

function notice(s: Stop, b: SafetyBlock): OwnerNotification {
  const open = b.state === "blocked";
  return {
    notificationId: `ntf-${s.block}`,
    agentId: AGENT,
    agentName: "ifm-ema-plots",
    origin: "system",
    text: `Claude Code 安全检查拦下了一条命令：${s.command}\n原因：${s.reason}`,
    level: "info",
    requestedLevel: "info",
    downgraded: null,
    muted: false,
    channels: ["desktop", "phone"],
    needsReply: false,
    delegation: null,
    job: null,
    turnId: s.turn,
    state: open ? "open" : "acknowledged",
    createdAt: at(s.ago),
    acknowledgedAt: open ? null : (b.decidedAt ?? at(s.ago)),
    reply: null,
    closedAt: open ? null : (b.decidedAt ?? at(s.ago)),
    notificationLevel: "needsYou",
    notificationEvent: "system.safetyBlock",
    actions: ["needsYou", "mark", "desktop", "phone"],
    systemKind: "safetyBlock",
    safetyBlock: b,
  };
}

const notes: OwnerNotification[] = [notice(STOPS[0]!, block(STOPS[0]!, "dismissed", 5300)), notice(STOPS[1]!, block(STOPS[1]!, "used", 2400)), notice(STOPS[2]!, block(STOPS[2]!, "blocked"))];

const declined = (s: Stop) => ({
  type: "commandExecution",
  id: s.item,
  command: s.command,
  cwd: "D:\\Research\\ifm-ema",
  processId: null,
  source: "agent",
  status: "declined",
  commandActions: [{ type: "unknown", command: s.command }],
  aggregatedOutput: `${s.reason}\n\n${HINT}`,
  exitCode: null,
  durationMs: 0,
});

function plotThread() {
  const [a, b, c] = STOPS as [Stop, Stop, Stop];
  return {
    thread: {
      id: THREAD,
      turns: [
        {
          id: a.turn, status: "completed", startedAt: sec(a.ago + 30), completedAt: sec(a.ago - 20),
          items: [
            { type: "userMessage", id: "ifm-plot-u1", content: [{ type: "text", text: "把旧的构建产物清掉，再重画三张图。" }] },
            declined(a),
            { type: "agentMessage", id: "ifm-plot-a1", text: "清理命令被 Claude Code 的安全检查拦下了：`$target` 可能为空。我改成先确认变量再删：" },
            { type: "commandExecution", id: "ifm-plot-c1b", command: 'rm -rf "${BUILD_DIR:?}/${target:?}"', status: "completed", exitCode: 0, durationMs: 400, aggregatedOutput: "" },
          ],
        },
        {
          id: b.turn, status: "completed", startedAt: sec(b.ago + 30), completedAt: sec(b.ago - 20),
          items: [
            { type: "userMessage", id: "ifm-plot-u2", content: [{ type: "text", text: "bootstrap 的临时文件太多了，清一下。" }] },
            declined(b),
            { type: "agentMessage", id: "ifm-plot-a2", text: "这条命令被安全检查拦下（`sh -c` 里的 rm 无法检查）。它需要在 `results/bootstrap` 里按通配符删除每轮的 tmp 目录，我没有换别的写法绕过。需要的话请批准一次，我原样再运行。" },
          ],
        },
        {
          id: "ifm-plot-t3", status: "completed", startedAt: sec(2390), completedAt: sec(2330),
          items: [
            { type: "userMessage", id: "ifm-plot-u3", content: [{ type: "text", text: `主人已批准一次：${b.command}（30 分钟内有效，仅此一次）` }] },
            { type: "commandExecution", id: "ifm-plot-c3", command: b.command, status: "completed", exitCode: 0, durationMs: 900, aggregatedOutput: "" },
            { type: "agentMessage", id: "ifm-plot-a3", text: "已经删掉了 200 个 tmp 目录，省出 3.1 GB。" },
          ],
        },
        {
          id: c.turn, status: "completed", startedAt: sec(c.ago + 40), completedAt: sec(c.ago - 15),
          items: [
            { type: "userMessage", id: "ifm-plot-u4", content: [{ type: "text", text: "开始重跑 bootstrap。" }] },
            declined(c),
            { type: "agentMessage", id: "ifm-plot-a4", text: "重跑前要删掉上一轮的输出和锁文件，但清理命令被安全检查拦下了（`$run` 可能为空）。`$run` 来自 `runs.txt` 的每一行，这里必须按它删。我停在这里，等你决定是否批准一次。" },
          ],
        },
      ],
    },
  };
}

export const mock: ModuleMock = {
  features: { new: ["claude-safety-grants"] },
  thread: (sessionId) => (sessionId === AGENT ? plotThread() : null),
  cutexState: (sessionId, core) => (core.legacy || sessionId !== AGENT ? {} : { ownerNotifications: structuredClone(notes) }),
  start(core) {
    if (core.legacy) return;
    // The waiting one as a live event: 需要你 without opening the agent.
    setTimeout(() => {
      for (const n of notes) if (n.safetyBlock?.state === "blocked") core.emitCutex(AGENT, "cutex/ownerNotify/created", { notification: structuredClone(n) });
    }, 1200);
  },
  api: (core) => ({
    async safetyCheckDecide(agentId, blockId, decision): Promise<SafetyCheckResult> {
      const n = notes.find((x) => x.agentId === agentId && x.safetyBlock?.blockId === blockId);
      if (!n?.safetyBlock) return { ok: false, error: { code: "safety_block_not_found", message: "no such safety block" } };
      if (n.safetyBlock.state !== "blocked") return { ok: false, error: { code: "safety_block_closed", message: `already ${n.safetyBlock.state}` }, notification: structuredClone(n) };
      const now = new Date().toISOString();
      n.safetyBlock = { ...n.safetyBlock, state: decision === "grant" ? "granted" : "dismissed", decidedAt: now, expiresAt: decision === "grant" ? new Date(Date.now() + 1800_000).toISOString() : null };
      Object.assign(n, { state: "acknowledged", acknowledgedAt: n.acknowledgedAt ?? now, closedAt: now });
      core.emitCutex(agentId, "cutex/ownerNotify/updated", { notification: structuredClone(n) });
      console.info(`[mock] cutex/safetyCheck/${decision}`, blockId, decision === "grant" ? `→ 主人已批准一次：${n.safetyBlock.command}（30 分钟内有效，仅此一次）` : "");
      return { ok: true, notification: structuredClone(n), submitError: null };
    },
  }),
};
