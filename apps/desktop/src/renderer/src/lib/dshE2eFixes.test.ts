// r265 D3 (real-daemon desktop E2E) fixes: the DSH approval card names DSH's sandbox, a DSH variant's
// default effort reads cutex's model catalog, the profile header does not repeat a name.
import { describe, expect, it } from "vitest";
import { approvalSourceKeys } from "../components/ApprovalSource";
import { headerExtras } from "./profileCards";
import { variantEffort } from "./profileVariants";

describe("approval source label", () => {
  it("names DSH's own sandbox on a DSH agent", () => {
    expect(approvalSourceKeys("native", "dsh")).toEqual({ label: "dsh.approvalSource", hint: "dsh.approvalSource.hint" });
  });
  it("keeps the existing labels elsewhere", () => {
    expect(approvalSourceKeys("native", "codex")).toEqual({ label: "approvalSource.native", hint: "approvalSource.native.hint" });
    expect(approvalSourceKeys("native")).toEqual({ label: "approvalSource.native", hint: "approvalSource.native.hint" });
    expect(approvalSourceKeys("cutex", "dsh")).toEqual({ label: "approvalSource.cutex", hint: "approvalSource.cutex.hint" });
  });
});

describe("variantEffort", () => {
  const models = [
    { id: "deepseek-flash", defaultReasoningEffort: "high", isDefault: true },
    { id: "deepseek-v4-pro", defaultReasoningEffort: "max" },
  ];
  it("prefers the variant default", () => {
    expect(variantEffort({ defaults: { model: null, reasoningEffort: "low" }, models }, "deepseek-flash")).toBe("low");
  });
  it("falls back to the chosen model's default from cutex's catalog", () => {
    expect(variantEffort({ defaults: { model: "deepseek-flash", reasoningEffort: null }, models }, "deepseek-flash")).toBe("high");
    expect(variantEffort({ defaults: { model: null, reasoningEffort: null }, models }, "deepseek-v4-pro")).toBe("max");
    expect(variantEffort({ defaults: { model: null, reasoningEffort: null }, models }, null)).toBe("high");
  });
  it("is unknown without a catalog row", () => {
    expect(variantEffort({ defaults: { model: null, reasoningEffort: null } }, "deepseek-flash")).toBeNull();
    expect(variantEffort({ defaults: { model: null, reasoningEffort: null }, models }, "other")).toBeNull();
  });
});

describe("headerExtras", () => {
  it("drops a plan / family that repeats the preset", () => {
    expect(headerExtras("API Key · DeepSeek", "DeepSeek", "DeepSeek")).toEqual({ plan: null, family: null });
    expect(headerExtras("API Key · DeepSeek", "deepseek ", null)).toEqual({ plan: null, family: null });
  });
  it("keeps distinct names once", () => {
    expect(headerExtras("API Key · 智谱", "GLM Pro", "Zhipu")).toEqual({ plan: "GLM Pro", family: "Zhipu" });
    expect(headerExtras("API Key · 自定义", "Plus", "Plus")).toEqual({ plan: "Plus", family: null });
    expect(headerExtras("ChatGPT", null, null)).toEqual({ plan: null, family: null });
  });
});
