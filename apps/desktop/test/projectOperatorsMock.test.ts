// The preview's projects mock (modules/projects/mock.ts) must split members like the daemon: a member holding the
// project's Operator grant is in agent_operators only, never also in active_agents. A duplicated listing hid the
// operator-only revoke failure in lib/projectOperators.ts.
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PreloadBridge } from "../src/shared/ipc";
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));

function stubs(search: string) {
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return win;
}
beforeAll(async () => { stubs(""); await import("../src/renderer/src/dev/mockBridge"); vi.unstubAllGlobals(); }, 60_000);
async function install(search: string) {
  vi.resetModules();
  const win = stubs(search);
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  await vi.dynamicImportSettled();
  const { changeProjectOperator } = await import("../src/renderer/src/lib/projectOperators");
  return { api: win.cutex!.api, changeProjectOperator };
}
afterEach(() => { vi.unstubAllGlobals(); });
const ids = (rows: { agent: { cutex_session_id: string } }[] | undefined) => (rows ?? []).map(row => row.agent.cutex_session_id);
const operators = (view: { agent_operators?: { member: { agent: { cutex_session_id: string } } }[] }) => ids(view.agent_operators?.map(row => row.member));

it("lists an Operator only under agent_operators, and revoke/grant round-trip through the real client logic", async () => {
  const { api, changeProjectOperator } = await install("?operator=idle");
  const before = await api.projectRead("desktop");
  expect(operators(before)).toEqual(["mika"]);
  expect(ids(before.active_agents)).not.toContain("mika");
  const options = (grant: boolean) => ({ api, projectId: "desktop", sessionId: "mika", grant, current: () => true, owner: () => true,
    refresh: async () => {}, runtimeNotice: async () => { await api.operatorRuntimeNotice("desktop", "mika"); } });
  await changeProjectOperator(options(false));
  const revoked = await api.projectRead("desktop");
  expect(operators(revoked)).toEqual([]); expect(ids(revoked.active_agents)).toContain("mika");
  await changeProjectOperator(options(true));
  const granted = await api.projectRead("desktop");
  expect(operators(granted)).toEqual(["mika"]); expect(ids(granted.active_agents)).not.toContain("mika");
  expect(granted.operator_grant_revision).toBe(before.operator_grant_revision! + 2);
});
it("an older cutex has no operator projection and keeps everyone in active_agents", async () => {
  const { api } = await install("?legacy&operator=idle");
  const view = await api.projectRead("desktop");
  expect(view.agent_operators).toBeUndefined();
  expect(ids(view.active_agents)).toContain("mika");
});
