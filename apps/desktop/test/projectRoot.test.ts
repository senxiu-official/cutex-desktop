// 项目目录 edits (lib/projectRoot): the value sent, which confirm a change needs, and cutex's
// set_workspace_root refusals mapped to words.
import { describe, expect, it } from "vitest";
import { nextWorkspaceRoot, rootConfirmKind, workspaceRootErrorKey } from "../src/renderer/src/lib/projectRoot";
import { ProjectDirectoryError } from "../src/renderer/src/lib/projectCreate";
import { en, zhCN } from "../src/renderer/src/modules/projects/i18n";

describe("nextWorkspaceRoot", () => {
  it("trims, and empty means clear", () => {
    expect(nextWorkspaceRoot("  /srv/app ")).toBe("/srv/app");
    expect(nextWorkspaceRoot("   ")).toBeNull();
  });
});

describe("rootConfirmKind", () => {
  it("first set from empty needs no confirm", () => {
    expect(rootConfirmKind(null, "/srv/app")).toBe("none");
    expect(rootConfirmKind(undefined, "/srv/app")).toBe("none");
    expect(rootConfirmKind("", "/srv/app")).toBe("none");
  });
  it("replacing an existing root asks", () => {
    expect(rootConfirmKind("/srv/app", "/srv/other")).toBe("change");
  });
  it("clearing an existing root asks (its own confirm)", () => {
    expect(rootConfirmKind("/srv/app", null)).toBe("clear");
  });
  it("unchanged or still empty sends nothing", () => {
    expect(rootConfirmKind("/srv/app", "/srv/app")).toBe("same");
    expect(rootConfirmKind(null, null)).toBe("same");
  });
});

describe("workspaceRootErrorKey", () => {
  it("maps the three refusals from the message prefix", () => {
    expect(workspaceRootErrorKey(new Error("invalid_workspace_root: must be absolute"))).toBe("projects.rootError.invalid");
    // The real wire shape: class code twice, the reason token last (management/v2/server.rs).
    expect(workspaceRootErrorKey(Object.assign(new Error("invalid_request: invalid_request: workspace_root_not_found"), { code: "invalid_request" }))).toBe("projects.rootError.notFound");
    expect(workspaceRootErrorKey(new Error("Error invoking remote method: invalid_request: invalid_request: workspace_root_not_directory"))).toBe("projects.rootError.notDirectory");
    expect(workspaceRootErrorKey(new Error("workspace_root_not_found: /x"))).toBe("projects.rootError.notFound");
    expect(workspaceRootErrorKey(new Error("workspace_root_not_directory: /x/a.txt"))).toBe("projects.rootError.notDirectory");
  });
  it("tolerates the Electron IPC prefix and a code property", () => {
    expect(workspaceRootErrorKey(new Error("Error invoking remote method 'api': Error: workspace_root_not_found: /x"))).toBe("projects.rootError.notFound");
    expect(workspaceRootErrorKey({ code: "invalid_workspace_root", message: "" })).toBe("projects.rootError.invalid");
  });
  it("sees through the create flow's ProjectDirectoryError", () => {
    expect(workspaceRootErrorKey(new ProjectDirectoryError("p", new Error("workspace_root_not_directory: /x")))).toBe("projects.rootError.notDirectory");
  });
  it("leaves other errors alone", () => {
    expect(workspaceRootErrorKey(new Error("conflict: stale_project_revision"))).toBeNull();
    expect(workspaceRootErrorKey(null)).toBeNull();
    expect(workspaceRootErrorKey("boom")).toBeNull();
  });
  it("every mapped key has both translations", () => {
    for (const key of ["projects.rootError.invalid", "projects.rootError.notFound", "projects.rootError.notDirectory", "projects.root.changeConfirm", "projects.root.clearConfirm"] as const) {
      expect((zhCN as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
