// The browser card's 地址行 ⋯ (modules/browser/pageMenu): copy and open-outside live here; a service address keeps its
// external-open limit (disabled, with the reason); 前进 joins only when the row is narrow.
import { describe, expect, it, vi } from "vitest";
import { browserPageMenu, type BrowserPageMenuInput } from "../src/renderer/src/modules/browser/pageMenu";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";

const t = (key: string) => key;
const base: BrowserPageMenuInput = { url: "https://example.org/a", narrow: false, canGoForward: true, ready: true, working: false, toBackground: null, zoom: undefined };
const actions = () => ({ forward: vi.fn(), copy: vi.fn(), copyText: vi.fn(), openExternal: vi.fn(), toBackground: vi.fn(), resetZoom: vi.fn() });
const rows = (entries: MenuEntry[]) => entries.filter((e): e is MenuAction => !!e && e !== "separator");

describe("browser page menu", () => {
  it("a web page: copy and open outside (enabled, the exact URL), no 前进 while the row shows it", () => {
    const act = actions();
    const items = rows(browserPageMenu(base, act, t));
    expect(items.map(i => i.label)).toEqual(["browser.copy", "browser.external"]);
    void items[1]!.onSelect();
    expect(act.openExternal).toHaveBeenCalledWith("https://example.org/a");
    void items[0]!.onSelect();
    expect(act.copy).toHaveBeenCalledOnce();
  });
  it("a service or other non-web address never opens outside, and says why", () => {
    const act = actions();
    const service = rows(browserPageMenu({ ...base, url: "cutex:service/docs/" }, act, t)).find(i => i.label === "browser.external")!;
    expect(service.disabled).toBe(true);
    expect(service.info).toBe("browser.external.serviceNote");
    void service.onSelect();
    expect(act.openExternal).not.toHaveBeenCalled();
    const blank = rows(browserPageMenu({ ...base, url: "about:blank" }, act, t)).find(i => i.label === "browser.external")!;
    expect(blank.disabled).toBe(true);
    expect(blank.info).toBe("browser.external.webOnly");
  });
  it("narrow: 前进 first (disabled without history); background and zoom reset only when they apply", () => {
    const act = actions();
    const narrow = rows(browserPageMenu({ ...base, narrow: true, canGoForward: false, toBackground: { busy: false }, zoom: 1.25 }, act, t));
    expect(narrow.map(i => i.label)).toEqual(["browser.forward", "browser.copy", "browser.external", "browser.background.send", "browser.zoom.reset"]);
    expect(narrow[0]!.disabled).toBe(true);
    expect(narrow[4]!.hint).toBe("125%");
    expect(rows(browserPageMenu({ ...base, toBackground: { busy: true } }, act, t)).find(i => i.label === "browser.background.send")!.disabled).toBe(true);
  });
  it("a service tab copies the service's own address (with the page path) and port, then its cutex link", () => {
    const act = actions();
    const items = rows(browserPageMenu({ ...base, url: "cutex:service/photos/album?x=1", service: { address: "http://127.0.0.1:24421/album?x=1", port: 24421, remoteHost: null } }, act, t));
    expect(items.map(i => i.label)).toEqual(["services.copyUrl", "services.copyPort", "browser.copyServiceLink", "browser.external"]);
    expect(items[0]!.hint).toBe("127.0.0.1:24421/album?x=1");
    void items[0]!.onSelect();
    void items[1]!.onSelect();
    expect(act.copyText.mock.calls).toEqual([["http://127.0.0.1:24421/album?x=1"], ["24421"]]);
    void items[2]!.onSelect();
    expect(act.copy).toHaveBeenCalledOnce();
  });
});
