// @vitest-environment jsdom
// Cards that moved to a sub-page stay link and search targets: their anchors lead to the sub-page.
import { describe, expect, it } from "vitest";
import { subPageOfAnchor } from "../src/renderer/src/lib/settingsNav";
import agentConfig from "../src/renderer/src/modules/agent-config";
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
