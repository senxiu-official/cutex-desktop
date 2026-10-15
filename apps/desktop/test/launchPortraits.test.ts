import { expect, it } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import { portraitChoices, portraitProvider } from "../src/renderer/src/lib/launchPortraits";

const profile = (id: string, provider: string) => ({ id, name: id, appearance: { effectiveProviderCategory: provider } }) as ProfileItem;

it("shows only available providers in fixed order and chooses their first profile", () => {
  const choices = portraitChoices([profile("ds-first", "deepseek"), profile("ds-second", "deepseek"), profile("gpt", "codex"), profile("unknown", "other"), profile("zai", "zai")]);
  expect(choices.map((c) => [c.provider, c.profile.id])).toEqual([["glm", "zai"], ["codex", "gpt"], ["deepseek", "ds-first"]]);
  expect(choices.find((c) => c.provider === "deepseek")?.profiles.map((p) => p.id)).toEqual(["ds-first", "ds-second"]);
  expect(portraitChoices([])).toEqual([]);
});

it("keeps artwork tied to provider and maps Z.ai to GLM", () => {
  expect(portraitProvider("zai")).toBe("glm");
  expect(portraitProvider("claude")).toBe("claude");
  expect(portraitProvider("openrouter")).toBeNull();
  expect(portraitProvider(null)).toBeNull();
});
