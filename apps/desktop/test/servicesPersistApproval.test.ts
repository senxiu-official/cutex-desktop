// cutex service lifecycle settings (Settings → 协作 → 服务): patches, preview round trips,
// legacy omission, and section capability gating.
import { describe, expect, it, vi } from "vitest";
import { agentPersistentApprovalOf, DEFAULT_AGENT_PERSISTENT_APPROVAL, isAgentPersistentApproval, SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_PERSIST_APPROVAL_FEATURE, servicesSettingsPatch } from "../src/shared/servicesSettings";
import { stubServices } from "./serviceStub";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { mock } = await import("../src/renderer/src/modules/services/mock");
const { zhCN } = await import("../src/renderer/src/modules/services/i18n");
const { en } = await import("../src/renderer/src/modules/services/i18n.en");
const { default: servicesModule } = await import("../src/renderer/src/modules/services/index");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");

type Core = Parameters<NonNullable<typeof mock.api>>[0];

describe("servicesSettingsPatch", () => {
  it("passes ask / off and refuses anything else", () => {
    expect(servicesSettingsPatch({ agentPersistentApproval: "off" })).toEqual({ agentPersistentApproval: "off" });
    expect(servicesSettingsPatch({ agentPersistentApproval: "ask" })).toEqual({ agentPersistentApproval: "ask" });
    expect(servicesSettingsPatch({ ephemeralIdleMinutes: 120 })).toEqual({ ephemeralIdleMinutes: 120 });
    expect(servicesSettingsPatch({ ephemeralIdleMinutes: 0 })).toEqual({ ephemeralIdleMinutes: 0 });
    expect(() => servicesSettingsPatch({ ephemeralIdleMinutes: 4 })).toThrow();
    expect(() => servicesSettingsPatch({ ephemeralIdleMinutes: 1441 })).toThrow();
    expect(() => servicesSettingsPatch({ agentPersistentApproval: "never" })).toThrow();
    expect(() => servicesSettingsPatch({ portRangeStart: 1 })).toThrow(/portRangeStart/);
    expect(() => servicesSettingsPatch({})).toThrow();
    expect(() => servicesSettingsPatch(null)).toThrow();
    expect(() => servicesSettingsPatch(["off"])).toThrow();
  });

  it("reads the setting only when the daemon reports a known value", () => {
    expect(DEFAULT_AGENT_PERSISTENT_APPROVAL).toBe("ask");
    expect(isAgentPersistentApproval("off")).toBe(true);
    expect(agentPersistentApprovalOf({ portRangeStart: 1, portRangeEnd: 2, agentPersistentApproval: "off" })).toBe("off");
    expect(agentPersistentApprovalOf({ portRangeStart: 1, portRangeEnd: 2 })).toBeNull();
    expect(agentPersistentApprovalOf({ agentPersistentApproval: "maybe" as never })).toBeNull();
    expect(agentPersistentApprovalOf(null)).toBeNull();
  });
});

describe("preview mock", () => {
  it("defaults to ask and round-trips off / ask", async () => {
    const api = mock.api!({ legacy: false } as Core);
    expect((await api.services!()).settings.agentPersistentApproval).toBe("ask");
    expect((await api.services!()).settings.ephemeralIdleMinutes).toBe(120);
    expect(await api.patchServicesSettings!({ agentPersistentApproval: "off" })).toMatchObject({ agentPersistentApproval: "off", portRangeStart: 24400 });
    expect((await api.services!()).settings.agentPersistentApproval).toBe("off");
    expect((await api.patchServicesSettings!({ agentPersistentApproval: "ask" })).agentPersistentApproval).toBe("ask");
    expect((await api.patchServicesSettings!({ ephemeralIdleMinutes: 480 })).ephemeralIdleMinutes).toBe(480);
    await expect(api.patchServicesSettings!({ agentPersistentApproval: "never" as never })).rejects.toThrow();
  });

  it("an older cutex neither reports nor accepts it", async () => {
    const api = mock.api!({ legacy: true } as Core);
    expect((await api.services!()).settings).not.toHaveProperty("agentPersistentApproval");
    expect((await api.services!()).settings).not.toHaveProperty("ephemeralIdleMinutes");
    await expect(api.patchServicesSettings!({ agentPersistentApproval: "off" })).rejects.toThrow(/agentPersistentApproval/);
    expect(mock.features?.new).toContain(SERVICES_PERSIST_APPROVAL_FEATURE);
    expect(mock.features?.new).toContain(SERVICES_EPHEMERAL_TTL_FEATURE);
  });

  it("another host keeps its own value", async () => {
    const remote = mock.remote!("workstation-test", () => {});
    expect((await remote.services!()).settings.agentPersistentApproval).toBe("ask");
    await remote.patchServicesSettings!({ agentPersistentApproval: "off" });
    expect((await mock.remote!("workstation-test", () => {}).services!()).settings.agentPersistentApproval).toBe("off");
    expect((await mock.remote!("workstation-other", () => {}).services!()).settings.agentPersistentApproval).toBe("ask");
  });
});

describe("settings section", () => {
  const storage = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const section = async (features: string[]) => {
    const host = createModuleHost({ modules: [servicesModule], slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set(features) }, storage: storage(), services: () => stubServices(), log: () => {} });
    await host.idle();
    return host.snapshot("settings.section").find((e) => e.item.id === "services.persistApproval.settings");
  };

  it("shows on 协作 when cutex advertises service settings and the component feature-detects its rows", async () => {
    const shown = await section(["services", SERVICES_PERSIST_APPROVAL_FEATURE]);
    expect(shown?.mode).toBe("show");
    expect(shown?.item.page).toBe("collab");
    expect((await section(["services"]))?.mode ?? "hide").toBe("hide");
  });

  it("has zh-CN and en text", () => {
    for (const key of ["services.settings", "services.persistApproval", "services.persistApproval.hint", "services.persistApproval.unknown", "services.idleTtl", "services.idleTtl.0", "services.keepPinned.off", "services.extend"] as const) {
      expect(zhCN[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    expect(zhCN["services.persistApproval"]).toContain("审批");
  });
});
