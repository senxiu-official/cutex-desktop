import { describe, expect, it } from "vitest";
import { launchFromForm, sanitizeLaunch, type LaunchForm } from "../src/shared/launch";
import { LAUNCH_FOR_MODE, effectivePermissionLines, effectivePermissions, isAutoReviewer, permissionModeOf, permissionModeOfLaunch, permissionPatch, reviewerForCreate } from "../src/renderer/src/lib/permissionModes";

const ws = (reviewer?: string) => ({ approvalPolicy: "on-request", ...(reviewer ? { approvalsReviewer: reviewer } : {}), sandboxPolicy: { type: "workspaceWrite" } }) as never;

describe("自动 = workspace-write + on-request + the native auto reviewer", () => {
  it("the auto patch selects the auto reviewer with the exact native wire name", () => {
    const patch = permissionPatch("auto");
    expect(patch).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite", networkAccess: true } });
  });

  it("read only routes escalations to the owner; full access leaves the reviewer alone", () => {
    expect(permissionPatch("readOnly")).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } });
    expect(permissionPatch("full")).not.toHaveProperty("approvalsReviewer");
  });

  it("a workspace thread shows 自动 only with the auto reviewer; with the owner as reviewer it is custom", () => {
    expect(permissionModeOf(ws("auto_review"))).toBe("auto");
    expect(permissionModeOf(ws("guardian_subagent"))).toBe("auto");
    expect(permissionModeOf(ws("user"))).toBe("custom");
    // No reviewer reported = the native default (user).
    expect(permissionModeOf(ws())).toBe("custom");
  });

  it("read only stays read only with the owner as reviewer, custom with the auto reviewer", () => {
    expect(permissionModeOf({ approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } } as never)).toBe("readOnly");
    expect(permissionModeOf({ approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly" } } as never)).toBe("readOnly");
    expect(permissionModeOf({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "readOnly" } } as never)).toBe("custom");
  });

  it("full access ignores the reviewer", () => {
    expect(permissionModeOf({ approvalPolicy: "never", approvalsReviewer: "auto_review", sandboxPolicy: { type: "dangerFullAccess" } } as never)).toBe("full");
    expect(permissionModeOf({ approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } } as never)).toBe("full");
  });

  it("clicking 自动 on a custom (owner-reviewed) workspace thread fixes it and keeps its directories", () => {
    const current = { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/repo/sibling"], networkAccess: false } } as never;
    expect(permissionModeOf(current)).toBe("custom");
    const patch = permissionPatch("auto", current);
    expect(permissionModeOf({ ...(current as object), ...patch } as never)).toBe("auto");
    expect((patch as { sandboxPolicy: { writableRoots: string[] } }).sandboxPolicy.writableRoots).toEqual(["/repo/sibling"]);
  });

  it("isAutoReviewer accepts the legacy alias only", () => {
    expect(isAutoReviewer("auto_review")).toBe(true);
    expect(isAutoReviewer("guardian_subagent")).toBe(true);
    expect(isAutoReviewer("user")).toBe(false);
    expect(isAutoReviewer(undefined)).toBe(false);
  });
});

describe("launch (new agents / quick chats)", () => {
  it("mode launch values carry the reviewer and map back to their mode", () => {
    expect(LAUNCH_FOR_MODE.auto).toEqual({ sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review", networkAccess: true });
    expect(LAUNCH_FOR_MODE.readOnly.approvalsReviewer).toBe("user");
    for (const mode of ["full", "auto", "readOnly"] as const) {
      const v = LAUNCH_FOR_MODE[mode];
      expect(permissionModeOfLaunch(v.sandbox, v.approvalPolicy, v.approvalsReviewer)).toBe(mode);
    }
  });

  it("a reported reviewer decides; an unreported one (older cutex) follows the mode", () => {
    expect(permissionModeOfLaunch("workspace-write", "on-request", "auto_review")).toBe("auto");
    expect(permissionModeOfLaunch("workspace-write", "on-request", "user")).toBe("custom");
    expect(permissionModeOfLaunch("workspace-write", "on-request")).toBe("auto");
    expect(permissionModeOfLaunch("workspace-write", "on-request", null)).toBe("auto");
    expect(permissionModeOfLaunch("read-only", "on-request")).toBe("readOnly");
    expect(permissionModeOfLaunch("read-only", "on-request", "auto_review")).toBe("custom");
  });

  it("the create form sends the reviewer; main keeps only known values", () => {
    const form: LaunchForm = { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review", networkAccess: true, writableRoots: [], model: "", reasoningEffort: "" };
    expect(launchFromForm(form, true)).toMatchObject({ approvalsReviewer: "auto_review" });
    expect(launchFromForm({ ...form, approvalsReviewer: undefined }, true)).not.toHaveProperty("approvalsReviewer");
    expect(launchFromForm(form, false)).toBeUndefined();
    expect(sanitizeLaunch({ approvalsReviewer: "auto_review" })).toEqual({ approvalsReviewer: "auto_review" });
    expect(sanitizeLaunch({ approvalsReviewer: "user" })).toEqual({ approvalsReviewer: "user" });
    expect(sanitizeLaunch({ approvalsReviewer: "owner" })).toBeNull();
    expect(sanitizeLaunch({ approvalsReviewer: "guardian_subagent" })).toBeNull();
  });

  it("a host with launch-approvals-reviewer takes the reviewer in launch", () => {
    const launch = { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" } as const;
    expect(reviewerForCreate({ ...launch }, "auto", true)).toEqual({ launch, fallback: null });
    expect(reviewerForCreate(undefined, "auto", true)).toEqual({ launch: undefined, fallback: null });
  });

  it("an older cutex never sees the field; 自动 gets the reviewer after creation", () => {
    const r = reviewerForCreate({ sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, "auto", false);
    expect(r.launch).toEqual({ sandbox: "workspace-write", approvalPolicy: "on-request" });
    expect(r.fallback).toBe("auto_review");
    // Untouched form (cutex applies its defaults) in 自动: still fixed afterwards.
    expect(reviewerForCreate(undefined, "auto", false)).toEqual({ launch: undefined, fallback: "auto_review" });
    // Other modes keep the old default reviewer (user): nothing to do.
    expect(reviewerForCreate({ sandbox: "read-only", approvalPolicy: "on-request", approvalsReviewer: "user" }, "readOnly", false)).toEqual({ launch: { sandbox: "read-only", approvalPolicy: "on-request" }, fallback: null });
    expect(reviewerForCreate({}, "full", false)).toEqual({ launch: {}, fallback: null });
  });
});

describe("effective permissions (composer chip / menu detail)", () => {
  it("reports reviewer, network and extra directories the mode name hides", () => {
    const auto = { approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite", networkAccess: false, writableRoots: ["/a", "/b"] }, activePermissionProfile: null } as never;
    expect(effectivePermissions(auto)).toEqual({ approvals: "autoReview", network: false, writableRoots: ["/a", "/b"], profile: null });
    expect(effectivePermissionLines(effectivePermissions(auto)!)).toEqual([
      { key: "composer.effective.approvals.autoReview" },
      { key: "composer.effective.network.off" },
      { key: "composer.effective.roots", params: { n: 2 } },
    ]);
    // Same mode name, owner as reviewer, network on.
    const owner = { approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", networkAccess: true } } as never;
    expect(effectivePermissions(owner)).toMatchObject({ approvals: "owner", network: true, writableRoots: [] });
  });

  it("full access never asks and is online; named profiles are named; nothing reported → null", () => {
    expect(effectivePermissions({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } } as never)).toMatchObject({ approvals: "never", network: true });
    expect(effectivePermissions({ approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite" }, activePermissionProfile: { id: "team" } } as never)).toMatchObject({ network: null, profile: "team" });
    // Built-in presets and cutex's own extras profile are not shown as a named profile.
    for (const id of [":workspace", "cutex-workspace"]) expect(effectivePermissions({ activePermissionProfile: { id } } as never)?.profile).toBeNull();
    expect(effectivePermissions(null)).toBeNull();
    expect(effectivePermissionLines(effectivePermissions({ sandboxPolicy: { type: "readOnly" } } as never)!)).toEqual([{ key: "composer.effective.rootsNone" }]);
  });
});

describe("one network rule for 自动 (new agent, quick chat, running switch)", () => {
  it("picking 自动 turns network on everywhere and keeps extra directories", () => {
    expect(LAUNCH_FOR_MODE.auto.networkAccess).toBe(true);
    expect(permissionPatch("auto")).toMatchObject({ sandboxPolicy: { networkAccess: true } });
    // Old home default (full access, network off) → 自动 on the new-agent page / a pending quick chat.
    const oldHome = { sandbox: "danger-full-access", approvalPolicy: "never", networkAccess: false, writableRoots: ["/extra"] };
    expect({ ...oldHome, ...LAUNCH_FOR_MODE.auto }).toEqual({ sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review", networkAccess: true, writableRoots: ["/extra"] });
    // Full access / read only do not touch the network field.
    expect("networkAccess" in LAUNCH_FOR_MODE.full).toBe(false);
    expect("networkAccess" in LAUNCH_FOR_MODE.readOnly).toBe(false);
  });
});
