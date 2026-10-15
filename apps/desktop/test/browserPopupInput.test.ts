import { describe, expect, it } from "vitest";
import { BrowserPopupInput } from "../src/main/browser/popupInput";
describe("browser popup owner input gate", () => {
  it("requires trusted native input, rejects script/no-input, and consumes each input once", () => {
    const gate = new BrowserPopupInput(() => 1);
    expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", false); expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", true); expect(gate.consume()).toBe(true); expect(gate.consume()).toBe(false);
  });
  it("bounds activation to 500ms and one forwarding per guest per second", () => {
    let now = 0; const gate = new BrowserPopupInput(() => now);
    gate.observe("keyDown", true); now = 501; expect(gate.consume()).toBe(false);
    gate.observe("keyDown", true); expect(gate.consume()).toBe(true);
    now = 600; gate.observe("mouseUp", true); expect(gate.consume()).toBe(false); expect(gate.rejection).toBe("rate_limited");
    now = 1501; gate.observe("mouseUp", true); expect(gate.consume()).toBe(true);
  });
  it("denies while agent-leased and never replays a lease-era gesture", () => {
    let leased = false; const gate = new BrowserPopupInput(() => 0, () => leased);
    gate.observe("keyDown", true); leased = true; expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", true); leased = false; expect(gate.consume()).toBe(false);
    gate.observe("mouseUp", true); expect(gate.consume()).toBe(true);
  });
  it("revokes and ignores unrecognized events", () => {
    const gate = new BrowserPopupInput(() => 0);
    gate.observe("mouseMove", true); expect(gate.consume()).toBe(false);
    gate.observe("keyDown", true); gate.revoke(); expect(gate.consume()).toBe(false);
  });
});
