import { describe, expect, it } from "vitest";
import { BROWSER_ERROR_CODES } from "@cutex-desktop/browser-protocol";
import { RELAY_CODES } from "../src/main/browser/relayTypes";
import { browserErrorKey } from "../src/renderer/src/modules/browser/browserState";
import { zhCN, en } from "../src/renderer/src/modules/browser/i18n";
import { browserToolView } from "../src/renderer/src/modules/browser/browserTimeline";

describe("browser owner error localization", () => {
  it.each([...new Set([...RELAY_CODES, ...BROWSER_ERROR_CODES, "browser_identity_recovered"])])("localizes %s in both languages without raw diagnostics", code => {
    const key = browserErrorKey({ code, message: "SECRET http://private/" });
    expect(key).not.toBe("browser.error.unknown");
    expect(zhCN[key]).toBeTruthy(); expect(en[key]).toBeTruthy(); expect(zhCN[key]).not.toBe(code); expect(en[key]).not.toBe(code);
    expect(browserErrorKey(new Error(`Error invoking remote method 'cutex:browser': Error: ${code}`))).toBe(key);
  });
  it.each(RELAY_CODES.filter(code => code !== "loopback_only"))("timeline recognizes safe typed %s for the same localized projection", code => {
    const view = browserToolView({ id: "i", type: "mcpToolCall", server: "cutex", tool: "browser_open", status: "completed",
      result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: "SECRET" } }) }] } });
    expect(view?.errorCode).toBe(code); expect(view?.state).toBe("failed"); expect(JSON.stringify(view)).not.toContain("SECRET");
  });
  it("gives actionable lease-limit and honest isolated-recovery text, never an arbitrary message fallback", () => {
    expect(zhCN[browserErrorKey("lease_limit")]).toContain("释放"); expect(en[browserErrorKey("lease_limit")]).toContain("Release");
    expect(zhCN[browserErrorKey("browser_identity_recovered")]).toContain("原登录状态未沿用");
    expect(browserErrorKey(Error("SECRET token=private"))).toBe("browser.error.unknown");
  });
});
