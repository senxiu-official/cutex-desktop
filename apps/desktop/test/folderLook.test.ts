// Owner folders get an icon and a colour picked from their id (lib/folderLook, owner 2026-11-05).
import { describe, expect, it } from "vitest";
import { FOLDER_COLORS, FOLDER_ICONS, folderLook, OLDER_FOLDER_LOOK } from "../src/renderer/src/lib/folderLook";

describe("folderLook", () => {
  it("is stable per folder and drawn from the palette", () => {
    const a = folderLook("sec-1");
    expect(folderLook("sec-1")).toEqual(a);
    expect(FOLDER_COLORS).toContain(a.color);
    expect(FOLDER_ICONS).toContain(a.icon);
  });
  it("spreads folders over the colours", () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => folderLook(`folder-${i}`).color));
    expect(colors.size).toBeGreaterThanOrEqual(5);
  });
  it("the automatic 更早的项目 folder has an icon no owner folder gets, so a folder of the same name never looks the same", () => {
    expect(FOLDER_ICONS).not.toContain(OLDER_FOLDER_LOOK.icon);
    for (let i = 0; i < 200; i++) expect(folderLook(`s-${i}`).icon).not.toBe(OLDER_FOLDER_LOOK.icon);
    expect(FOLDER_COLORS).toContain(OLDER_FOLDER_LOOK.color);
  });
});
