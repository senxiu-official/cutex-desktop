// @vitest-environment jsdom
// 仍然打开 from an agent-pool tab: main mints the new tab in the OWNER pool and says so with `newTabOwner`; the renderer
// must place it as the owner's tab, never as an agent tab (which would let the agent pool into the LAN origin).
import { describe, expect, it, vi } from "vitest";
import { openPopupTab } from "../src/renderer/src/modules/browser/popupOpen";
import { BROWSER_TAB } from "../src/renderer/src/modules/browser/browserState";

const minted = "4f0bbfa0-1234-4abc-8def-0123456789ab";
const opened = () => vi.fn(() => ({ status: "opened", instanceId: "new" }) as never);
const base = { hostId: "local", tabKey: "no-such-opener", pool: "agent" as const, newTabUrl: "http://10.0.0.20:8123/lovelace", newTabKey: minted };

describe("popup tab placement with newTabOwner", () => {
  it("newTabOwner: an owner tab with main's minted key, even when the opener is an agent-pool tab", () => {
    const open = opened();
    expect(openPopupTab({ ...base, newTabOwner: true }, open)).not.toBeNull();
    expect(open).toHaveBeenCalledWith(BROWSER_TAB, { url: "http://10.0.0.20:8123/lovelace", tabKey: minted, ownerTab: true }, { binding: { kind: "host", hostId: "local" }, focus: false });
    const params = (open.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(params.agentOpened).toBeUndefined();
  });

  it("absent or false keeps today's placement: an agent-pool opener's popup stays an agent tab", () => {
    for (const newTabOwner of [undefined, false as never]) {
      const open = opened();
      openPopupTab({ ...base, newTabOwner }, open);
      expect(open).toHaveBeenCalledWith(BROWSER_TAB, { url: "http://10.0.0.20:8123/lovelace", tabKey: minted, agentOpened: true }, expect.anything());
    }
    const owner = opened();
    openPopupTab({ ...base, pool: "owner", newTabKey: undefined }, owner);
    expect(owner).toHaveBeenCalledWith(BROWSER_TAB, { url: "http://10.0.0.20:8123/lovelace" }, expect.anything());
  });

  it("an owner tab is only opened with main's minted key (never a fresh renderer-made tab for that URL)", () => {
    const open = opened();
    expect(openPopupTab({ ...base, newTabOwner: true, newTabKey: undefined }, open)).toBeNull();
    expect(openPopupTab({ ...base, newTabOwner: true, newTabKey: "not-a-key" }, open)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
