// @vitest-environment jsdom
// 浏览器身份 package E-UI: main's password prompts / fill offers per tab, and refusal codes as owner text.
import { beforeEach, describe, expect, it } from "vitest";
import { applyPasswordEvent, forgetPasswordUi, passwordErrorKey, passwordTabKey, usePasswordUi } from "../src/renderer/src/modules/browser/passwordUi";
import { browserIdentityZhCN } from "../src/renderer/src/modules/browser/identityMessages";

const TAB = "00000000-0000-4000-8000-000000000009";
const prompt = { promptId: "p1", hostId: "local", tabKey: TAB, identityId: "1a2b3c4d", origin: "https://a.test", username: "u", kind: "save" as const };
const offer = { offerId: "o1", hostId: "local", tabKey: TAB, identityId: "1a2b3c4d", origin: "https://a.test", field: { x: 1, y: 2, width: 3, height: 4 }, logins: [{ id: "l", username: "u" }] };

describe("password prompts and offers", () => {
  beforeEach(() => usePasswordUi.setState({ prompts: {}, offers: {} }));

  it("keeps one prompt and one offer per tab, and drops them on main's close", () => {
    applyPasswordEvent({ kind: "passwordPrompt", prompt });
    applyPasswordEvent({ kind: "fillOffer", offer });
    const key = passwordTabKey("local", TAB);
    expect(usePasswordUi.getState().prompts[key]?.promptId).toBe("p1");
    expect(usePasswordUi.getState().offers[key]?.offerId).toBe("o1");
    applyPasswordEvent({ kind: "passwordPrompt", prompt: { ...prompt, promptId: "p2", kind: "update" } });
    expect(usePasswordUi.getState().prompts[key]?.promptId).toBe("p2");
    applyPasswordEvent({ kind: "passwordPromptClosed", promptId: "p1" });
    expect(usePasswordUi.getState().prompts[key]?.promptId).toBe("p2");
    forgetPasswordUi("prompt", "p2");
    forgetPasswordUi("offer", "o1");
    expect(usePasswordUi.getState()).toEqual({ prompts: {}, offers: {} });
  });

  it("says each refusal plainly", () => {
    for (const code of ["auth_cancelled", "auth_unavailable", "key_lost", "tab_granted", "offer_closed", "origin_changed", "field_gone"]) {
      const key = passwordErrorKey(new Error(`Error invoking remote method 'x': Error: ${code}`));
      expect(key).toBe(`browser.password.error.${code}`);
      expect(browserIdentityZhCN[key as keyof typeof browserIdentityZhCN]).toBeTruthy();
    }
    expect(passwordErrorKey("weird")).toBe("browser.password.error.failed");
  });

  it("tells the owner that lost keys cannot be recovered", () => {
    expect(browserIdentityZhCN["browser.password.status.keyLost"]).toContain("找不回来");
    expect(browserIdentityZhCN["browser.password.status.unreadable"]).toContain("找不回来");
  });
});
