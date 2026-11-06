import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
import { activateClaudeScience, openAccount } from "../src/renderer/src/modules/claude-science/actions";

const controllers: AbortController[] = [];
afterEach(() => { for (const c of controllers.splice(0)) c.abort(); });
function setup() {
  const controller = new AbortController();
  controllers.push(controller);
  const open = vi.fn();
  activateClaudeScience({ signal: controller.signal, services: { side: { open } } } as never);
  return open;
}

describe("Claude Science service page routing", () => {
  it("opens the single-service kind on the account's host", () => {
    const open = setup().mockReturnValue({ status: "opened" });
    expect(openAccount("science-one", "remote")).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith("browser.service", { url: "cutex:service/science-one/" }, expect.objectContaining({ binding: { kind: "host", hostId: "remote" } }));
  });
  it("keeps the independent pack usable on older desktops without the new kind", () => {
    const open = setup().mockReturnValueOnce({ status: "unavailable", reason: "unknown-kind" }).mockReturnValueOnce({ status: "opened" });
    expect(openAccount("science-one", "remote")).toBe(true);
    expect(open.mock.calls.map(c => c[0])).toEqual(["browser.service", "browser.tab"]);
  });
  it.each(["module-off", "capability"])("does not fall back when refused for %s", reason => {
    const open = setup().mockReturnValue({ status: "unavailable", reason });
    expect(openAccount("science-one", "remote")).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
