// 项目看板 problem rows (owner 2026-11-25): grouped causes read as one line; 回合, not 轮.
import { describe, expect, it } from "vitest";
import { boardText } from "../src/renderer/src/board/i18n";

describe("board problem text", () => {
  it("zh-CN: 「N 个智能体读不到状态：a、b、c 等」, 上一回合", () => {
    const t = boardText("zh-CN", null);
    expect(t.problemGroup("memberUnavailable", 239, ["a", "b", "c", "d"])).toBe("239 个智能体读不到状态：a、b、c 等");
    expect(t.problemGroup("memberUnavailable", 2, ["a", "b"])).toBe("2 个智能体读不到状态：a、b");
    expect(t.problemGroup("agentError", 5, [])).toBe("5 个智能体出错");
    expect(t.problem("lastTurnFailed", "m", null)).toBe("m 上一回合出错");
    expect(t.problemGroup("lastTurnFailed", 3, ["m"])).toBe("3 个智能体上一回合出错：m 等");
  });
  it("en", () => {
    const t = boardText("en", null);
    expect(t.problemGroup("memberUnavailable", 12, ["a", "b", "c", "d"])).toBe("12 agents: state not readable (a, b, c, …)");
    expect(t.problemGroup("agentError", 2, ["a", "b"])).toBe("2 agents failed (a, b)");
  });
});
