import { expect, it } from "vitest";
import { portraitProvider } from "../src/renderer/src/lib/launchPortraits";

it("keeps artwork tied to provider and maps Z.ai to GLM", () => {
  expect(portraitProvider("zai")).toBe("glm");
  expect(portraitProvider("claude")).toBe("claude");
  expect(portraitProvider("openrouter")).toBeNull();
  expect(portraitProvider(null)).toBeNull();
});
