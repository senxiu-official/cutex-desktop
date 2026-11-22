import { describe, expect, it } from "vitest";
import { BROWSER_POPUP_OWNER_INPUT_MS, BrowserPopupInput } from "../src/main/browser/popupInput";
describe("browser popup owner input gate", () => {
  it("requires trusted native input, rejects script/no-input, and consumes each input once", () => {
    const gate = new BrowserPopupInput(() => 1);
    expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", false); expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", true); expect(gate.consume()).toBe(true); expect(gate.consume()).toBe(false);
  });
  it("bounds activation to Chromium's 5 s (an awaited fetch before window.open) and one forwarding per guest per second", () => {
    let now = 0; const gate = new BrowserPopupInput(() => now);
    expect(BROWSER_POPUP_OWNER_INPUT_MS).toBe(5000);
    gate.observe("keyDown", true); now = 5001; expect(gate.consume()).toBe(false); expect(gate.rejection).toBe("no_owner_input");
    gate.observe("keyDown", true); now = 9900; expect(gate.consume()).toBe(true);
    now = 10_000; gate.observe("mouseUp", true); expect(gate.consume()).toBe(false); expect(gate.rejection).toBe("rate_limited");
    now = 11_000; gate.observe("mouseUp", true); expect(gate.consume()).toBe(true);
    // Still consumed once: one click, one window.
    expect(gate.consume()).toBe(false);
  });
  it("ignores the agent's own dispatched input and never replays it as an owner gesture", () => {
    let agent = false; const gate = new BrowserPopupInput(() => 0, () => agent);
    gate.observe("keyDown", true); agent = true; expect(gate.consume()).toBe(false); expect(gate.rejection).toBe("agent_input");
    gate.observe("mouseUp", true); agent = false; expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", true); expect(gate.consume()).toBe(true);
  });
  it("rate limits agent-caused popups to one per second", () => {
    let now = 0; const gate = new BrowserPopupInput(() => now, () => true);
    expect(gate.consumeAgent()).toBe(true); now = 500; expect(gate.consumeAgent()).toBe(false);
    now = 1000; expect(gate.consumeAgent()).toBe(true);
  });
  it("revokes and ignores unrecognized events", () => {
    const gate = new BrowserPopupInput(() => 0);
    gate.observe("mouseMove", true); expect(gate.consume()).toBe(false);
    gate.observe("keyDown", true); gate.revoke(); expect(gate.consume()).toBe(false);
  });
});
