// Settings → 自定义桌面 became part of the guide (owner 2026-11-26, module start): links and saved params with the old
// page id land on 外观, which holds those settings (lib/settingsNav PAGE_ALIASES).
import { describe, expect, it } from "vitest";
import { CUSTOMIZE_OLD_PAGE, settingsTab } from "../src/renderer/src/lib/settingsNav";

describe("the old 自定义桌面 page id", () => {
  it("lands on 外观", () => {
    expect(CUSTOMIZE_OLD_PAGE).toBe("customize-desktop");
    expect(settingsTab({ tab: CUSTOMIZE_OLD_PAGE })).toBe("appearance");
  });
});
