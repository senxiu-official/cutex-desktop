// @vitest-environment jsdom
// The file view on a path that is not there (owner report 2026-11-10): plain words, not the host's
// `path_not_found: the path does not exist`; other errors still show as they come.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, api: {}, onEvent: () => () => {} }));
const { FileView } = await import("../src/renderer/src/modules/workspace/FileView");
const { I18nProvider } = await import("../src/renderer/src/i18n");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let failure = new Error("path_not_found: the path does not exist");
const api = { hostFile: async () => { throw failure; }, fsFile: async () => { throw failure; } } as never;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (props: Record<string, unknown>) => act(async () => root.render(h(I18nProvider, null, h(FileView, { api, hostId: "local", scope: null, path: "C:/Users/me/.cutex/tool-results/a.png", host: true, ...props } as never))));

describe("FileView: a file that is not there", () => {
  it("says so in plain words, for a host path and a workspace path", async () => {
    failure = new Error("path_not_found: the path does not exist");
    await render({});
    await act(async () => {});
    const shown = host.querySelector("[data-file-error]");
    expect(shown?.getAttribute("data-file-error")).toBe("missing");
    expect(shown?.textContent).not.toMatch(/path_not_found/);
    expect(shown?.textContent?.length).toBeGreaterThan(0);

    await render({ host: false, scope: { kind: "agent", id: "a" }, path: "src/gone.ts" });
    await act(async () => {});
    expect(host.querySelector("[data-file-error]")?.getAttribute("data-file-error")).toBe("missing");
  });

  it("other errors are shown as they come", async () => {
    failure = new Error("permission_denied: no access");
    await render({ path: "C:/Users/me/secret.txt" });
    await act(async () => {});
    expect(host.textContent).toContain("permission_denied: no access");
    expect(host.querySelector('[data-file-error="missing"]')).toBeNull();
  });
});
