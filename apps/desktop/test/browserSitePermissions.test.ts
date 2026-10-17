import { describe, expect, it, vi } from "vitest";
import { BrowserSitePermissionStore, browserPermissionKeys, browserPermissionOrigin, createBrowserSitePermissions, type BrowserPermissionGuest } from "../src/main/browser/sitePermissions";
import { browserDownloadDialogTitle, browserPermissionPromptText } from "../src/main/browser/promptText";

function memoryIo(initial?: string) {
  let text = initial; const writes: string[] = [];
  return { io: { read: () => { if (text === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return text; }, write: (_path: string, next: string) => { text = next; writes.push(next); } }, writes };
}
function setup(guest: BrowserPermissionGuest | undefined = { guestId: "g1", pool: "owner", url: "https://meet.example/room" }) {
  const store = new BrowserSitePermissionStore("perm.json", memoryIo().io);
  let current: BrowserPermissionGuest | undefined = guest, agent = false;
  const prompt = vi.fn(async () => ({ allow: true, remember: true }) as { allow: boolean; remember: boolean } | null);
  const permissions = createBrowserSitePermissions({ store, guest: () => current, agentInput: () => agent, prompt });
  return { store, prompt, permissions, setGuest: (next?: BrowserPermissionGuest) => { current = next; }, setAgent: (value: boolean) => { agent = value; } };
}

describe("browser site permission mapping", () => {
  it("maps Electron permissions to owner-facing ones and denies the rest without asking", () => {
    expect(browserPermissionKeys("media", { mediaTypes: ["video", "audio"] })).toEqual(["camera", "microphone"]);
    expect(browserPermissionKeys("media", { mediaType: "audio" })).toEqual(["microphone"]);
    expect(browserPermissionKeys("media", { mediaTypes: [] })).toBeNull();
    expect(browserPermissionKeys("media", { mediaTypes: ["video", "screen"] })).toBeNull();
    expect(browserPermissionKeys("geolocation", {})).toEqual(["geolocation"]);
    expect(browserPermissionKeys("clipboard-sanitized-write", {})).toBe("auto");
    for (const denied of ["openExternal", "fileSystem", "display-capture", "fullscreen", "unknown", "hid", "serial", "usb"]) expect(browserPermissionKeys(denied, {})).toBeNull();
  });
  it("only secure-context origins can hold a permission", () => {
    expect(browserPermissionOrigin("https://a.example/x?y")).toBe("https://a.example");
    expect(browserPermissionOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(browserPermissionOrigin("http://docs.svc.localhost:24270/")).toBe("http://docs.svc.localhost:24270");
    for (const insecure of ["http://10.0.0.5/", "http://nas.local/", "file:///etc", "data:text/html,x", undefined]) expect(browserPermissionOrigin(insecure)).toBeNull();
  });
});

describe("browser site permission decisions", () => {
  it("asks the owner once, remembers a ticked choice per pool + origin, and answers checks from it", async () => {
    const f = setup();
    expect(await f.permissions.request(7, "media", { mediaTypes: ["video"], requestingUrl: "https://meet.example/room" })).toBe(true);
    expect(f.prompt).toHaveBeenCalledWith({ guestId: "g1", origin: "https://meet.example", permissions: ["camera"], pool: "owner", agentActing: false });
    expect(await f.permissions.request(7, "media", { mediaTypes: ["video"] })).toBe(true);
    expect(f.prompt).toHaveBeenCalledOnce();
    expect(f.permissions.check(7, "media", "https://meet.example", { mediaType: "video" })).toBe(true);
    expect(f.permissions.check(7, "media", "https://meet.example", { mediaType: "audio" })).toBe(false);
    // The agents' pool is a separate login pool: its own decision.
    f.setGuest({ guestId: "g2", pool: "agent", url: "https://meet.example/room" });
    expect(f.permissions.check(8, "media", "https://meet.example", { mediaType: "video" })).toBe(false);
    expect(f.store.list()).toEqual([{ pool: "owner", origin: "https://meet.example", permission: "camera", allow: true }]);
  });
  it("a remembered block denies without asking; an unticked answer is not stored", async () => {
    const f = setup(); f.prompt.mockResolvedValueOnce({ allow: false, remember: false });
    expect(await f.permissions.request(7, "geolocation", {})).toBe(false);
    expect(f.store.list()).toEqual([]);
    f.store.set("owner", "https://meet.example", "geolocation", false);
    expect(await f.permissions.request(7, "geolocation", {})).toBe(false);
    expect(f.prompt).toHaveBeenCalledOnce();
  });
  it("cross-origin frames, insecure pages, unknown guests and unsupported kinds never reach the owner", async () => {
    const f = setup();
    expect(await f.permissions.request(7, "media", { mediaTypes: ["audio"], requestingUrl: "https://ads.example/frame" })).toBe(false);
    expect(f.permissions.check(7, "media", "https://ads.example", { mediaType: "audio" })).toBe(false);
    expect(await f.permissions.request(7, "openExternal", {})).toBe(false);
    f.setGuest({ guestId: "g1", pool: "owner", url: "http://10.0.0.5/" });
    expect(await f.permissions.request(7, "geolocation", {})).toBe(false);
    f.setGuest(undefined);
    expect(await f.permissions.request(7, "geolocation", {})).toBe(false);
    expect(f.prompt).not.toHaveBeenCalled();
  });
  it("a page that navigates away while the owner decides gets nothing, and nothing is remembered", async () => {
    const f = setup(); let answer!: (value: { allow: boolean; remember: boolean }) => void;
    f.prompt.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const pending = f.permissions.request(7, "notifications", {});
    await Promise.resolve(); await Promise.resolve();
    f.setGuest({ guestId: "g1", pool: "owner", url: "https://other.example/" });
    answer({ allow: true, remember: true });
    expect(await pending).toBe(false); expect(f.store.list()).toEqual([]);
  });
  it("shares one prompt between identical concurrent requests and fails closed when it cannot be shown", async () => {
    const f = setup(); let answer!: (value: { allow: boolean; remember: boolean } | null) => void;
    f.prompt.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const one = f.permissions.request(7, "geolocation", {}), two = f.permissions.request(7, "geolocation", {});
    await Promise.resolve(); await Promise.resolve(); answer(null);
    expect(await one).toBe(false); expect(await two).toBe(false); expect(f.prompt).toHaveBeenCalledOnce();
  });
  it("tells the owner when the agent is operating the tab; clipboard writes skip the prompt except during agent input", async () => {
    const f = setup({ guestId: "g1", pool: "agent", url: "https://meet.example/", agentName: "Mira" }); f.setAgent(true);
    await f.permissions.request(7, "media", { mediaTypes: ["audio"] });
    expect(f.prompt).toHaveBeenCalledWith(expect.objectContaining({ agentActing: true, agentName: "Mira", pool: "agent" }));
    expect(await f.permissions.request(7, "clipboard-sanitized-write", {})).toBe(false);
    f.setAgent(false);
    expect(await f.permissions.request(7, "clipboard-sanitized-write", {})).toBe(true);
  });
});

describe("browser site permission store", () => {
  it("persists, forgets per origin or all, and ignores malformed rows (fail closed)", () => {
    const { io, writes } = memoryIo(JSON.stringify({ version: 1, entries: [
      { pool: "owner", origin: "https://a.example", permission: "camera", allow: true },
      { pool: "owner", origin: "http://10.0.0.5", permission: "camera", allow: true },
      { pool: "root", origin: "https://b.example", permission: "camera", allow: true },
      { pool: "owner", origin: "https://b.example", permission: "usb", allow: true },
    ] }));
    const store = new BrowserSitePermissionStore("perm.json", io);
    expect(store.list()).toEqual([{ pool: "owner", origin: "https://a.example", permission: "camera", allow: true }]);
    store.set("agent", "https://a.example", "microphone", false);
    store.forget({ pool: "owner", origin: "https://a.example" });
    expect(store.list()).toEqual([{ pool: "agent", origin: "https://a.example", permission: "microphone", allow: false }]);
    store.forget("all"); expect(store.list()).toEqual([]);
    expect(JSON.parse(writes.at(-1)!)).toEqual({ version: 1, entries: [] });
    expect(new BrowserSitePermissionStore("perm.json", memoryIo("{not json").io).list()).toEqual([]);
  });
});

describe("browser native dialog text", () => {
  it("names the origin and permissions in the app locale", () => {
    expect(browserPermissionPromptText("zh-CN", { origin: "https://meet.example", permissions: ["camera", "microphone"], pool: "owner", agentActing: false }).message)
      .toBe("https://meet.example 想使用：摄像头、麦克风");
    const en = browserPermissionPromptText("en", { origin: "https://meet.example", permissions: ["geolocation"], pool: "agent", agentName: "Mira", agentActing: true });
    expect(en.detail).toContain("Mira is operating this tab"); expect(en.detail).toContain("agents' separate login pool");
    expect(browserPermissionPromptText("zh-Hant-CN", { origin: "https://x.example", permissions: ["camera"], pool: "owner", agentActing: false }).allow).toBe("允許");
    expect(browserDownloadDialogTitle("zh-CN", undefined)).toBe("保存下载");
    expect(browserDownloadDialogTitle("en", "Mira")).toContain("Mira wants to download");
  });
});
