import { describe, expect, it, vi } from "vitest";
import { boundSkills, fuzzyScore, insertMention, mentionAt, paletteQuery, parseSlash, rankEntries, runSlash, SLASH_COMMANDS, slashSpec, slashUnavailable, type PaletteEntry, type SlashContext } from "../src/renderer/src/lib/slashCommands";
import { INIT_PROMPT } from "../src/renderer/src/lib/initPrompt";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const entry = (name: string, description = "", keywords: string[] = []): PaletteEntry => ({ key: name, kind: "command", name, description, keywords });

describe("fuzzyScore", () => {
  it("orders prefix > word start > substring > subsequence, null on miss", () => {
    const prefix = fuzzyScore("re", "review")!;
    const sub = fuzzyScore("view", "review")!;
    const seq = fuzzyScore("rvw", "review")!;
    expect(prefix).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(seq);
    expect(seq).toBeGreaterThan(0);
    expect(fuzzyScore("zz", "review")).toBeNull();
    expect(fuzzyScore("", "x")).toBe(0);
  });
  it("matches CJK text", () => {
    expect(fuzzyScore("压缩", "压缩当前对话")).not.toBeNull();
    expect(fuzzyScore("对话", "压缩当前对话")).not.toBeNull();
  });
});

describe("rankEntries", () => {
  const entries = [entry("goal", "Show or set the goal", ["查看或设置目标"]), entry("compact", "Compact the conversation", ["压缩当前对话"]), entry("copy", "Copy the last response", ["复制最后一条回复"]), entry("plan", "Switch to Plan mode", ["切换到计划模式"])];
  it("keeps registry order for an empty query", () => {
    expect(rankEntries("", entries).map((e) => e.name)).toEqual(["goal", "compact", "copy", "plan"]);
  });
  it("ranks name prefix first, then fuzzy name, then description matches", () => {
    expect(rankEntries("co", entries).map((e) => e.name).slice(0, 2)).toEqual(["compact", "copy"]);
    expect(rankEntries("cpy", entries)[0]!.name).toBe("copy");
    // "mode" only appears in plan's description
    expect(rankEntries("mode", entries).map((e) => e.name)).toEqual(["plan"]);
  });
  it("ignores short / mid-word English description hits", () => {
    const list = [entry("review", "Review the uncommitted changes"), entry("status", "Show the session configuration")];
    expect(rankEntries("co", list)).toEqual([]);
    expect(rankEntries("config", list).map((e) => e.name)).toEqual(["status"]);
  });
  it("matches either locale's description", () => {
    expect(rankEntries("压缩", entries).map((e) => e.name)).toEqual(["compact"]);
    expect(rankEntries("计划", entries).map((e) => e.name)).toEqual(["plan"]);
  });
  it("finds /side by its /btw alias while keeping its unavailable reason", () => {
    const spec = slashSpec("side")!;
    const candidate = { ...entry(spec.id, "", [...spec.aliases!]), disabledReason: "agentUnsupported" };
    expect(rankEntries("btw", [candidate])).toEqual([candidate]);
  });
  it("sinks unavailable entries below equal matches", () => {
    const list = [{ ...entry("fork"), disabledReason: "gap" }, entry("format")];
    expect(rankEntries("f", list).map((e) => e.name)).toEqual(["format", "fork"]);
  });
});

describe("draft tokens", () => {
  it("opens the palette only for a leading /word", () => {
    expect(paletteQuery("/")).toBe("");
    expect(paletteQuery("/go")).toBe("go");
    expect(paletteQuery("/goal x")).toBeNull();
    expect(paletteQuery("hi /go")).toBeNull();
  });
  it("parses known commands with args; unknown /… is text", () => {
    expect(parseSlash("/goal  ship it ")).toEqual({ id: "goal", args: "ship it" });
    expect(parseSlash("/compact")).toEqual({ id: "compact", args: "" });
    expect(parseSlash("/usr/bin/env")).toBeNull();
    expect(parseSlash("/quit")).toBeNull();
    expect(parseSlash("/review\nfocus on tests")).toEqual({ id: "review", args: "focus on tests" });
  });
  it("finds the @token at the caret and replaces it", () => {
    expect(mentionAt("see @doc", 8)).toEqual({ start: 4, end: 8, query: "doc" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(mentionAt("mail a@b", 8)).toBeNull();
    expect(mentionAt("see @doc now", 6)).toEqual({ start: 4, end: 8, query: "d" });
    expect(insertMention("see @doc now", { start: 4, end: 8 }, "docs/DESIGN.md")).toEqual({ text: "see docs/DESIGN.md now", caret: 19 });
    expect(insertMention("@my", { start: 0, end: 3 }, "my file.md").text).toBe('"my file.md" ');
  });
  it("keeps only skills whose $name is still in the text", () => {
    const picked = [{ name: "pdf", path: "/s/pdf" }, { name: "xlsx", path: "/s/x" }, { name: "pdf", path: "/s/pdf" }];
    expect(boundSkills("$pdf fill the form", picked)).toEqual([{ name: "pdf", path: "/s/pdf" }]);
    expect(boundSkills("use $pdfx", picked)).toEqual([]);
  });
});

function ctx(over: Partial<SlashContext> = {}): SlashContext & Record<string, ReturnType<typeof vi.fn>> {
  const fns = {
    open: vi.fn(),
    insert: vi.fn(),
    notify: vi.fn(),
    submitText: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    setGoal: vi.fn(async () => {}),
    goalVerb: vi.fn(async () => {}),
    review: vi.fn(async () => {}),
    setPlan: vi.fn(async () => true),
    rename: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    fork: vi.fn(async () => {}),
    newAgent: vi.fn(),
    side: vi.fn(),
    openDiff: vi.fn(),
    stopBackground: vi.fn(async () => 2),
    copyLast: vi.fn(async () => true),
    exportMarkdown: vi.fn(async () => {}),
    openSettings: vi.fn(),
  };
  return { online: true, hasGoal: false, planActive: false, features: new Set<string>(), ...fns, ...over } as never;
}

describe("runSlash", () => {
  it("/side and /btw dispatch outside the main queue even during a main turn", async () => {
    const c = ctx({ features: new Set(["side-chat"]), busy: true });
    expect(slashSpec("btw")).toBe(slashSpec("side"));
    await runSlash(slashSpec("btw")!.id, "a side question", c);
    expect(c.side).toHaveBeenCalledWith("a side question");
    expect(c.submitText).not.toHaveBeenCalled();
    const agent = { runtime: "claude" as const, map: null };
    expect(slashUnavailable(slashSpec("btw")!, new Set(["side-chat"]), agent)).toBe("agentUnsupported");
  });
  it("/goal: set, verbs, show, usage", async () => {
    let c = ctx();
    await runSlash("goal", "ship the palette", c);
    expect(c.setGoal).toHaveBeenCalledWith("ship the palette");
    await runSlash("goal", "Pause", c);
    expect(c.goalVerb).toHaveBeenCalledWith("pause");
    await runSlash("goal", "edit", c);
    expect(c.goalVerb).toHaveBeenCalledWith("edit");
    await runSlash("goal", "", c);
    expect(c.insert).toHaveBeenCalledWith("/goal ");
    expect(c.notify).toHaveBeenCalledWith("slash.notice.goalUsage");
    c = ctx({ hasGoal: true });
    await runSlash("goal", "", c);
    expect(c.open).toHaveBeenCalledWith("goal");
  });
  it("needs a thread where it must", async () => {
    const c = ctx({ online: false });
    await runSlash("review", "", c);
    expect(c.review).not.toHaveBeenCalled();
    expect(c.notify).toHaveBeenCalledWith("slash.notice.needsOnline", { name: "review" });
    await runSlash("model", "", c);
    expect(c.open).toHaveBeenCalledWith("model");
  });
  it("/plan toggles, or switches and sends", async () => {
    let c = ctx({ planActive: true });
    await runSlash("plan", "", c);
    expect(c.setPlan).toHaveBeenCalledWith(false);
    c = ctx();
    await runSlash("plan", "design the cache", c);
    expect(c.setPlan).toHaveBeenCalledWith(true);
    expect(c.submitText).toHaveBeenCalledWith("design the cache");
    c = ctx({ setPlan: vi.fn(async () => false) });
    await runSlash("plan", "x", c);
    expect(c.submitText).not.toHaveBeenCalled();
    expect(c.notify).toHaveBeenCalledWith("slash.notice.planUnavailable");
    // Stale (selection / host changed meanwhile): neither a notice nor a send.
    for (const args of ["", "x"]) {
      c = ctx({ setPlan: vi.fn(async () => null) });
      await runSlash("plan", args, c);
      expect(c.submitText).not.toHaveBeenCalled();
      expect(c.notify).not.toHaveBeenCalled();
    }
  });
  it("maps the rest to their features", async () => {
    const c = ctx();
    await runSlash("review", "focus on races", c);
    expect(c.review).toHaveBeenCalledWith("focus on races");
    await runSlash("review", "", c);
    expect(c.review).toHaveBeenLastCalledWith(null);
    await runSlash("init", "", c);
    expect(c.submitText).toHaveBeenCalledWith(INIT_PROMPT);
    await runSlash("usage", "", c);
    expect(c.open).toHaveBeenCalledWith("quota");
    await runSlash("rename", "Mika", c);
    expect(c.rename).toHaveBeenCalledWith("Mika");
    await runSlash("rename", "", c);
    expect(c.rename).toHaveBeenLastCalledWith(null);
    await runSlash("stop", "", c);
    expect(c.notify).toHaveBeenCalledWith("slash.notice.stopped", { n: 2 });
    await runSlash("logout", "", c);
    expect(c.openSettings).toHaveBeenCalledWith("logout");
    await runSlash("fork", "", c);
    expect(c.notify).toHaveBeenCalledWith("slash.notice.unavailable", { name: "fork" });
    expect(c.fork).not.toHaveBeenCalled();
  });
  it("/fork runs once cutex has session-fork", async () => {
    const c = ctx({ features: new Set(["session-fork"]) });
    await runSlash("fork", "", c);
    expect(c.fork).toHaveBeenCalled();
    expect(slashUnavailable(slashSpec("fork")!, new Set())).toBe("forkGap");
    expect(slashUnavailable(slashSpec("fork")!, new Set(["session-fork"]))).toBeUndefined();
    expect(slashUnavailable(slashSpec("side")!, new Set(["session-fork"]))).toBe("sideGap");
  });
  it("every command has zh-CN and en labels", () => {
    for (const c of SLASH_COMMANDS) {
      const key = `slash.cmd.${c.id}` as keyof typeof zhCN;
      expect(zhCN[key], c.id).toBeTruthy();
      expect(en[key], c.id).toBeTruthy();
    }
    expect(INIT_PROMPT).toMatch(/^Generate a file named AGENTS\.md/);
    expect(INIT_PROMPT).not.toContain("\r");
  });
});
