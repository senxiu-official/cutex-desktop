// WhatsApp as its own module (owner 2026-11-26): default off; 服务通知 says nothing about WhatsApp; main keeps and
// obeys its own copy of the switch (no script, no polling, no owner-only hold while off; binding kept); one-time
// migration for installs whose watch was already on; a clicked notice opens through the module's opener.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(""), decryptString: () => "" } }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { WhatsAppObserver } = await import("../src/main/browser/whatsAppObserver");
const { parseBrowserRequest, createBrowserChannel } = await import("../src/main/browser/channel");
const { syncWhatsAppModule, WHATSAPP_MIGRATION_MARKER } = await import("../src/renderer/src/modules/whatsappSync");
const { MODULES } = await import("../src/renderer/src/modules/registry");
const { zhCN: snZh } = await import("../src/renderer/src/modules/service-notify/i18n");
const { en: snEn } = await import("../src/renderer/src/modules/service-notify/i18n.en");
const { locales: snHant } = await import("../src/renderer/src/modules/service-notify/i18n.locales");
const { registerServiceOpener } = await import("../src/renderer/src/lib/serviceOpeners");
const { openServiceNotification } = await import("../src/renderer/src/modules/service-notify/open");

const TAB = "00000000-0000-4000-8000-00000000aaaa";
const dirs: string[] = [];
const userData = () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-module-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const binding = (enabled: boolean) => JSON.stringify({ version: 1, hostId: "local", tabKey: TAB, enabled, linked: true, preview: false, credential: "c2VjcmV0" });
function observer(dir: string) {
  const source = vi.fn(() => null);
  const o = new WhatsAppObserver({ userData: dir, hasTab: () => true, source, client: () => null, locale: () => "zh-CN" });
  return { o, source };
}
const moduleFile = (dir: string) => JSON.parse(readFileSync(join(dir, "whatsapp-module.json"), "utf8")) as { version: number; enabled: boolean };

describe("main: the WhatsApp module switch", () => {
  it("migrates once: an install with the watch on starts on; without a binding (or with it off) off", () => {
    const on = userData();
    writeFileSync(join(on, "whatsapp-observer.json"), binding(true));
    expect(observer(on).o.moduleEnabled()).toBe(true);
    expect(moduleFile(on)).toEqual({ version: 1, enabled: true });
    const none = userData();
    expect(observer(none).o.moduleEnabled()).toBe(false);
    expect(moduleFile(none).enabled).toBe(false);
    const paused = userData();
    writeFileSync(join(paused, "whatsapp-observer.json"), binding(false));
    expect(observer(paused).o.moduleEnabled()).toBe(false);
    // The saved switch wins over the binding afterwards (main decides from its own file).
    writeFileSync(join(on, "whatsapp-module.json"), JSON.stringify({ version: 1, enabled: false }));
    expect(observer(on).o.moduleEnabled()).toBe(false);
  });

  it("off: nothing runs or polls, the tab is not owner-only, settings are refused; the binding stays", async () => {
    const dir = userData();
    writeFileSync(join(dir, "whatsapp-observer.json"), binding(true));
    const { o, source } = observer(dir);
    expect(o.protected("local", TAB)).toBe(true);
    o.tick(Date.now());
    expect(source).toHaveBeenCalledTimes(1);
    expect(o.setModuleEnabled(false)).toEqual({ enabled: false });
    expect(moduleFile(dir).enabled).toBe(false);
    expect(o.protected("local", TAB)).toBe(false);
    expect(o.observing("local", TAB)).toBe(false);
    o.tick(Date.now() + 60_000);
    expect(source).toHaveBeenCalledTimes(1);
    await expect(o.configure("local", TAB, true, false, () => {})).rejects.toThrow("whatsapp_module_off");
    expect(() => o.unbind("local", TAB)).toThrow("whatsapp_module_off");
    // Closing the tab while off keeps the owner's binding (and its credential) for later.
    o.retire("local", TAB);
    expect(JSON.parse(readFileSync(join(dir, "whatsapp-observer.json"), "utf8"))).toMatchObject({ tabKey: TAB, credential: "c2VjcmV0" });
    // On again: held and polled again.
    o.setModuleEnabled(true);
    expect(o.protected("local", TAB)).toBe(true);
    o.tick(Date.now() + 120_000);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("channel: whatsAppModule reads or sets, host-independent; anything else refused", async () => {
    expect(parseBrowserRequest({ op: "whatsAppModule" })).toEqual({ op: "whatsAppModule" });
    expect(parseBrowserRequest({ op: "whatsAppModule", enabled: false })).toEqual({ op: "whatsAppModule", enabled: false });
    expect(() => parseBrowserRequest({ op: "whatsAppModule", enabled: "yes" })).toThrow();
    expect(() => parseBrowserRequest({ op: "whatsAppModule", enabled: true, tabKey: TAB })).toThrow();
    const whatsAppModule = vi.fn((enabled?: boolean) => ({ enabled: enabled ?? true }));
    const execute = vi.fn();
    const handle = createBrowserChannel<object, { generation: number }>({ isAppSender: () => true, isEnabled: () => false, getHosts: () => null, setEnabled: () => {}, whatsAppModule, execute });
    await expect(handle({}, { op: "whatsAppModule", enabled: false }, null)).resolves.toEqual({ enabled: false });
    expect(whatsAppModule).toHaveBeenCalledWith(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("renderer: module and migration", () => {
  it("whatsapp is a built-in module, default off, with its own settings page under 通知", () => {
    const wa = MODULES.find((m) => m.id === "whatsapp")!;
    expect(wa.defaultEnabled).toBe(false);
    expect(wa.contributes?.["settings.page"]?.[0]).toMatchObject({ page: "whatsapp", navParent: "notifications", source: "local" });
  });

  it("服务通知 does not mention WhatsApp (copy, keywords, sections)", () => {
    for (const dict of [snZh, snEn, snHant["zh-Hant-CN"]] as Record<string, string>[]) {
      expect(Object.keys(dict).filter((k) => k.startsWith("service-notify.whatsapp."))).toEqual([]);
      const mentions = Object.entries(dict).filter(([k, v]) => /whatsapp/i.test(v) && k !== "service-notify.settings.retainWhatsApp");
      expect(mentions).toEqual([]);
    }
    const sn = MODULES.find((m) => m.id === "service-notify")!;
    expect(JSON.stringify(sn.contributes, (_k, v) => (typeof v === "function" ? undefined : v))).not.toMatch(/whatsapp/i);
  });

  const store = (record?: object) => {
    const m = new Map<string, string>();
    if (record) m.set("cutex-desktop.modules", JSON.stringify(record));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const host = (on = false) => {
    const listeners = new Set<() => void>();
    const h = {
      on,
      isEnabled: () => h.on,
      setEnabled: vi.fn(async (_id: string, v: boolean) => { h.on = v; listeners.forEach((l) => l()); }),
      subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    };
    return h;
  };

  it("migration: main on + no saved choice → the module turns on, once; then main follows every change", async () => {
    const s = store({ v: 1, enabled: {} });
    const h = host();
    const calls: (boolean | undefined)[] = [];
    const browser = { whatsAppModule: vi.fn(async (enabled?: boolean) => { calls.push(enabled); return { enabled: enabled ?? true }; }) };
    const off = await syncWhatsAppModule(h, s, browser);
    expect(h.setEnabled).toHaveBeenCalledWith("whatsapp", true);
    expect(s.m.get(WHATSAPP_MIGRATION_MARKER)).toBe("1");
    expect(calls).toEqual([undefined, true]);
    await h.setEnabled("whatsapp", false);
    expect(calls.at(-1)).toBe(false);
    off();
    // The next start: no second read for migration; main simply gets the current state.
    calls.length = 0;
    await syncWhatsAppModule(h, s, browser);
    expect(calls).toEqual([false]);
  });

  it("migration: an explicit choice (or main off) is never overridden; default off is sent to main", async () => {
    const h = host();
    const browser = { whatsAppModule: vi.fn(async (enabled?: boolean) => ({ enabled: enabled ?? true })) };
    await syncWhatsAppModule(h, store({ v: 1, enabled: { whatsapp: false } }), browser);
    expect(h.setEnabled).not.toHaveBeenCalled();
    expect(browser.whatsAppModule).toHaveBeenLastCalledWith(false);
    const h2 = host();
    const offMain = { whatsAppModule: vi.fn(async (enabled?: boolean) => ({ enabled: enabled ?? false })) };
    await syncWhatsAppModule(h2, store(), offMain);
    expect(h2.setEnabled).not.toHaveBeenCalled();
    // An older desktop main without the call: nothing happens.
    await expect(syncWhatsAppModule(host(), store(), {})).resolves.toBeTypeOf("function");
  });

  it("a clicked notice opens through the registered opener on this desktop only", async () => {
    const side = { open: vi.fn() };
    const opener = vi.fn(async () => true);
    const off = registerServiceOpener("whatsapp", opener);
    await expect(openServiceNotification({ hostId: "local", slug: "whatsapp", id: "x" } as never, side as never)).resolves.toBe("opener");
    expect(opener).toHaveBeenCalledTimes(1);
    off();
  });
});
