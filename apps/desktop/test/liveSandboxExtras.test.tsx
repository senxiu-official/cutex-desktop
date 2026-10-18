// Composer permission menu → network / extra writable directories of a running agent (cutex
// `session-sandbox-extras`): shown only with the capability, on a Codex agent whose live sandbox is
// workspace-write; the mock cutex stores the values and pushes them to the live thread.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_SANDBOX_EXTRAS_FEATURE, type PreloadBridge } from "../src/shared/ipc";
import { effectivePermissions, liveExtrasApply } from "../src/renderer/src/lib/permissionModes";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
const fx = vi.hoisted(() => ({ state: { daemon: { kind: "disconnected" }, hosts: null } as Record<string, unknown> }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: () => ({}),
  bridge: {},
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/remoteMode", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFolderPickBlocked: () => false,
}));

const workspace = (extra: Record<string, unknown> = {}) =>
  ({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/srv/data"], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false, ...extra } }) as never;

describe("liveExtrasApply", () => {
  it("needs the capability, a Codex agent, a live thread and workspace-write", () => {
    const base = { feature: true, claude: false, online: true, settings: workspace() };
    expect(liveExtrasApply(base)).toBe(true);
    expect(liveExtrasApply({ ...base, feature: false })).toBe(false); // older cutex: controls hidden
    expect(liveExtrasApply({ ...base, claude: true })).toBe(false);
    expect(liveExtrasApply({ ...base, online: false })).toBe(false);
    expect(liveExtrasApply({ ...base, settings: { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } } as never })).toBe(false);
    expect(liveExtrasApply({ ...base, settings: { approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } } as never })).toBe(false);
    expect(liveExtrasApply({ ...base, settings: null })).toBe(false);
  });
});

describe("menu footer", () => {
  it("PermissionDetail drops the network / directory lines when the controls show them", async () => {
    const { PermissionDetail } = await import("../src/renderer/src/components/PermissionDetail");
    const effective = effectivePermissions(workspace())!;
    const plain = renderToStaticMarkup(h(PermissionDetail, { effective }));
    expect(plain).toContain("composer.effective.network.off");
    expect(plain).toContain("/srv/data");
    const editable = renderToStaticMarkup(h(PermissionDetail, { effective, editable: true }));
    expect(editable).toContain("composer.effective.approvals.autoReview");
    expect(editable).not.toContain("composer.effective.network");
    expect(editable).not.toContain("composer.effective.roots");
  });

  it("LiveSandboxExtras shows the network switch, the directories with an add button and the next-turn note", async () => {
    const { LiveSandboxExtras } = await import("../src/renderer/src/components/LiveSandboxExtras");
    const html = renderToStaticMarkup(h(LiveSandboxExtras, { hostId: "local", sessionId: "eva", network: true, roots: ["/srv/data"] }));
    expect(html).toContain("launch.network");
    expect(html).toMatch(/aria-checked="true"|checked=""/);
    expect(html).toContain("/srv/data");
    expect(html).toContain("launch.addRoot");
    expect(html).toContain("composer.live.nextTurn");
  });

  it("ships the strings in zh-CN, zh-Hant-CN, en and en-AU", () => {
    for (const key of ["composer.live.title", "composer.live.networkHint", "composer.live.nextTurn", "composer.live.stored", "composer.live.failed"] as const) {
      for (const catalog of [zhCN, zhHantCN, en, enAU] as Record<string, string>[]) expect(catalog[key], key).toBeTruthy();
    }
    expect(zhCN["composer.live.failed"]).toContain("{error}");
  });
});

async function install(search = ""): Promise<PreloadBridge> {
  vi.resetModules();
  vi.useFakeTimers();
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return win.cutex!;
}

describe("mock cutex", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("advertises the capability only on a current cutex", async () => {
    const { MOCK_NEW_FEATURES, MOCK_BASE_FEATURES } = await import("../src/renderer/src/dev/mockFeatures");
    expect(MOCK_NEW_FEATURES).toContain(SESSION_SANDBOX_EXTRAS_FEATURE);
    expect(MOCK_BASE_FEATURES).not.toContain(SESSION_SANDBOX_EXTRAS_FEATURE);
  });

  it("stores network / directories of a workspace agent and refuses unsafe or meaningless changes", async () => {
    const api = (await install()).api;
    // "eva" runs on the gamma profile (自动 = workspace-write).
    const before = await api.sessionSandboxExtras("eva");
    expect(before).toMatchObject({ editable: true, sandbox: "workspace-write", networkAccess: true, writableRoots: [] });
    const after = await api.setSessionSandboxExtras("eva", { networkAccess: false, writableRoots: ["/srv/data/", "/srv/data"] });
    expect(after).toMatchObject({ networkAccess: false, writableRoots: ["/srv/data"], live: { status: "applied" } });
    expect(await api.sessionSandboxExtras("eva")).toMatchObject({ networkAccess: false, writableRoots: ["/srv/data"] });
    await expect(api.setSessionSandboxExtras("eva", { writableRoots: ["relative"] })).rejects.toThrow(/absolute/);
    await expect(api.setSessionSandboxExtras("eva", { writableRoots: ["/home/alex/.cutex/runtime"] })).rejects.toThrow(/cutex home/);
    // A full-access agent (omega profile): nothing to adjust.
    expect((await api.sessionSandboxExtras("no-such-agent")).editable).toBe(false);
    await expect(api.setSessionSandboxExtras("no-such-agent", { networkAccess: true })).rejects.toThrow(/workspace-write/);
  });
});
