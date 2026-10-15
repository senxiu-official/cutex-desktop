// Browser-preview data for managed / external services (services page; dev/mockTypes.ts).
// `services-persistent-approval`: settings.agentPersistentApproval per host (default ask; `?persistoff`
// starts the shown host with off); PATCH /v2/services (patchServicesSettings) validates like cutex.
// Under `?legacy` the setting is not reported and a PATCH of it is refused.
import type { ModuleMock } from "../../dev/mockTypes";
import { SERVICES_PERSIST_APPROVAL_FEATURE, servicesSettingsPatch } from "../../../../shared/servicesSettings";
import type { ServicesSettings, ServicesSettingsPatch } from "../../../../shared/ipc";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/** One host's registry settings; `legacy()` = a cutex without the setting. */
function settingsStore(initial: ServicesSettings, legacy: () => boolean) {
  let settings = initial;
  const view = (): ServicesSettings => {
    const { agentPersistentApproval, ...rest } = settings;
    return legacy() ? rest : { ...rest, agentPersistentApproval };
  };
  return {
    view,
    patch(patch: ServicesSettingsPatch): ServicesSettings {
      if (legacy()) throw new Error("invalid_request: unknown field `agentPersistentApproval`");
      settings = { ...settings, ...servicesSettingsPatch(patch) };
      return view();
    },
  };
}

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
type MockService = import("../../../../shared/ipc").ServiceView;
function mockService(slug: string, displayName: string, port: number, runtime: MockService["runtime"], health: MockService["health"], owner: string | null, projectId: string | null, extra: Partial<MockService> = {}): MockService {
  return { slug, displayName, host: "host-a", port, path: null, ownerCutexSessionId: owner, projectId, runtime, createdAt: iso(86400), lastSeenAt: health === "reachable" ? iso(10) : null, health, url: `http://host-a:${port}`, localUrl: `http://127.0.0.1:${port}`, process: runtime === "external" ? null : { pid: health === "reachable" ? 4100 + port % 100 : null, startedAt: null, restarts: 0, lastExitCode: null, lastExitAt: null, nextRestartAt: null }, ...extra };
}
let mockServices: MockService[] = [
  mockService("host-a-experiment-console", "HOST-A Experiment Console", 24301, "managed", "reachable", "eva", "desktop"),
  mockService("kks-voice-audition", "KKS Voice Audition", 24234, "managed", "reachable", "mika", "desktop", { process: { pid: 4321, startedAt: null, restarts: 2, lastExitCode: 1, lastExitAt: null, nextRestartAt: null } }),
  mockService("host-a-image2-results", "HOST-A Image2 Results", 24308, "managed", "stopped", "alden", "desktop"),
  mockService("alpha-hexmap-editor", "ALPHA Hex Map Editor", 24201, "external", "unreachable", null, null),
  // demo-study: its 项目 page shows a 服务 tab next to the 成果库 (modules/artifacts/mock.ts).
  mockService("demo-results-dashboard", "Demo Results Dashboard", 24330, "managed", "reachable", "demo-run", "demo"),
  mockService("demo-notebook", "Demo Notebook", 24331, "managed", "stopped", "demo-done", "demo"),
  mockService("denia-score-annotator", "Denia Score Annotator", 24321, "external", "reachable", "wave-director", "waveline"),
  mockService("heltia-web", "Heltia Web Prototype", 24085, "managed", "starting", "scratch", null),
];
/** Multi-host P1: another host (workstation) has its own services (merged 服务 page). */
const remoteServices = new Map<string, MockService[]>();
function remoteServicesOf(hostId: string): MockService[] {
  let list = remoteServices.get(hostId);
  if (!list) {
    const on = (s: MockService): MockService => ({ ...s, host: "workstation", url: `http://workstation:${s.port}` });
    list = [
      on(mockService("waveline-api", "Waveline API", 24410, "managed", "reachable", "wave", "waveline")),
      on(mockService("tensorboard", "TensorBoard", 24411, "managed", "unreachable", "scratch", null, { process: { pid: null, startedAt: null, restarts: 3, lastExitCode: 1, lastExitAt: null, nextRestartAt: null } })),
    ];
    remoteServices.set(hostId, list);
  }
  return list;
}
const remoteSettings = new Map<string, ReturnType<typeof settingsStore>>();
function remoteServiceApi(hostId: string, emitHost: (method: string, params: Record<string, unknown>) => void): Partial<import("../../../../shared/ipc").DesktopApi> {
  const list = remoteServicesOf(hostId);
  let hostSettings = remoteSettings.get(hostId);
  if (!hostSettings) {
    hostSettings = settingsStore({ portRangeStart: 24400, portRangeEnd: 24999, agentPersistentApproval: "ask" }, () => false);
    remoteSettings.set(hostId, hostSettings);
  }
  const settings = hostSettings;
  const find = (slug: string) => list.find((s) => s.slug === slug)!;
  return {
    async services() {
      return { hostId: "WORKSTATION", services: structuredClone(list), settings: settings.view() };
    },
    async patchServicesSettings(patch) {
      return settings.patch(patch);
    },
    async serviceAction(slug, action) {
      const s = find(slug);
      s.health = action === "stop" ? "stopped" : "reachable";
      emitHost("cutex/services/changed", { reason: action === "stop" ? "stopped" : "started", slug, service: structuredClone(s) });
      return structuredClone(s);
    },
    async openService(slug) {
      const s = find(slug);
      return { url: s.url, localUrl: s.localUrl };
    },
    async serviceLogs(slug) {
      return { text: `[mock workstation] ${slug} listening on :${find(slug).port}
` };
    },
  };
}
export const mock: ModuleMock = {
  remote: remoteServiceApi,
  features: { new: [SERVICES_PERSIST_APPROVAL_FEATURE] },
  api: (core) => serviceApi(core, settingsStore({ portRangeStart: 24400, portRangeEnd: 24999, agentPersistentApproval: params.has("persistoff") ? "off" : "ask" }, () => core.legacy)),
  // service_register with reveal: true by demo-writer (owner of demo-notebook) ~16 s after start
  // (?revealAt=<s>): a card 「demo-writer 想给你看：Demo Notebook · 打开」 in its conversation (live.ts).
  start: (core) => {
    const at = Number(params.get("revealAt")) || 16;
    setTimeout(() => core.emitHost("cutex/services/revealRequested", { slug: "demo-notebook", hostId: "host-a", ownerCutexSessionId: "demo-done", path: "/lab", requestedAt: new Date().toISOString() }), at * 1000);
  },
};

function serviceApi(core: Parameters<NonNullable<ModuleMock["api"]>>[0], settings: ReturnType<typeof settingsStore>): Partial<import("../../../../shared/ipc").DesktopApi> {
  return {
    async services() {
      return { hostId: "HOST-A", services: mockServices, settings: settings.view() };
    },
    async patchServicesSettings(patch) {
      return settings.patch(patch);
    },
    async registerService(request) {
      if (mockServices.some((s) => s.slug === request.slug)) throw new Error(`slug_taken: slug \`${request.slug}\` is already registered`);
      // Managed: cutex starts it right away; the view keeps what an owner view shows (command, env keys…).
      const managed = request.runtime === "managed";
      const s = mockService(request.slug, request.displayName ?? request.slug, request.port ?? 24400 + mockServices.length, request.runtime ?? "external", managed ? "reachable" : "unreachable", null, null, {
        command: request.command ?? null,
        envKeys: Object.keys(request.env ?? {}),
        lifetime: request.lifetime ?? "persistent",
        proxyHostHeader: request.proxyHostHeader ?? "preserve",
        ...(request.loginLinkCommand ? { loginLinkCommand: request.loginLinkCommand } : {}),
      });
      mockServices = [...mockServices, s];
      return s;
    },
    async patchService(slug, patch) {
      mockServices = mockServices.map((s) => (s.slug === slug ? { ...s, ...patch } as typeof s : s));
      const s = mockServices.find((x) => x.slug === slug)!;
      core.emit("hostEvent", { cutex: { method: "cutex/services/changed", params: { reason: "updated", slug, service: s } } } as never);
      return s;
    },
    async deleteService(slug) {
      mockServices = mockServices.filter((s) => s.slug !== slug);
      core.emit("hostEvent", { cutex: { method: "cutex/services/changed", params: { reason: "removed", slug } } } as never);
    },
    async serviceAction(slug, action) {
      mockServices = mockServices.map((s) => (s.slug === slug ? { ...s, health: action === "stop" ? "stopped" : "reachable" } as typeof s : s));
      const s = mockServices.find((x) => x.slug === slug)!;
      core.emit("hostEvent", { cutex: { method: "cutex/services/changed", params: { reason: action === "stop" ? "stopped" : "started", slug, service: s } } } as never);
      return s;
    },
    async openService(slug) {
      const s = mockServices.find((x) => x.slug === slug)!;
      return { url: s.url, localUrl: s.localUrl };
    },
    async serviceLogs(slug) {
      return { text: `[mock] ${slug} listening\nGET / 200\nGET /api/state 200\n` };
    },
  };
}
