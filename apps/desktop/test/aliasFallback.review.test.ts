import { afterEach, it, expect } from "vitest";
import { claudeAliasName } from "../src/renderer/src/lib/claudeModels";
import { forgetCatalogNames, modelLabel, setAliasNamer } from "../src/renderer/src/lib/modelDisplay";
const t = ((key: string) => key) as Parameters<typeof claudeAliasName>[1];
afterEach(() => { setAliasNamer(null); forgetCatalogNames(); });
it("id-only alias fallback must not borrow a version cached from another profile's catalog", () => {
  forgetCatalogNames();
  setAliasNamer(id => claudeAliasName(id, t));
  expect(modelLabel("opus", "Opus 5.5")).toBe("Opus 5.5");
  // A different profile's id-only call has no SDK-confirmed target/version of its own (owner 2026-11-23: 「Opus」).
  expect(modelLabel("opus", null)).toBe("Opus");
});
