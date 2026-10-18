// `cutex:service/<slug>[/path]` links (ref.target kind `service`): open the in-app browser tab with the
// path kept, only on the host the side shows; with the browser module off, the system browser.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sideOpen = vi.fn();
const openService = vi.fn();
const openExternal = vi.fn();
let shownHost = "local";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openService: (...a: unknown[]) => openService(...a), openExternal: (...a: unknown[]) => openExternal(...a) },
  apiFor: () => ({ openService: (...a: unknown[]) => openService(...a) }),
  bridge: {},
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { open: (...a: unknown[]) => sideOpen(...a) } } }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (h: string) => h === shownHost }));

import { openServiceRef, parseServiceRefKey, useServiceLink } from "../src/renderer/src/modules/services/refTarget";
import { parseCutexLink, cutexLinkRef } from "../src/renderer/src/lib/cutexLinks";
import type { CutexRef } from "../src/renderer/src/modules/slots";

const refOf = (href: string, hostId = "local"): CutexRef => cutexLinkRef(hostId, parseCutexLink(href)!, "");

beforeEach(() => {
  sideOpen.mockReset();
  openService.mockReset();
  openExternal.mockReset();
  shownHost = "local";
});

describe("service ref key", () => {
  it("slug alone = the root; the path is kept", () => {
    expect(parseServiceRefKey("web")).toEqual({ slug: "web", path: "/" });
    expect(parseServiceRefKey("web/reports/a.html")).toEqual({ slug: "web", path: "/reports/a.html" });
    expect(parseServiceRefKey(parseCutexLink("cutex:service/web/a%20b")!.key)).toEqual({ slug: "web", path: "/a%20b" });
  });
  it("refuses a bad slug or path", () => {
    expect(parseServiceRefKey("Web")).toBeNull();
    expect(parseServiceRefKey("-x")).toBeNull();
    expect(parseServiceRefKey("web//evil.example")).toBeNull();
    expect(parseServiceRefKey("web/a\\b")).toBeNull();
  });
});

describe("open a service link", () => {
  it("opens the browser tab bound to the host with the link's path", async () => {
    sideOpen.mockReturnValue({ status: "opened" });
    const r = await openServiceRef(refOf("cutex:service/web/docs/index.html"), "auto");
    expect(r).toEqual({ status: "opened", where: "card" });
    expect(sideOpen).toHaveBeenCalledWith("browser.tab", { url: "cutex:service/web/docs/index.html" }, expect.objectContaining({ binding: { kind: "host", hostId: "local" } }));
    expect(openExternal).not.toHaveBeenCalled();
  });
  it("another host's link is unavailable (the side shows the open agent's host only)", async () => {
    const r = await openServiceRef(refOf("cutex:service/web", "remote-1"), "auto");
    expect(r).toEqual({ status: "unavailable", reason: "host-offline" });
    expect(sideOpen).not.toHaveBeenCalled();
  });
  it("browser module off → the system browser, path kept", async () => {
    sideOpen.mockReturnValue({ status: "unavailable", reason: "module-off" });
    openService.mockResolvedValue({ url: "http://h:26180", localUrl: "http://127.0.0.1:26180/" });
    const r = await openServiceRef(refOf("cutex:service/web/a/b"), "page");
    expect(r).toEqual({ status: "opened", where: "page" });
    expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:26180/a/b");
  });
  it("a bad key is a bad ref; the chip is muted", async () => {
    expect(await openServiceRef({ hostId: "local", kind: "service", key: "BAD", title: "x", params: {} }, "auto")).toEqual({ status: "unavailable", reason: "bad-ref" });
    expect(useServiceLink({ hostId: "local", kind: "service", key: "BAD", title: "x", params: {} })?.tone).toBe("muted");
    expect(useServiceLink(refOf("cutex:service/web/x"))?.tooltip).toBe("web/x");
  });
});
