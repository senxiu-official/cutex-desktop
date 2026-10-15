// Display terms (lib/terms): placeholder resolution, overrides, and a lint over every i18n string —
// a user-facing mention of an agent / the Director goes through `{{agent}}` / `{{director}}`
// (docs/module-dev-guide.md §4 术语), never a hard-coded word.
import { describe, expect, it } from "vitest";

const { applyTerms, autoPlural, DEFAULT_TERMS, parseOverrides, resolveTerms, retermDaemonText, unknownTermTokens } = await import("../src/renderer/src/lib/terms");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");

describe("applyTerms", () => {
  const enTerms = DEFAULT_TERMS.en;
  const zhTerms = DEFAULT_TERMS["zh-CN"];

  it("resolves singular / plural / capitalised / article forms in en", () => {
    expect(applyTerms("New {{agent}}", enTerms, "en")).toBe("New agent");
    expect(applyTerms("{{Agents}} online", enTerms, "en")).toBe("Agents online");
    expect(applyTerms("Ask the {{director}}", enTerms, "en")).toBe("Ask the Director");
    expect(applyTerms("{{Directors}}", enTerms, "en")).toBe("Directors");
    expect(applyTerms("Pick {{an agent}}", enTerms, "en")).toBe("Pick an agent");
    expect(applyTerms("{{A director}} is set", enTerms, "en")).toBe("A Director is set");
    expect(applyTerms("{{subagents}} · {{Subagent}}", enTerms, "en")).toBe("sub-agents · Sub-agent");
    expect(applyTerms("{{Owner}} notices · ask the {{owner}}", enTerms, "en")).toBe("Owner notices · ask the owner");
    expect(applyTerms("等待{{owner}}", DEFAULT_TERMS["zh-CN"], "zh-CN")).toBe("等待主人");
  });

  it("zh has one form and no article", () => {
    expect(applyTerms("新建{{agent}}", zhTerms, "zh-CN")).toBe("新建智能体");
    expect(applyTerms("{{subagents}} · {{Director}} · {{an agent}}", zhTerms, "zh-CN")).toBe("子智能体 · 主管 · 智能体");
  });

  it("leaves {var} and unknown placeholders alone", () => {
    expect(applyTerms("{name} · {{agentx}}", enTerms, "en")).toBe("{name} · {{agentx}}");
    expect(unknownTermTokens("{{agent}} {{Agents}} {{an director}} {{agentx}} {{ agent}}")).toEqual(["agentx", " agent"]);
  });

  it("the sub-agent word follows the agent word unless set on its own", () => {
    expect(resolveTerms({ "zh-CN": { agent: { one: "Maid" } } }, "zh-CN").subagent).toEqual({ one: "子Maid", many: "子Maid" });
    expect(resolveTerms({ "zh-CN": { agent: { one: "Maid" }, subagent: { one: "小女仆" } } }, "zh-CN").subagent).toEqual({ one: "小女仆", many: "小女仆" });
    expect(resolveTerms({ en: { agent: { one: "maid" } } }, "en").subagent).toEqual({ one: "sub-maid", many: "sub-maids" });
    expect(resolveTerms({ en: { subagent: { one: "helper" } } }, "en").subagent).toEqual({ one: "helper", many: "helpers" });
  });

  it("overrides replace the defaults; en derives a plural from a custom singular", () => {
    const o = parseOverrides({ en: { agent: { one: " butler " }, director: { one: "Boss", many: "Bosses!" } }, "zh-CN": { agent: { one: "管家" } }, fr: { agent: { one: "x" } } });
    expect(o).toEqual({ en: { agent: { one: "butler" }, director: { one: "Boss", many: "Bosses!" } }, "zh-CN": { agent: { one: "管家" } } });
    const t = resolveTerms(o, "en");
    expect(t.agent).toEqual({ one: "butler", many: "butlers" });
    expect(t.director).toEqual({ one: "Boss", many: "Bosses!" });
    expect(applyTerms("{{An agent}} and {{an agent}}", t, "en")).toBe("A butler and a butler");
    expect(resolveTerms(o, "zh-CN").agent).toEqual({ one: "管家", many: "管家" });
    expect(resolveTerms({}, "en")).toEqual(DEFAULT_TERMS.en);
    expect(autoPlural("assistant")).toBe("assistants");
    expect(autoPlural("deputy")).toBe("deputies");
    expect(autoPlural("boss")).toBe("bosses");
  });
});

// ---- lint over the catalogs ----

/**
 * Keys whose text names the word on purpose (a literal tool / product name, a native concept that
 * is not one of our agents). Each entry says why; keep it short.
 */
const ALLOWED: Record<string, string> = {};

/** Strips what is not prose: `code`, identifiers with _ - . / (agent_tell, cutex-agent-bus, AGENTS.md), placeholders. */
function prose(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\{\w+\}/g, " ")
    .replace(/[\w.-]*[A-Za-z0-9][_./-][\w./-]*/g, (w) => (/agent|director|owner/i.test(w) && !/^sub-agents?$/i.test(w) ? " " : w));
}

const ZH_BANNED = /agent|代理|智能体|director|主管|主人|owner/i;
const EN_BANNED = /\b(sub-?)?agents?\b|\bdirectors?\b|\bowners?\b/i;

function offenders(catalog: Record<string, string>, banned: RegExp): string[] {
  return Object.entries(catalog)
    .filter(([key, text]) => !ALLOWED[key] && banned.test(prose(text)))
    .map(([key, text]) => `${key}: ${text}`);
}

describe("i18n terms lint", () => {
  it("sub-agents use {{subagent}}, never 子{{agent}} / sub-{{agent}}", () => {
    const bad = [...Object.entries(zhCN), ...Object.entries(en)].filter(([, v]) => /子\{\{agents?\}\}|sub-?\{\{agents?\}\}/i.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("no unknown {{placeholders}}", () => {
    const bad = [...Object.entries(zhCN), ...Object.entries(en)].filter(([, v]) => unknownTermTokens(v).length > 0).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("zh-CN strings say agent / Director only through {{agent}} / {{director}}", () => {
    expect(offenders(zhCN as Record<string, string>, ZH_BANNED)).toEqual([]);
  });

  it("en strings say agent / Director only through {{agent}} / {{director}}", () => {
    expect(offenders(en, EN_BANNED)).toEqual([]);
  });

  it("allow-listed keys exist", () => {
    for (const key of Object.keys(ALLOWED)) expect(key in zhCN, key).toBe(true);
  });
});

describe("retermDaemonText", () => {
  it("swaps cutex's default zh words for the owner's terms", () => {
    const terms = resolveTerms({ "zh-CN": { agent: { one: "女仆" }, owner: { one: "我" } } }, "zh-CN");
    expect(retermDaemonText("主人回合中子智能体与智能体出错", terms, "zh-CN")).toBe("我回合中子女仆与女仆出错");
  });
  it("leaves default terms and other languages alone", () => {
    const zh = resolveTerms({}, "zh-CN");
    expect(retermDaemonText("智能体消息", zh, "zh-CN")).toBe("智能体消息");
    expect(retermDaemonText("Agent message", resolveTerms({}, "en"), "en")).toBe("Agent message");
  });
});
