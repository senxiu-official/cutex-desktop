// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileRuntimeVariant } from "../src/shared/profileVariants";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, api: {} }));
import { NewAgentRuntimePicker } from "../src/renderer/src/modules/agent-config/NewAgentRuntimePicker";
import { CreationRuntimeTag } from "../src/renderer/src/components/CreationRuntimeTag";
import { ProviderCards } from "../src/renderer/src/components/settings/newProfile/ProviderCards";
import { providerCards } from "../src/renderer/src/lib/newProfileModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const variant = (runtime: ProfileRuntimeVariant["runtime"]): ProfileRuntimeVariant => ({ id: runtime, runtime, primary: true, defaults: { model: null, reasoningEffort: null }, inUse: 0 });
const features = new Set(["dsh-runtime", "kimi-runtime"]);

it("new-agent runtime choices mark only DSH/Kimi and retain selection", () => {
  const variants = ["codex", "claude", "dsh", "kimi"].map((r) => variant(r as ProfileRuntimeVariant["runtime"]));
  const changed = vi.fn();
  act(() => root.render(h(NewAgentRuntimePicker, { variants, chosen: variants[0]!, features, onChange: changed })));
  expect([...host.querySelectorAll('[data-experimental-runtime]')].map((el) => el.getAttribute("data-experimental-runtime"))).toEqual(["dsh", "kimi"]);
  expect(host.querySelector('[data-experimental-runtime="kimi"]')?.getAttribute("title")).toContain("creation.experimentalHint");
  const radio = host.querySelector('[data-experimental-runtime="dsh"]')!.closest("button")!;
  act(() => radio.click());
  expect(changed).toHaveBeenCalledWith("dsh");
});

it.each(["dsh", "kimi"] as const)("new-agent single %s runtime is labelled; a host without its capability is unchanged", (runtime) => {
  const v = variant(runtime);
  act(() => root.render(h(NewAgentRuntimePicker, { variants: [v], chosen: v, features, onChange: vi.fn() })));
  expect(host.querySelector(`[data-experimental-runtime="${runtime}"]`)).toBeTruthy();
  act(() => root.render(h(NewAgentRuntimePicker, { variants: [v], chosen: v, features: new Set<string>(), onChange: vi.fn() })));
  expect(host.querySelector('[data-experimental-runtime]')).toBeNull();
});

it("new-Profile provider cards label Kimi only when the native Kimi option is offered", () => {
  const caps = new Set(["profile-runtime-variants", "kimi-runtime-profiles", "kimi-accounts"]);
  act(() => root.render(h(ProviderCards, { cards: providerCards([], caps), onPick: vi.fn() })));
  expect(host.querySelector('[data-provider-card="kimi"] [data-experimental-runtime="kimi"]')).toBeTruthy();
  expect(host.querySelector('[data-provider-card="openai"] [data-experimental-runtime]')).toBeNull();
  act(() => root.render(h(ProviderCards, { cards: providerCards([], new Set()), onPick: vi.fn() })));
  expect(host.querySelector('[data-experimental-runtime]')).toBeNull();
});

it.each(["codex", "claude", null])("does not label ordinary %s runtimes", (runtime) => {
  act(() => root.render(h(CreationRuntimeTag, { runtime })));
  expect(host.textContent).toBe("");
});

it("existing-agent/Profile surfaces do not import the creation-only tag or runtime picker", () => {
  const src = join(__dirname, "../src/renderer/src");
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".tsx") ? [join(dir, entry.name)] : []);
  const imports = files(src).filter((file) => /import .*CreationRuntimeTag|import .*NewAgentRuntimePicker/.test(readFileSync(file, "utf8"))).map((file) => relative(src, file).replace(/\\/g, "/")).sort();
  expect(imports).toEqual([
    "components/settings/NewProfileVariantsForm.tsx", "components/settings/newProfile/AuthStep.tsx", "components/settings/newProfile/ProviderCards.tsx", "components/settings/newProfile/RuntimeStep.tsx",
    "modules/agent-config/NewAgentPage.tsx", "modules/agent-config/NewAgentRuntimePicker.tsx",
  ]);
});
