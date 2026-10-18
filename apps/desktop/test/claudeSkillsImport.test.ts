import { describe, expect, it } from "vitest";
import type { ClaudeSkillImportItem } from "../src/shared/ipc";
import { formatBytes, initialSelection, namesToImport, reasonKey, resultCounts, selectable } from "../src/renderer/src/lib/claudeSkillsImport";

const skill = (name: string, patch: Partial<ClaudeSkillImportItem> = {}): ClaudeSkillImportItem => ({ name, title: name, description: null, bytes: 100, files: 1, exists: false, importable: true, skippedLinks: 0, ...patch });
const list = [skill("a"), skill("b", { exists: true }), skill("c", { importable: false, reason: "symlinkOutsideSource" })];

describe("Claude skills import (cutex claude-skills-import)", () => {
  it("pre-selects importable skills that do not exist yet", () => {
    expect([...initialSelection(list)]).toEqual(["a"]);
  });

  it("an existing skill is selectable only with overwrite; a refused one never", () => {
    expect(selectable(list[1]!, false)).toBe(false);
    expect(selectable(list[1]!, true)).toBe(true);
    expect(selectable(list[2]!, true)).toBe(false);
  });

  it("sends only checked skills that are still selectable", () => {
    const picked = new Set(["a", "b", "c"]);
    expect(namesToImport(list, picked, false)).toEqual(["a"]);
    expect(namesToImport(list, picked, true)).toEqual(["a", "b"]);
  });

  it("maps reasons to messages, unknown ones to the generic text", () => {
    expect(reasonKey("tooLarge")).toBe("claudeSkillsImport.reason.tooLarge");
    expect(reasonKey("exists")).toBe("claudeSkillsImport.reason.exists");
    expect(reasonKey("somethingNew")).toBe("claudeSkillsImport.reason.other");
    expect(reasonKey(undefined)).toBe("claudeSkillsImport.reason.other");
  });

  it("formats sizes and counts results", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(18_400)).toBe("18 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(resultCounts({ imported: ["a"], skipped: [{ name: "b", reason: "exists" }], failed: [], target: "/t" })).toEqual({ imported: 1, skipped: 1, failed: 0 });
  });
});
