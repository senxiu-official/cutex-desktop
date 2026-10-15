import { describe, expect, it } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import { isDefaultProfile, modelLine, orderProfiles, profileProblems } from "../src/renderer/src/lib/profileCards";
import { gaugeLabel } from "../src/renderer/src/lib/quota";

const item = (name: string, over: Partial<ProfileItem> = {}): ProfileItem =>
  ({ id: `id-${name}`, name, cliKind: "codex", authKind: "apiKey", authPresent: true, isDefault: false, model: null, modelReasoningEffort: null, ...over }) as ProfileItem;

describe("profile cards", () => {
  it("recognises the default by flag, name or id", () => {
    expect(isDefaultProfile(item("a", { isDefault: true }), null)).toBe(true);
    expect(isDefaultProfile(item("a"), "a")).toBe(true);
    expect(isDefaultProfile(item("a"), "id-a")).toBe(true);
    expect(isDefaultProfile(item("a"), "b")).toBe(false);
    expect(isDefaultProfile(item("a"), null)).toBe(false);
  });

  it("puts the default first and keeps the saved order otherwise", () => {
    const list = { defaultProfile: "c", profiles: [item("a"), item("b"), item("c"), item("d")] };
    expect(orderProfiles(list).map((p) => p.name)).toEqual(["c", "a", "b", "d"]);
    expect(orderProfiles({ defaultProfile: null, profiles: [item("b"), item("a")] }).map((p) => p.name)).toEqual(["b", "a"]);
  });

  it("derives problems by kind and quota errors", () => {
    expect(profileProblems(item("k", { authPresent: false }), undefined)).toEqual(["keyMissing"]);
    expect(profileProblems(item("o", { authKind: "chatgpt", authPresent: false }), [])).toEqual(["notLoggedIn"]);
    expect(profileProblems(item("o", { authKind: "chatgpt", authPresent: true }), [{ error: null }, { error: "401" }])).toEqual(["quotaError"]);
    // Claude CLI manages its own login: no ⚠ for a missing auth file.
    expect(profileProblems(item("c", { cliKind: "claude", authKind: "none", authPresent: false }), undefined)).toEqual([]);
  });

  it("summarises the default model", () => {
    expect(modelLine(item("a", { model: "deepseek-v4-flash", modelReasoningEffort: "high" }))).toBe("deepseek-v4-flash · high");
    expect(modelLine(item("a", { model: "glm-5" }))).toBe("glm-5");
    expect(modelLine(item("a"))).toBeNull();
  });

  it("labels gauges without repeating the window", () => {
    expect(gaugeLabel({ label: "GLM", windowLabel: "5h" })).toBe("GLM 5h");
    expect(gaugeLabel({ label: "7d", windowLabel: "7d" })).toBe("7d");
    expect(gaugeLabel({ label: "余额", windowLabel: null })).toBe("余额");
  });
});
