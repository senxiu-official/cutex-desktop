// @vitest-environment jsdom
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key === "sidebar.backgroundWork" ? "Background work running" : key }) }));
import type { SessionRuntime } from "@cutex-desktop/protocol";
import { showsBackgroundWork } from "../src/renderer/src/lib/agentBackgroundWork";
import { BackgroundBot } from "../src/renderer/src/components/BackgroundBot";

const runtime = { status: "online", appServerConnected: true, activeTurnId: null, backgroundWork: { running: true } } as SessionRuntime;
describe("idle agent background work", () => {
  it("shows a presence signal without requiring a precise count", () => {
    for (const signal of ["idle", "done", "needsYou", "error"] as const)
      expect(showsBackgroundWork(runtime, signal, true)).toBe(true);
  });
  it("never accompanies the busy ring, including a needs-you active turn", () => {
    expect(showsBackgroundWork(runtime, "running", true)).toBe(false);
    for (const signal of ["idle", "needsYou", "error"] as const)
      expect(showsBackgroundWork({ ...runtime, activeTurnId: "turn" }, signal, true)).toBe(false);
  });
  it("hides on old hosts, finished work, disconnect and stale rows", () => {
    expect(showsBackgroundWork(runtime, "idle", false)).toBe(false);
    expect(showsBackgroundWork({ ...runtime, backgroundWork: { running: false } }, "idle", true)).toBe(false);
    expect(showsBackgroundWork({ ...runtime, backgroundWork: null }, "idle", true)).toBe(false);
    expect(showsBackgroundWork({ ...runtime, appServerConnected: false }, "idle", true)).toBe(false);
    expect(showsBackgroundWork({ ...runtime, status: "offline" }, "idle", true)).toBe(false);
    expect(showsBackgroundWork(runtime, "offline", true)).toBe(false);
    expect(showsBackgroundWork(runtime, "unknown", true)).toBe(false);
  });
  it("has an accessible description and a breathing wrapper around the icon", () => {
    const html = renderToStaticMarkup(h(BackgroundBot));
    expect(html).toContain('data-background-work=""');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Background work running"');
    expect(html).toContain('background-work-bot');
    expect(html).toContain('aria-hidden="true"');
  });
});
