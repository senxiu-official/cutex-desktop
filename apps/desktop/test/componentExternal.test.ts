// r269 components (contract frozen by Wren, cutex cefe571a docs/contracts/component-index-v1.md; wire names in
// shared/componentIndex.ts): readers, external-install guides per platform, readiness (checkedAt null = unverified),
// the signed-index summary and the capability gates (a host without them shows nothing new). The signed index fixture
// (test/fixtures/component-index-v1.example.json, copied unchanged from that commit) feeds the daemon-style `index` rows.
import { describe, expect, it } from "vitest";
import indexFixture from "./fixtures/component-index-v1.example.json";
import {
  COMPONENT_INDEX_FEATURE,
  COMPONENTS_FEATURE,
  COMPONENTS_INDEX_UPDATED_EVENT,
  EXTERNAL_ISSUE_CODES,
  EXTERNAL_RUNTIME_ROOT_FEATURE,
  componentClearCli,
  componentConfigureBody,
  componentConfigureCli,
  componentEventOf,
  componentIndexEventOf,
  externalReadiness,
  externalRuntimeOf,
  readComponentExternal,
  readComponentsList,
  type ComponentExternal,
  type ComponentIndexRelease,
  type ComponentStatus,
} from "../src/shared/components";
import { componentCardState } from "../src/renderer/src/lib/componentCard";
import { hostPath } from "../src/shared/componentIndex";
import { componentIndexSupported, componentIndexView, configureFields, configurePathOk, externalGuidanceSupported, externalGuides, externalNeeds, externalStatus, missingCapability, specVersion } from "../src/renderer/src/lib/componentExternal";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

type FixtureRelease = (typeof indexFixture.components)[number]["releases"][number];
/** A GET `index` row as cutex would derive it from a release of the signed document (compatibility decided by cutex). */
const getRow = (r: FixtureRelease, more: Partial<ComponentIndexRelease> = {}) => ({
  version: r.version, yanked: r.yanked, yankReason: r.yankReason, compatible: true, incompatibleReason: null,
  requirements: { upstream: Object.entries(r.externalRuntime.externalRoot.packages)[0]!.join("@"), node: r.externalRuntime.node.range },
  externalRuntime: r.externalRuntime, externalRuntimeSha256: r.externalRuntimeSha256, ...more,
});
const fixtureRelease = (name: string) => indexFixture.components.find((c) => c.name === name)!.releases[0]!;
const getIndex = (name: string, more: Record<string, unknown> = {}) => ({
  source: "componentIndex", channel: indexFixture.channel, sequence: indexFixture.sequence, publishedAt: indexFixture.publishedAt, fetchedAt: "2026-10-29T07:00:00Z",
  stale: false, staleReason: null, recommended: indexFixture.components.find((c) => c.name === name)!.recommended, selectedYanked: false,
  releases: [getRow(fixtureRelease(name))], ...more,
});

const EXTERNAL = {
  version: "dsh-r3",
  root: "/home/alex/.local/share/cutex-external/dsh/0.2.1-rc.3",
  node: null,
  rg: null,
  packages: ["@deepseek-ai/dsh@0.2.1-rc.4", "@deepseek-ai/dsh-session-format-catalog@0.2.1-rc.4", "ws@8.22.0"],
  nodeRange: ">=24.9.0 <25",
  nodeRecommended: "24.22.0",
  checkedAt: "2026-10-29T08:00:00Z",
  issues: [{ code: "node_missing", expected: ">=24.9.0 <25", actual: null, path: null, steps: [] }],
};
const RAW = {
  managed: true,
  installFrom: "release",
  components: [
    { name: "dsh-runtime", supported: true, state: "needsUser", selected: "dsh-r3", available: "dsh-r3", origin: "signed", versions: [], error: null, steps: ["see below"], external: EXTERNAL, index: getIndex("dsh-runtime") },
    {
      name: "kimi-runtime", supported: true, state: "ready", selected: "kimi-r2", available: "kimi-r2", origin: "signed", versions: [{ version: "kimi-r2", pinnedBy: 3, sizeBytes: 1 }, { version: "kimi-r1", pinnedBy: 2, sizeBytes: 1 }],
      error: null, steps: [],
      index: getIndex("kimi-runtime", { releases: [{ ...getRow(fixtureRelease("kimi-runtime")), requirements: { upstream: "@moonshot-ai/kimi-code@2.3.3", node: 24 } }, { version: "kimi-r2", yanked: false }] }),
    },
  ],
  operation: { id: "cop-1", name: "dsh-runtime", action: "install", state: "done", step: null, error: null, result: { outcome: "needsUser", version: "dsh-r3", selected: false } },
  indexOperation: { id: "cop-2", name: null, action: "indexCheck", state: "running", step: "download", error: null },
};

describe("r269 readers (frozen contract)", () => {
  it("keeps external / index next to the client reader's fields; drops malformed parts", () => {
    const list = readComponentsList(structuredClone(RAW));
    const dsh = list.components[0]!;
    expect(dsh.external?.version).toBe("dsh-r3");
    expect(dsh.external?.issues).toEqual([{ code: "node_missing", expected: ">=24.9.0 <25", actual: null, path: null, steps: [] }]);
    expect(dsh.external?.packages[0]).toBe("@deepseek-ai/dsh@0.2.1-rc.4");
    const kimi = list.components[1]!;
    expect(kimi.index?.recommended).toBe("kimi-r3");
    expect(kimi.index?.selectedYanked).toBe(false);
    // A non-string requirement is dropped; an absent `compatible` is NOT compatible (cutex decides).
    expect(kimi.index?.releases[0]!.requirements).toEqual({ upstream: "@moonshot-ai/kimi-code@2.3.3" });
    expect(kimi.index?.releases[1]).toEqual({ version: "kimi-r2", yanked: false, yankReason: null, compatible: false, incompatibleReason: null, requirements: {}, externalRuntime: null, externalRuntimeSha256: null });
    const loose = readComponentsList({ components: [{ name: "dsh-runtime", state: "needsUser", external: { issues: [] }, index: { releases: [] } }] });
    // `external` without `version` is not an adapter report; `index` without `source` is not one either.
    expect(loose.components[0]).not.toHaveProperty("external");
    expect(loose.components[0]).not.toHaveProperty("index");
    expect(loose).not.toHaveProperty("indexOperation");
  });

  it("the signed fixture's externalRuntime / SHA pass through unchanged; specs and Node come from it", () => {
    const dsh = readComponentsList(structuredClone(RAW)).components[0]!;
    const row = dsh.index!.releases[0]!;
    expect(row.externalRuntime).toEqual(fixtureRelease("dsh-runtime").externalRuntime);
    expect(row.externalRuntimeSha256).toBe(fixtureRelease("dsh-runtime").externalRuntimeSha256);
    expect(dsh.index).toMatchObject({ channel: "public-stable", sequence: 1, publishedAt: "2026-10-29T00:00:00Z", source: "componentIndex" });
    expect(externalRuntimeOf(fixtureRelease("kimi-runtime").externalRuntime)).toEqual({ packages: ["@moonshot-ai/kimi-code@2.3.3", "ws@8.22.0"], nodeRecommended: "24.21.0", nodeRange: ">=24.9.0 <25" });
    expect(externalRuntimeOf({ schema: "other/v9" })).toBeNull();
    // A malformed SHA is dropped; sequence must be a positive safe integer.
    const bad = readComponentsList({ components: [{ name: "x", index: { ...getIndex("dsh-runtime"), sequence: 0, releases: [{ ...getRow(fixtureRelease("dsh-runtime")), externalRuntimeSha256: "ABC" }] } }] });
    expect(bad.components[0]!.index!.sequence).toBeNull();
    expect(bad.components[0]!.index!.releases[0]!.externalRuntimeSha256).toBeNull();
  });

  it("operation result, top-level indexOperation and the indexUpdated event", () => {
    const list = readComponentsList(structuredClone(RAW));
    expect(list.operation?.result).toEqual({ outcome: "needsUser", version: "dsh-r3", selected: false });
    expect(list.indexOperation).toMatchObject({ name: null, action: "indexCheck", state: "running" });
    const event = componentEventOf({ cutex: { method: "cutex/components/updated", params: { name: "dsh-runtime", reason: "operation", state: "ready", operation: RAW.operation } } });
    expect(event?.operation?.result?.selected).toBe(false);
    expect(componentIndexEventOf({ cutex: { method: COMPONENTS_INDEX_UPDATED_EVENT, params: { channel: "public-stable", sequence: 2, stale: true, staleReason: "offline", operation: RAW.indexOperation } } })).toEqual({ channel: "public-stable", sequence: 2, stale: true, staleReason: "offline" });
    expect(componentIndexEventOf({ cutex: { method: "cutex/components/updated", params: {} } })).toBeNull();
    // The index event is not a component event (no null component name for old readers).
    expect(componentEventOf({ cutex: { method: COMPONENTS_INDEX_UPDATED_EVENT, params: {} } })).toBeNull();
  });

  it("configure body: absolute paths only, empty → null (cutex default), absent → unchanged", () => {
    expect(componentConfigureBody({ externalRoot: " /opt/dsh ", node: "", rg: undefined })).toEqual({ externalRoot: "/opt/dsh", node: null });
    expect(componentConfigureBody({ node: "C:\\Program Files\\nodejs\\node.exe" })).toEqual({ node: "C:\\Program Files\\nodejs\\node.exe" });
    expect(() => componentConfigureBody({ externalRoot: "relative/dir" })).toThrow(/absolute/);
    expect(configurePathOk("~/x")).toBe(false);
    expect(configurePathOk("")).toBe(true);
  });
  it("Windows verbatim paths from cutex (\\\\?\\C:\\…) read as typed; UNC verbatim and POSIX paths stay", () => {
    const e = readComponentExternal({ ...EXTERNAL, root: "\\\\?\\C:\\Users\\a\\kimi", node: "\\\\?\\D:\\nodejs\\node.exe", rg: "\\\\?\\UNC\\srv\\rg.exe", issues: [{ code: "node_missing", path: "\\\\?\\D:\\nodejs\\node.exe", steps: [] }] })!;
    expect([e.root, e.node, e.rg, e.issues[0]!.path]).toEqual(["C:\\Users\\a\\kimi", "D:\\nodejs\\node.exe", "\\\\?\\UNC\\srv\\rg.exe", "D:\\nodejs\\node.exe"]);
    expect(hostPath("/home/a/.local/kimi")).toBe("/home/a/.local/kimi");
  });
});

describe("readiness: checkedAt null is unverified, never ready", () => {
  it("externalReadiness", () => {
    expect(externalReadiness({ ...EXTERNAL, checkedAt: null, issues: [] })).toBe("unverified");
    expect(externalReadiness({ ...EXTERNAL, checkedAt: null })).toBe("unverified");
    expect(externalReadiness({ ...EXTERNAL, issues: [] })).toBe("ready");
    expect(externalReadiness(EXTERNAL)).toBe("needsUser");
  });
  it("a candidate (r3 staged, r2 selected) vs the selected adapter", () => {
    const features = new Set([EXTERNAL_RUNTIME_ROOT_FEATURE]);
    const c = { ...readComponentsList(structuredClone(RAW)).components[0]!, selected: "dsh-r2", state: "ready" };
    expect(externalStatus(c, features)).toMatchObject({ candidate: true, readiness: "needsUser", release: { version: "dsh-r3" } });
    expect(externalStatus({ ...c, selected: "dsh-r3" }, features)?.candidate).toBe(false);
    expect(externalStatus(c, new Set())).toBeUndefined();
    const { external: _e, ...plain } = c;
    expect(externalStatus(plain, features)).toBeUndefined();
  });
});

describe("gates: a host without the capabilities shows nothing new", () => {
  const base = { name: "dsh-runtime", connected: true, featuresKnown: true, platform: "linux" as const, moduleCapabilities: [], listError: null, pending: false };
  const list = readComponentsList(structuredClone({ ...RAW, operation: null }));
  it("needsUser without external-runtime-root-v1: the old steps card", () => {
    const off = componentCardState({ ...base, features: new Set([COMPONENTS_FEATURE]), list });
    expect(off).toEqual({ kind: "needsUser", steps: ["see below"] });
    const on = componentCardState({ ...base, features: new Set([COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE]), list });
    expect(on.kind === "needsUser" && on.external?.issues[0]?.code).toBe("node_missing");
  });
  it("needsUser + unverified (no issues, checkedAt null) still gets the guide; a verified-ready external does not", () => {
    const features = new Set([COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE]);
    const withExt = (external: ComponentExternal) => ({ ...list, components: [{ ...list.components[0]!, external }] });
    const unverified = componentCardState({ ...base, features, list: withExt({ ...EXTERNAL, checkedAt: null, issues: [] }) });
    expect(unverified.kind === "needsUser" && unverified.external?.checkedAt).toBeNull();
    const ready = componentCardState({ ...base, features, list: withExt({ ...EXTERNAL, issues: [] }) });
    expect(ready).toEqual({ kind: "needsUser", steps: ["see below"] });
  });
  it("the gate helpers read only the named capabilities", () => {
    expect(externalGuidanceSupported(new Set([COMPONENTS_FEATURE]))).toBe(false);
    expect(componentIndexSupported(new Set([COMPONENTS_FEATURE]))).toBe(false);
    expect(externalGuidanceSupported(new Set([EXTERNAL_RUNTIME_ROOT_FEATURE]))).toBe(true);
    expect(componentIndexSupported(new Set([COMPONENT_INDEX_FEATURE]))).toBe(true);
  });
});

const ext = (code: string, extra: Partial<ComponentExternal> = {}): ComponentExternal => ({ ...EXTERNAL, ...extra, issues: [{ code, expected: code === "node_version_unsupported" ? ">=24.9.0 <25" : null, actual: null, path: null, steps: [] }] });

describe("external-install guides", () => {
  it("every known code has zh-CN + en copy", () => {
    for (const code of EXTERNAL_ISSUE_CODES)
      for (const part of ["title", "what"]) {
        const key = `modules.component.external.${code}.${part}` as keyof typeof zhCN;
        expect(zhCN[key], `${key} zh-CN`).toBeTruthy();
        expect(en[key as keyof typeof en], `${key} en`).toBeTruthy();
      }
  });

  it("each known code gives commands for the host's platform only (both when unknown)", () => {
    for (const code of EXTERNAL_ISSUE_CODES) {
      const name = code.startsWith("kimi_") ? "kimi-runtime" : "dsh-runtime";
      const linux = externalGuides(name, ext(code), "linux")[0]!;
      expect(linux.known).toBe(true);
      expect(linux.commands.map((c) => c.platform)).toEqual(["linux"]);
      expect(externalGuides(name, ext(code), "windows")[0]!.commands.map((c) => c.platform)).toEqual(["windows"]);
      expect(externalGuides(name, ext(code), null)[0]!.commands.map((c) => c.platform)).toEqual(["linux", "windows"]);
    }
  });

  it("install commands use cutex's package specs (not the desktop's) in a fresh versioned prefix", () => {
    const [linux] = externalGuides("dsh-runtime", ext("external_root_missing"), "linux")[0]!.commands;
    expect(linux!.lines).toEqual([
      `dsh="$HOME/.local/share/cutex-external/dsh/0.2.1-rc.4"`,
      `npm install --prefix "$dsh" @deepseek-ai/dsh@0.2.1-rc.4 @deepseek-ai/dsh-session-format-catalog@0.2.1-rc.4 ws@8.22.0`,
      `cutex component configure dsh-runtime --external-root "$dsh" --node "$(command -v node)"`,
    ]);
    const [win] = externalGuides("dsh-runtime", ext("upstream_version_mismatch"), "windows")[0]!.commands;
    expect(win!.lines[0]).toBe(`$dsh = Join-Path $env:LOCALAPPDATA 'cutex-external/dsh/0.2.1-rc.4'`);
    expect(win!.lines[1]).toBe(`npm install --prefix $dsh '@deepseek-ai/dsh@0.2.1-rc.4' '@deepseek-ai/dsh-session-format-catalog@0.2.1-rc.4' 'ws@8.22.0'`);
    expect(win!.lines[2]).toContain("--node (Get-Command node.exe).Source");
  });

  it("no packages from cutex: the signed externalRuntime of the checked release (fixture), else no commands", () => {
    const kimi = { ...ext("external_root_invalid", { packages: [], nodeRecommended: null }), version: "kimi-r3" };
    const row = getRow(fixtureRelease("kimi-runtime"));
    expect(externalNeeds(kimi, row)).toEqual({ packages: ["@moonshot-ai/kimi-code@2.3.3", "ws@8.22.0"], nodeRecommended: "24.21.0" });
    const fromFixture = externalGuides("kimi-runtime", kimi, "linux", row)[0]!.commands[0]!;
    expect(fromFixture.lines[1]).toBe(`npm install --prefix "$kimi" @moonshot-ai/kimi-code@2.3.3 ws@8.22.0`);
    // The row of another version is not used; nothing exact to install → cutex's steps only.
    expect(externalGuides("kimi-runtime", { ...kimi, version: "kimi-r4" }, "linux", row)[0]!.commands).toEqual([]);
    expect(externalGuides("kimi-runtime", kimi, "linux")[0]!.commands).toEqual([]);
    // Node without any version from cutex: no commands either (never a desktop default).
    expect(externalGuides("dsh-runtime", ext("node_missing", { nodeRecommended: null }), "linux")[0]!.commands).toEqual([]);
  });

  it("node commands use cutex's recommended version; rebuild / rg use the configured prefix", () => {
    const node = externalGuides("dsh-runtime", ext("node_version_unsupported"), "windows")[0]!.commands[0]!;
    expect(node.lines[0]).toBe("winget install -e --id OpenJS.NodeJS --version 24.22.0");
    const nodeLinux = externalGuides("dsh-runtime", ext("node_missing", { nodeRecommended: null }), "linux", getRow(fixtureRelease("dsh-runtime"), { version: "dsh-r3" }))[0]!.commands[0]!;
    expect(nodeLinux.lines.join("\n")).toContain("node-v24.21.0-linux-$arch");
    const pty = externalGuides("kimi-runtime", ext("kimi_pty_unavailable", { root: "/srv/it's/kimi" }), "linux")[0]!.commands[0]!;
    expect(pty.lines).toEqual(["sudo apt-get install build-essential python3", `kimi='/srv/it'\\''s/kimi'`, `npm rebuild --prefix "$kimi" node-pty`]);
    const rg = externalGuides("kimi-runtime", ext("kimi_rg_missing"), "windows")[0]!.commands[0]!;
    expect(rg.lines).toEqual(["winget install -e --id BurntSushi.ripgrep.MSVC", "cutex component configure kimi-runtime --rg (Get-Command rg.exe).Source"]);
  });

  it("an unknown code: no commands, cutex's steps only", () => {
    const g = externalGuides("dsh-runtime", { ...EXTERNAL, issues: [{ code: "future_check", expected: null, actual: null, path: null, steps: ["do x"] }] }, "linux")[0]!;
    expect(g.known).toBe(false);
    expect(g.commands).toEqual([]);
  });

  it("configure CLI: the confirmed flags, and --clear-* for 恢复默认", () => {
    expect(componentConfigureCli("dsh-runtime", [["externalRoot", "/x"], ["node", "/n"]])).toBe("cutex component configure dsh-runtime --external-root /x --node /n");
    expect(componentClearCli("kimi-runtime", ["externalRoot", "node", "rg"])).toBe("cutex component configure kimi-runtime --clear-external-root --clear-node --clear-rg");
    expect(componentClearCli("dsh-runtime", ["node"])).toBe("cutex component configure dsh-runtime --clear-node");
  });
  it("the form asks for rg only for Kimi", () => {
    expect(configureFields("dsh-runtime", EXTERNAL)).toEqual(["externalRoot", "node"]);
    expect(configureFields("kimi-runtime", EXTERNAL)).toEqual(["externalRoot", "node", "rg"]);
    expect(specVersion("@scope/pkg@1.2.3")).toBe("1.2.3");
    expect(specVersion("pkg")).toBeNull();
  });
});

const status = (index: Partial<NonNullable<ComponentStatus["index"]>>, selected = "dsh-r2", versions = [{ version: "dsh-r2", pinnedBy: 4, sizeBytes: 1 }, { version: "dsh-r1", pinnedBy: 2, sizeBytes: 1 }, { version: "dsh-r0", pinnedBy: 0, sizeBytes: 1 }]): ComponentStatus => ({
  name: "dsh-runtime", supported: true, state: "ready", selected, available: selected, origin: "signed", versions, error: null, steps: [],
  index: { source: "componentIndex", channel: "public-stable", sequence: 3, publishedAt: null, fetchedAt: null, stale: false, staleReason: null, recommended: null, selectedYanked: false, releases: [], ...index },
});
const rel = (version: string, more: Partial<ComponentIndexRelease> = {}): ComponentIndexRelease => ({ version, yanked: false, yankReason: null, compatible: true, incompatibleReason: null, requirements: {}, externalRuntime: null, externalRuntimeSha256: null, ...more });

describe("signed component index view", () => {
  it("adapter update for new agents (the fixture's dsh-r3); pins of existing agents (not the default)", () => {
    const fromFixture = readComponentsList({ components: [{ ...status({}), index: getIndex("dsh-runtime") }] }).components[0]!;
    const v = componentIndexView(fromFixture)!;
    expect(v.offer).toEqual({ kind: "adapterUpdate", version: "dsh-r3", requirements: { upstream: "@deepseek-ai/dsh@0.2.1-rc.3", node: ">=24.9.0 <25" } });
    expect(v.pins).toEqual([{ version: "dsh-r1", agents: 2 }]);
    expect(v.yanked).toBeNull();
    expect(v.sequence).toBe(1);
  });
  it("an incompatible recommendation: a newer cutex for capability / payload, else not for this host", () => {
    const v = componentIndexView(status({ recommended: "dsh-r3", releases: [rel("dsh-r3", { compatible: false, incompatibleReason: "capability:external-runtime-root-v2" })] }))!;
    expect(v.offer).toEqual({ kind: "needsCutex", version: "dsh-r3", reason: "capability:external-runtime-root-v2" });
    expect(componentIndexView(status({ recommended: "dsh-r3", releases: [rel("dsh-r3", { compatible: false, incompatibleReason: "payload:adapter-v2" })] }))!.offer.kind).toBe("needsCutex");
    expect(componentIndexView(status({ recommended: "dsh-r3", releases: [rel("dsh-r3", { compatible: false, incompatibleReason: "platform" })] }))!.offer).toEqual({ kind: "incompatible", version: "dsh-r3", reason: "platform" });
    // A recommendation cutex did not list is unknown data (contract clarification 5): never installable, never a platform verdict.
    expect(componentIndexView(status({ recommended: "dsh-r3", releases: [] }))!.offer).toEqual({ kind: "unknown", version: "dsh-r3" });
    expect(componentIndexView(status({ recommended: "dsh-r3", releases: [rel("dsh-r1")] }))!.yanked).toBeNull();
    expect(missingCapability("capability:external-runtime-root-v2")).toBe("external-runtime-root-v2");
    expect(missingCapability("payload:adapter-v2")).toBeNull();
  });
  it("yanked default → the safe recommendation (no separate update line); none yet → wait", () => {
    const v = componentIndexView(status({ recommended: "dsh-r1", selectedYanked: true, releases: [rel("dsh-r2", { yanked: true, yankReason: "bad resume" }), rel("dsh-r1")] }))!;
    expect(v.yanked).toEqual({ version: "dsh-r2", reason: "bad resume", safe: "dsh-r1" });
    expect(v.offer.kind).toBe("none");
    const none = componentIndexView(status({ recommended: null, selectedYanked: true, releases: [rel("dsh-r2", { yanked: true })] }))!;
    expect(none.yanked).toEqual({ version: "dsh-r2", reason: null, safe: null });
  });
  it("selectedYanked when the withdrawn default is no longer in the document", () => {
    const v = componentIndexView(status({ recommended: "dsh-r1", selectedYanked: true, releases: [rel("dsh-r1")] }))!;
    expect(v.yanked).toEqual({ version: "dsh-r2", reason: null, safe: "dsh-r1" });
  });
  it("current, stale cache, and no index at all", () => {
    const v = componentIndexView(status({ recommended: "dsh-r2", stale: true, staleReason: "offline", fetchedAt: "2026-10-26T00:00:00Z", releases: [rel("dsh-r2")] }))!;
    expect(v.offer).toEqual({ kind: "current", version: "dsh-r2" });
    expect(v.stale).toBe(true);
    const plain = status({});
    delete plain.index;
    expect(componentIndexView(plain)).toBeUndefined();
  });
});
