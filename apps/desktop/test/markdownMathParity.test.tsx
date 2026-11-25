// The Markdown math delimiter rules the phone shares (packages/cutex-mobile/src/lib/math.ts): one case table,
// run here against the desktop renderer and in cutex-mobile's test/math.test.ts against the phone's, so a rule
// changed on one side fails until the other follows.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import parity from "./fixtures/markdown-math-parity.json";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: () => Promise.resolve() },
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { loadKatex } = await import("../src/renderer/src/lib/katexRender");

beforeAll(async () => {
  await loadKatex();
});

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** Formulas KaTeX typeset, in document order: [source as written, display block]. */
const formulas = (html: string) =>
  [...html.matchAll(/class="math-(inline|display)" data-math-source="([^"]*)"/g)].map((m) => [unescape(m[2]!), m[1] === "display"] as [string, boolean]);

describe("Markdown math rules shared with cutex-mobile", () => {
  it.each(parity.cases.map((c) => [c.md, c.math] as const))("%j", (md, math) => {
    expect(formulas(renderToStaticMarkup(h(Markdown, { text: md })))).toEqual(math);
  });
});
