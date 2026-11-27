// @vitest-environment jsdom
// Onboarding fixes (owner 2026-11-26, audit .claude/reports/onboarding-audit-20261126.md): the Profile kind picked in
// onboarding (now 开始使用 step 2, modules/start) opens the 添加 form on that kind; guide copy. The empty main area's
// list-following moved with the card to test/startCard.test.tsx (onboarding v3).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", async (importOriginal) => {
  const daemon = { listProfiles: async () => ({ defaultProfile: null, profiles: [] }) };
  return { ...(await importOriginal<object>()), api: daemon, apiFor: () => daemon, bridge: { on: () => () => {}, shell: null } };
});
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));

const { choiceForStart, cardChoice, providerCards, resolveChoice } = await import("../src/renderer/src/lib/newProfileModel");
const { FALLBACK_PRESETS } = await import("../src/renderer/src/lib/profilePresets");
const { useApp } = await import("../src/renderer/src/store");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the onboarding Profile card's pick opens the 添加 form on it", () => {
  const cards = providerCards(FALLBACK_PRESETS, new Set(["profile-create"]));
  it("ChatGPT → Codex with ChatGPT login; Claude → Claude subscription; API key keeps the provider cards", () => {
    const chatgpt = resolveChoice(cards, choiceForStart(cards, "chatgpt")!)!;
    expect([chatgpt.card.id, chatgpt.option.auth]).toEqual(["openai", "chatgpt"]);
    const claude = resolveChoice(cards, choiceForStart(cards, "claude")!)!;
    expect([claude.card.id, claude.option.auth]).toEqual(["anthropic", "claudeSubscription"]);
    expect(choiceForStart(cards, "apiKey")).toBeNull();
  });
  it("with API key picked, choosing a provider card opens its key option, not its login", () => {
    const openai = cards.find((c) => c.id === "openai")!;
    expect(resolveChoice(cards, cardChoice(openai))!.option.auth).toBe("chatgpt");
    expect(resolveChoice(cards, cardChoice(openai, "apiKey"))!.option.auth).toBe("apiKey");
  });
  it("添加 Profile carries the pick to Settings", async () => {
    const { runGuideAction, GUIDE_ACTIONS } = await import("../src/renderer/src/lib/guideActions");
    const calls: unknown[][] = [];
    useApp.setState({ openSettings: ((...a: unknown[]) => calls.push(a)) as never });
    await runGuideAction({ ...GUIDE_ACTIONS["profile.add"], createKind: "claude" });
    expect(calls).toEqual([["profiles", { create: true, createKind: "claude" }]]);
  });
});

describe("guide copy that changed what the owner does", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/onboarding/i18n");
  const { en } = await import("../src/renderer/src/modules/onboarding/i18n.en");
  it("notes, wakes and delegation results are told apart (a note starts no turn)", () => {
    const zh = zhCN["onboarding.guide.rideAlong.text"];
    expect(zh).toContain("留言：不开始新回合");
    expect(zh).toContain("唤醒：");
    expect(zh).not.toContain("将自动开始");
    expect(en["onboarding.guide.rideAlong.text"]).toContain("A note starts no turn");
  });
  // (The workspace / Profile cards went with the old flow: onboarding v3, owner 2026-11-26.)
  it("the key tip no longer promises a fetched model list", () => {
    expect(zhCN["onboarding.guide.profile.apiKey.text"]).not.toContain("自动获取");
  });
});
