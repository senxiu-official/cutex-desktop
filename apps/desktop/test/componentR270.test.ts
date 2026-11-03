// r270 component UI (cutex fix/r270-component-contract a40c7e81 / aa1d3463, docs/contracts/component-external-ui-v1.md): the
// additive readers (`storedConfig` exact, `resolved` display form, issue `diagnostics`), the path form state (inputs = stored
// overrides, 恢复默认 only for stored fields; r269 rows keep the old heuristic), the `component_source_only` explicit-version
// hint, and the fresh-host DSH / Kimi group (component-index-v1 + the component row; Profile link still behind the runtime).
// `external` bodies come unchanged from the contract HTTP smoke, with installation paths anonymized (test/fixtures/component-external-ui-v1.evidence.json).
import { describe, expect, it } from "vitest";
import evidence from "./fixtures/component-external-ui-v1.evidence.json";
import { COMPONENT_INDEX_FEATURE, COMPONENTS_FEATURE, readComponentExternal, readComponentsList, sourceOnlyOffer, type ComponentExternal } from "../src/shared/components";
import { refusalKey } from "../src/renderer/src/lib/componentCard";
import { configureFields, configureFormState } from "../src/renderer/src/lib/componentExternal";
import { acpRuntimeProfiles, acpRuntimeShown } from "../src/renderer/src/lib/acpRuntimes";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const read = (raw: unknown) => readComponentExternal(raw)!;

describe("r270 readers", () => {
  it("storedConfig is the exact lexical override (../ kept), resolved the effective path; legacy fields stay effective", () => {
    const e = read(evidence.ready);
    expect(e.storedConfig).toEqual({ externalRoot: "/opt/component-fixtures/r270/dsh/../dsh", node: "/opt/component-fixtures/r270/node-v24.21.0-linux-x64/bin/../bin/node", rg: null });
    expect(e.resolved).toEqual({ externalRoot: "/opt/component-fixtures/r270/dsh", node: "/opt/component-fixtures/r270/node-v24.21.0-linux-x64/bin/node", rg: null });
    expect(e.root).toBe(e.resolved!.externalRoot);
    expect(e.node).toBe(e.resolved!.node);
  });

  it("a stored Windows path is never rewritten (not even verbatim); resolved / issue paths get the display form", () => {
    const e = read({ ...evidence.ready, storedConfig: { externalRoot: "\\\\?\\D:\\ext\\dsh", node: " C:\\Program Files\\nodejs\\node.exe", rg: null }, resolved: { externalRoot: "\\\\?\\D:\\ext\\dsh", node: "C:\\Program Files\\nodejs\\node.exe", rg: "\\\\?\\UNC\\srv\\rg.exe" } });
    expect(e.storedConfig).toEqual({ externalRoot: "\\\\?\\D:\\ext\\dsh", node: " C:\\Program Files\\nodejs\\node.exe", rg: null });
    expect(e.resolved).toEqual({ externalRoot: "D:\\ext\\dsh", node: "C:\\Program Files\\nodejs\\node.exe", rg: "\\\\?\\UNC\\srv\\rg.exe" });
  });

  it("compact actual + expandable diagnostics (broken ws); r269 issues have none", () => {
    const issue = read(evidence.brokenWs).issues[0]!;
    expect(issue.code).toBe("external_root_invalid");
    expect([...issue.actual!].length).toBeLessThanOrEqual(240);
    expect(issue.actual).not.toContain("\n");
    expect(issue.diagnostics).toBe(evidence.brokenWs.issues[0]!.diagnostics);
    const r269 = read({ ...evidence.brokenWs, issues: [{ code: "node_missing", expected: null, actual: "line 1\nline 2", path: null, steps: [] }] }).issues[0]!;
    expect(r269.diagnostics).toBeUndefined();
    expect(r269.actual).toBe("line 1\nline 2");
    // Oversized / empty diagnostics are dropped (the compact actual stays).
    expect(read({ ...evidence.brokenWs, issues: [{ ...evidence.brokenWs.issues[0], diagnostics: "x".repeat(70_000) }] }).issues[0]!.diagnostics).toBeUndefined();
    expect(read({ ...evidence.brokenWs, issues: [{ ...evidence.brokenWs.issues[0], diagnostics: " " }] }).issues[0]!.diagnostics).toBeUndefined();
  });

  it("absent / malformed storedConfig or resolved is unknown (undefined), never three absent overrides", () => {
    const { storedConfig: _s, resolved: _r, ...r269 } = evidence.ready;
    const old = read(r269);
    expect(old.storedConfig).toBeUndefined();
    expect(old.resolved).toBeUndefined();
    expect("storedConfig" in old).toBe(false);
    for (const bad of [null, [], "x", { externalRoot: null, node: null }, { externalRoot: 1, node: null, rg: null }, { externalRoot: "", node: null, rg: null }])
      expect(read({ ...evidence.ready, storedConfig: bad }).storedConfig).toBeUndefined();
  });

  it("the list reader carries them per component (r269 rows unchanged)", () => {
    const list = readComponentsList({ managed: true, installFrom: "release", operation: null, components: [
      { name: "dsh-runtime", supported: true, state: "missing", selected: null, available: null, origin: null, versions: [], error: null, steps: [], external: evidence.ready },
      { name: "kimi-runtime", supported: true, state: "missing", selected: null, available: null, origin: null, versions: [], error: null, steps: [], external: { ...evidence.ready, version: "kimi-r3", storedConfig: undefined, resolved: undefined } },
    ] });
    expect(list.components[0]!.external!.storedConfig!.externalRoot).toBe("/opt/component-fixtures/r270/dsh/../dsh");
    expect(list.components[1]!.external!.storedConfig).toBeUndefined();
  });
});

describe("path form state", () => {
  const base = read(evidence.ready);
  const fields = configureFields("dsh-runtime", base);
  it("r270: inputs hold the stored overrides; 恢复默认 for stored fields only", () => {
    const f = configureFormState(base, fields);
    expect(f.exact).toBe(true);
    expect(f.initial).toEqual({ externalRoot: "/opt/component-fixtures/r270/dsh/../dsh", node: "/opt/component-fixtures/r270/node-v24.21.0-linux-x64/bin/../bin/node", rg: "" });
    expect(f.stored).toEqual(["externalRoot", "node"]);
    expect(f.resettable).toBe(true);
    expect(f.resolved).toEqual(base.resolved);
  });
  it("r270: nothing stored → no 恢复默认 even though cutex discovered paths; a stored rg alone does offer it", () => {
    const none: ComponentExternal = { ...base, storedConfig: { externalRoot: null, node: null, rg: null } };
    expect(configureFormState(none, fields)).toMatchObject({ exact: true, stored: [], resettable: false, initial: { externalRoot: "", node: "", rg: "" } });
    const rg: ComponentExternal = { ...base, storedConfig: { externalRoot: null, node: null, rg: "/opt/rg/bin/rg" } };
    expect(configureFields("dsh-runtime", rg)).toEqual(["externalRoot", "node", "rg"]);
    expect(configureFormState(rg, configureFields("dsh-runtime", rg))).toMatchObject({ stored: ["rg"], resettable: true, initial: { rg: "/opt/rg/bin/rg" } });
  });
  it("r269 (storedConfig unknown): the effective paths fill the inputs and the old heuristic decides 恢复默认", () => {
    const { storedConfig: _s, resolved: _r, ...rest } = evidence.ready;
    const old = read({ ...rest, rg: "/usr/bin/rg" });
    const f = configureFormState(old, configureFields("dsh-runtime", old));
    expect(f).toMatchObject({ exact: false, stored: ["externalRoot", "node", "rg"], resettable: true });
    expect(f.initial.externalRoot).toBe("/opt/component-fixtures/r270/dsh");
    expect(f.resolved).toBeUndefined();
    const rgOnly = read({ ...rest, root: null, node: null, rg: "/usr/bin/rg" });
    expect(configureFormState(rgOnly, configureFields("dsh-runtime", rgOnly)).resettable).toBe(false);
  });
});

describe("component_source_only", () => {
  it("names the explicit version cutex suggests (suggestedRequest first); otherwise none", () => {
    expect(sourceOnlyOffer("component_source_only", { offeredVersion: "dsh-r3", suggestedRequest: { version: "dsh-r3" } })).toBe("dsh-r3");
    expect(sourceOnlyOffer("component_source_only", { suggestedRequest: { version: "kimi-r3" } })).toBe("kimi-r3");
    expect(sourceOnlyOffer("component_source_only", { offeredVersion: "kimi-r3" })).toBe("kimi-r3");
    expect(sourceOnlyOffer("component_source_only", {})).toBeNull();
    expect(sourceOnlyOffer("component_source_only", undefined)).toBeNull();
    expect(sourceOnlyOffer("component_version_required", { offeredVersion: "dsh-r3" })).toBeNull();
  });
  it("has friendly copy (zh-CN + en); unknown codes still fall back to cutex's text", () => {
    expect(refusalKey("component_source_only")).toBe("modules.component.refusal.component_source_only");
    expect(refusalKey("component_brand_new")).toBeNull();
    for (const key of ["modules.component.refusal.component_source_only", "modules.component.refusal.component_source_only_offer", "modules.component.installVersion", "modules.component.external.diagnostics", "modules.component.external.resolvedUsed", "modules.component.external.resolvedFound"] as const) {
      expect(zhCN[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    expect(en["modules.component.refusal.component_source_only_offer"]).toContain("{version}");
  });
});

describe("fresh-host DSH / Kimi group", () => {
  const index = new Set([COMPONENTS_FEATURE, COMPONENT_INDEX_FEATURE]);
  it("shown with component-index-v1 + the component row, without the runtime capability", () => {
    expect(acpRuntimeShown("dsh", index, ["claude-runtime", "dsh-runtime"])).toBe(true);
    expect(acpRuntimeShown("kimi", index, ["kimi-runtime"])).toBe(true);
    // No index gate, no row, or the list not read yet: as before (hidden).
    expect(acpRuntimeShown("dsh", new Set([COMPONENTS_FEATURE]), ["dsh-runtime"])).toBe(false);
    expect(acpRuntimeShown("dsh", index, ["claude-runtime"])).toBe(false);
    expect(acpRuntimeShown("dsh", index, undefined)).toBe(false);
    expect(acpRuntimeShown("dsh", new Set(["dsh-runtime"]))).toBe(true);
  });
  it("the Profile link stays behind the runtime (dsh-runtime; Kimi: its runtime or kimi-runtime-profiles, as before)", () => {
    expect(acpRuntimeProfiles("dsh", index)).toBe(false);
    expect(acpRuntimeProfiles("dsh", new Set(["dsh-runtime"]))).toBe(true);
    expect(acpRuntimeProfiles("kimi", index)).toBe(false);
    expect(acpRuntimeProfiles("kimi", new Set(["kimi-runtime-profiles", COMPONENTS_FEATURE]))).toBe(true);
  });
});
