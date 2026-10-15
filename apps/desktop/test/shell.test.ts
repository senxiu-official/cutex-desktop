import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { addAttentionDot, overlayPng } from "../src/main/icon";
import { needsInputIds, waitingAgentCount } from "../src/renderer/src/lib/sidebar";
import { attentionCount, closeAction, effectiveCloseBehavior, overlayDescription, parseNameHasOwner, parsePrefs, parseTerms, resolveLocale, shouldHideOnClose, trayMenuLabels, trayNoticeText, trayTooltip } from "../src/shared/shell";

describe("desktop shell logic", () => {
  it("hides on close only with a tray, the tray pref, and no quit in progress", () => {
    expect(shouldHideOnClose({ quitting: false, trayAvailable: true, closeBehavior: "tray" })).toBe(true);
    expect(shouldHideOnClose({ quitting: true, trayAvailable: true, closeBehavior: "tray" })).toBe(false);
    expect(shouldHideOnClose({ quitting: false, trayAvailable: false, closeBehavior: "tray" })).toBe(false);
    expect(shouldHideOnClose({ quitting: false, trayAvailable: true, closeBehavior: "quit" })).toBe(false);
  });

  it("Linux close fallback: no tray host closes, else asks once; an explicit choice or another OS hides", () => {
    const base = { quitting: false, trayAvailable: true, closeBehavior: "tray" as const, closeBehaviorChosen: false, platform: "linux", trayHost: "present" as const, trayNoticeShown: false };
    expect(closeAction(base)).toBe("ask");
    expect(closeAction({ ...base, trayHost: "unknown" })).toBe("ask");
    expect(closeAction({ ...base, trayNoticeShown: true })).toBe("hide");
    expect(closeAction({ ...base, trayHost: "absent" })).toBe("close");
    expect(closeAction({ ...base, trayHost: "absent", closeBehaviorChosen: true })).toBe("hide");
    expect(closeAction({ ...base, closeBehaviorChosen: true })).toBe("hide");
    expect(closeAction({ ...base, platform: "win32", trayHost: "absent" })).toBe("hide");
    expect(closeAction({ ...base, platform: "darwin" })).toBe("hide");
    // Never hides without a tray, while quitting, or with 退出 picked.
    expect(closeAction({ ...base, trayAvailable: false, closeBehaviorChosen: true })).toBe("close");
    expect(closeAction({ ...base, quitting: true })).toBe("close");
    expect(closeAction({ ...base, closeBehavior: "quit" })).toBe("close");
  });

  it("the effective 关闭窗口时 and the session-bus probe parser", () => {
    expect(effectiveCloseBehavior({ closeBehavior: "tray" }, "linux", "absent")).toBe("quit");
    expect(effectiveCloseBehavior({ closeBehavior: "tray", closeBehaviorChosen: true }, "linux", "absent")).toBe("tray");
    expect(effectiveCloseBehavior({ closeBehavior: "tray" }, "linux", "unknown")).toBe("tray");
    expect(effectiveCloseBehavior({ closeBehavior: "tray" }, "win32", "absent")).toBe("tray");
    expect(parseNameHasOwner("(true,)\n")).toBe("present");
    expect(parseNameHasOwner("(false,)\n")).toBe("absent");
    expect(parseNameHasOwner("method return time=1 sender=org.freedesktop.DBus\n   boolean true\n")).toBe("present");
    expect(parseNameHasOwner("method return …\n   boolean false\n")).toBe("absent");
    expect(parseNameHasOwner("Error: no bus")).toBe("unknown");
  });

  it("first-close notice text: locale, en fallback, custom terms", () => {
    expect(trayNoticeText("zh-CN").keep).toBe("继续在托盘中运行");
    expect(trayNoticeText("de-DE")).toEqual(trayNoticeText("en"));
    expect(trayNoticeText("en-AU").quit).toBe("Quit when closing");
    const terms = { agent: { one: "Maid", many: "Maids" }, subagent: { one: "s", many: "ss" }, director: { one: "d", many: "dd" }, owner: { one: "o", many: "oo" } };
    expect(trayNoticeText("en", { locale: "en", terms }).detail).toContain("so Maids can alert you");
    expect(trayNoticeText("en", { locale: "zh-CN", terms }).detail).toContain("so agents can alert you");
  });

  it("parses stored prefs defensively (default: minimize to tray)", () => {
    const noTerms = { closeBehavior: "tray", locale: null, terms: null, updateCheckMinutes: 10, notifyOff: { desktop: false, sound: false, bigAlert: false } };
    expect(parsePrefs(null)).toEqual(noTerms);
    expect(parsePrefs({ closeBehavior: "quit", locale: "en", updateCheckMinutes: 0, notifyOff: { sound: true, bogus: true } })).toEqual({ ...noTerms, closeBehavior: "quit", locale: "en", updateCheckMinutes: 0, notifyOff: { desktop: false, sound: true, bigAlert: false } });
    expect(parsePrefs({ closeBehavior: "explode", locale: "fr", updateCheckMinutes: -5 })).toEqual(noTerms);
    expect(parsePrefs("garbage")).toEqual(noTerms);
    expect(parsePrefs({ closeBehavior: "tray", closeBehaviorChosen: true, trayNoticeShown: true })).toEqual({ ...noTerms, closeBehaviorChosen: true, trayNoticeShown: true });
    expect(parsePrefs({ closeBehaviorChosen: "yes", trayNoticeShown: 1 })).toEqual(noTerms);
    const terms = { agent: { one: "Maid", many: "Maids" }, subagent: { one: "s", many: "ss" }, director: { one: "d", many: "dd" }, owner: { one: "o", many: "oo" } };
    expect(parsePrefs({ terms: { locale: "en", terms } }).terms).toEqual({ locale: "en", terms });
    expect(parsePrefs({ terms: { agent: { one: "a" } } }).terms).toBeNull();
    expect(parsePrefs({ terms: { locale: "klingon", terms } }).terms).toBeNull();
    expect(parsePrefs({ terms: { agent: { one: "a", many: "as" }, subagent: { one: "", many: "ss" }, director: { one: "d", many: "dd" }, owner: { one: "o", many: "oo" } } }).terms).toBeNull();
  });

  it("uses the renderer locale, else the OS locale", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale(null, "zh-TW")).toBe("zh-Hant-CN");
    expect(resolveLocale(null, "en-AU")).toBe("en-AU");
  });

  it("tray tooltip and labels", () => {
    expect(trayTooltip(0, "zh-CN")).toBe("Cutex");
    expect(trayTooltip(2, "zh-CN")).toBe("Cutex — 2 个智能体等待处理");
    expect(trayTooltip(1, "en")).toBe("Cutex — 1 agent waiting");
    expect(trayTooltip(3, "en")).toBe("Cutex — 3 agents waiting");
    expect(trayMenuLabels("zh-CN")).toEqual({ show: "显示窗口", newChat: "快速启动", quit: "退出" });
    expect(trayMenuLabels("en").quit).toBe("Quit");
  });

  it("tray / overlay text follows the pushed terms when the locale tag matches, defaults otherwise", () => {
    const terms = { agent: { one: "Maid", many: "Maids" }, subagent: { one: "s", many: "ss" }, director: { one: "d", many: "dd" }, owner: { one: "o", many: "oo" } };
    const enMirror = { locale: "en" as const, terms };
    expect(trayTooltip(1, "en", enMirror)).toBe("Cutex — 1 Maid waiting");
    expect(trayTooltip(2, "en", enMirror)).toBe("Cutex — 2 Maids waiting");
    expect(overlayDescription(2, "en", enMirror)).toBe("2 Maids waiting");
    // language switched but the push has not arrived (or was lost): the new language's built-ins,
    // never the previous language's words
    expect(trayTooltip(2, "zh-CN", enMirror)).toBe("Cutex — 2 个智能体等待处理");
    expect(overlayDescription(2, "ru-RU", enMirror)).toBe("агент(ов) в ожидании: 2");
    const zhMirror = { locale: "zh-CN" as const, terms: { ...terms, agent: { one: "管家", many: "管家" } } };
    expect(trayTooltip(2, "zh-CN", zhMirror)).toBe("Cutex — 2 个管家等待处理");
    expect(overlayDescription(2, "zh-Hant-CN", { locale: "zh-Hant-CN", terms: { ...terms, agent: { one: "管家", many: "管家" } } })).toBe("2 個管家等待處理");
    // the push arrived before setLocale (reordered): the stale-tag mirror is ignored for the old
    // locale too
    expect(trayTooltip(2, "en", zhMirror)).toBe("Cutex — 2 agents waiting");
    // no mirror yet (tray before the renderer first pushed): the built-in words
    expect(trayTooltip(2, "en", null)).toBe("Cutex — 2 agents waiting");
    expect(trayTooltip(2, "zh-CN")).toBe("Cutex — 2 个智能体等待处理");
  });

  it("parses a pushed terms mirror defensively", () => {
    const good = { agent: { one: "a", many: "as" }, subagent: { one: "s", many: "ss" }, director: { one: "d", many: "dd" }, owner: { one: "o", many: "oo" } };
    expect(parseTerms({ locale: "en", terms: good })).toEqual({ locale: "en", terms: good });
    expect(parseTerms(null)).toBeNull();
    expect(parseTerms("garbage")).toBeNull();
    expect(parseTerms({ locale: "en" })).toBeNull();
    expect(parseTerms({ locale: "xx-XX", terms: good })).toBeNull();
    expect(parseTerms({ locale: "en", terms: { ...good, owner: { one: "o" } } })).toBeNull();
    expect(parseTerms({ locale: "en", terms: { ...good, director: 3 } })).toBeNull();
    const trimmed = parseTerms({ locale: "en", terms: { ...good, agent: { one: "  Maid  ", many: "Maids" } } });
    expect(trimmed?.terms.agent).toEqual({ one: "Maid", many: "Maids" });
  });

  it("sanitizes the attention count", () => {
    expect(attentionCount(3)).toBe(3);
    expect(attentionCount(-1)).toBe(0);
    expect(attentionCount(Number.NaN)).toBe(0);
    expect(attentionCount("2")).toBe(0);
    expect(attentionCount(2.7)).toBe(2);
    expect(attentionCount(1e9)).toBe(999);
  });

  it("counts agents with pending requests like the sidebar", () => {
    const view = (n: number) => ({ timeline: { pending: { size: n } } });
    const sessions = { a: view(0), b: view(2), c: view(1) };
    expect(waitingAgentCount(sessions)).toBe(2);
    expect([...needsInputIds(sessions)].sort()).toEqual(["b", "c"]);
    expect(waitingAgentCount({})).toBe(0);
  });
});

function decodePng(png: Buffer): { size: number; pixels: Buffer } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let offset = 8;
  let size = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") size = data.readUInt32BE(0);
    if (type === "IDAT") idat.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) raw.copy(pixels, y * size * 4, y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1));
  return { size, pixels };
}

describe("generated icons", () => {
  it("encodes a valid overlay PNG", () => {
    expect(decodePng(overlayPng(16)).size).toBe(16);
  });

  it("puts the attention dot on the logo with a transparent ring, in either channel order", () => {
    const grey = () => new Uint8Array(32 * 32 * 4).fill(128);
    const at = (px: Uint8Array, x: number, y: number) => Array.from(px.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    const rgba = addAttentionDot(grey(), 32, "rgba");
    const bgra = addAttentionDot(grey(), 32, "bgra");
    // Dot centre (0.8, 0.2) is mint; the ring at radius ~0.23 is cleared; far away is untouched.
    expect(at(rgba, 25, 6)).toEqual([92, 214, 180, 255]);
    expect(at(bgra, 25, 6)).toEqual([180, 214, 92, 255]);
    expect(at(rgba, 25, 14)[3]).toBe(0);
    expect(at(rgba, 4, 28)).toEqual([128, 128, 128, 128]);
  });
});

describe("parsePrefs updateRemote", () => {
  it("keeps a usable update remote and drops anything else", () => {
    expect(parsePrefs({ updateRemote: "https://example.com/cutex-desktop.git" }).updateRemote).toBe("https://example.com/cutex-desktop.git");
    expect(parsePrefs({ updateRemote: "-x" })).not.toHaveProperty("updateRemote");
    expect(parsePrefs({})).not.toHaveProperty("updateRemote");
  });
});
