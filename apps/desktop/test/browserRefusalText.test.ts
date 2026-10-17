// Owner-facing text for an agent's refused browser call (modules/browser/browserTimeline.ts).
import { expect, it } from "vitest";
import { browserTimelineEn, browserTimelineRefusalKey, browserTimelineZhCN } from "../src/renderer/src/modules/browser/browserTimeline";

it("says why and what works for refusals the owner can act on; others keep the generic text", () => {
  expect(browserTimelineRefusalKey("external_pages_unavailable")).toBe("browser.timeline.refused.external");
  expect(browserTimelineRefusalKey("service_proxy_required")).toBe("browser.timeline.refused.serviceProxy");
  expect(browserTimelineRefusalKey("browser_disabled")).toBe("browser.timeline.refused.disabled");
  expect(browserTimelineRefusalKey("busy")).toBeNull();
  expect(browserTimelineRefusalKey(null)).toBeNull();
  // The daemon's generic code covers several causes: never claim one (e.g. "turn on websites").
  expect(browserTimelineZhCN["browser.timeline.refused.external"]).toContain("具体原因");
  expect(browserTimelineEn["browser.timeline.refused.external"]).toContain("exact reason");
});
