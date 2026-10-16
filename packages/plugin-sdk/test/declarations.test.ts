import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MODULE_API_VERSION } from "../src/index";
import { emitDeclarations } from "../scripts/declarations.mjs";

it("matches the reviewed v1.15 declaration output, including the contract version", () => {
  expect(MODULE_API_VERSION).toBe("1.15");
  expect(emitDeclarations()).toBe(readFileSync(new URL("./fixtures/module-api-1.15.d.ts", import.meta.url), "utf8"));
});
