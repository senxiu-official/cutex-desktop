// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({
  modules: [] as any[], rt: { view: null, active: {}, decisions: {}, bundled: {} } as any,
  dev: null as any, enable: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ modules: fx.modules, isEnabled: () => true, setEnabled: fx.enable, retry: vi.fn(), statuses: () => new Map(), subscribe: () => () => {}, snapshot: () => [] }) }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useModuleStatuses: () => new Map() }));
vi.mock("../src/renderer/src/modules/packs", async (original) => ({ ...(await original<object>()), usePackRuntime: () => fx.rt }));
vi.mock("../src/renderer/src/modules/devModules", () => ({ useModuleDevView: () => fx.dev }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => ({ current: { version: "0.2.4" } }) }));
vi.mock("../src/renderer/src/modules/shell/DevModules", () => ({ DevModulesGroup: () => null }));
vi.mock("../src/renderer/src/modules/shell/ModuleData", () => ({ ModuleDataGroup: () => null }));
import { I18nProvider } from "../src/renderer/src/i18n";
import { ModulesPage } from "../src/renderer/src/modules/shell/ModulesPage";
import { ModuleTags } from "../src/renderer/src/modules/shell/ModulePacks";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); fx.modules = []; fx.rt = { view: null, active: {}, decisions: {}, bundled: {} }; fx.dev = null; fx.enable.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = () => act(async () => root.render(h(I18nProvider, null, h(ModulesPage))));
const def = (id: string, required = false) => ({ id, required, displayName: id, titleKey: "modules.section.all" });
it("an initially loading pack view must not erase previous first-seen times", async () => {
  localStorage.setItem("cutex.modules.seen", JSON.stringify({ pilot: { version: "1.0.0", at: 1000 } }));
  fx.modules = [def("pilot")];
  await render();
  fx.rt = { view: { installed: [{ id: "pilot", version: "1.0.0", moduleApi: "^1.16", compat: "ok", entry: "x", styles: [], host: {} }], broken: [], index: null, operation: null, lastError: null }, active: { pilot: "1.0.0" }, decisions: { pilot: { use: true } }, bundled: {} };
  await render();
  expect(JSON.parse(localStorage.getItem("cutex.modules.seen")!).pilot.at).toBe(1000);
});
it("a loaded developer-folder module keeps its local origin, own version and internal/experimental tags", async () => {
  fx.modules = [def("lab-demo")];
  fx.rt.view = { installed: [], broken: [], index: null, operation: null, lastError: null };
  fx.dev = { enabled: true, internal: true, skipped: false, modules: [{ folder: "D:/test/lab", id: "lab-demo", version: "1.2.3", moduleApi: "^1.16", rev: 1, entry: "cutex-module://dev/entry.js", styles: [], host: { "@app/store": ["useApp"], "@cutex-desktop/module-api/experimental": ["workspace"] }, error: null }] };
  await render();
  const row = host.querySelector('[id="settings-module-lab-demo"]')!;
  expect(row).not.toBeNull();
  const tags = [...row.querySelectorAll<HTMLElement>("[data-module-tag]")].map((e) => e.dataset.moduleTag);
  expect(tags).toContain("local"); expect(tags).toContain("unverified"); expect(tags).toContain("internal"); expect(tags).toContain("experimental");
  expect(row.querySelector("[data-module-version]")!.textContent).toBe("v1.2.3");
});
it("a core module shows only a lock with its explanation, no switch", async () => {
  fx.modules = [def("shell", true)]; await render();
  const lock = host.querySelector<HTMLElement>("[data-module-locked]")!;
  expect(lock.querySelector("button, [role=switch]")).toBeNull();
  expect(lock.getAttribute("role")).toBe("img");
  expect(lock.title).toMatch(/核心模块|Core module/);
  expect(lock.getAttribute("aria-label")).toContain(lock.title);
  expect(fx.enable).not.toHaveBeenCalled();
});
it("a failed-verification local pack must not claim that its publisher is verified", async () => {
  // Matches ModulePackService.view() after a local pack's bytes no longer match its recorded hash.
  fx.rt.view = { installed: [], broken: [{ id: "hello", version: "1.0.0", error: "index.js does not match its recorded hash" }], index: null, operation: null, lastError: null };
  await render();
  const origin = host.querySelector<HTMLButtonElement>("[data-module-tag=downloaded] button");
  if (origin) act(() => origin.click());
  expect(document.querySelector("[data-popover]")?.textContent ?? "").not.toMatch(/发布者已验证|publisher.*verified/i);
});
it("a digit-leading source commit keeps its identifier without a version prefix", async () => {
  await act(async () => root.render(h(I18nProvider, null, h(ModuleTags, { facts: { origin: "core", version: "89c3643", versionOf: "app", tags: [] } }))));
  expect(host.querySelector("[data-module-version]")!.textContent).toBe("89c3643");
});

it("a failed developer-folder rebuild keeps the running build's version and risk tags", async () => {
  fx.modules = [def("lab-demo")];
  fx.rt.view = { installed: [], broken: [], index: null, operation: null, lastError: null };
  fx.dev = { enabled: true, internal: true, skipped: false, modules: [{ folder: "D:/test/lab", id: "lab-demo", version: "1.0.0", moduleApi: "^1.31", rev: 1, entry: "cutex-module://dev/lab-demo/1/index.js", styles: [], host: { "@app/store": ["useApp"] }, error: null }] };
  await render();
  const row = () => host.querySelector('[id="settings-module-lab-demo"]')!;
  expect(row().querySelector("[data-module-version]")!.textContent).toBe("v1.0.0");
  expect(row().querySelector('[data-module-tag="internal"]')).not.toBeNull();
  // createDevModuleLoader keeps rev 1 after rev 2 fails to activate; main's view still names the compiled rev 2.
  fx.dev = { ...fx.dev, modules: [{ ...fx.dev.modules[0], version: "2.0.0", rev: 2, entry: "cutex-module://dev/lab-demo/2/index.js", host: { "@cutex-desktop/module-api": ["defineModule"] }, error: "activate threw; previous build retained" }] };
  await render();
  expect(row().querySelector('[data-module-tag="internal"]')).not.toBeNull();
  expect(row().querySelector("[data-module-version]")!.textContent).toBe("v1.0.0");
});

it("a rejected developer-folder id collision cannot relabel the bundled module that is still running", async () => {
  fx.modules = [def("browser")];
  fx.rt = { view: { installed: [], broken: [], index: null, operation: null, lastError: null }, active: {}, decisions: {}, bundled: { browser: null } };
  fx.dev = { enabled: true, internal: true, skipped: false, modules: [{ folder: "D:/test/browser", id: "browser", version: "9.9.9", moduleApi: "^1.31", rev: 1, entry: "cutex-module://dev/browser/1/index.js", styles: [], host: {}, error: "id taken by the bundled module" }] };
  await render();
  const row = host.querySelector('[id="settings-module-browser"]')!;
  expect(row.querySelector('[data-module-tag="bundled"]')).not.toBeNull();
  expect(row.querySelector("[data-module-version]")!.textContent).toBe("v0.2.4");
});
