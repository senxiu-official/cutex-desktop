// @vitest-environment jsdom
// Owner 2026-10-23 (perf audit §5): rarely used pages — the Settings pages and sections, 关于 and a few seldom
// opened `main.page` items — load on first open (lib/lazyPage), out of the entry chunk.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { act, createElement as h, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../src/renderer/src/i18n";
import { LAZY_RETRY_MS, lazyPage, lazyPageCount, preloadLazyPages, preloadOnIntent, resetPreloadIntent } from "../src/renderer/src/lib/lazyPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("lazyPage (lib/lazyPage)", () => {
  it("renders nothing until loaded, then the page; later opens render at once", async () => {
    const chunk = deferred<(p: { label: string }) => ReturnType<typeof h>>();
    let calls = 0;
    const Page = lazyPage(() => (calls++, chunk.promise));
    await act(async () => root.render(h(Page, { label: "关于" })));
    expect(host.textContent).toBe("");
    await act(async () => chunk.resolve(({ label }) => h("p", null, label)));
    expect(host.textContent).toBe("关于");
    // Closed and opened again: no empty frame — the first synchronous render already shows it.
    act(() => root.render(null));
    act(() => root.render(h(Page, { label: "再次" })));
    expect(host.textContent).toBe("再次");
    expect(calls).toBe(1);
  });

  it("a page open while its chunk loads is not remounted once it arrives", async () => {
    const chunk = deferred<() => ReturnType<typeof h>>();
    const Page = lazyPage(() => chunk.promise);
    let mounts = 0;
    function Inner() {
      const [n] = useState(() => ++mounts);
      useEffect(() => undefined, []);
      return h("span", null, String(n));
    }
    function Parent({ tick }: { tick: number }) {
      return h("div", { "data-tick": tick }, h(Page, {}));
    }
    await act(async () => root.render(h(Parent, { tick: 1 })));
    await act(async () => chunk.resolve(Inner));
    await act(async () => root.render(h(Parent, { tick: 2 })));
    await act(async () => root.render(h(Parent, { tick: 3 })));
    expect(host.textContent).toBe("1");
    expect(mounts).toBe(1);
  });

  it("a failed load is tried again on the next open", async () => {
    let calls = 0;
    const Page = lazyPage(() => (++calls === 1 ? Promise.reject(new Error("chunk")) : Promise.resolve(() => h("b", null, "ok"))));
    await expect(preloadLazyPages(async () => undefined)).resolves.toBeUndefined();
    expect(calls).toBe(1);
    await act(async () => root.render(h(Page, {})));
    expect(calls).toBe(2);
    expect(host.textContent).toBe("ok");
  });

  it("a chunk that fails to load is tried once more, then says so with 重试 / 重新加载窗口 (not a module error)", async () => {
    let calls = 0;
    let fail = 2;
    const Page = lazyPage(() => (++calls, fail-- > 0 ? Promise.reject(new TypeError("Failed to fetch dynamically imported module: x.js")) : Promise.resolve(() => h("b", null, "ok"))));
    // zh-CN: bundled, so the provider renders at once (jsdom says en-US, whose catalog loads on demand).
    localStorage.setItem("cutex-desktop.locale", "zh-CN");
    await act(async () => root.render(h(I18nProvider, null, h(Page, {}))));
    expect(calls).toBe(1);
    expect(host.querySelector("[data-testid=lazy-load-failed]")).toBeNull();
    await act(async () => void (await new Promise((r) => setTimeout(r, LAZY_RETRY_MS + 20))));
    expect(calls).toBe(2);
    const failed = host.querySelector("[data-testid=lazy-load-failed]");
    expect(failed).not.toBeNull();
    expect(failed!.querySelectorAll("button")).toHaveLength(2);
    // 重试: the third try loads it.
    await act(async () => (failed!.querySelector("button") as HTMLButtonElement).click());
    expect(calls).toBe(3);
    expect(host.textContent).toBe("ok");
  });

  it("preloadOnIntent preloads once, however often the owner heads for a page", async () => {
    resetPreloadIntent();
    let loads = 0;
    lazyPage(() => (loads++, Promise.resolve(() => null)));
    const before = lazyPageCount();
    await Promise.all([preloadOnIntent(), preloadOnIntent()]);
    await preloadOnIntent();
    expect(loads).toBe(1);
    expect(before).toBeGreaterThan(0);
  });

  it("preloadLazyPages loads every registered page, one per idle period", async () => {
    const loaded: string[] = [];
    lazyPage(() => (loaded.push("a"), Promise.resolve(() => null)));
    lazyPage(() => (loaded.push("b"), Promise.resolve(() => null)));
    let idles = 0;
    await preloadLazyPages(async () => void idles++);
    expect(loaded).toEqual(["a", "b"]);
    expect(idles).toBe(lazyPageCount());
    // Loaded ones are not fetched again.
    await preloadLazyPages(async () => undefined);
    expect(loaded).toEqual(["a", "b"]);
  });
});

// Every Settings page / section a module contributes is lazy; only the pages opened often stay in the entry chunk.
const EAGER = new Set(["ApprovalsPage", "DelegationsPage", "JobsPage", "ProjectsPage", "PendingChat", "ServicesPage", "WorkflowsPage", "Settings", "SettingsNav"]);
describe("module pages are lazy (source)", () => {
  const modules = join(__dirname, "../src/renderer/src/modules");
  // claude-science is a module pack (scripts/module-packs): it may only import what modules/packHost provides.
  const files = readdirSync(modules)
    .filter((m) => m !== "claude-science")
    .map((m) => ["index.ts", "index.tsx"].map((n) => join(modules, m, n)).find(existsSync))
    .filter((f): f is string => !!f);
  it.each(files.map((f) => [f.slice(modules.length + 1).replace(/\\/g, "/"), f]))("%s", (_name, file) => {
    const text = readFileSync(file, "utf8");
    const names = [...new Set([...text.matchAll(/\b(?:Page|Section): ([A-Za-z]+)\b/g)].map((m) => m[1]!))].filter((n) => !EAGER.has(n));
    for (const name of names) expect(text, name).toMatch(new RegExp(`const ${name} = lazyPage\\(\\(\\) => import\\(`));
  });
});
