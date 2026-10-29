// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_BASE_FEATURES, MOCK_NEW_FEATURES } from "../src/renderer/src/dev/mockFeatures";

const fx = vi.hoisted(() => ({ features: new Set<string>(), list: vi.fn(), openPage: vi.fn() }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetFeatures: () => fx.features }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: fx.openPage } } }));
vi.mock("../src/renderer/src/components/Page", () => ({ PageBody: ({ children }: { children: ReactNode }) => h("main", null, children) }));
vi.mock("../src/renderer/src/components/DelegationList", () => ({ DelegationList: (props: { agent?: string; actions?: ReactNode }) => {
  fx.list(props); return h("section", { "data-testid": "existing-delegation-list" }, "existing asks/views list", props.actions);
} }));
import { DelegationsPage } from "../src/renderer/src/modules/delegations/DelegationsPage";

const R266 = new Set(["delegation-routing-v1", "delegation-tree-stop-v1", "project-run-control-v1", "delegation-continuation-v1", "agent-activity-v1", "agent-bus-message-settlement-v1"]);
afterEach(() => { vi.clearAllMocks(); });
describe("r265 additive compatibility (not the broad legacy mode)", () => {
  it("removes precisely six r266 capabilities, preserves asks/views/archive and the existing delegation page", () => {
    const current = new Set([...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES, "agent-asks", "delegation-views", "agent-archive-kind-v1"]);
    fx.features = new Set([...current].filter(feature => !R266.has(feature)));
    expect(fx.features.has("agent-asks")).toBe(true);
    expect(fx.features.has("delegation-views")).toBe(true);
    expect(fx.features.has("agent-archive-kind-v1")).toBe(true);
    for (const feature of current) expect(fx.features.has(feature)).toBe(!R266.has(feature));
    const container = document.createElement("div"), root = createRoot(container);
    act(() => root.render(h(DelegationsPage, { params: { agent: "existing-agent" } })));
    expect(container.querySelector('[data-testid="existing-delegation-list"]')?.textContent).toBe("existing asks/views list");
    expect(fx.list).toHaveBeenLastCalledWith({ agent: "existing-agent", actions: false });
    expect(container.querySelector("button")).toBeNull();
    expect(fx.openPage).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
