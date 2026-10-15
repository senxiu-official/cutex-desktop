// Owner-facing text for an agent's refused browser call (modules/browser/browserTimeline.ts).
import { expect, it } from "vitest";
import { browserTimelineEn, browserTimelineRefusalKey, browserTimelineZhCN } from "../src/renderer/src/modules/browser/browserTimeline";

it("says why and what works for refusals the owner can act on; others keep the generic text", () => {
  expect(browserTimelineRefusalKey("external_pages_unavailable")).toBe("browser.timeline.refused.external");
  expect(browserTimelineRefusalKey("service_proxy_required")).toBe("browser.timeline.refused.serviceProxy");
  expect(browserTimelineRefusalKey("browser_disabled")).toBe("browser.timeline.refused.disabled");
  expect(browserTimelineRefusalKey("busy")).toBeNull();
  expect(browserTimelineRefusalKey(null)).toBeNull();
  expect(browserTimelineZhCN["browser.timeline.refused.external"]).toContain("cutex:service/");
  expect(browserTimelineEn["browser.timeline.refused.external"]).toContain("cutex:service/");
});
