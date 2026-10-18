import { describe, expect, it, vi } from "vitest";

const all: object[] = [];
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => all } }));
const { appWindows, markBackgroundWindow } = await import("../src/main/appWindows");

describe("appWindows", () => {
  it("skips background browser carriers", () => {
    const main = {}, carrier = {};
    all.push(carrier, main);
    markBackgroundWindow(carrier as never);
    expect(appWindows()).toEqual([main]);
  });
});
