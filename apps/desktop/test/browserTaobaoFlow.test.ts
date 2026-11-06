import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtocolError } from "@cutex-desktop/browser-protocol";
import { AgentPopups, AGENT_POPUP_QUIET_MS, AGENT_POPUP_SETTLE_MS, AGENT_POPUP_WAIT_MS, popupBlockReason } from "../src/main/browser/agentPopups";
import { BrowserRelayError, busyError, relayErrorDetail } from "../src/main/browser/relayTypes";

// Owner report 2026-11-06 (bought-items flow): a click that opened a tab looked like nothing
// happened, and every failure was one bare code.
describe("agent popups", () => {
  afterEach(() => { vi.useRealTimers(); });
  const clock = () => { vi.useFakeTimers(); vi.setSystemTime(10_000); return new AgentPopups(); };
  it("a popup noted after the click began answers opened at once or within the wait", async () => {
    const popups = clock();
    popups.note("g1", 10_000);
    await expect(popups.outcome("g1", 10_000)).resolves.toEqual({ opened: true });
    const late = popups.outcome("g1", 10_000);
    await vi.advanceTimersByTimeAsync(50);
    popups.note("g1");
    await expect(late).resolves.toEqual({ opened: true });
  });
  it("no popup (or an older one, or another tab's) answers nothing after the bounded wait", async () => {
    const popups = clock();
    popups.note("g1", 9_000);
    const answer = popups.outcome("g1", 10_000);
    popups.note("g2");
    await vi.advanceTimersByTimeAsync(AGENT_POPUP_WAIT_MS);
    await expect(answer).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a page that asks its server after the click and then opens a tab: the late popup is reported blocked", async () => {
    const popups = clock(), since = Date.now();
    const answer = popups.outcome("g1", since);
    await vi.advanceTimersByTimeAsync(50); popups.requestStarted("g1", "r1");
    await vi.advanceTimersByTimeAsync(600); popups.requestEnded("g1", "r1");
    await vi.advanceTimersByTimeAsync(100); popups.blocked("g1", "no_owner_input");
    await expect(answer).resolves.toEqual({ blocked: "late_page_popup" });
  });
  it("only requests started since the click keep it watching, and never past the cap", async () => {
    const popups = clock();
    popups.requestStarted("g1", "poll", Date.now() - 10);
    const quiet = popups.outcome("g1", Date.now());
    await vi.advanceTimersByTimeAsync(AGENT_POPUP_WAIT_MS + 50);
    await expect(quiet).resolves.toBeUndefined();
    const ended = popups.outcome("g1", Date.now());
    popups.requestStarted("g1", "r2"); await vi.advanceTimersByTimeAsync(20); popups.requestEnded("g1", "r2");
    await vi.advanceTimersByTimeAsync(AGENT_POPUP_WAIT_MS + AGENT_POPUP_QUIET_MS + 50);
    await expect(ended).resolves.toBeUndefined();
    const capped = popups.outcome("g1", Date.now());
    popups.requestStarted("g1", "hanging");
    await vi.advanceTimersByTimeAsync(AGENT_POPUP_SETTLE_MS - 100);
    let settled = false; void capped.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    await expect(capped).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("main's discard codes map to the fixed reasons", () => {
    expect(["no_owner_input", "rate_limited", "agent_rate_limited", "policy_denied", "post_body", "invalid_url", "handler_error", "agent_input"].map(popupBlockReason))
      .toEqual(["late_page_popup", "rate_limited", "rate_limited", "address_not_allowed", "form_post", "invalid_url", "unavailable", "unavailable"]);
  });
});

describe("relay error detail", () => {
  it("keeps a relay error's own detail, a provider's busy reason and a diagnostic cause", () => {
    expect(relayErrorDetail(new BrowserRelayError("navigation_failed", undefined, undefined,
      { stage: "popup_load", url: "https://item.example.com/item.htm?id=7", netError: { code: -102, name: "ERR_CONNECTION_REFUSED" } })))
      .toEqual({ stage: "popup_load", url: "https://item.example.com/item.htm?id=7", netError: { code: -102, name: "ERR_CONNECTION_REFUSED" } });
    expect(relayErrorDetail(busyError(new ProtocolError("busy", "One operation per guest is allowed"), "tab_operation_running")))
      .toEqual({ reason: "tab_operation_running" });
    expect(relayErrorDetail(new BrowserRelayError("busy", undefined, "ledger_capacity"))).toEqual({ reason: "ledger_capacity" });
    expect(relayErrorDetail({ stage: "mount", reason: "tab_opening" })).toEqual({ stage: "mount", reason: "tab_opening" });
  });
  it("drops anything that is not a fixed word, a redacted http(s) page or a Chromium net error", () => {
    for (const detail of [{ stage: "Popup Load" }, { reason: "<b>busy</b>" }, { url: "file:///c:/secret" }, { url: "javascript:alert(1)" },
      { netError: { code: -102, name: "connection refused" } }, { netError: { code: 3, name: "ERR_X" } }, { netError: { name: "ERR_X" } }]) {
      expect(relayErrorDetail(new BrowserRelayError("navigation_failed", undefined, undefined, detail as never))).toBeUndefined();
    }
    expect(relayErrorDetail(new Error("raw message https://secret.example/"))).toBeUndefined();
    expect(relayErrorDetail(undefined)).toBeUndefined();
  });
});
