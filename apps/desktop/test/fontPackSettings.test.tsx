// Settings → 外观: the font picker draws each choice in its own font (bundled preview subsets for the 中文字体包, never
// the big files), pack families say 未导入 until imported; the 中文字体包 card lists the four families and imports.
// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: (globalThis as { cutex?: unknown }).cutex ?? {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "zh-CN" }),
}));

const g = globalThis as { cutex?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
let combo: typeof import("../src/renderer/src/components/settings/FontCombo");
let rows: typeof import("../src/renderer/src/components/settings/AppearanceRows");
let section: typeof import("../src/renderer/src/components/settings/FontPackSettings");
let pack: typeof import("../src/renderer/src/lib/fontPack");
const added: { family: string; source: string }[] = [];
beforeAll(async () => {
  g.IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { FontFace?: unknown }).FontFace = class { constructor(readonly family: string, readonly source: string) { added.push({ family, source }); } };
  Object.defineProperty(document, "fonts", { value: { add: () => {}, delete: () => {} }, configurable: true });
  const { mockFontPack } = await import("../src/renderer/src/dev/mockFontPack");
  g.cutex = { fontPack: mockFontPack() };
  combo = await import("../src/renderer/src/components/settings/FontCombo");
  rows = await import("../src/renderer/src/components/settings/AppearanceRows");
  section = await import("../src/renderer/src/components/settings/FontPackSettings");
  pack = await import("../src/renderer/src/lib/fontPack");
}, 30_000);

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
async function open(host: HTMLElement) {
  await act(async () => host.querySelector("input")!.focus());
  return [...host.querySelectorAll<HTMLElement>("[role=option]")];
}

describe("font picker previews", () => {
  it("draws each choice in its own font with a sample; a listed font that is not installed keeps 未安装", async () => {
    const describe = (f: string) => (f === "Fancy" ? { label: "Fancy Name", preview: { fontFamily: '"cutex-preview-x", system-ui', sample: "永和 Aa 123" } } : {});
    const host = await mount(h(combo.FontCombo, { value: "Fancy", fonts: ["Fancy", "Missing"], defaultLabel: "默认", installed: (f: string) => f !== "Missing", describe, onChange: () => {} }));
    expect(host.querySelector("input")!.value).toBe("Fancy Name");
    const options = await open(host);
    const fancy = options[1]!.querySelector<HTMLElement>("[data-font-choice]")!;
    expect(fancy.style.fontFamily).toContain("cutex-preview-x");
    expect(fancy.textContent).toBe("Fancy Name永和 Aa 123");
    expect(options[2]!.textContent).toContain("appearance.notInstalled");
    // Typing matches the family as well as the shown name.
    await act(async () => {
      const input = host.querySelector("input")!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "fancy");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...host.querySelectorAll("[role=option]")].map((o) => o.textContent)).toEqual(["Fancy Name永和 Aa 123"]);
  });

  it("lists pack families by name, 未导入 until imported, with only the small preview faces registered", async () => {
    added.length = 0;
    const host = await mount(h(rows.FontRow, { label: "中文", value: "", fonts: ["Swei Spring Sugar SC", "Zhuque Fangsong", "Bitter", "Microsoft YaHei"], cjkFonts: ["Microsoft YaHei"], onChange: () => {} }));
    const options = await open(host);
    const text = options.map((o) => o.textContent);
    expect(text[1]).toBe("狮尾四季春加糖永和 Aa 123appearance.fontPack.notImported");
    expect(text[2]).toBe("朱雀仿宋永和 Aa 123appearance.fontPack.notImported");
    expect(text[3]).toBe("BitterAa Gg 123");
    expect(options[4]!.querySelector<HTMLElement>("[data-font-choice]")!.style.fontFamily).toContain("Microsoft YaHei");
    expect(text[4]).toContain("永和 Aa 123");
    // Opening the list registers preview faces only: subsets for the pack, Bitter's own regular face.
    expect(added.map((a) => a.family).sort()).toEqual(["cutex-preview-bitter", "cutex-preview-swei-spring-sugar", "cutex-preview-zhuque-fangsong"]);
    for (const face of added) expect(face.source).not.toContain("cutex-font:");
    expect(added.find((a) => a.family === "cutex-preview-zhuque-fangsong")!.source).toMatch(/preview\/zhuque-fangsong\.woff2/);
    // After the import, the imported family has no note.
    await act(async () => { await pack.importFontPack(); });
    const after = await open(host);
    expect(after[1]!.textContent).toBe("狮尾四季春加糖永和 Aa 123");
    expect(after[2]!.textContent).toContain("appearance.fontPack.notImported");
  });
});

describe("中文字体包 card", () => {
  it("lists the four families with weights, size and status, and the two buttons", async () => {
    const host = await mount(h(section.FontPackSection));
    const html = host.innerHTML;
    expect(html).toContain("appearance.fontPack.import");
    expect(html).toContain("appearance.fontPack.openFolder");
    expect([...host.querySelectorAll("[data-font-pack]")].map((e) => e.getAttribute("data-font-pack"))).toEqual(["swei-spring-sugar", "swei-b2-sugar", "swei-spring", "zhuque-fangsong"]);
    expect(html).toContain("appearance.fontPack.detail(400 / 500 / 700,");
    expect([...host.querySelectorAll("[data-font-pack-status]")].map((e) => e.getAttribute("data-font-pack-status"))).toEqual(["imported", "missing", "missing", "missing"]);
  });

  it("is absent without the bridge (owner alert window, plain browser)", () => {
    const saved = (g.cutex as { fontPack?: unknown }).fontPack;
    delete (g.cutex as { fontPack?: unknown }).fontPack;
    try {
      expect(renderToStaticMarkup(h(section.FontPackSection))).toBe("");
    } finally {
      (g.cutex as { fontPack?: unknown }).fontPack = saved;
    }
  });
});
