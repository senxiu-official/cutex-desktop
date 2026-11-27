import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MODULE_API_VERSION } from "../src/index";
import { emitDeclarations } from "../scripts/declarations.mjs";

it("matches the reviewed v1.33 declaration output, including the contract version", { timeout: 60_000 }, () => {
  expect(MODULE_API_VERSION).toBe("1.33");
  expect(emitDeclarations()).toBe(readFileSync(new URL("./fixtures/module-api-1.33.d.ts", import.meta.url), "utf8"));
});
