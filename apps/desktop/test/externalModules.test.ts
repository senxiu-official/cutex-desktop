// Acceptance O5: external plugin modules / entries carry a visible 外部 marker keyed off the id namespace.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { EXTERNAL_MODULE_PREFIX, isExternalModuleId } = await import("../src/renderer/src/modules/external");
const { externalItemId, externalModuleId } = await import("../src/renderer/src/modules/plugins/manager");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");

const SRC = join(__dirname, "../src/renderer/src");

describe("external module marker", () => {
  it("reserves the external- namespace for plugin modules", () => {
    expect(MODULES.filter((module) => isExternalModuleId(module.id))).toEqual([]);
    expect(isExternalModuleId(externalModuleId("settings"))).toBe(true);
    expect(externalItemId("settings.open")).toBe(`${EXTERNAL_MODULE_PREFIX}settings.open`);
    expect(isExternalModuleId("plugins")).toBe(false);
  });

  it("has a short label in both languages", () => {
    expect(zhCN["modules.external"]).toBe("外部");
    expect(en["modules.external"]).toBe("External");
  });

  it.each(["components/Sidebar.tsx", "components/PageTitle.tsx", "modules/shell/ModulesPage.tsx"])("%s marks external entries by module id", (file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    expect(source).toMatch(/isExternalModuleId\((?:entry|def)\.(?:moduleId|id)\) && <ExternalBadge \/>/);
  });
});
