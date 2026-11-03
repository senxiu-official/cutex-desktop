import { expect, it } from "vitest";
import { unlistedModel } from "../src/renderer/src/lib/models";

it("only flags a missing model in a successfully loaded, current, nonempty list", () => {
  const models = [{ id: "native-id", model: "gpt-6.1-sol" }];
  expect(unlistedModel(models, "gpt-sol-6.1", true)).toBe(true);
  expect(unlistedModel(models, "gpt-6.1-sol", true)).toBe(false);
  expect(unlistedModel(models, "native-id", true)).toBe(false);
  expect(unlistedModel(models, "gpt-sol-6.1", false)).toBe(false);
  expect(unlistedModel(null, "gpt-sol-6.1", true)).toBe(false);
  expect(unlistedModel([], "gpt-sol-6.1", true)).toBe(false);
  expect(unlistedModel(models, null, true)).toBe(false);
  expect(unlistedModel([{ id: "friendly", requestModel: "provider/new" }], "provider/new", true)).toBe(false);
});
