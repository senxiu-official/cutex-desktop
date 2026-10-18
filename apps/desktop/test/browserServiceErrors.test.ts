// Service errors in the side browser get their own owner text (cutex's lease / view-ticket codes and
// the proxy's x-cutex-service-error header), with Reload offered where reloading helps. The relay keeps
// the collapsed service_unavailable (cutex maps unknown relay codes to invalid_result); the owner's
// tab keeps the precise code.
import { describe, expect, it } from "vitest";
import { browserOwnerErrorKey, browserRefusalAction } from "../src/shared/browser";
import { browserErrorMessagesEn, browserErrorMessagesZhCN } from "../src/renderer/src/modules/browser/errorMessages";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { BrowserRelayError, browserServiceRelayError, relayError } from "../src/main/browser/relayTypes";
import { browserServiceError, subresourceReticketDue, SUBRESOURCE_RETICKET_INTERVAL_MS } from "../src/main/browser/services";

const CASES: [string, string][] = [
  ["service_reclaimed", "browser.error.serviceReclaimed"],
  ["service_stopped", "browser.error.serviceStopped"],
  ["service_not_found", "browser.error.serviceNotFound"],
  ["service_start_failed", "browser.error.serviceStartFailed"],
  ["port_in_use", "browser.error.serviceStartFailed"],
  ["service_crash_looped", "browser.error.serviceCrashLooped"],
  ["service_changed", "browser.error.serviceChanged"],
  ["upstream_unreachable", "browser.error.upstreamUnreachable"],
  ["static_not_found", "browser.error.staticNotFound"],
  ["services_store_unavailable", "browser.error.serviceUnavailable"],
  ["service_unavailable", "browser.error.serviceUnavailable"],
];

describe("service error text", () => {
  it.each(CASES)("%s → %s, in zh-CN, en and zh-Hant-CN", (code, key) => {
    expect(browserOwnerErrorKey(code)).toBe(key);
    expect(browserOwnerErrorKey(new Error(`Error invoking remote method 'browser:tab': BrowserRelayError: ${code}`))).toBe(key);
    expect(browserErrorMessagesZhCN[key as keyof typeof browserErrorMessagesZhCN]).toBeTruthy();
    expect(browserErrorMessagesEn[key as keyof typeof browserErrorMessagesEn]).toBeTruthy();
    expect((zhHantCN as Record<string, string>)[key]).toBeTruthy();
  });
  it("offers Reload where a reload can fix it, never for a reclaimed / unknown service", () => {
    for (const code of ["service_stopped", "service_start_failed", "service_crash_looped", "service_changed", "upstream_unreachable", "service_unavailable"]) expect(browserRefusalAction(code)).toBe("reload");
    for (const code of ["service_reclaimed", "service_not_found", "static_not_found"]) expect(browserRefusalAction(code)).toBeNull();
    expect(browserRefusalAction("external_pages_off")).toBe("enableExternal");
    expect(browserRefusalAction("external_proxy_unavailable")).toBe("retry");
  });
});

describe("opening errors keep cutex's code for the owner", () => {
  it("the relay sends service_unavailable; the message / tab error is the precise code", () => {
    const daemon = { code: "service_reclaimed" };
    const error = new BrowserRelayError(browserServiceRelayError(daemon), browserServiceError(daemon));
    expect(error.code).toBe("service_unavailable");
    expect(relayError(error)).toBe("service_unavailable");
    expect(error.message).toBe("service_reclaimed");
    expect(browserServiceError(error)).toBe("service_reclaimed");
    expect(browserServiceRelayError(error)).toBe("service_unavailable");
  });
  it("a plain relay error is unchanged", () => {
    const error = new BrowserRelayError("lease_revoked");
    expect(error.message).toBe("lease_revoked");
    expect(browserServiceError(error)).toBe("lease_revoked");
  });
});

describe("subresource re-ticket rate limit", () => {
  it("one automatic attempt per minute", () => {
    expect(subresourceReticketDue(undefined, 1_000)).toBe(true);
    expect(subresourceReticketDue(1_000, 1_000 + SUBRESOURCE_RETICKET_INTERVAL_MS - 1)).toBe(false);
    expect(subresourceReticketDue(1_000, 1_000 + SUBRESOURCE_RETICKET_INTERVAL_MS)).toBe(true);
  });
});
