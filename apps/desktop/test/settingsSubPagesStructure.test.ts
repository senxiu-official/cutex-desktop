// @vitest-environment jsdom
// Cards that moved to a sub-page stay link and search targets: their anchors lead to the sub-page.
import { describe, expect, it } from "vitest";
import { movedSettingsRoute, settingsTab, subPageOfAnchor } from "../src/renderer/src/lib/settingsNav";
import agentConfig from "../src/renderer/src/modules/agent-config";
import featureProfiles from "../src/renderer/src/modules/feature-profiles";
import approvals from "../src/renderer/src/modules/approvals";
import browser from "../src/renderer/src/modules/browser";
import { COLLAB_SEARCH } from "../src/renderer/src/modules/agent-config/settingsSearch";

describe("网站权限's full list", () => {
  it("has its own anchor; the card with the first rows stays on the page", () => {
    const page = browser.contributes!["settings.page"]!.find((p) => p.page === "browser")!;
    expect(subPageOfAnchor(page, "site-permissions-all")).toBe("sites");
    expect(subPageOfAnchor(page, "site-permissions")).toBeUndefined();
    expect(page.sections!.map((s) => s.anchor)).toContain("site-permissions");
  });
});

describe("功能 Profile: a card of Profile (owner 2026-11-26), not a page of 工具", () => {
  const profiles = agentConfig.contributes!["settings.page"]!.find((p) => p.page === "profiles")!;
  it("its card is on the Profile page after the agent Profiles' cards; 全部 N 个 is Profile's sub-page", () => {
    expect(featureProfiles.contributes!["settings.page"]).toBeUndefined();
    const sections = featureProfiles.contributes!["settings.section"]!;
    expect(sections.map((s) => [s.id, s.page])).toEqual([["feature-profiles.list", "profiles"], ["feature-profiles.all", "profiles"]]);
    expect(sections[0]!.order).toBeGreaterThan(200); // after Claude 账户, Kimi 账户, 从 CC Switch 导入
    expect(sections[0]!.keywords).toContain("feature-profiles.form.baseUrl");
    expect(subPageOfAnchor(profiles, "feature-profiles.all")).toBe("features");
    expect(subPageOfAnchor(profiles, "feature-profiles.list")).toBeUndefined();
    expect(featureProfiles.requires?.capabilities).toEqual(["feature-profiles"]);
  });
  it("old ids still land: the page id, its 全部 sub-page, and the alias the page frame reads", () => {
    expect(settingsTab({ tab: "feature-profiles" })).toBe("profiles");
    expect(movedSettingsRoute("feature-profiles", undefined)).toEqual({ tab: "profiles", focus: { sub: undefined, anchor: "feature-profiles.list" } });
    expect(movedSettingsRoute("feature-profiles", { sub: "all" })).toEqual({ tab: "profiles", focus: { sub: "features", anchor: undefined } });
    expect(movedSettingsRoute("feature-profiles", { anchor: "feature-profiles.all" })).toEqual({ tab: "profiles", focus: { sub: undefined, anchor: "feature-profiles.all" } });
    // 输入优化 (owner 2026-11-26): the old page lands on its card in 会话; its template editor on the detail page under 会话.
    expect(movedSettingsRoute("input-refinement", undefined)).toEqual({ tab: "conversation", focus: { sub: undefined, anchor: "input-refinement.card" } });
    expect(movedSettingsRoute("input-refinement", { sub: "template" })).toEqual({ tab: "input-refinement-detail", focus: { sub: "template", anchor: undefined } });
    expect(settingsTab({ tab: "input-refinement" })).toBe("conversation");
    const focus = { anchor: "projects" };
    expect(movedSettingsRoute("sidebar", focus)).toEqual({ tab: "sidebar", focus });
  });
});

describe("cards moved to a sub-page of 协作", () => {
  const collab = agentConfig.contributes!["settings.page"]!.find((p) => p.page === "collab")!;
  it("互通的项目", () => {
    expect(subPageOfAnchor(collab, "links")).toBe("links");
    expect(COLLAB_SEARCH.sections!.map((s) => s.anchor)).toContain("links");
  });
  it("可见的外部智能体", () => {
    expect(subPageOfAnchor(collab, "external")).toBe("external");
    expect(COLLAB_SEARCH.sections!.map((s) => s.anchor)).toContain("external");
  });
  it("规则审计's full list", () => {
    expect(subPageOfAnchor(collab, "approvals.rules.auditAll")).toBe("audit");
    const section = approvals.contributes!["settings.section"]!.find((s) => s.id === "approvals.rules.auditAll")!;
    expect(section.page).toBe("collab");
    expect(section.titleKey).toBe("approvals.rules.audit");
  });
  it("cards still on the page stay there", () => {
    expect(subPageOfAnchor(collab, "boundary")).toBeUndefined();
    expect(subPageOfAnchor(collab, "templates")).toBeUndefined();
  });
});
