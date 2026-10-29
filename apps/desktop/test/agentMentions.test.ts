import { describe, expect, it } from "vitest";
import { agentMentionMarkdown, agentMentionTokens, parseAgentMentionHref, parseAgentMention } from "../src/renderer/src/lib/agentMentions";

const id = "cutex.00000000-0000-4000-8000-000000000001";
describe("agent mention wire format", () => {
  it.each([id, "cutex.01a16980ed207000a1ab4a24a5e6d928", "cutex.ag-alpha", "cutex.ag-helper-2"])("accepts complete identity %s", value => {
    expect(parseAgentMentionHref(`cutex:agent/${value}`)).toBe(value);
    expect(agentMentionMarkdown("Helper", value)).toBe(`[@Helper](cutex:agent/${value})`);
  });
  it.each(["s1", "cutex.123abc", "cutex.01a16980-ed20", "cutex.ag-", "cutex.ag-a/other", `${id}?host=other`, `${id}#x`, `${id}/x`, `%63${id.slice(1)}`, `${id}\n`, "../private"])("rejects incomplete or unsafe identity %s", value => {
    expect(parseAgentMentionHref(`cutex:agent/${value}`)).toBeNull();
    expect(() => agentMentionMarkdown("Helper", value)).toThrow("invalid_agent_mention_id");
  });
  it.each([`https://example.test/${id}`, `javascript:cutex:agent/${id}`, `cutex://agent/${id}`, ` cutex:agent/${id}`, `cutex:artifact/${id}`])("rejects alternate href %s", href => expect(parseAgentMentionHref(href)).toBeNull());
  it("round-trips Unicode and every Markdown punctuation character without injecting markup", () => {
    const name = '名字 🦊 [x](javascript:alert(1)) ! " \\ _*`<> &amp; # {hello} | ~';
    const raw = agentMentionMarkdown(name, id);
    expect(agentMentionTokens(raw)).toEqual([{ id, host: null, name, raw, start: 0, end: raw.length }]);
    expect(raw).toContain("\\[x\\]");
    expect(raw).toContain("\\<\\>");
  });
  it("another host's agent: @name@host in the text, the host after @ in the key; names keep - . _ unescaped", () => {
    const raw = agentMentionMarkdown("deleg-core_v2.1", id, "remote");
    expect(raw).toBe(`[@deleg-core_v2.1@remote](cutex:agent/${id}@remote)`);
    expect(agentMentionTokens(raw)).toEqual([{ id, host: "remote", name: "deleg-core_v2.1", raw, start: 0, end: raw.length }]);
    expect(parseAgentMention(`cutex:agent/${id}@my%20box`)).toEqual({ id, host: "my box" });
    expect(agentMentionMarkdown("A", id, "my box")).toBe(`[@A@my box](cutex:agent/${id}@my%20box)`);
    expect(parseAgentMention(`cutex:agent/${id}@`)).toBeNull();
    expect(parseAgentMention("cutex:agent/short@remote")).toBeNull();
  });
  it("normalizes multiline labels and falls back to the full ID for empty names", () => {
    expect(agentMentionTokens(agentMentionMarkdown("  First\nSecond\tThird\u0000 ", id))[0]?.name).toBe("First Second Third");
    expect(agentMentionTokens(agentMentionMarkdown("", id))[0]?.name).toBe(id);
  });
  it("reports exact UTF-16 offsets, duplicate occurrences and untouched surrounding text", () => {
    const a = agentMentionMarkdown("Name ] \\ end", id), b = agentMentionMarkdown("Other", "cutex.ag-beta");
    const text = `🙂 start ${a} then ${b} ${a}!`;
    const tokens = agentMentionTokens(text);
    expect(tokens.map(token => token.id)).toEqual([id, "cutex.ag-beta", id]);
    expect(tokens[0]!.start).toBe("🙂 start ".length);
    for (const token of tokens) expect(text.slice(token.start, token.end)).toBe(token.raw);
  });
  it("does not claim image links, escaped openings, malformed labels or unsafe hrefs", () => {
    const raw = agentMentionMarkdown("Name", id);
    expect(agentMentionTokens(`!${raw} \\${raw} [@Name](cutex:agent/${id}?x=1) [@Name\n](cutex:agent/${id})`)).toEqual([]);
    expect(agentMentionTokens(`\\\\${raw}`)).toHaveLength(1);
  });
});
