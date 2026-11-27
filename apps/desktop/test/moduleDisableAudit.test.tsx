// @vitest-environment jsdom
// Opt-in diagnostic: CUTEX_MODULE_DISABLE_AUDIT=1 pnpm test test/moduleDisableAudit.test.tsx
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

const OPT_IN = process.env.CUTEX_MODULE_DISABLE_AUDIT === "1";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function until(find: () => boolean, ms = 1800) {
  const end = Date.now() + ms;
  do {
    if (find()) return true;
    await act(() => new Promise(resolve => setTimeout(resolve, 15)));
  } while (Date.now() < end);
  return find();
}

interface ScenarioResult {
  scenario: string;
  off: string[];
  missing: string[];
  errors: string[];
}

it.skipIf(!OPT_IN)("audits rendered desktop surfaces with each switch off and the Lean preset", async () => {
  window.history.replaceState(null, "", "/?perf=quiet");
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false, media, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.scrollTo ??= () => {};
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const { MODULES } = await import("../src/renderer/src/modules/registry");
  const { startAppModules } = await import("../src/renderer/src/modules/app");
  const { App } = await import("../src/renderer/src/App");
  const { I18nProvider, translate } = await import("../src/renderer/src/i18n");
  const { useApp, NEW_AGENT_PAGE } = await import("../src/renderer/src/store");
  const { closeSettingsShelf } = await import("../src/renderer/src/lib/settingsShelf");
  const { moduleMetadata } = await import("../src/shared/moduleMetadata");
  const { setUiPref } = await import("../src/renderer/src/lib/prefs");
  const { setAppearance } = await import("../src/renderer/src/lib/appearance");
  const { activateAttention } = await import("../src/renderer/src/lib/attentionActivate");
  const { presetChanges, switchPlan } = await import("../src/renderer/src/modules/moduleCatalog");
  // Projects, archive, storage and approvals are required since module-dependencies-20261126: never switched here.
  const modifiable = MODULES.filter(def => !def.required);
  const presetModules = MODULES.map(def => ({ id: def.id, required: !!def.required, defaultOn: !!def.required || (!moduleMetadata(def.id)?.optional && def.defaultEnabled !== false), requires: def.requires?.modules ?? [] }));
  const host = startAppModules(MODULES);
  const box = document.createElement("div");
  document.body.append(box);
  const errors = new Set<string>();
  const onError = (event: ErrorEvent) => { errors.add(errorText(event.error ?? event.message)); event.preventDefault(); };
  const onRejection = (event: PromiseRejectionEvent) => { errors.add(errorText(event.reason)); event.preventDefault(); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const root = createRoot(box, {
    onCaughtError: error => { errors.add(errorText(error)); },
    onUncaughtError: error => { errors.add(errorText(error)); },
    onRecoverableError: error => { errors.add(errorText(error)); },
  });
  const scenarioResults: ScenarioResult[] = [];
  const select = () => useApp.getState().select("demo-done");
  const shown = (query: string) => !!box.querySelector(query);
  async function checkScenario(scenario: string, off: readonly string[]) {
    const missing: string[] = [];
    const expectRender = async (name: string, selector: string | (() => boolean)) => {
      const rendered = await until(typeof selector === "string" ? () => shown(selector) : selector, scenario === "baseline" ? 8000 : 600);
      if (!rendered) {
        const pageOff = [...box.querySelectorAll("main")].some(node => node.textContent?.includes(translate("modules.pageOff")));
        missing.push(pageOff ? name + " (module-off page)" : name);
      }
    };
    if (scenario !== "baseline") errors.clear();
    await act(async () => {
      closeSettingsShelf();
      useApp.getState().closePage();
      for (const def of modifiable) {
        const want = !off.includes(def.id);
        if (host.isEnabled(def.id) !== want) await host.setEnabled(def.id, want);
      }
      await select();
    });
    await expectRender("sidebar", "[data-sidebar-roster]");
    await expectRender("conversation", "[data-composer-input]");
    await act(async () => useApp.getState().openSettings("general"));
    await expectRender("settings", "[data-settings-card] #settings-language");
    if (scenario === "baseline" || scenario === "lean") {
      await act(async () => useApp.getState().openSettings("archive"));
      await expectRender("archive list", "[data-settings-card] #settings-list");
      await act(async () => useApp.getState().openSettings("storage"));
      await expectRender("storage cleanup entry", "[data-settings-card] [data-storage-cleanup]");
    }
    await act(async () => closeSettingsShelf());

    const projectButton = box.querySelector<HTMLButtonElement>(`button[aria-label="${translate("nav.projectSettings")}"]`);
    if (projectButton) {
      await act(async () => projectButton.click());
      await expectRender("sidebar → project settings", "[data-project-tabs]");
    } else if (!off.includes("projects")) {
      await act(async () => useApp.getState().openPage("projects.page", { project: "demo" }));
      await expectRender("project", "[data-project-tabs]");
    }
    if (scenario === "baseline" || scenario === "approvals") {
      await act(async () => {
        useApp.getState().closePage();
        // The production action used by the sidebar/Needs You strip for an approvals-only signal.
        activateAttention({ id: "demo-done", signal: "needsYou" }, { reasons: ["approval"], count: 1, askIds: [] }, "local");
      });
      await expectRender("Needs You → approvals", () => [...box.querySelectorAll("button")].some(
        button => button.textContent === translate("approvals.scope.decided"),
      ));
    }
    await act(async () => useApp.getState().openPage(NEW_AGENT_PAGE, { project: "demo" }));
    await expectRender("new agent", "[data-launch-option=project]");

    const pages = new Set(host.snapshot("main.page").filter(e => e.mode === "show").map(e => e.item.id));
    for (const { item, mode } of host.snapshot("nav.primary")) {
      if (mode === "show" && "page" in item.target && !pages.has(item.target.page))
        missing.push(`navigation ${item.id} → ${item.target.page}`);
    }
    const errorList = [...errors];
    const result = { scenario, off: [...off], missing, errors: errorList };
    scenarioResults.push(result);
    if (missing.length || errorList.length) console.log(JSON.stringify(result));
    return result;
  }
  try {
    setUiPref("sidebarOpen", true);
    // Use the actual in-column setting so the next scenario does not inherit the last opened page.
    setAppearance({ pageOpen: "column" }, false);
    await act(async () => root.render(createElement(I18nProvider, null, createElement(App))));
    if (!await until(() => !!useApp.getState().hosts, 10000)) throw Error("preview did not supply its mock hosts");
    const baseline = await checkScenario("baseline", []);
    expect(baseline).toMatchObject({ missing: [], errors: [] });

    const requested = process.env.CUTEX_MODULE_DISABLE_AUDIT_ONLY?.split(",");
    for (const { id } of modifiable) {
      // As Settings → 模块 does it: turning a module off asks to turn off the modules on that need it (一起关掉).
      if (!requested || requested.includes(id)) await checkScenario(id, switchPlan(id, false, presetModules, () => true));
    }
    // The real 精简 preset (modules/moduleCatalog), applied to the shipped defaults: optional modules keep theirs, and
    // whatever a module left on needs stays on.
    if (!requested || requested.includes("lean")) {
      const defaultOn = (id: string) => presetModules.find(m => m.id === id)!.defaultOn;
      const { on, off } = presetChanges("lean", presetModules, defaultOn);
      await checkScenario("lean", modifiable.filter(def => off.includes(def.id) || (!defaultOn(def.id) && !on.includes(def.id))).map(def => def.id));
    }

    const failures = scenarioResults.filter(row => row.missing.length || row.errors.length);
    const output = { scenarios: scenarioResults, failed: failures.map(row => row.scenario) };
    const report = process.env.CUTEX_MODULE_DISABLE_AUDIT_REPORT;
    if (report) writeFileSync(report, JSON.stringify(output, null, 2) + "\n", "utf8");
    expect(failures).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    await host.dispose();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}, 480_000);
