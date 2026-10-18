import { describe, expect, it } from "vitest";
import type { ClaudeCodeSources, ProfileDetail } from "../../../shared/ipc";
import { claudeCodeShown, profileSources, toggledSources } from "./claudeCodeSources";

const detail = (fields: Partial<ProfileDetail>, inner: Partial<ProfileDetail["detail"]> = {}) => ({ ...fields, detail: { ...inner } }) as ProfileDetail;

describe("claude-code-sources helpers", () => {
  it("reads the draft first, then the effective value, then the default", () => {
    expect(profileSources({}, detail({ claudeSettingSources: ["project"] }))).toEqual(["project"]);
    expect(profileSources({}, detail({}, { claudeSettingSourcesDefault: [] }))).toEqual([]);
    expect(profileSources({ claudeSettingSources: ["user"] }, detail({ claudeSettingSources: ["project"] }))).toEqual(["user"]);
    expect(profileSources({ claudeSettingSources: null }, detail({ claudeSettingSources: ["project"] }, { claudeSettingSourcesDefault: [] }))).toEqual([]);
  });

  it("toggles one source and keeps the order", () => {
    expect(toggledSources([], "user", true)).toEqual(["user"]);
    expect(toggledSources(["user"], "project", true)).toEqual(["project", "user"]);
    expect(toggledSources(["project", "user"], "project", false)).toEqual(["user"]);
  });

  it("shows the running launch, else the next one", () => {
    const next = { settingSources: ["project" as const], claudeAiConnectors: false, mcpServers: ["docs"], skipped: [] };
    const launched = { ...next, settingSources: [], mcpServers: [] };
    const base = { next, launched, running: true } as unknown as ClaudeCodeSources;
    expect(claudeCodeShown(base)).toBe(launched);
    expect(claudeCodeShown({ ...base, running: false })).toBe(next);
    expect(claudeCodeShown({ ...base, launched: null })).toBe(next);
  });
});
