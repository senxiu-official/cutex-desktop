import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SEPARATION, groupColor, migrateProjectSeparation, NEUTRAL_GROUP, PROJECT_SEPARATION_REV, PROJECT_SEPARATIONS, projectBlockLook } from "../src/renderer/src/lib/projectSeparation";

describe("项目颜色 pref (was 项目分隔)", () => {
  it("defaults to none (quiet pass) and keeps only known values", () => {
    expect(DEFAULT_PROJECT_SEPARATION).toBe("none");
    // Settings order: quietest to strongest.
    expect(PROJECT_SEPARATIONS).toEqual(["none", "iconLine", "rail", "tint", "header"]);
    expect(migrateProjectSeparation(undefined)).toBe("none");
    expect(migrateProjectSeparation("bogus")).toBe("none");
    for (const v of PROJECT_SEPARATIONS) expect(migrateProjectSeparation(v, PROJECT_SEPARATION_REV)).toBe(v);
  });

  it("a stored header band from the old default moves to none once; later choices are kept", () => {
    expect(migrateProjectSeparation("header")).toBe("none");
    expect(migrateProjectSeparation("header", 0)).toBe("none");
    expect(migrateProjectSeparation("header", PROJECT_SEPARATION_REV)).toBe("header");
    expect(migrateProjectSeparation("tint")).toBe("tint");
    expect(migrateProjectSeparation("iconLine", 0)).toBe("iconLine");
  });

  it("rev 2: 项目标题着色 is gone; an untinted header band (the same look) becomes 图标下竖线", () => {
    expect(PROJECT_SEPARATION_REV).toBe(2);
    expect(migrateProjectSeparation("header", 1, false)).toBe("iconLine");
    expect(migrateProjectSeparation("header", 1, true)).toBe("header");
    expect(migrateProjectSeparation("header", 1)).toBe("header");
    // A band picked after the change stays a band, whatever the old switch said.
    expect(migrateProjectSeparation("header", 2, false)).toBe("header");
    // Before rev 1 a stored band was the old default: none, as before.
    expect(migrateProjectSeparation("header", 0, false)).toBe("none");
    expect(migrateProjectSeparation("tint", 1, false)).toBe("tint");
  });

  it("标题行: full-width band header, untinted rows with the rail, band for one-row projects", () => {
    const look = projectBlockLook("header", "blue");
    expect(look.className).toBe("");
    expect(look.headerClassName).toBe("project-band");
    expect(look.metaClassName).toBe("project-band-body project-band-meta");
    expect(look.bodyClassName).toBe("project-band-body project-band-rows");
    expect(look.rowClassName).toBe("project-band project-band-row");
    expect(look.style).toEqual({ "--project-color": "#4c8dff" });
  });

  it("图标引线: untinted full-width header, the line under the icon beside the indented rows", () => {
    const look = projectBlockLook("iconLine", "blue");
    expect(look.className).toBe("");
    expect(look.headerClassName).toBe("project-lead");
    expect(look.metaClassName).toBe("project-lead-body project-lead-meta");
    expect(look.bodyClassName).toBe("project-lead-body project-lead-rows");
    expect(look.rowClassName).toBe("project-lead project-lead-row");
    expect(look.style).toEqual({ "--project-color": "#4c8dff" });
    // No header tint to drop: 项目标题着色 does not change it.
    expect(projectBlockLook("iconLine", NEUTRAL_GROUP).style).toEqual({ "--project-color": "var(--fg-muted)" });
  });

  it("背景色 / 左侧色条 map to the block classes with the project colour", () => {
    const tint = projectBlockLook("tint", "blue");
    expect(tint.className).toBe("project-block project-block-tint");
    expect(tint.headerClassName).toBe("project-block-header");
    expect(tint.rowClassName).toContain("project-block-tint");
    expect(tint.bodyClassName).toContain("pl-4");

    const rail = projectBlockLook("rail", "#123456");
    expect(rail.className).toBe("project-block project-block-rail");
    expect(rail.headerClassName).toBe("");
    expect(rail.style).toEqual({ "--project-color": "#123456" });
  });

  it("无 or no colour: nothing but the agent indent", () => {
    const none = { className: "", headerClassName: "", metaClassName: "", bodyClassName: "pl-4", rowClassName: "", gapClassName: "mb-1.5", foldedGapClassName: "", style: undefined };
    expect(projectBlockLook("none", "blue")).toEqual(none);
    expect(projectBlockLook("none", NEUTRAL_GROUP)).toEqual(none);
    for (const mode of PROJECT_SEPARATIONS) expect(projectBlockLook(mode, null)).toEqual(none);
  });

  it("a folded group keeps a one-row project's pitch (no extra section gap)", () => {
    // Starred projects never auto-collapse: folded, they must line up with the collapsed rows.
    for (const mode of PROJECT_SEPARATIONS) {
      const look = projectBlockLook(mode, "blue");
      const rowGap = look.rowClassName.split(" ").filter((c) => c.startsWith("mb-")).join(" ");
      expect(look.foldedGapClassName).toBe(rowGap);
    }
  });

  it("独立智能体 / 工作 get the same look in the neutral theme colour", () => {
    expect(groupColor(NEUTRAL_GROUP)).toBe("var(--fg-muted)");
    expect(groupColor("red")).toBe("#fa5252");
    const look = projectBlockLook("header", NEUTRAL_GROUP);
    expect(look.headerClassName).toBe("project-band");
    expect(look.style).toEqual({ "--project-color": "var(--fg-muted)" });
  });

});
