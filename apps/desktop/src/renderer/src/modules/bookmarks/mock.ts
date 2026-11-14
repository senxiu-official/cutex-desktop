import type { OwnerPin, OwnerPinChange, OwnerPinList, OwnerPinUpdateResult } from "../../../../shared/ownerPins";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

/** Preview only. No daemon endpoint: bookmarks are device preferences. Existing preview data wins. */
export const previewBookmarks = () => {
  const at = "2026-10-11T01:00:00Z";
  const turn = (sessionId: string, turnId: string, name: string, snippet: string, ordinal?: number) => ({ hostId: "local", kind: "turn", key: `${sessionId}:${turnId}`, title: ordinal ? `${name} · #${ordinal}` : name, params: { sessionId, turnId, ...(ordinal ? { ordinal: String(ordinal) } : {}) }, snapshot: { at, agentName: name, snippet } });
  const agent = (hostId: string, sessionId: string, title: string) => ({ hostId, kind: "agent", key: sessionId, title, params: { sessionId }, snapshot: { at, agentName: title } });
  const refs = [
    turn("eva", "turn-1", "Eva", "最初的设计讨论", 1),
    turn("wave", "wave-t36", "Wave-Director", "看看先前的这一轮，不离开当前阅读位置。", 36),
    turn("eva", "reverted-preview-turn", "Eva", "已撤销的来源轮：短片段仍可查找。"),
    agent("local", "mika", "Mika"),
    { hostId: "local", kind: "notes.note", key: "note-preview-1", title: "批注：旁注与聊天分开", params: { noteId: "note-preview-1" } },
    { hostId: "local", kind: "workspace.preview", key: "docs/DESIGN.md", title: "DESIGN.md", params: { path: "docs/DESIGN.md", sessionId: "eva" } },
    agent("preview-offline", "helper", "Offline helper"),
  ];
  return { version: 2 as const, records: refs.map((ref, index) => ({ id: `bookmark-preview-${index}`, createdAt: at, ref })) };
};
// 备忘 · 要处理 (cutex owner-pins): pins from Eva, Mika, Alden and Sora — two to decide, two to do, two notes, and three
// resolved (one withdrawn by its agent) — plus Wave-Director's on a remote host. `?pins` scripts Alden's conversation
// with the owner_pin calls behind two of them (the timeline card), and 8 s after start Alden adds one more (live event).

const scene = typeof location !== "undefined" && new URLSearchParams(location.search).has("pins");
const NAMES: Record<string, string> = { eva: "Eva", mika: "Mika", alden: "Alden", sora: "Sora", wave: "Wave-Director" };
const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
let n = 0;

function pin(agentId: string, kind: OwnerPin["kind"], title: string, ago: number, extra: Partial<OwnerPin> = {}): OwnerPin {
  n += 1;
  return {
    pinId: `pin-${String(n).padStart(4, "0")}-6f2a`,
    key: null,
    author: "agent",
    agentId,
    agentName: NAMES[agentId] ?? null,
    kind,
    title,
    detail: null,
    links: [],
    turnId: null,
    state: "open",
    resolvedBy: null,
    resolution: null,
    createdAt: iso(ago),
    updatedAt: iso(ago),
    resolvedAt: null,
    revision: 1,
    ...extra,
  };
}

const local: OwnerPin[] = [
  pin("alden", "decide", "the next release 要不要带上 heavy-read 默认值 4？", 3 * 3600, {
    key: "the next release-heavy-read",
    detail: "实测 2/4/6/8：4 在 EVA 上最稳（p95 −38%），6 在 Remote 更快但偶发卡顿。选 4 还是按机器自动？",
    links: [{ target: "cutex:artifact/af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8@2", label: "heavy-read 实测 v3" }],
    turnId: "alden-t2",
  }),
  pin("eva", "todo", "用 USB 连上手机并打开 adb 调试", 26 * 3600, { detail: "装 APK 要用；连好后在对话里说一声。", turnId: "turn-0" }),
  pin("mika", "decide", "侧栏自动整理：按项目还是按最近活跃？", 2 * 86400, { links: [{ target: "https://example.com/sidebar-preview", label: "两种排法预览" }] }),
  pin("alden", "todo", "Win+R 里运行 the next release 激活命令（三个变量先去掉）", 40 * 60, {
    key: "the next release-activate",
    detail: "pwsh -NoProfile -File D:/Work/builds/demo-release/tracks/host-02/activate.ps1",
    turnId: "alden-t3",
  }),
  pin("sora", "note", "DESKTOP_PARITY.md 第 3 节是 timeline 改动的检查单", 5 * 86400, { links: [{ target: "D:/Work/app/docs/DESKTOP_PARITY.md", label: "DESKTOP_PARITY.md" }] }),
  pin("eva", "note", "夜间测试的失败用例都在 e2e/nightly-1109.md", 9 * 3600),
  pin("mika", "todo", "看一眼新的输入框草稿迁移", 4 * 86400, { state: "done", resolvedBy: "owner", resolvedAt: iso(3 * 86400) }),
  pin("eva", "decide", "要不要把旧的测试升级包 删掉？", 6 * 86400, { state: "dropped", resolvedBy: "agent", resolution: "你在对话里说了删，已删除，释放 41 GB。", resolvedAt: iso(5 * 86400) }),
  pin("sora", "todo", "给 Waveline 重新 pin cutex-mobile", 7 * 86400, { state: "done", resolvedBy: "agent", resolution: "已 pin 到 0.2.4。", resolvedAt: iso(6 * 86400) }),
];

const remote = new Map<string, OwnerPin[]>();
function remoteOf(hostId: string): OwnerPin[] {
  let list = remote.get(hostId);
  if (!list) remote.set(hostId, (list = [pin("wave", "decide", "夜间 e2e 的 3 个失败用例要不要先跳过？", 7 * 3600)]));
  return list;
}

function api(list: OwnerPin[], hostId: string, emitHost: (method: string, params: Record<string, unknown>) => void) {
  return {
    async ownerPins(query: { state?: "open" | "all"; agentId?: string }): Promise<OwnerPinList> {
      const pins = list.filter((p) => (!query.agentId || p.agentId === query.agentId) && (query.state === "all" || p.state === "open"));
      return { hostId, pins: structuredClone(pins), openCount: list.filter((p) => p.state === "open").length };
    },
    async ownerPinUpdate(pinId: string, change: OwnerPinChange): Promise<OwnerPinUpdateResult> {
      const i = list.findIndex((p) => p.pinId === pinId);
      if (i < 0) return { ok: false, error: { code: "pin_not_found", message: "no pin with this id" } };
      if ("delete" in change) {
        list.splice(i, 1);
        emitHost("cutex/ownerPin/changed", { pinId, deleted: true });
        return { ok: true, pin: null };
      }
      const p = list[i]!;
      const at = new Date().toISOString();
      Object.assign(p, { state: change.state, updatedAt: at, revision: p.revision + 1, ...(change.state === "open" ? { resolvedBy: null, resolvedAt: null, resolution: null } : { resolvedBy: "owner", resolvedAt: at }) });
      emitHost("cutex/ownerPin/changed", { pin: structuredClone(p) });
      return { ok: true, pin: structuredClone(p) };
    },
  };
}

const call = (id: string, args: Record<string, unknown>, result: Record<string, unknown>) =>
  ({ type: "mcpToolCall", id, server: "cutex", tool: "owner_pin", status: "completed", durationMs: 40, arguments: args, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });

function aldenThread() {
  const now = Math.floor(Date.now() / 1000);
  const [decide, activate] = [local[0]!, local[3]!];
  return {
    thread: {
      id: "thread-alden-pins",
      turns: [
        {
          id: "alden-t2", status: "completed", startedAt: now - 3 * 3600 - 300, completedAt: now - 3 * 3600,
          items: [
            { type: "userMessage", id: "ap-u2", content: [{ type: "text", text: "heavy-read 的并发测一下 2/4/6/8，给个建议。" }] },
            { type: "commandExecution", id: "ap-c2", command: "pwsh scripts/bench-heavy-read.ps1 -Levels 2,4,6,8", status: "completed", exitCode: 0, durationMs: 412000, aggregatedOutput: "level 2  p95 1830 ms\nlevel 4  p95 1135 ms\nlevel 6  p95  990 ms (2 stalls)\nlevel 8  p95 1410 ms (7 stalls)" },
            call("ap-p2", { kind: "decide", title: decide.title, detail: decide.detail, links: decide.links, key: decide.key }, { ok: true, pinId: decide.pinId, created: true, state: "open" }),
            { type: "agentMessage", id: "ap-a2", text: "测完了：**4 在 EVA 上最稳**（p95 比 2 低 38%），6 在 Remote 更快但偶尔卡住。要不要在 the next release 里把默认值定成 4，还是按机器自动选，等你定。" },
          ],
        },
        {
          id: "alden-t3", status: "completed", startedAt: now - 2700, completedAt: now - 2400,
          items: [
            { type: "userMessage", id: "ap-u3", content: [{ type: "text", text: "the next release 的 EVA kit 准备好了吗？" }] },
            { type: "commandExecution", id: "ap-c3", command: "pwsh D:/Work/builds/demo-release/tracks/host-02/check-only.ps1", status: "completed", exitCode: 0, durationMs: 95000, aggregatedOutput: "capture ok\ndry-run ok: 14 checks passed" },
            call("ap-p3", { kind: "todo", title: activate.title, detail: activate.detail, key: activate.key }, { ok: true, pinId: activate.pinId, created: true, state: "open" }),
            { type: "agentMessage", id: "ap-a3", text: "准备好了，capture 和 dry-run 都过了。激活命令我放进备忘了，你方便时从 Win+R 的 pwsh 里跑就行。" },
          ],
        },
      ],
    },
  };
}

export const mock: ModuleMock = {
  features: { new: ["owner-pins"] },
  api: (core: MockCore) => api(local, "local", (m, params) => core.emitHost(m, params)),
  remote: (hostId, emitHost) => api(remoteOf(hostId), hostId, emitHost),
  thread: (sessionId) => (scene && sessionId === "alden" ? aldenThread() : null),
  start(core) {
    try { if (localStorage.getItem("cutex-desktop.module.bookmarks") === null) localStorage.setItem("cutex-desktop.module.bookmarks", JSON.stringify({ saved: previewBookmarks() })); } catch { /* preview storage can be disabled */ }
    if (core.legacy || !scene) return;
    setTimeout(() => {
      const p = pin("alden", "note", "the next release kit 的 SHA：6be946de（cutex）/ 31cba5cc5（desktop）", 0, { key: "the next release-shas", turnId: "alden-t3" });
      local.unshift(p);
      core.emitHost("cutex/ownerPin/changed", { pin: structuredClone(p) });
    }, 8000);
  },
};
