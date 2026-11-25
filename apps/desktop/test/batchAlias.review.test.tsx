// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ state: {} as any }));
vi.mock("../src/renderer/src/lib/batchModel", () => ({
  useBatchModel: (select?: (s: any) => unknown) => select ? select(fx.state) : fx.state,
  scopeAgents: () => [], batchSources: () => [{ key: "source", model: "sonnet", profile: "p", count: 1 }],
  batchRows: () => [], tickedRows: () => [], runningOn: () => false,
  applyBatch: () => {}, chooseEffort: () => {}, chooseSource: () => {}, chooseTarget: () => {}, closeBatchModel: () => {}, setBatchScope: () => {}, toggleBatchRow: () => {},
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: object) => unknown) => select({}), sidebarOf: () => null, featuresOf: () => new Set(), agentState: () => undefined }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, string | number>) => key === "claudeModels.latestTag" ? "Follow latest" : key === "claudeModels.oneMName" ? `${v?.model} · 1M` : key }) }));
vi.mock("../src/renderer/src/lib/ownerContext", () => ({ useOwnerWindow: () => window }));
import { BatchModelDialog } from "../src/renderer/src/components/BatchModelDialog";

// The store double is too thin for the avatar stack (agent looks, Profile pictures): icons are stubbed.
vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("batch model raw target list must name its folded-out 1M alias from the handshake", () => {
  const alias = { id: "opus", displayName: "Opus (alias)", resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayVersion: "5.5", supportedReasoningEfforts: ["medium"] };
  fx.state = { scope: { hostId: "local", label: "All" }, sourceKey: "source", target: null, effort: "keep", unticked: new Set(), runtimeModels: new Map(), phase: "choose", results: [], catalog: [alias, { ...alias, id: "opus[1m]", displayName: "Opus 1M (alias)" }, { ...alias, id: "claude-opus-5-5", displayName: "Opus 5.5" }], pendingReads: 0 };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(h(BatchModelDialog)));
    const text = host.querySelector('select[data-testid="batch-model-target"] option[value="opus[1m]"]')!.textContent!;
    expect(text).toContain("Opus 5.5");
    expect(text).not.toContain("(alias)");
    // delegation-252ec5: the same rule as the folded rows; the fixed 5.5 row stays plain.
    expect(text.startsWith("Opus 5.5 · 1M")).toBe(true);
    expect(host.querySelector('select[data-testid="batch-model-target"] option[value="claude-opus-5-5"]')!.textContent).not.toContain("1M");
  } finally { act(() => root.unmount()); host.remove(); }
});
