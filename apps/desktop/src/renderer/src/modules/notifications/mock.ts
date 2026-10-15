// Mock notification levels (cutex `notification-levels`) for the browser preview: a trimmed copy of
// cutex src/notification_levels/registry.json (levels, methods, fixed cells, presets, events of every
// module), stored settings with the `default` presets plus one changed cell (inform · sound: custom)
// and one changed event, and the patch / evaluate rules of cutex (config/notification_levels.rs,
// Evaluator::decide). Like cutex since 2026-10-15 (notification-presets-no-legacy) there is no
// `legacy` preset. `?legacy` = an older cutex without the capability (no routes).
import type { DesktopApi } from "../../../../shared/ipc";
import { NOTIFICATION_LEVELS, NOTIFICATION_LEVELS_FEATURE, NOTIFICATION_PRESETS_NO_LEGACY_FEATURE, sanitizeEvaluate, sanitizeLevelsPatch, type MethodMatrix, type NotificationDecision, type NotificationLevel, type NotificationLevelSettings, type NotificationLevelsPatch, type NotificationLevelsView } from "../../../../shared/notificationLevels";
import type { ModuleMock } from "../../dev/mockTypes";

type Text = Record<string, string>;
const tx = (en: string, zh: string): Text => ({ en, "zh-CN": zh });
type L = NotificationLevel;
const row = (needsYou: boolean, mark: boolean, desktop: boolean, phone: boolean, sound: boolean, bigAlert: boolean) => ({ needsYou, mark, desktop, phone, sound, bigAlert });

const LEVELS = [
  { id: "urgent", title: tx("Urgent", "紧急"), description: tx("The owner must know right away.", "必须马上知道") },
  { id: "needsYou", title: tx("Needs you", "需要你"), description: tx("Work stops until the owner acts.", "主人不动，事情就停在那里") },
  { id: "inform", title: tx("Inform", "告知"), description: tx("Something the owner started has a result.", "主人自己发起的事有了结果") },
  { id: "record", title: tx("Record", "记录"), description: tx("Everything else. Timeline only.", "其它一切；只在时间线") },
];
const METHODS = [
  { id: "needsYou", title: tx("Counts in Needs you", "计入需要你"), description: tx("Needs-you strip, sidebar and badge.", "需要你条、侧栏和角标") },
  { id: "mark", title: tx("Sidebar mark", "侧栏标记"), description: tx("A done / failed mark, cleared when opened.", "「完成」/「出错」小标记，打开即清") },
  { id: "desktop", title: tx("Desktop notification", "桌面通知"), description: tx("OS notification on the desktop.", "系统通知") },
  { id: "phone", title: tx("Phone push", "手机推送"), description: tx("Push to the phone and the webhook.", "推送到手机和 webhook") },
  { id: "sound", title: tx("Sound", "声音"), description: tx("Play a sound.", "响铃") },
  { id: "bigAlert", title: tx("Alert window", "置顶提醒窗"), description: tx("Always-on-top alert window.", "置顶提醒窗") },
];
const FIXED: MethodMatrix = { urgent: { needsYou: true }, needsYou: { needsYou: true }, record: { needsYou: false } };
const METHOD_PRESETS: { id: string; title: Text; matrix: MethodMatrix }[] = [
  { id: "quiet", title: tx("Quiet", "安静"), matrix: { urgent: row(true, true, true, true, true, false), needsYou: row(true, true, false, false, false, false), inform: row(false, true, false, false, false, false), record: row(false, false, false, false, false, false) } },
  { id: "default", title: tx("Recommended", "推荐"), matrix: { urgent: row(true, true, true, true, true, true), needsYou: row(true, true, true, true, false, false), inform: row(false, true, true, false, false, false), record: row(false, false, false, false, false, false) } },
  { id: "all", title: tx("Everything", "全部"), matrix: { urgent: row(true, true, true, true, true, true), needsYou: row(true, true, true, true, true, false), inform: row(true, true, true, true, false, false), record: row(false, true, false, false, false, false) } },
];
const EVENT_PRESETS = [{ id: "default", title: tx("Recommended", "推荐") }];
const ev = (id: string, module: string, title: Text, def: L, appliedBy: string[], requires: string[] = []) => ({ id, module, title, description: {} as Text, levels: { default: def }, appliedBy, requires });
const EVENTS = [
  ev("ownerNotify.info", "ownerNotify", tx("Agent message · Inform", "智能体消息 · 告知"), "record", ["cutex"]),
  ev("ownerNotify.attention", "ownerNotify", tx("Agent message · Needs you", "智能体消息 · 需要你"), "inform", ["cutex"]),
  ev("ownerNotify.urgent", "ownerNotify", tx("Agent message · Urgent", "智能体消息 · 紧急"), "urgent", ["cutex"]),
  ev("ownerNotify.needsReply", "ownerNotify", tx("Agent message · Asks for a reply", "智能体消息 · 需要回复"), "needsYou", ["cutex"]),
  ev("system.quarantine", "system", tx("Agent message quarantined", "智能体消息被隔离"), "record", ["cutex"]),
  ev("system.deliveryFailed", "system", tx("Delegation or result undeliverable", "委托或结果投递不了"), "record", ["cutex"]),
  ev("system.idleDelegation", "system", tx("Delegation without change", "委托长期无变化"), "record", ["cutex"]),
  ev("native.approval", "native", tx("Approval request", "审批请求"), "needsYou", ["cutex", "client"]),
  ev("native.question", "native", tx("Question from the agent", "智能体提问"), "needsYou", ["cutex", "client"]),
  ev("ownerApproval.pending", "native", tx("Owner approval", "主人审批"), "needsYou", ["cutex", "client"]),
  ev("delegation.pendingReview", "delegation", tx("Delegation waiting for the owner's review", "委托等主人审阅"), "needsYou", ["cutex", "client"]),
  ev("delegation.failed.owner", "delegation", tx("Owner's delegation failed", "主人的委托失败"), "needsYou", ["cutex", "client"]),
  ev("delegation.deliveryFailed", "delegation", tx("Delegation send failed", "委托发送失败"), "record", ["client"]),
  ev("agentBus.messageFailed", "agentBus", tx("Agent message failed to send", "智能体消息发送失败"), "record", ["client"]),
  ev("turn.owner.completed", "turn", tx("Owner's turn completed", "主人回合完成"), "inform", ["client"], ["turn-triggers"]),
  ev("turn.owner.failed", "turn", tx("Owner's turn failed", "主人回合失败"), "needsYou", ["client"], ["turn-triggers"]),
  ev("turn.owner.interrupted", "turn", tx("Owner's turn interrupted", "主人回合被中断"), "record", ["client"], ["turn-triggers"]),
  ev("turn.other.completed", "turn", tx("Other turn completed", "其它回合完成"), "record", ["client"], ["turn-triggers"]),
  ev("turn.other.failed", "turn", tx("Other turn failed", "其它回合失败"), "record", ["client"], ["turn-triggers"]),
  ev("runtime.error", "runtime", tx("Runtime error", "运行时出错"), "inform", ["client"]),
  ev("job.completed.agent", "jobs", tx("Agent's job finished", "智能体提交的作业结束"), "record", ["client"]),
];

/** Stored settings: recommended events (one changed), default methods plus a custom cell. */
const settings: NotificationLevelSettings = {
  eventPreset: "default",
  eventLevels: { "turn.owner.completed": "record" },
  methodPreset: "default",
  methods: { inform: { sound: true } },
  projectOverrides: {},
};

const presetMatrix = (id: string) => METHOD_PRESETS.find((p) => p.id === id)?.matrix ?? METHOD_PRESETS.find((p) => p.id === "default")!.matrix;
const eventLevelIn = (e: (typeof EVENTS)[number], preset: string): L => (e.levels as Record<string, L>)[preset] ?? e.levels.default;

function effectiveMatrix(): MethodMatrix {
  const out: MethodMatrix = {};
  for (const level of NOTIFICATION_LEVELS) {
    out[level] = { ...presetMatrix(settings.methodPreset)[level] };
    for (const [m, v] of Object.entries(settings.methods[level] ?? {})) if (FIXED[level]?.[m] === undefined) out[level]![m] = v;
  }
  return out;
}

function effectiveEventLevels(): Record<string, L> {
  return Object.fromEntries(EVENTS.map((e) => [e.id, (settings.eventLevels[e.id] as L | undefined) ?? eventLevelIn(e, settings.eventPreset)]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function view(): NotificationLevelsView {
  const levels = effectiveEventLevels();
  const matrix = effectiveMatrix();
  const matchEvents = EVENT_PRESETS.find((p) => p.id === settings.eventPreset && same(levels, Object.fromEntries(EVENTS.map((e) => [e.id, eventLevelIn(e, p.id)]))))?.id
    ?? EVENT_PRESETS.find((p) => same(levels, Object.fromEntries(EVENTS.map((e) => [e.id, eventLevelIn(e, p.id)]))))?.id ?? "custom";
  const matchMethods = METHOD_PRESETS.find((p) => p.id === settings.methodPreset && same(matrix, p.matrix))?.id ?? METHOD_PRESETS.find((p) => same(matrix, p.matrix))?.id ?? "custom";
  return structuredClone({
    contractVersion: 1,
    registryVersion: 2,
    levels: LEVELS,
    methods: METHODS,
    fixedCells: FIXED,
    eventPresets: EVENT_PRESETS.map((p) => ({ ...p, levels: Object.fromEntries(EVENTS.map((e) => [e.id, eventLevelIn(e, p.id)])) })),
    methodPresets: METHOD_PRESETS.map((p) => ({ id: p.id, title: p.title, methods: p.matrix })),
    events: EVENTS.map((e) => ({ ...e, level: levels[e.id]!, overridden: e.id in settings.eventLevels })),
    settings,
    effective: { eventPreset: matchEvents, methodPreset: matchMethods, eventLevels: levels, methods: matrix, legacyNeedsYouRequiresChannel: false },
  });
}

/** cutex NotificationLevelSettings::patched (preset clears its table's cells; a cell equal to the preset is not stored). */
function applyPatch(raw: NotificationLevelsPatch): void {
  const p = sanitizeLevelsPatch(raw);
  if (p.events?.preset) {
    if (!EVENT_PRESETS.some((x) => x.id === p.events!.preset)) throw new Error(`notificationLevels.events.preset: unknown preset ${p.events.preset}`);
    settings.eventPreset = p.events.preset;
    settings.eventLevels = {};
  }
  for (const [id, level] of Object.entries(p.events?.levels ?? {})) {
    const e = EVENTS.find((x) => x.id === id);
    if (!e) throw new Error(`notificationLevels.events.levels: unknown event ${id}`);
    if (level === null || level === eventLevelIn(e, settings.eventPreset)) delete settings.eventLevels[id];
    else settings.eventLevels[id] = level;
  }
  if (p.methods?.preset) {
    if (!METHOD_PRESETS.some((x) => x.id === p.methods!.preset)) throw new Error(`notificationLevels.methods.preset: unknown preset ${p.methods.preset}`);
    settings.methodPreset = p.methods.preset;
    settings.methods = {};
  }
  for (const [level, cells] of Object.entries(p.methods?.cells ?? {})) {
    const stored = (settings.methods[level] ??= {});
    for (const [m, v] of Object.entries(cells)) {
      if (v === null || FIXED[level]?.[m] !== undefined || presetMatrix(settings.methodPreset)[level]?.[m] === v) delete stored[m];
      else stored[m] = v;
    }
    if (!Object.keys(stored).length) delete settings.methods[level];
  }
  for (const [project, mode] of Object.entries(p.projectOverrides ?? {})) {
    if (mode === null) delete settings.projectOverrides[project];
    else settings.projectOverrides[project] = mode;
  }
}

/** cutex Evaluator::decide (no agent overrides in the mock). */
function evaluate(raw: unknown): NotificationDecision {
  const request = sanitizeEvaluate(raw);
  const levels = effectiveEventLevels();
  const rank: Record<L, number> = { record: 0, inform: 1, needsYou: 2, urgent: 3 };
  let event = "";
  let level: L = "record";
  for (const id of request.events) {
    if (!(id in levels)) throw new Error(`events: unknown event ${id}`);
    if (!event || rank[levels[id]!] > rank[level]) [event, level] = [id, levels[id]!];
  }
  const project = request.projectId === undefined ? undefined : (request.projectId ?? "__independent__");
  const muted = project !== undefined && settings.projectOverrides[project] === "mute";
  if (muted && level === "inform") level = "record";
  const matrix = effectiveMatrix();
  let actions = METHODS.map((m) => m.id).filter((m) => matrix[level]?.[m]);
  if (muted) actions = actions.filter((a) => !["desktop", "phone", "sound", "bigAlert"].includes(a));
  return { level, event, actions, channels: ["desktop", "phone", "bigAlert"].filter((c) => actions.includes(c)), muted, needsYou: actions.includes("needsYou") };
}

export const mock: ModuleMock = {
  features: { new: [NOTIFICATION_LEVELS_FEATURE, NOTIFICATION_PRESETS_NO_LEGACY_FEATURE] },
  api: (core): Partial<DesktopApi> => ({
    async notificationLevels() {
      return core.legacy ? null : view();
    },
    async patchNotificationLevels(patch) {
      if (core.legacy) throw new Error("PATCH /v2/notification-levels: 404");
      applyPatch(patch);
      return view();
    },
    async evaluateNotification(request) {
      if (core.legacy) throw new Error("POST /v2/notification-levels/evaluate: 404");
      return evaluate(request);
    },
  }),
};
