import { describe, expect, it } from "vitest";
import {
  addWritableRoot,
  BUILTIN_THREAD_DEFAULTS,
  changedFields,
  isAbsolutePath,
  launchFromForm,
  readNewThreadDefaults,
  sanitizeLaunch,
} from "../src/shared/launch";

describe("sanitizeLaunch", () => {
  it("keeps valid fields and drops the rest", () => {
    expect(
      sanitizeLaunch({
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        networkAccess: true,
        writableRoots: ["D:\\data", "relative", "/srv/x", "D:\\data", 3],
        model: "gpt-5.5",
        reasoningEffort: "high",
        extra: "nope",
      }),
    ).toEqual({ sandbox: "workspace-write", approvalPolicy: "on-request", networkAccess: true, writableRoots: ["D:\\data", "/srv/x"], model: "gpt-5.5", reasoningEffort: "high" });
  });

  it("rejects values cutex would refuse", () => {
    expect(sanitizeLaunch({ sandbox: "full", approvalPolicy: "untrusted", model: " padded", reasoningEffort: "a b" })).toBeNull();
    expect(sanitizeLaunch(null)).toBeNull();
    expect(sanitizeLaunch([])).toBeNull();
    expect(sanitizeLaunch({ networkAccess: "yes" })).toBeNull();
  });
});

describe("launchFromForm", () => {
  const form = { ...BUILTIN_THREAD_DEFAULTS.agent, model: "", reasoningEffort: "" };
  it("omits launch while untouched", () => {
    expect(launchFromForm(form, false)).toBeUndefined();
  });
  it("sends the full permission set once touched, model / effort only when chosen", () => {
    expect(launchFromForm(form, true)).toEqual({ sandbox: "danger-full-access", approvalPolicy: "never", networkAccess: false, writableRoots: [] });
    expect(launchFromForm({ ...form, model: " glm-5 ", reasoningEffort: "high" }, true)).toMatchObject({ model: "glm-5", reasoningEffort: "high" });
  });
});

describe("new thread defaults helpers", () => {
  it("lists fields that differ from the built-in", () => {
    const builtin = BUILTIN_THREAD_DEFAULTS.quickChat;
    expect(changedFields(builtin, builtin)).toEqual([]);
    expect(changedFields({ ...builtin, networkAccess: true, writableRoots: ["/x"] }, builtin)).toEqual(["networkAccess", "writableRoots"]);
  });

  it("reads defaults only when the daemon reports both views", () => {
    expect(readNewThreadDefaults({})).toBeNull();
    expect(readNewThreadDefaults({ newThreadDefaults: BUILTIN_THREAD_DEFAULTS })).toBeNull();
    expect(readNewThreadDefaults({ newThreadDefaults: BUILTIN_THREAD_DEFAULTS, newThreadDefaultsBuiltin: BUILTIN_THREAD_DEFAULTS })?.current.quickChat.approvalPolicy).toBe("on-request");
  });

  it("adds only new absolute writable roots", () => {
    const roots = ["D:\\a"];
    expect(addWritableRoot(roots, "D:\\a")).toBe(roots);
    expect(addWritableRoot(roots, "rel")).toBe(roots);
    expect(addWritableRoot(roots, "\\\\server\\share")).toEqual(["D:\\a", "\\\\server\\share"]);
    expect(isAbsolutePath("/home/x")).toBe(true);
    expect(isAbsolutePath("C:")).toBe(false);
  });
});

describe("no effort is sent unless the owner picked one (owner 10-22, design 028 (b))", () => {
  it("an untouched form or an unpicked effort leaves the effort to cutex's default and fallback", async () => {
    const { launchFromForm, BUILTIN_THREAD_DEFAULTS } = await import("../src/shared/launch");
    const form = { ...BUILTIN_THREAD_DEFAULTS.agent, writableRoots: [...BUILTIN_THREAD_DEFAULTS.agent.writableRoots], model: "", reasoningEffort: "" };
    expect(launchFromForm(form, false)).toBeUndefined();
    // Touched (e.g. a model picked), effort never picked: no reasoningEffort, even though the page shows one.
    const touched = launchFromForm({ ...form, model: "glm-5.3" }, true)!;
    expect(touched.model).toBe("glm-5.3");
    expect(touched).not.toHaveProperty("reasoningEffort");
    expect(launchFromForm({ ...form, reasoningEffort: "high" }, true)!.reasoningEffort).toBe("high");
  });
});
