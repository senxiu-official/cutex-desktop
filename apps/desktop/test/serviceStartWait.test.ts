// @vitest-environment jsdom
// A service tab whose service is still coming up (owner 2026-10-25): 正在启动, a reload every 2 s by itself until
// the page answers, a clear failure after a minute; refusals a wait cannot fix are not waited for.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVICE_WAIT_EVERY_MS, SERVICE_WAIT_LIMIT_MS, useServiceStartWait, waitsForService, type ServiceWait } from "../src/renderer/src/modules/browser/serviceStartWait";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, div: HTMLDivElement, wait: ServiceWait;
const retry = vi.fn();
function Probe({ waiting }: { waiting: boolean }) {
  wait = useServiceStartWait(waiting, retry);
  return null;
}
const render = (waiting: boolean) => act(() => root.render(h(Probe, { waiting })));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  retry.mockClear();
  div = document.createElement("div");
  root = createRoot(div);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("which refusals wait", () => {
  it("a service tab refused while its service starts / restarts / is briefly busy", () => {
    for (const code of ["upstream_unreachable", "service_unavailable", "service_stopped", "services_store_unavailable", "proxy_busy"]) expect(waitsForService("cutex:service/cutex-e-director-board/", code)).toBe(true);
  });
  it("not: a crash loop, a failed start, an unknown service, a web page, no refusal", () => {
    for (const code of ["service_crash_looped", "service_start_failed", "service_not_found", "service_reclaimed"]) expect(waitsForService("cutex:service/board/", code)).toBe(false);
    expect(waitsForService("https://example.com/", "upstream_unreachable")).toBe(false);
    expect(waitsForService("cutex:service/board/", null)).toBe(false);
  });
});

describe("the wait", () => {
  it("reloads every 2 s while the service is not up; opens (stops) as soon as the page answers", () => {
    render(true);
    expect(wait.state).toBe("waiting");
    advance(SERVICE_WAIT_EVERY_MS);
    expect(retry).toHaveBeenCalledTimes(1);
    advance(SERVICE_WAIT_EVERY_MS);
    expect(retry).toHaveBeenCalledTimes(2);
    render(false);
    expect(wait.state).toBeNull();
    advance(SERVICE_WAIT_EVERY_MS * 5);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("gives up after a minute (timedOut: the tab says so, with 重新加载); 重新加载 starts a new wait", () => {
    render(true);
    for (let i = 0; i < SERVICE_WAIT_LIMIT_MS / SERVICE_WAIT_EVERY_MS + 2; i++) advance(SERVICE_WAIT_EVERY_MS);
    expect(wait.state).toBe("timedOut");
    const calls = retry.mock.calls.length;
    expect(calls).toBe(SERVICE_WAIT_LIMIT_MS / SERVICE_WAIT_EVERY_MS);
    advance(SERVICE_WAIT_EVERY_MS * 5);
    expect(retry).toHaveBeenCalledTimes(calls);
    act(() => wait.restart());
    expect(wait.state).toBe("waiting");
    advance(SERVICE_WAIT_EVERY_MS);
    expect(retry).toHaveBeenCalledTimes(calls + 1);
  });

  it("a reload's brief no-refusal moment keeps the minute running (no endless waiting)", () => {
    render(true);
    for (let i = 0; i < 40; i++) {
      advance(SERVICE_WAIT_EVERY_MS / 2);
      render(i % 2 === 0 ? false : true);
    }
    render(true);
    for (let i = 0; i < 20; i++) advance(SERVICE_WAIT_EVERY_MS);
    expect(wait.state).toBe("timedOut");
  });
});
