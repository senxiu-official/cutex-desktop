// Windows sandbox readiness (cutex windows-sandbox-readiness): when the composer warns, what the
// setup outcome maps to, the timeline keeping native's setupCompleted, the menu note's content,
// and the main-process calls (session native methods, exact params).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));

import { windowsSandboxCanSetUp, windowsSandboxReadinessOf, windowsSandboxSetupOutcomeOf, windowsSandboxWarns } from "../src/shared/windowsSandbox";
import { hostSetupPhase } from "../src/renderer/src/lib/windowsSandboxView";
import { applyEvent, emptyTimeline } from "../src/renderer/src/lib/timeline";
import { WindowsSandboxMenuNote } from "../src/renderer/src/components/WindowsSandboxNotice";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

describe("windows sandbox readiness", () => {
  it("warns only on Windows hosts, when not ready, and outside full access", () => {
    expect(windowsSandboxWarns("windows", "notConfigured", "auto")).toBe(true);
    expect(windowsSandboxWarns("windows", "updateRequired", "readOnly")).toBe(true);
    expect(windowsSandboxWarns("windows", "notConfigured", "custom")).toBe(true);
    expect(windowsSandboxWarns("windows", "notConfigured", "full")).toBe(false);
    expect(windowsSandboxWarns("windows", "ready", "auto")).toBe(false);
    expect(windowsSandboxWarns("windows", null, "auto")).toBe(false);
    // Native answers notConfigured off Windows: never shown there.
    expect(windowsSandboxWarns("linux", "notConfigured", "auto")).toBe(false);
    expect(windowsSandboxWarns(null, "notConfigured", "auto")).toBe(false);
  });

  it("parses native values and offers the unelevated setup only when nothing is configured", () => {
    expect(windowsSandboxReadinessOf("ready")).toBe("ready");
    expect(windowsSandboxReadinessOf("updateRequired")).toBe("updateRequired");
    expect(windowsSandboxReadinessOf("elevated")).toBeNull();
    expect(windowsSandboxReadinessOf(undefined)).toBeNull();
    expect(windowsSandboxCanSetUp("notConfigured")).toBe(true);
    expect(windowsSandboxCanSetUp("updateRequired")).toBe(false);
    expect(windowsSandboxCanSetUp("ready")).toBe(false);
    expect(windowsSandboxSetupOutcomeOf({ mode: "unelevated", success: false, error: "denied" })).toEqual({ success: false, error: "denied" });
    expect(windowsSandboxSetupOutcomeOf({ mode: "unelevated", success: true, error: null })).toEqual({ success: true, error: null });
    expect(windowsSandboxSetupOutcomeOf({ mode: "unelevated" })).toBeNull();
  });

  it("maps the host route's result (cutex waits for setupCompleted)", () => {
    expect(hostSetupPhase({ started: true, completed: { mode: "unelevated", success: true, error: null } })).toEqual({ kind: "done" });
    expect(hostSetupPhase({ started: true, completed: { mode: "unelevated", success: false, error: "requirements forbid it" } })).toEqual({ kind: "failed", message: "requirements forbid it" });
    expect(hostSetupPhase({ started: true, completed: null })).toEqual({ kind: "pending" });
  });

  it("keeps the session's native setupCompleted in the timeline", () => {
    const tl = emptyTimeline();
    const changed = applyEvent(tl, { receivedAt: "2026-10-16T01:00:00Z", native: { kind: "notification", message: { method: "windowsSandbox/setupCompleted", params: { mode: "unelevated", success: false, error: "ACL refresh failed" } } } } as never);
    expect(changed).toBe(true);
    expect(tl.windowsSandboxSetup).toEqual({ success: false, error: "ACL refresh failed" });
  });

  it("explains the prompts and offers setup for notConfigured; steps only for updateRequired", () => {
    const notConfigured = renderToStaticMarkup(h(WindowsSandboxMenuNote, { readiness: "notConfigured", phase: { kind: "idle" }, onSetup: () => {} }));
    expect(notConfigured).toContain("winSandbox.notReady");
    expect(notConfigured).toContain("winSandbox.why.notConfigured");
    expect(notConfigured).toContain("winSandbox.setup");
    expect(notConfigured).not.toContain("winSandbox.steps.elevated");
    const elevated = renderToStaticMarkup(h(WindowsSandboxMenuNote, { readiness: "updateRequired", phase: { kind: "idle" }, onSetup: () => {} }));
    expect(elevated).toContain("winSandbox.why.updateRequired");
    expect(elevated).toContain("winSandbox.steps.elevated");
    expect(elevated).not.toContain(">winSandbox.setup<");
    const started = renderToStaticMarkup(h(WindowsSandboxMenuNote, { readiness: "notConfigured", phase: { kind: "started" }, onSetup: () => {} }));
    expect(started).toContain("winSandbox.setupStarted");
    expect(started).not.toContain(">winSandbox.setup<");
    const failed = renderToStaticMarkup(h(WindowsSandboxMenuNote, { readiness: "notConfigured", phase: { kind: "failed", message: "boom" }, onSetup: () => {} }));
    expect(failed).toContain("winSandbox.setupFailed(boom)");
  });

  it("has the owner's wording in zh-CN and an en string for every key", () => {
    expect(zhCN["winSandbox.notReady"]).toBe("Windows 沙箱未就绪：普通命令也会询问");
    for (const key of Object.keys(zhCN).filter((k) => k.startsWith("winSandbox."))) expect(en[key as keyof typeof en], key).toBeTruthy();
  });
});
