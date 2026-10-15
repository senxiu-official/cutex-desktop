import { describe, expect, it } from "vitest";
import { checkDefaultsPatch } from "../src/shared/sessionDefaults";

describe("checkDefaultsPatch", () => {
  it("accepts only the Claude tool switches", () => {
    expect(() => checkDefaultsPatch({ patch: { claudeAllowWrite: true } })).not.toThrow();
    expect(() => checkDefaultsPatch({ patch: { claudeAllowExec: false }, expectedRevision: 3 })).not.toThrow();
  });
  it("refuses other defaults, non-booleans and empty patches", () => {
    for (const params of [
      { patch: { sandboxMode: "danger-full-access" } },
      { patch: { claudeAllowWrite: true, permissions: "full-access" } },
      { patch: { claudeAllowWrite: "yes" } },
      { patch: {} },
      { patch: [] },
      {},
      { patch: { claudeAllowWrite: true }, other: 1 },
    ]) expect(() => checkDefaultsPatch(params as Record<string, unknown>)).toThrow();
  });
});
