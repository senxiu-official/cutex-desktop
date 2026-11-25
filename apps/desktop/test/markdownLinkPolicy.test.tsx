// @vitest-environment jsdom
// MarkdownLinkPolicyContext "inert" (a client without host file access, the iPad conversation): file links and local
// image paths are plain text, `cutex:` links / images / mentions are their text, nothing goes through hostApi and
// nothing opens on click. External links and data: images are unchanged; the default policy is unchanged; nested
// Markdown under the provider follows it.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const read = vi.fn(() => new Promise(() => {}));
  return {
    read,
    hostApi: vi.fn(() => ({ fsFile: read, hostFile: read, browseDirs: read })),
    openMenuFrom: vi.fn(),
    state: { sidebar: null, byHost: {}, hosts: null, selectedId: null, features: new Set(["fs-file-read"]) } as Record<string, unknown>,
  };
});
vi.mock("../src/renderer/src/store", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    hostApi: mocks.hostApi,
    useApp: Object.assign((select: (s: unknown) => unknown) => select(mocks.state), { getState: () => mocks.state, subscribe: () => () => {}, setState: () => {} }),
  };
});
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: mocks.openMenuFrom }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() }, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/components/CutexLink", () => ({
  CutexLink: ({ children }: { children: ReactNode }) => h("span", { "data-cutex-link": "" }, children),
  CutexImage: () => h("span", { "data-cutex-image": "" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { Markdown, MarkdownLinkPolicyContext } = await import("../src/renderer/src/components/Markdown");

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.hostApi.mockClear();
  mocks.read.mockClear();
  mocks.openMenuFrom.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const TEXT = [
  "See [the log](/home/me/logs/a.txt) and [home](~/notes.md).",
  "",
  "![shot](/home/me/shots/a.png)",
  "",
  "Report: [summary](cutex:artifact/report-1) by [@bob](cutex:agent/abc123).",
  "",
  "![chart](cutex:artifact/chart-1)",
  "",
  "Docs: [site](https://example.test/docs).",
].join("\n");

async function render(policy: "default" | "inert" | null, children: ReactNode = h(Markdown, { text: TEXT })) {
  await act(async () => root.render(policy ? h(MarkdownLinkPolicyContext.Provider, { value: policy }, children) : children));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}

describe("MarkdownLinkPolicyContext", () => {
  it("default (no provider): file links are chips and cutex: links resolve, as before", async () => {
    await render(null);
    const chips = [...host.querySelectorAll('a[role="link"]')].map((a) => a.textContent);
    expect(chips).toEqual(expect.arrayContaining(["the log"]));
    expect(host.querySelector("[data-cutex-link]")).not.toBeNull();
    expect(host.querySelector("[data-cutex-image]")).not.toBeNull();
  });

  it("an explicit 'default' renders the same as no provider", async () => {
    await render(null);
    const plain = host.innerHTML;
    await render("default");
    expect(host.innerHTML).toBe(plain);
  });

  it("inert: file links, local images and cutex: links are plain text; no hostApi, no click menus", async () => {
    await render("inert");
    expect(host.querySelector('a[role="link"]')).toBeNull();
    expect(host.querySelector("[data-cutex-link], [data-cutex-image]")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    const text = host.textContent!;
    for (const word of ["the log", "home", "shot", "summary", "@bob", "chart"]) expect(text).toContain(word);
    // The path stays readable as a tooltip, but nothing is a link to it.
    expect(host.querySelector('[title="/home/me/logs/a.txt"]')?.tagName).toBe("SPAN");
    expect(host.querySelector('[title="/home/me/shots/a.png"]')?.tagName).toBe("SPAN");
    for (const span of host.querySelectorAll("span[title]")) act(() => (span as HTMLElement).click());
    expect(mocks.hostApi).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.openMenuFrom).not.toHaveBeenCalled();
  });

  it("inert: external links and data: images are unchanged", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const text = `[site](https://example.test/docs)\n\n![dot](${png})`;
    await render(null, h(Markdown, { text }));
    const plain = host.innerHTML;
    await render("inert", h(Markdown, { text }));
    const a = host.querySelector<HTMLAnchorElement>('a[href="https://example.test/docs"]');
    expect(a?.textContent).toBe("site");
    // Same output as the default policy (the pipeline's own handling of the data: image included).
    expect(host.innerHTML).toBe(plain);
  });

  it("inert reaches nested Markdown (a work group's) and scoped file reads", async () => {
    await render(
      "inert",
      h("div", null, h(Markdown, { text: "[a](/x/a.txt)" }), h("section", null, h(Markdown, { text: "[b](/x/b.txt)", fileReads: "scoped" }))),
    );
    expect(host.querySelector('a[role="link"]')).toBeNull();
    for (const span of host.querySelectorAll("span[title]")) act(() => (span as HTMLElement).click());
    expect(mocks.openMenuFrom).not.toHaveBeenCalled();
    expect(mocks.hostApi).not.toHaveBeenCalled();
  });
});
