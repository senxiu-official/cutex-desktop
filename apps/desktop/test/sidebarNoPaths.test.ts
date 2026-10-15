// The sidebar shows no project directory line (owner 2026-10-14): the quiet pass revealed it under the
// open agent's project, which only shifted the list on selection. The path stays in the header /
// collapsed-row / flyout tooltips and on the project page. Guard: the sidebar surfaces never render
// a shortened path (lib/workspace shortenHome) as a line again.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (file: string) => readFileSync(new URL(`../src/renderer/src/components/${file}`, import.meta.url), "utf8");

describe("sidebar project paths", () => {
  it("Sidebar and the project flyout render no directory line", () => {
    for (const file of ["Sidebar.tsx", "ProjectFlyout.tsx"]) expect(src(file)).not.toMatch(/shortenHome/);
  });

  it("the directory stays in tooltips", () => {
    expect(src("Sidebar.tsx")).toMatch(/title=\{\[t\(open \? "fold\.collapse" : "fold\.unfold"\), root\]/);
    expect(src("ProjectFlyout.tsx")).toMatch(/title=\{root \?\? undefined\}/);
  });
});
