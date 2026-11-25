// Guards from the localization audit (docs/research/i18n-terms-audit-20261013.md, owner 2026-10-13):
// zh prose treats Profile as the product noun (the settings nav page is "Profile"), and the
// tray / taskbar text speaks the UI's own agent word, never a hard-coded latin "agent".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { overlayDescription, trayTooltip } from "../src/shared/shell";

const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { zhHantCN } = await import("../src/renderer/src/i18n/zh-Hant-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { countKey } = await import("../src/renderer/src/i18n");
const { en: projectsEn } = await import("../src/renderer/src/modules/projects/i18n.en");
const { zhHantTW } = await import("../src/renderer/src/i18n/zh-Hant-TW");
const { zhHantHK } = await import("../src/renderer/src/i18n/zh-Hant-HK");
const { NEXT_UP_STATES, NEXT_UP_EFFECTS } = await import("../src/renderer/src/lib/inputLedger/nextUpRegistry");
/** One counted message as the app renders it: `.one` for n = 1 (countKey), then {vars}. */
const translateIn = (catalog: Record<string, string>, key: string, vars: Record<string, string | number>) =>
  catalog[countKey(key, vars, catalog, catalog)]!.replace(/\{(\w+)\}/g, (m, v: string) => String(vars[v] ?? m));
const { applyTerms, DEFAULT_TERMS, parseOverrides, resolveTerms, resetTerm, setTerm, splitTerms } = await import("../src/renderer/src/lib/terms");

/** Strips what is not prose: term placeholders, {var}s. */
function prose(text: string): string {
  return text
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\{[^}]*\}/g, " ");
}

describe("localization audit guards (2026-10-13)", () => {
  it("keeps system tray, project view, jobs and plan labels distinct", () => {
    expect(zhCN["shell.closeWindow.tray"]).toBe("最小化到系统托盘");
    expect(zhHantCN["shell.closeWindow.tray"]).toBe("最小化到系統托盤");
    expect(en["shell.closeWindow.tray"]).toBe("Minimize to system tray");
    expect(zhCN["project-view.count.jobs"]).toBe("作业");
    expect(zhCN["project-view.job"]).toBe("作业");
    expect(zhCN["plan.statusTitle"]).toBe("计划");
    expect(zhCN["shell.statusPlace.bar"]).toBe("状态行");
    expect(zhCN["onboarding.guide.project.text"]).not.toContain("看板");
    expect(en["onboarding.guide.project.text"]).toContain("Project view and activity");
  });

  it("zh strings contain no control characters (placeholder-mangling guard)", () => {
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([, v]) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("zh strings spell the product noun Profile capitalized", () => {
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([, v]) => /[\u4e00-\u9fff]/.test(v) && /\bprofile\b/.test(prose(v)))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("zh strings write a term placeholder flush against Chinese text (settings audit 2026-10-15: 「主 智能体」)", () => {
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([, v]) => /[\u4e00-\u9fff，。；：（）「」] \{\{|\}\} [\u4e00-\u9fff，。；：（）「」]/.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("keeps the audited sentences capitalized (spot checks)", () => {
    expect(zhCN["settings.profiles.new.title"]).toBe("新建 Profile");
    expect(zhCN["composer.quota.none"]).toContain("该 Profile");
    expect(zhCN["composer.quota.none"]).toContain("设置 → Profile");
    expect(zhCN["refusal.profile_is_default"]).toBe("不能删除默认 Profile。先把别的 Profile 设为默认。");
  });

  it("keeps the reviewed zh terminology consistent", () => {
    const reviewed = {
      "zh-CN": {
        "project-view.title": "项目视图",
        "sidebar.openProjectView": "打开项目视图",
        "projects.badge": "徽章",
        "stopIdle.reason.pinned": "已固定",
        "side.pin": "固定：改成「并排」，不再盖住对话",
        "updater.title": "桌面应用更新",
        "backend-upgrade.desktopLink": "桌面应用更新",
        "shell.about.desktop": "Cutex 桌面应用",
      },
      "zh-Hant-CN": {
        "project-view.title": "項目視圖",
        "sidebar.openProjectView": "打開項目視圖",
        "projects.badge": "徽章",
        "stopIdle.reason.pinned": "已固定",
        "side.pin": "固定：改成「並排」，不再蓋住對話",
        "updater.title": "桌面應用更新",
        "backend-upgrade.desktopLink": "桌面應用更新",
        "shell.about.desktop": "Cutex 桌面應用",
      },
    } as const;
    for (const [locale, expected] of Object.entries(reviewed)) {
      const catalog = locale === "zh-CN" ? zhCN : zhHantCN;
      for (const [key, value] of Object.entries(expected)) {
        expect(catalog[key as keyof typeof catalog], `${locale} ${key}`).toBe(value);
      }
    }
  });

  it("writes mouse actions in full in zh-CN", () => {
    const ownedElsewhere = [/^gestures\./];
    const nonMouse = new Set([
      "quota.credits",
      "info.avatar.defaultHintImportant",
      "appearance.agentAvatarHint",
      "fork.profile.sizeEstimate",
      "settings.profile.introPortrait.bad.tooLarge",
    ]);
    const bareClick = /(?<!左键)(?<!中键)(?<!右键)(?<!双)点击|单击|右击|右键(?!点击|菜单)|中键(?!点击)|再点|点一下|点(?=[「⌄＋×↻A-Za-z])|点到|点的|\+\s*点|点\s*\+/;
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([key]) => !ownedElsewhere.some((pattern) => pattern.test(key)) && !nonMouse.has(key))
      .filter(([, value]) => bareClick.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(bad).toEqual([]);
  });

  it("zh tray / taskbar text uses the agent term, not a hard-coded latin word", () => {
    for (const locale of ["zh-CN", "zh-Hant-CN"] as const) {
      for (const text of [trayTooltip(2, locale), overlayDescription(2, locale), trayTooltip(0, locale)]) {
        expect(text, `${locale}: ${text}`).not.toMatch(/agent/i);
      }
      expect(trayTooltip(2, locale)).toMatch(/智能/);
    }
  });

  // The parent agent has its own term (owner 2026-10-13): a custom agent word must not leak into
  // it (Maid → not 「父Maid」), and an old terms store without the term keeps the default.
  it("parentagent is an independent term with its own default in every language", () => {
    expect(DEFAULT_TERMS["zh-CN"].parentagent).toEqual({ one: "父智能体", many: "父智能体" });
    expect(DEFAULT_TERMS["zh-Hant-CN"].parentagent).toEqual({ one: "父智能體", many: "父智能體" });
    expect(DEFAULT_TERMS.en.parentagent).toEqual({ one: "parent agent", many: "parent agents" });
    // Translated 2026-10-18 (they were the en words before).
    expect(DEFAULT_TERMS["ru-RU"].parentagent).toEqual({ one: "родительский агент", many: "родительские агенты" });
    expect(DEFAULT_TERMS["fr-FR"].parentagent).toEqual({ one: "agent parent", many: "agents parents" });
    expect(DEFAULT_TERMS["es-ES"].parentagent).toEqual({ one: "agente padre", many: "agentes padre" });
    expect(DEFAULT_TERMS["pt-BR"].parentagent).toEqual({ one: "agente pai", many: "agentes pai" });
    expect(DEFAULT_TERMS["it-IT"].parentagent).toEqual({ one: "agente padre", many: "agenti padre" });
    expect(DEFAULT_TERMS["de-DE"].parentagent).toEqual({ one: "übergeordneter Agent", many: "übergeordnete Agenten" });
    expect(DEFAULT_TERMS["ja-JP"].parentagent).toEqual({ one: "親エージェント", many: "親エージェント" });
    expect(DEFAULT_TERMS["ko-KR"].parentagent).toEqual({ one: "상위 에이전트", many: "상위 에이전트" });
  });

  it("a custom agent word never leaks into parentagent (Maid → not 父Maid)", () => {
    const overrides = parseOverrides({ "zh-CN": { agent: { one: "Maid" } } });
    const terms = resolveTerms(overrides, "zh-CN");
    expect(terms.agent.one).toBe("Maid");
    expect(terms.parentagent.one).toBe("父智能体");
    expect(applyTerms(zhCN["sub.readOnly"], terms, "zh-CN")).toContain("父智能体");
    expect(applyTerms(zhCN["sub.readOnly"], terms, "zh-CN")).not.toContain("父Maid");
  });

  it("parentagent can be overridden and reset; an old store keeps the default", () => {
    let saved: string | null = null;
    Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => saved, setItem: (_k: unknown, v: string) => { saved = v; } }, configurable: true });
    expect(parseOverrides({ en: { agent: { one: "Butler" } } }).en?.parentagent).toBeUndefined();
    setTerm("en", "parentagent", "one", "boss agent");
    expect(resolveTerms(parseOverrides(JSON.parse(localStorage.getItem("cutex-desktop.terms") ?? "{}")), "en").parentagent.one).toBe("boss agent");
    resetTerm("en", "parentagent");
    expect(resolveTerms({}, "en").parentagent.one).toBe("parent agent");
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("the 术语 preview shows the parentagent word and marks it (review 2026-10-13; preview band 2026-10-18)", () => {
    const sample = zhCN["terms.sample.reportsTo"];
    expect(sample).toContain("{{parentagent}}");
    const custom = resolveTerms(parseOverrides({ "zh-CN": { parentagent: { one: "上司" } } }), "zh-CN");
    const shown = applyTerms(sample, custom, "zh-CN");
    expect(shown).toContain("上司");
    expect(shown).not.toContain("父智能体");
    expect(applyTerms(sample, resolveTerms({}, "zh-CN"), "zh-CN")).toContain("父智能体");
    // the sample word never derives from the agent term
    const maid = resolveTerms(parseOverrides({ "zh-CN": { agent: { one: "Maid" }, parentagent: { one: "上司" } } }), "zh-CN");
    expect(applyTerms(sample, maid, "zh-CN")).toContain("上司");
    const enSample = applyTerms(en["terms.sample.reportsTo"], resolveTerms(parseOverrides({ en: { parentagent: { one: "boss agent" } } }), "en"), "en");
    expect(enSample).toContain("boss agent");
    // the pieces carry the term id, and join back to applyTerms
    const pieces = splitTerms(sample, custom, "zh-CN");
    expect(pieces).toEqual(["汇报给", { id: "parentagent", text: "上司" }]);
    expect(pieces.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(shown);
    expect(splitTerms("Waiting for {{an owner}} · {{Agents}}", resolveTerms({}, "en"), "en")).toEqual(["Waiting for ", { id: "owner", text: "an owner" }, " · ", { id: "agent", text: "Agents" }]);
  });
});

// Copy consistency, round 1 (.claude/reports/audit-20261124-copy.md): one action, one word; they must not drift back.
describe("copy consistency guards (2026-11-24)", () => {
  const zh = zhCN as Record<string, string>;
  const english = en as Record<string, string>;
  const where = (catalog: Record<string, string>, test: (v: string) => boolean) => Object.entries(catalog).filter(([, v]) => test(v)).map(([k, v]) => `${k}: ${v}`);

  it("the current turn is interrupted (中断), never stopped; jobs, services and runtimes keep 停止", () => {
    // The composer's button: its accessible name and its tooltip say the same verb.
    expect(zh["composer.stop"]).toBe("中断");
    expect(zh["composer.stopHint"]).toMatch(/^中断/);
    expect(english["composer.stop"]).toBe("Interrupt");
    expect(english["composer.stopHint"]).toMatch(/^Interrupt/);
    expect(zh["conversation.stopped"]).toBe(zh["conversation.turnInterrupted"]);
    expect(english["conversation.stopped"]).toBe(english["conversation.turnInterrupted"]);
    // The Next Up registry's held-group labels too (registry 2.6, owner approved 2026-11-24).
    expect(zh["queue.turn.heldStop"]).toBe("已随中断暂停");
    expect(zh["asksPause.stopTitle"]).toBe("新委托已随中断暂停");
    expect(zh["queue.turn.afterStop"]).toBe("中断后，收到委托结果会开始新回合");
    expect(where(zh, (v) => /停止(当前|这次|运行中的|本轮)?回合|停止本轮|随停止暂停|停止后(结果|不会自动发送)|停止不会扣住/.test(v))).toEqual([]);
    expect(where(english, (v) => /\b[Ss]top(s|ping)? (the|this) (current |running )?turn\b|[Hh]eld by (your )?stop\b|after (a|the) stop\b|\bA stop doesn't\b/.test(v))).toEqual([]);
    expect(zh["conversation.tools.taskStop"]).toBe("停止任务");
  });

  it("removing a usage source says what goes: the imported usage, not a folder on disk", () => {
    expect(zh["usage.sources.remove"]).toBe("移除用量来源");
    expect(zh["usage.sources.removeArmed"]).toContain("清除已导入的用量");
    expect(zh["usage.sources.removeArmed"]).not.toContain("删除");
    expect(english["usage.sources.remove"]).toBe("Remove usage source");
    expect(english["usage.sources.removeArmed"]).toContain("imported usage");
  });

  it("a button that redoes the action is 重试 / Retry", () => {
    for (const key of ["kimi-accounts.login.retry", "peers.retryWrites", "users.relayPairing.retry"]) {
      expect(zh[key]).toBe("重试");
      expect(english[key]).toBe("Retry");
    }
    expect(where(zh, (v) => v === "再试一次" || v === "再试")).toEqual([]);
    expect(where(english, (v) => v === "Try again")).toEqual([]);
  });

  it("one feature, one name: 成果 (not 产物), 委托 (not 委派), 「MCP 工具」", () => {
    expect(zh["artifacts.listFailed"]).toContain("成果");
    expect(zh["settings.pageHint.collab"]).toContain("委托");
    expect(zh["settings.scope.mcp.label"]).toBe("MCP 工具");
    expect(where(zh, (v) => /产物|委派|MCP工具/.test(v))).toEqual([]);
  });

  // Owner 2026-11-24: 「这个页面」 is too wordy; sentences say 「此页面」.
  it("the current page is 「本页」 in short labels and 「此页面」 in sentences", () => {
    expect(zh["side.pageActions"]).toBe("本页操作");
    expect(zh["pane.closePage"]).toBe("关闭页面（回到对话）");
    expect(zh["browser.host.failed"]).toContain("重新打开此页面");
    expect(where(zh, (v) => /这个页面|该页面|本页面|这页/.test(v))).toEqual([]);
    // 「本页」 only as a short label, not inside a sentence.
    expect(where(zh, (v) => v.includes("本页") && /[，。；：]/.test(v))).toEqual([]);
  });

  it("English titles and buttons stay in sentence case", () => {
    expect(english["sidebar.openProjectView"]).toBe("Open project view");
    expect(where(english, (v) => /\bOpen Project\b/.test(v))).toEqual([]);
  });
});

// Copy round 2 (owner approved the core term table 2026-11-25, .claude/reports/copy-round2-changes.md). Assertions sit on
// the finalized key groups; the library-wide scan only reports candidates (轮 can be 轮换 / 一轮检查, 设备 can be pairing).
describe("copy round 2 guards (2026-11-25)", () => {
  const zh = zhCN as Record<string, string>;
  const hant = zhHantCN as Record<string, string>;
  const english = en as Record<string, string>;

  // Turn wording: these keys say 回合 and never 轮 (zh and zh-Hant).
  const TURN_KEYS = [
    "noteDelivery.carried", "noteDelivery.turnFrom.delivery", "interruptSend.manyTip", "interruptSend.oneTip", "notify.turnCompleted",
    "notify.turnFailed", "notify.turnInterrupted", "conversation.showEarlier", "conversation.timelineTurns", "conversation.timelineTurns.n",
    "conversation.turnSummary", "conversation.turnSummary.hint", "conversation.turnSummary.latestExpanded", "agentMsg.kind.noteHint",
    "agentMsg.kind.wakeHint", "agentMsg.wakeHint", "agentMsg.pending.afterTurn", "composer.queueSend", "queue.turn.queue",
    "queue.turn.follows", "queue.turn.numberHint", "queue.turn.yielded", "queue.turn.afterStop", "queue.turn.afterStopHint",
    "queue.turn.heldStopHint", "reply.revertHint", "menu.revertConfirm", "asksPause.gateTitle", "side-chat.open", "side-chat.source",
    "notes.addToTurn", "bookmarks.showRibbon", "diff.turnBadge", "claude-accounts.usage.turns", "delegations.upgrade.tree.continuing",
    "onboarding.panel.sidebar.runtime.detail",
  ];
  // Storage scope: kept by the desktop app.
  const SCOPE_LABELS = ["settings.scope.local.label", "settings.scope.local.title", "settings.source.local", "settings.scope.thisComputer"];
  const SCOPE_HINTS = [
    "settings.scope.local.body", "settings.source.localHint", "settings.pageHint.conversation", "settings.pageHint.general",
    "settings.pageHint.sides", "settings.pageHint.tray", "settings.pageHint.shortcuts", "settings.ia.pageDataLink", "settings.ia.homeLocal",
    "bookmarks.localHint", "remark.hint", "debug.hint", "browser.claim.modeHint", "appearance.launchArtHint",
  ];

  it("the finalized turn keys say 回合, never 轮; a turn 开始", () => {
    for (const key of TURN_KEYS) {
      expect(zh[key], key).toBeDefined();
      expect(zh[key], key).not.toMatch(/轮/);
      expect(hant[key], key).not.toMatch(/輪/);
    }
    for (const key of ["agentMsg.kind.wakeHint", "agentMsg.wakeHint", "queue.turn.afterStop", "queue.turn.afterStopHint"]) expect(zh[key], key).toMatch(/开始/);
    expect(zh["conversation.turnSummary"]).toBe("回合摘要");
    expect(zh["queue.turn.numberHint"]).toBe("第 {n} 个回合");
    expect(zh["delegations.upgrade.tree.limitNote"]).toBe("每段最多运行 {rounds} 次 / {hours} 小时；等待和暂停也计入时间");
  });

  it("settings kept by the desktop app say 「桌面应用」, in labels and hints", () => {
    for (const key of SCOPE_LABELS) {
      expect(zh[key], key).toBe("桌面应用");
      expect(english[key], key).toBe("Desktop app");
    }
    for (const key of SCOPE_HINTS) {
      expect(zh[key], key).toContain("桌面应用");
      expect(zh[key], key).not.toMatch(/此设备|这台设备|本设备|本机|这台电脑|这台桌面应用|本地桌面应用/);
      expect(english[key], key).not.toMatch(/\bthis (device|computer)\b/i);
    }
  });

  it("the interrupt hint names only what the interrupt holds; the menu's term stays {{agent}}", () => {
    // A delegation result is not held on hosts with per-item admission (queue.turn.afterStopHint): these must not say it waits.
    for (const key of ["asksPause.stopTitleHint", "paused.resumeHintStop"]) {
      expect(zh[key], key).toContain("随中断暂停");
      expect(zh[key], key).not.toMatch(/委托结果|委托及其结果/);
      expect(english[key], key).not.toMatch(/their results/);
    }
    expect(zh["onboarding.panel.sidebar.runtime.detail"]).toContain(`「${zh["stopIdle.menu"]}」`);
    expect(hant["onboarding.panel.sidebar.runtime.detail"]).toContain(`「${hant["stopIdle.menu"]}」`);
  });

  it("quick chats: the card and its hints say 快速会话 / quick chats; the entry keeps 快速启动 / Quick launch", () => {
    expect(zh["agent-config.quickChats"]).toBe("快速会话");
    expect(english["agent-config.quickChats"]).toBe("Quick chats");
    for (const key of ["settings.pageHint.defaults", "agent-config.defaults.pageHint", "agent-config.quickChats.profileHint", "agent-config.quickChats.profileHintOn"]) {
      expect(zh[key], key).toContain("快速会话");
      expect(english[key], key).toMatch(/quick chats/i);
      expect(english[key], key).not.toMatch(/quick launch/i);
    }
  });

  it("the archive confirm counts members properly", () => {
    const say = (n: number) => translateIn(projectsEn, "projects.archiveConfirmMembers", { name: "P", n });
    expect(say(1)).toContain("1 member.");
    expect(say(2)).toContain("2 members.");
  });

  it("reports library-wide candidates without failing (for review only)", () => {
    const turnish = /本轮|这一轮|[上下新]一轮|轮次|第 ?(\{\w+\}|\d+) ?轮|每轮/;
    const found = Object.entries(zh).filter(([, v]) => turnish.test(v)).map(([k, v]) => `${k}: ${v}`);
    if (found.length) console.info(`[copy round 2] 轮 candidates to review:\n${found.join("\n")}`);
    expect(Array.isArray(found)).toBe(true);
  });
});

describe("copy round 3 guards (2026-11-25): verbs and states, docs/GLOSSARY.md 动作与状态", () => {
  const zh = zhCN as Record<string, string>;
  const hant = zhHantCN as Record<string, string>;
  const english = en as Record<string, string>;

  // State-surface keys rewritten in round 3. Only these are guarded; other text follows the glossary by review.
  const STATE_KEYS = [
    "followUp.confirm", "noteDelivery.readNow.unsupported", "noteDelivery.readNow.outcomeUnknown",
    "interruptSend.notSubmitted", "interruptBatch.groupIncomplete", "interruptBatch.historyUnavailable",
    "interruptBatch.recoveryRequired", "interruptBatch.hookBlocked", "interruptBatch.notSentOther",
    "interruptBatch.retryTip", "interruptBatch.retryBlocked", "queue.row.sentAt", "operations.trackingStoppedTip",
    "composer.noSteerHint", "composer.placeholderBusyNoSteer", "outbox.stoppingHint", "outbox.checking",
    "outbox.checkingHint", "queue.addedToPaused", "paused.composerHintQueue", "queue.editFailed",
    "queue.insert.forget", "queue.steer.changed", "queue.move.gone", "queue.turn.heldStopHint",
    "outbox.admissionTimeout", "outbox.sendingHint", "outbox.capacityExceeded", "asksPause.titleHint",
    "asksPause.stopTitleHint", "subagents.stopOutcome.unknownHint", "inputLedger.record.afterCurrentTurn",
    "inputLedger.record.runtimeDisconnected", "inputLedger.record.ownerRetry", "inputLedger.record.failed",
    "inputLedger.retryNothingSent", "inputLedger.retryNothingSentOffline", "inputLedger.retryNothingSentOnlyDismiss",
    "delegation.cont.hintChildren", "delegations.mine", "noteDelivery.release.recorded",
    "delegation.peer.lateAnswerHint",
    "agentMsg.kind.downgradedHint", "queue.move.passingNotAllowed", "queue.turn.startsNowHint",
    "queue.receipt.hideHint", "queue.turn.nativeReceiptHint", "cancelSend.hint", "queue.turn.notStartedHint",
    "queue.delivery.other", "queue.orderSectionHint", "queue.ownerMayPassAsksHint", "agent-bus.stuck.state.pending",
    "queue.insert.resendHint", "agent-bus.stuck.hint", "noteDelivery.wait.contextReceipt",
    "noteDelivery.readNow.unavailable", "agentMsg.kind.noteHint", "steer.pendingHint", "steer.undeliveredHint",
    "steer.undeliveredNotice", "alarms.messageNotFound", "queue.meta.insertedHint", "queue.meta.insertedPathHint",
    "queue.meta.insertedImageHint", "inputLedger.record.inserted", "agent-bus.stuck.withdrawMayRequeue",
    "agent-bus.stuck.withdrawMayRequeueTip", "noteDelivery.wait.nativeReconciliation",
    "noteDelivery.retryBlocked.timeline", "queue.steer.outcomeUnknown", "outbox.heldHint",
    "inputLedger.taskNotice.retry", "inputLedger.taskNotice.hint", "queue.insert.unsureHint",
    "queue.insert.resendUnreadable", "steer.resendHint", "queue.insert.resend", "jobs.followUp.localInfo",
    "delegation.statusHint.stopping", "delegation.statusHint.stopUnconfirmed", "delegation.statusHint.followUpEnded",
    "agentPause.pauseHint", "agentPause.pauseHintToolGate", "agentPause.tagHint.toolBoundary",
    "agentPause.pauseToolGateHint", "agentPause.tagHint.pausing", "agentPause.section.pausing",
    "subagents.stopOutcome.acceptedHint", "stopIdle.failedSome", "asksPause.gateResumeHint",
    "delegation.statusHint.heldByRuntime", "noteDelivery.wait.nativeRelease", "queue.turn.afterStopHint",
    "agent-bus.stuck.state.stale_held", "agent-bus.stuck.hint.held", "agent-bus.stuck.summary.live", "outbox.held",
    "inputLedger.record.held", "interruptSend.manyUnsupported", "interruptSend.tooMany",
    "agentMsg.wake.countdownHint", "agentMsg.wake.readPointHint", "composer.hint", "queue.sendNowHint",
    "composer.hint.cli", "composer.steerSend", "delegationTurn.choice.interrupt", "safetyBlock.notice.waitingHint",
    "safetyBlock.notice.readHint",
  ];
  const OFF_GLOSSARY_ZH = /发出|投递|送到|重发|再发一次|没能|没发出|停下|等着|扣住|扣下|被扣留|重投|收下|接下(?!来)|读到|读进去|入队(?!列)|排入/;
  const OFF_GLOSSARY_HANT = /發出|投遞|送到|重發|再發一次|沒能|沒發出|停下|等著|扣住|扣下|被扣留|重投|收下|接下(?!來)|讀到|讀進去|入隊(?!列)|排入/;

  // The effective regional catalogs: TW is complete; HK holds differences over TW.
  const tw = zhHantTW as Record<string, string>;
  const hkEffective = (key: string) => (zhHantHK as Record<string, string>)[key] ?? tw[key];

  it("state surfaces use one word per meaning (zh, zh-Hant-CN and the effective TW / HK catalogs)", () => {
    for (const key of STATE_KEYS) {
      expect(zh[key], key).toBeDefined();
      expect(zh[key], key).not.toMatch(OFF_GLOSSARY_ZH);
      expect((zh[key] ?? "").split("打断并发送").join(""), key).not.toMatch(/打断/);
      for (const [region, value] of [["zh-Hant-CN", hant[key]], ["zh-Hant-TW", tw[key]], ["zh-Hant-HK", hkEffective(key)]] as const) {
        expect(value, `${region} ${key}`).toBeDefined();
        expect(value, `${region} ${key}`).not.toMatch(OFF_GLOSSARY_HANT);
        // 打断 only inside the action name 打斷並發送 (TW: 打斷並傳送).
        expect((value ?? "").replace(/打斷並(發|傳)送/g, ""), `${region} ${key}`).not.toMatch(/打斷/);
      }
    }
  });

  it("cross-review fixes keep their reviewed wording", () => {
    expect(zh["menu.editResend"]).toBe("回退并编辑");
    expect(english["menu.editResend"]).toBe("Revert and edit");
    expect(zh["reply.editResendArmed"]).toBe("再次左键点击将移除从这里开始的 {n} 个回合，并将原消息放回输入框");
    for (const key of ["menu.editResend", "menu.editResendArmed", "reply.editResendHint", "reply.editResendArmed", "dsh.editResendHint", "kimi.editResendHint"]) {
      expect(zh[key], key).not.toMatch(/重新发送|重发/);
      expect(english[key], key).not.toMatch(/resend/i);
    }
    expect(zh["queue.addedToPaused"]).toBe("已加入暂停的队列，继续后按顺序发送");
    expect(zh["paused.composerHintQueue"]).toBe("队列已暂停（{n} 条）。这条消息会加入队列，继续后按顺序发送");
    expect(zh["alarms.messageNotFound"]).toBe("未找到这条消息。它可能已被处理，或当前没有可查看的记录。");
    expect(zh["agent-bus.stuck.hint.held"]).toBe("主机启动时发现这条消息等待过久，已将它暂缓。消息尚未交给运行时。");
    expect(zh["noteDelivery.release.recorded"]).toBe("已放行，系统会继续尝试发送，无需重复操作");
    expect(zh["delegation.status.outcomeUnknown"]).toBe("结果未确认");
    expect(zh["noteDelivery.readNow.outcomeUnknown"]).toBe("结果未确认，可能已发送；不会自动重新发送");
    // A retry never promises arrival.
    for (const key of ["noteDelivery.release.recorded", "noteDelivery.readNow.outcomeUnknown"]) expect(zh[key], key).not.toMatch(/送达/);
  });

  it("the Next Up registry's afterWork ⓘ and retryNotice tip are pinned", () => {
    expect(NEXT_UP_STATES.afterWork.info).toEqual({
      zh: "当前回合结束后发送。如果倒计时先结束，消息会在对方下次调用工具时插入，当前回合会继续。",
      en: "Sent once the current turn ends. If the countdown ends first, the message is inserted at the agent's next tool call and the current turn goes on.",
    });
    expect(NEXT_UP_EFFECTS.retryNotice.label).toEqual({ zh: "重新发送通知", en: "Resend notice" });
    expect(NEXT_UP_EFFECTS.retryNotice.tip).toEqual({ zh: "只重新发送这条通知，任务不会重新开始；可能收到两次", en: "Only the notice is sent again; the task does not restart. It may arrive twice" });
  });

  it("the short labels say the glossary word", () => {
    expect(zh["queue.insert.resend"]).toBe("重新发送");
    expect(english["queue.insert.resend"]).toBe("Resend");
    expect(zh["queue.delivery.other"]).toBe("待送达");
    expect(zh["agent-bus.stuck.state.pending"]).toBe("等待送达");
    expect(zh["agent-bus.stuck.state.stale_held"]).toBe("已暂缓");
    expect(english["agent-bus.stuck.state.stale_held"]).toBe("Held");
    expect(zh["inputLedger.record.failed"]).toBe("未发送");
    expect(zh["delegations.mine"]).toBe("我发起的");
    expect(zh["taskrow.resume"]).toBe("继续");
    expect(zh["taskrow.outcome.uncertain"]).toBe("结果未确认");
    expect(zh["steer.interruptSend"]).toBe("打断并发送");
  });
});
