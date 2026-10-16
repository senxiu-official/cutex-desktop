// Component card states (components spec v2 §5, docs/desktop-modules.md §12.1): lib/componentCard.ts.
import { describe, expect, it } from "vitest";
import { readComponentsList } from "../src/shared/components";
import { RESTRICTED_FEATURE } from "../src/shared/users";
import { componentBlocks, componentCardState, componentText, componentUsable, isBanner, refusalKey, sourceInstallCommand, type ComponentCardInput } from "../src/renderer/src/lib/componentCard";

const component = (over: Record<string, unknown> = {}) => ({ name: "job-service", supported: true, state: "missing", selected: null, available: "0.1.2", origin: null, versions: [], error: null, ...over });
const list = (over: Record<string, unknown> = {}, c: Record<string, unknown> = {}) => readComponentsList({ managed: true, installFrom: "release", components: [component(c)], ...over });

function input(over: Partial<ComponentCardInput> = {}): ComponentCardInput {
  return {
    name: "job-service",
    connected: true,
    featuresKnown: true,
    features: new Set(["job-service", "components"]),
    platform: "linux",
    moduleCapabilities: ["job-service"],
    list: list(),
    listError: null,
    pending: false,
    ...over,
  };
}

describe("componentCardState", () => {
  it("ready / external render the page body; an unconnected host too (the page shows that)", () => {
    expect(componentCardState(input({ list: list({}, { state: "ready", selected: "0.1.1" }) }))).toEqual({ kind: "body" });
    expect(componentCardState(input({ list: list({ managed: false }, { state: "external" }) }))).toEqual({ kind: "body" });
    expect(componentCardState(input({ connected: false, list: undefined }))).toEqual({ kind: "body" });
  });

  it("waits for the capabilities and the first read", () => {
    expect(componentCardState(input({ featuresKnown: false }))).toEqual({ kind: "waiting" });
    expect(componentCardState(input({ list: undefined }))).toEqual({ kind: "waiting" });
    expect(componentCardState(input({ list: undefined, listError: "ECONNRESET" }))).toEqual({ kind: "readError", error: "ECONNRESET" });
  });

  it("a non-owner connection asks the host owner", () => {
    expect(componentCardState(input({ features: new Set([RESTRICTED_FEATURE]) }))).toEqual({ kind: "askOwner" });
  });

  it("no components capability: update cutex, or not on Windows for Linux-only components", () => {
    const old = new Set(["job-service"]);
    expect(componentCardState(input({ features: old, list: undefined }))).toEqual({ kind: "updateCutex", bypass: true });
    expect(componentCardState(input({ features: new Set(), list: undefined }))).toEqual({ kind: "updateCutex", bypass: false });
    expect(componentCardState(input({ features: old, platform: "windows", list: undefined }))).toEqual({ kind: "unsupportedPlatform", platform: "windows" });
    // Unknown names are not assumed Linux-only.
    expect(componentCardState(input({ name: "other", features: old, platform: "windows", list: undefined }))).toEqual({ kind: "updateCutex", bypass: true });
    // The capability without the route, or a cutex that does not know this component.
    expect(componentCardState(input({ list: null }))).toEqual({ kind: "updateCutex", bypass: true });
    expect(componentCardState(input({ name: "newer" }))).toEqual({ kind: "updateCutex", bypass: false });
  });

  it("cutex's `supported` decides the platform when it can say", () => {
    expect(componentCardState(input({ platform: "windows", list: list({}, { supported: false }) }))).toEqual({ kind: "unsupportedPlatform", platform: "windows" });
  });

  it("unmanaged / installFrom none: set up by hand; source-only: the CLI command", () => {
    expect(componentCardState(input({ list: list({ managed: false }) }))).toEqual({ kind: "unmanaged" });
    expect(componentCardState(input({ list: list({ installFrom: "none" }) }))).toEqual({ kind: "unmanaged" });
    expect(componentCardState(input({ list: list({ installFrom: "source-only" }) }))).toEqual({ kind: "sourceOnly", command: "cutex component install job-service --from-source <dir>" });
    expect(sourceInstallCommand("claude-runtime")).toBe("cutex component install claude-runtime --from-source <dir>");
  });

  it("missing → install; installing (state, operation or a request of ours) → progress", () => {
    expect(componentCardState(input())).toEqual({ kind: "missing", version: "0.1.2" });
    expect(componentCardState(input({ pending: true }))).toEqual({ kind: "installing", step: null });
    expect(componentCardState(input({ list: list({}, { state: "installing" }) }))).toEqual({ kind: "installing", step: null });
    expect(componentCardState(input({ list: list({ operation: { name: "job-service", state: "running", step: "verify" } }) }))).toEqual({ kind: "installing", step: "verify" });
    // A finished operation no longer counts.
    expect(componentCardState(input({ list: list({ operation: { name: "job-service", state: "failed" } }) }))).toEqual({ kind: "missing", version: "0.1.2" });
    expect(componentCardState(input({ list: list({ operation: { name: "job-service", state: "done" } }) }))).toEqual({ kind: "missing", version: "0.1.2" });
    expect(componentCardState(input({ list: list({ operation: { name: "claude-runtime", state: "running" } }) }))).toEqual({ kind: "missing", version: "0.1.2" });
  });

  it("needsUser → steps; restartPending and a degraded update that kept a version are banners", () => {
    expect(componentCardState(input({ list: list({}, { state: "needsUser", steps: ["log in"] }) }))).toEqual({ kind: "needsUser", steps: ["log in"] });
    const pending = componentCardState(input({ list: list({}, { state: "restartPending", selected: "0.1.2" }) }));
    expect(pending).toEqual({ kind: "restartPending", version: "0.1.2" });
    expect(isBanner(pending)).toBe(true);
    const broken = componentCardState(input({ list: list({}, { state: "degraded", error: "boom" }) }));
    expect(broken).toEqual({ kind: "degraded", error: "boom", working: false });
    expect(isBanner(broken)).toBe(false);
    expect(isBanner(componentCardState(input({ list: list({}, { state: "degraded", selected: "0.1.1", error: "boom" }) })))).toBe(true);
  });

  it("notInManifest and unknown states", () => {
    expect(componentCardState(input({ list: list({}, { state: "notInManifest" }) }))).toEqual({ kind: "notInManifest" });
    expect(componentCardState(input({ list: list({}, { state: "warming" }) }))).toEqual({ kind: "unknown", state: "warming" });
  });
});

describe("componentText", () => {
  const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  it("keys known components by name and falls back to a generic line", () => {
    expect(componentText("job-service", t as never)).toEqual({ title: "modules.component.job-service.name", what: "modules.component.job-service.what" });
    expect(componentText("toString", t as never)).toEqual({ title: "toString", what: 'modules.component.generic.what:{"component":"toString"}' });
  });
});

describe("componentBlocks / componentUsable / refusalKey", () => {
  it("blocks starting only where it cannot work", () => {
    const blocks = (over: Partial<ComponentCardInput>) => componentBlocks(componentCardState(input(over)));
    expect(blocks({})).toBe(true); // missing
    expect(blocks({ pending: true })).toBe(true);
    expect(blocks({ list: list({}, { state: "needsUser" }) })).toBe(true);
    expect(blocks({ list: list({ managed: false }) })).toBe(true);
    expect(blocks({ list: list({}, { supported: false }) })).toBe(true);
    expect(blocks({ list: list({}, { state: "degraded" }) })).toBe(true);
    expect(blocks({ list: list({}, { state: "degraded", selected: "0.1.1" }) })).toBe(false);
    expect(blocks({ list: list({}, { state: "ready" }) })).toBe(false);
    expect(blocks({ list: list({}, { state: "restartPending", selected: "0.1.2" }) })).toBe(false);
    // Unknown answers never block: cutex refuses itself.
    expect(blocks({ features: new Set(["job-service"]), list: undefined })).toBe(false);
    expect(blocks({ list: undefined, listError: "x" })).toBe(false);
    expect(blocks({ features: new Set([RESTRICTED_FEATURE]) })).toBe(false);
  });

  it("usable: older cutex, ready, external, a selected version still running; not while unread or missing", () => {
    const caps = new Set(["components"]);
    expect(componentUsable(new Set(), undefined, "job-service")).toBe(true);
    expect(componentUsable(caps, null, "job-service")).toBe(true);
    expect(componentUsable(caps, undefined, "job-service")).toBe(false);
    expect(componentUsable(caps, list(), "job-service")).toBe(false);
    expect(componentUsable(caps, list({}, { state: "installing" }), "job-service")).toBe(false);
    expect(componentUsable(caps, list({}, { state: "ready" }), "job-service")).toBe(true);
    expect(componentUsable(caps, list({}, { state: "external" }), "job-service")).toBe(true);
    expect(componentUsable(caps, list({}, { state: "restartPending", selected: "0.1.2" }), "job-service")).toBe(true);
    expect(componentUsable(caps, list({}, { state: "degraded", selected: "0.1.1" }), "job-service")).toBe(true);
    expect(componentUsable(caps, list({}, { state: "degraded" }), "job-service")).toBe(false);
  });

  it("every pinned refusal code has a friendly line", () => {
    for (const code of ["unmanaged_install", "component_unsupported_platform", "component_external", "upgrade_blocked", "component_pinned", "jobs_running"]) expect(refusalKey(code)).toBe(`modules.component.refusal.${code}`);
    expect(refusalKey("component_busy")).toBeNull();
  });
});
