// 项目看板 window strings: zh-CN and en (other locales fall back: Traditional Chinese → zh-CN wording, else en).
// The 主管 word follows Settings → 通用 → 称呼 (the terms main mirrors), like the tray.
import type { ShellLocale, ShellTermsPref } from "../../../shared/ipc";
import type { BoardProblemKind, BoardMemberState } from "../../../shared/board";

export interface BoardText {
  title: string;
  updated: (s: string) => string;
  never: string;
  needsYou: (n: number) => string;
  needsYouAll: (n: number) => string;
  cards: string;
  thumbnail: string;
  bigText: string;
  bigTextHint: string;
  onTop: string;
  onTopHint: string;
  projects: string;
  projectsHint: string;
  manageNote: string;
  pin: string;
  unpin: string;
  hide: string;
  show: string;
  up: string;
  down: string;
  refresh: string;
  openOnLaunch: string;
  hostState: { connecting: string; offline: string };
  health: { ok: string; problem: (n: number) => string; unknown: string; quiet: (ago: string) => string };
  /** Tooltip on unknown numbers / health: a place could not read that source. */
  unknownHint: string;
  openUnknown: string;
  needsYouUnknown: string;
  state: Record<BoardMemberState, string>;
  director: (w: string) => string;
  directorWord: string;
  noDirector: string;
  plan: string;
  current: (s: string) => string;
  goal: string;
  goalUnknown: string;
  goalUnknownHint: string;
  toolRunning: (ago: string) => string;
  open: (n: number) => string;
  today: string;
  failed: string;
  todayUnknown: string;
  more: (n: number) => string;
  moreProblems: (n: number) => string;
  last: (text: string, ago: string) => string;
  problem: (kind: BoardProblemKind, subject: string, detail: string | null) => string;
  /** One row for `n` agents with the same cause; `names`: the ones the host listed (a few are shown). */
  problemGroup: (kind: BoardProblemKind, n: number, names: string[]) => string;
  tier: { error: string; busy: string; idle: string; offline: string };
  noProjects: string;
  noHosts: string;
  demo: string;
  ago: { s: (n: number) => string; m: (n: number) => string; h: (n: number, m: number) => string; d: (n: number) => string };
}

/** A delegation problem's subject: who「title」; the title may be missing when the host listed only its id. */
const zhAsk = (title: string, who: string | null): string => (title ? `${who ?? ""}「${title}」` : who ? `${who} 的一个委托` : "一个委托");
const enAsk = (title: string, who: string | null): string => (title ? `${who ? `${who} ` : ""}“${title}”` : who ? `a delegation of ${who}` : "a delegation");

const ZH: BoardText = {
  title: "项目看板",
  updated: (s) => `${s}前更新`,
  never: "还没读到",
  needsYou: (n) => `需要你 ${n}`,
  needsYouAll: (n) => `需要你 ${n} · 在主窗口处理`,
  cards: "卡片",
  thumbnail: "缩略视图",
  bigText: "大字",
  bigTextHint: "放大全部文字，远看也清楚",
  onTop: "置顶",
  onTopHint: "看板保持在其他窗口上面",
  projects: "项目",
  projectsHint: "钉住、排序、隐藏项目",
  manageNote: "默认显示所有项目；钉住的排在前面",
  pin: "钉住",
  unpin: "取消钉住",
  hide: "隐藏",
  show: "显示",
  up: "上移",
  down: "下移",
  refresh: "刷新",
  openOnLaunch: "启动时打开",
  hostState: { connecting: "连接中", offline: "离线" },
  health: { ok: "正常", problem: (n) => `${n} 处出问题`, unknown: "情况不明", quiet: (ago) => `安静 ${ago}` },
  unknownHint: "有主机读不出这部分，数量不明（不是 0）",
  openUnknown: "委托进行中 —",
  needsYouUnknown: "需要你 —",
  state: { busy: "工作中", idle: "空闲", paused: "已暂停", error: "出错", offline: "离线" },
  director: (w) => w,
  directorWord: "主管",
  noDirector: "没有主管",
  plan: "计划",
  current: (s) => `当前：${s}`,
  goal: "目标",
  goalUnknown: "目标 —",
  goalUnknownHint: "主机还没看到主管的目标（不是没有目标）",
  toolRunning: (ago) => `工具已运行 ${ago}`,
  open: (n) => `委托进行中 ${n}`,
  today: "今天结束",
  failed: "失败",
  todayUnknown: "今天结束 —",
  more: (n) => `还有 ${n} 个`,
  moreProblems: (n) => `还有 ${n} 处`,
  last: (text, ago) => `最后：${text}（${ago}前）`,
  problem: (kind, subject, detail) => {
    switch (kind) {
      case "hostOffline": return `${subject} 离线`;
      case "agentError": return `${subject} 出错${detail ? `：${detail}` : ""}`;
      case "stopUnconfirmed": return `停止未确认：${zhAsk(subject, detail)}`;
      case "stalled": return `没有进展：${zhAsk(subject, detail)}`;
      case "delegationFailed": return `委托失败：${zhAsk(subject, detail)}`;
      case "handlerOffline": return `接手的成员离线：${zhAsk(subject, detail)}`;
      case "handlerUnavailable": return `找不到接手的成员：${zhAsk(subject, detail)}`;
      case "memberUnavailable": return `${subject} 读不到状态`;
      case "lastTurnFailed": return `${subject} 上一回合出错`;
      case "service": return `服务 ${subject}：${detail === "crashLooped" ? "反复崩溃" : "不可访问"}`;
      case "quotaOut": return `Profile ${subject} 额度用完${detail ? `（${detail}）` : ""}`;
      default: return subject && detail ? `${subject}：${detail}` : subject || detail || "其他问题";
    }
  },
  problemGroup: (kind, n, names) => {
    const who = names.length ? `：${names.slice(0, 3).join("、")}${n > Math.min(3, names.length) ? " 等" : ""}` : "";
    switch (kind) {
      case "agentError": return `${n} 个智能体出错${who}`;
      case "lastTurnFailed": return `${n} 个智能体上一回合出错${who}`;
      default: return `${n} 个智能体读不到状态${who}`;
    }
  },
  tier: { error: "出错", busy: "工作中", idle: "空闲", offline: "离线" },
  noProjects: "没有项目。连接主机后，这里显示每个项目的进展。",
  noHosts: "没有已连接的主机",
  demo: "示例数据",
  ago: { s: (n) => `${n} 秒`, m: (n) => `${n} 分钟`, h: (n, m) => (m ? `${n} 小时 ${m} 分` : `${n} 小时`), d: (n) => `${n} 天` },
};

const EN: BoardText = {
  title: "Project board",
  updated: (s) => `updated ${s} ago`,
  never: "not read yet",
  needsYou: (n) => `Needs you ${n}`,
  needsYouAll: (n) => `Needs you ${n} · handle in the main window`,
  cards: "Cards",
  thumbnail: "Thumbnails",
  bigText: "Large text",
  bigTextHint: "Larger text for reading from a distance",
  onTop: "On top",
  onTopHint: "Keep the board above other windows",
  projects: "Projects",
  projectsHint: "Pin, reorder, hide projects",
  manageNote: "All projects show by default; pinned ones come first",
  pin: "Pin",
  unpin: "Unpin",
  hide: "Hide",
  show: "Show",
  up: "Move up",
  down: "Move down",
  refresh: "Refresh",
  openOnLaunch: "Open at launch",
  hostState: { connecting: "connecting", offline: "offline" },
  health: { ok: "OK", problem: (n) => `${n} problem${n === 1 ? "" : "s"}`, unknown: "Unknown", quiet: (ago) => `quiet ${ago}` },
  unknownHint: "A host could not read this part; the number is unknown (not 0)",
  openUnknown: "open delegations —",
  needsYouUnknown: "Needs you —",
  state: { busy: "working", idle: "idle", paused: "paused", error: "error", offline: "offline" },
  director: (w) => w,
  directorWord: "Director",
  noDirector: "No director",
  plan: "Plan",
  current: (s) => `now: ${s}`,
  goal: "Goal",
  goalUnknown: "Goal —",
  goalUnknownHint: "The host has not seen the Director's goal yet (not \"no goal\")",
  toolRunning: (ago) => `tool running ${ago}`,
  open: (n) => `${n} open delegation${n === 1 ? "" : "s"}`,
  today: "finished today",
  failed: "failed",
  todayUnknown: "finished today —",
  more: (n) => `${n} more`,
  moreProblems: (n) => `${n} more`,
  last: (text, ago) => `Last: ${text} (${ago} ago)`,
  problem: (kind, subject, detail) => {
    switch (kind) {
      case "hostOffline": return `${subject} is offline`;
      case "agentError": return `${subject} failed${detail ? `: ${detail}` : ""}`;
      case "stopUnconfirmed": return `Stop not confirmed: ${enAsk(subject, detail)}`;
      case "stalled": return `No progress: ${enAsk(subject, detail)}`;
      case "delegationFailed": return `Delegation failed: ${enAsk(subject, detail)}`;
      case "handlerOffline": return `Handler offline: ${enAsk(subject, detail)}`;
      case "handlerUnavailable": return `Handler not found: ${enAsk(subject, detail)}`;
      case "memberUnavailable": return `${subject}: state not readable`;
      case "lastTurnFailed": return `${subject}: last turn failed`;
      case "service": return `Service ${subject}: ${detail === "crashLooped" ? "keeps crashing" : "unreachable"}`;
      case "quotaOut": return `Profile ${subject} is out of quota${detail ? ` (${detail})` : ""}`;
      default: return subject && detail ? `${subject}: ${detail}` : subject || detail || "Other problem";
    }
  },
  problemGroup: (kind, n, names) => {
    const who = names.length ? ` (${names.slice(0, 3).join(", ")}${n > Math.min(3, names.length) ? ", …" : ""})` : "";
    switch (kind) {
      case "agentError": return `${n} agents failed${who}`;
      case "lastTurnFailed": return `${n} agents: last turn failed${who}`;
      default: return `${n} agents: state not readable${who}`;
    }
  },
  tier: { error: "Error", busy: "Working", idle: "Idle", offline: "Offline" },
  noProjects: "No projects. Once a host is connected, each project's progress shows here.",
  noHosts: "No connected hosts",
  demo: "sample data",
  ago: { s: (n) => `${n}s`, m: (n) => `${n} min`, h: (n, m) => (m ? `${n} h ${m} min` : `${n} h`), d: (n) => `${n} d` },
};

export function boardText(locale: ShellLocale, terms: ShellTermsPref | null): BoardText {
  const base = locale.startsWith("zh") ? ZH : EN;
  const director = terms?.locale === locale ? terms.terms.director.one : null;
  return director ? { ...base, directorWord: director } : base;
}

/** cutex project colour names → CSS (the same values as lib/sidebar projectColor; not imported so this window stays
 *  free of the app bundle). */
export function projectColor(color: string): string {
  const named: Record<string, string> = { cyan: "#22b8cf", blue: "#4c8dff", green: "#40c057", magenta: "#d6336c", yellow: "#fab005", red: "#fa5252" };
  return named[color] ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : "#868e96");
}

export function agoText(t: BoardText, ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t.ago.s(s);
  const m = Math.floor(s / 60);
  if (m < 60) return t.ago.m(m);
  const h = Math.floor(m / 60);
  if (h < 24) return t.ago.h(h, m % 60);
  return t.ago.d(Math.floor(h / 24));
}
