// Browser-preview data for managed / external services (services page; dev/mockTypes.ts).
// `services-persistent-approval`: settings.agentPersistentApproval per host (default ask; `?persistoff`
// starts the shown host with off); PATCH /v2/services (patchServicesSettings) validates like cutex.
// Under `?legacy` the setting is not reported and a PATCH of it is refused.
// `services-project-scope` (r267): two of desktop's services are project services; old-refactor (archived)
// left a session one and another lost its registrant (both 认领候选 of desktop); Eva's Director Board has no
// projectId (转为项目服务 picks the project). PATCH {ownerScope, projectId} validates like cutex.
import { SERVICES_ELIGIBLE_OWNERS_FEATURE, type EligibleServiceOwner } from "../../../../shared/serviceOwners";
import type { ModuleMock } from "../../dev/mockTypes";
import { SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_ORGANIZE_FEATURE, SERVICES_PERSIST_APPROVAL_FEATURE, SERVICES_PROJECT_SCOPE_FEATURE, SERVICES_IDLE_PRESETS_FEATURE, servicesSettingsPatch } from "../../../../shared/servicesSettings";
import type { ServicesSettings, ServicesSettingsPatch } from "../../../../shared/ipc";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/** One host's registry settings; `legacy()` = a cutex without the setting. */
function settingsStore(initial: ServicesSettings, legacy: () => boolean) {
  let settings = initial;
  const view = (): ServicesSettings => {
    const { agentPersistentApproval, ephemeralIdleMinutes, ephemeralTtlHours, ...rest } = settings;
    return legacy() ? rest : { ...rest, agentPersistentApproval, ephemeralIdleMinutes, ephemeralTtlHours };
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

function patchedService(service: MockService, patch: Parameters<NonNullable<import("../../../../shared/ipc").DesktopApi["patchService"]>>[1], settings: ServicesSettings): MockService {
  const next = { ...service, ...patch } as MockService;
  if (patch.idleStopPreset !== undefined && (next.runtime !== "managed" || next.lifetime !== "persistent" || !["1h", "24h", "7d", "forever"].includes(patch.idleStopPreset))) throw new Error("invalid_request: idleStopPreset requires a persistent managed service");
  if (patch.lifetime === "persistent" && service.lifetime !== "persistent" && next.runtime === "managed" && patch.idleStopPreset === undefined) next.idleStopPreset = "24h";
  // cutex: a project service needs a projectId (409 project_scope_unavailable); unknown scopes are a 400.
  if (patch.ownerScope !== undefined && patch.ownerScope !== "session" && patch.ownerScope !== "project") throw new Error("invalid_request: ownerScope must be session or project");
  if (next.ownerScope === "project" && !next.projectId) throw new Error("project_scope_unavailable: a project service needs a projectId");
  if (patch.lifetime === "ephemeral") next.purpose = null;
  if (patch.pinned !== undefined || patch.idleTtlMinutes !== undefined) {
    next.effectiveIdleTtlMinutes = next.pinned ? null : (next.idleTtlMinutes ?? settings.ephemeralIdleMinutes ?? 30);
  }
  return next;
}

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
type MockService = import("../../../../shared/ipc").ServiceView;
function mockService(slug: string, displayName: string, port: number, runtime: MockService["runtime"], health: MockService["health"], owner: string | null, projectId: string | null, extra: Partial<MockService> = {}): MockService {
  return { slug, displayName, host: "host-a", port, path: null, ownerCutexSessionId: owner, projectId, runtime, lifetime: "ephemeral", purpose: null, pinned: false, effectiveIdleTtlMinutes: 120, maxIdleTtlMinutes: 1440, groupName: null, starred: false, sortOrder: 0, note: null, hidden: false, archived: false, createdAt: iso(86400), lastSeenAt: health === "reachable" ? iso(10) : null, lastTrafficAt: health === "reachable" ? iso(30) : null, health, url: `http://host-a:${port}`, localUrl: `http://127.0.0.1:${port}`, process: runtime === "external" ? null : { pid: health === "reachable" ? 4100 + port % 100 : null, startedAt: null, restarts: 0, lastExitCode: null, lastExitAt: null, nextRestartAt: null }, ...extra };
}
let mockServices: MockService[] = [
  mockService("host-a-experiment-console", "HOST-A Experiment Console", 24301, "managed", "reachable", "eva", "desktop", { ownerScope: "project", lifetime: "persistent", purpose: "foreground", groupName: "开发工具", starred: true, note: "实验控制台与实时结果" }),
  mockService("kks-voice-audition", "KKS Voice Audition", 24234, "managed", "reachable", "mika", "desktop", { ownerScope: "project", lifetime: "persistent", purpose: "background", groupName: "语音", note: "本地试听与转码服务", process: { pid: 4321, startedAt: null, restarts: 2, lastExitCode: 1, lastExitAt: null, nextRestartAt: null } }),
  mockService("host-a-image2-results", "HOST-A Image2 Results", 24308, "managed", "stopped", "alden", "desktop", { lifetime: "persistent", purpose: null, note: "等待主人分类的长期服务" }),
  mockService("alpha-hexmap-editor", "ALPHA Hex Map Editor", 24201, "external", "unreachable", null, null),
  // demo-study: its 项目 page shows a 服务 tab next to the 成果库 (modules/artifacts/mock.ts).
  mockService("demo-results-dashboard", "Demo Results Dashboard", 24330, "managed", "reachable", "demo-run", "demo"),
  mockService("demo-notebook", "Demo Notebook", 24331, "managed", "stopped", "demo-done", "demo"),
  mockService("denia-score-annotator", "Denia Score Annotator", 24321, "external", "reachable", "wave-director", "waveline", { lifetime: "persistent", purpose: "foreground", groupName: "Waveline" }),
  mockService("heltia-web", "Heltia Web Prototype", 24085, "managed", "starting", "scratch", null, { lifetime: "persistent", purpose: "background" }),
  // 桌面 (modules/home/mock.ts pins it): a service with a template tile (cutex service-tiles).
  mockService("audiobook", "听书", 24340, "managed", "reachable", "mika", null, { lifetime: "persistent", purpose: "foreground", groupName: "个人工具" }),
  // services-project-scope: 认领候选 of desktop (an archived registrant, a cleared one) and a board without a project.
  mockService("desktop-legacy-board", "Legacy Review Board", 24302, "managed", "reachable", "old1", "desktop", { lifetime: "persistent", purpose: "foreground", groupName: "开发工具" }),
  mockService("desktop-layout-preview", "Layout Preview", 24303, "external", "reachable", null, "desktop"),
  mockService("cutex-e-director-board", "Director Board", 24304, "managed", "reachable", "eva", null, { lifetime: "persistent", purpose: "foreground" }),
];
// Repeatable conversation-header review: the Director owns thirteen synthetic services.
if (params.has("idle") && !params.has("legacy") && !params.has("oldidle")) {
  mockServices.push(mockService("idle-preview", "Sleeping preview", 24358, "managed", "stoppedIdle", "eva", "desktop", { lifetime: "persistent", purpose: "foreground", idleStopPreset: "1h", stoppedIdle: true, stoppedIdleAt: iso(3600), idleStopAt: null, lastTrafficAt: iso(7200), stopped: false }));
  mockServices.push(mockService("idle-scheduled", "Scheduled preview", 24359, "managed", "reachable", "eva", "desktop", { lifetime: "persistent", purpose: "foreground", idleStopPreset: "24h", idleStopAt: iso(-86370) }));
}
if (params.get("ws") === "header") {
  mockServices.push(...Array.from({ length: 12 }, (_, i) =>
    mockService(`header-review-${i + 1}`, `Header review ${i + 1}`, 24500 + i, "external", i === 11 ? "starting" : "reachable", "eva", "desktop")));
}
// `?ws=svchdr&svcs=N` (dev/devWorkspaces): Mika owns N services in all (it has two), for the header popover's height cap,
// two columns and paging (owner 2026-10-25: 16 ran off the window). Every fifth is static with no port (「运行中 · 静态」).
const svcs = Number(params.get("svcs"));
if (svcs > 2) {
  const healths: MockService["health"][] = ["reachable", "reachable", "starting", "reachable", "stopped", "unreachable"];
  mockServices.push(...Array.from({ length: svcs - 2 }, (_, i) =>
    i % 5 === 4
      ? mockService(`mika-static-${i + 1}`, `Mika Static Page ${i + 1}`, 0, "static", "reachable", "mika", "desktop", { url: `http://host-a/s/mika-static-${i + 1}/`, localUrl: "", process: null })
      : mockService(`mika-tool-${i + 1}`, `Mika Tool ${i + 1}${i % 3 === 0 ? " — a longer service display name" : ""}`, 24600 + i, "managed", healths[i % healths.length]!, "mika", "desktop")));
}
// `?projectview` (modules/project-view/mock.ts): a service registered by the cutex-dev project's shelf-model.
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("projectview"))
  mockServices.push(
    mockService("shelf-preview", "Shelf Preview", 24404, "managed", "reachable", "pv-shm", "cutex-dev", { createdAt: iso(26 * 60) }),
    // The previous Director's leftover board: a claim candidate in the Shelf project view (前任 Director).
    mockService("cutex-dev-old-board", "Previous Director Board", 24405, "managed", "reachable", "previous-director", "cutex-dev", { lifetime: "persistent", purpose: "foreground", createdAt: iso(3 * 86400) }),
  );

/** cutex `service-tiles`: GET /v2/services/{slug}/tile (docs/SERVICES.md "Tiles"); audiobook serves one with an image + progress. */
const TILES: Record<string, unknown> = {
  audiobook: {
    title: "第 12 章 · 红岸之四",
    subtitle: "《三体》· 听书管家朗读 · 剩余 23 分钟",
    lines: ["下一章：第 13 章 · 红岸之五"],
    image: "/covers/santi.jpg",
    progress: { value: 0.38, label: "14:06 / 37:12" },
    badge: "1.25×",
    actions: [
      { label: "继续播放", path: "/player?chapter=12" },
      { label: "章节", path: "/chapters" },
      // Refused by the desktop (not a path inside the service): never drawn.
      { label: "外链", path: "https://example.com/" },
    ],
    refreshSeconds: 120,
    sizes: ["m", "w", "l"],
  },
};

/** The tile image: a small book cover painted on a canvas (PNG data URL; the preview has no network). */
function bookCover(): string | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 236;
  c.height = 340;
  const g = c.getContext("2d");
  if (!g) return null;
  const bg = g.createLinearGradient(0, 0, 236, 340);
  bg.addColorStop(0, "#20304f");
  bg.addColorStop(0.55, "#5a3d6e");
  bg.addColorStop(1, "#d0875a");
  g.fillStyle = bg;
  g.fillRect(0, 0, 236, 340);
  const orb = g.createRadialGradient(190, 110, 6, 200, 120, 70);
  orb.addColorStop(0, "#ffe2a8");
  orb.addColorStop(0.6, "#e08a4c");
  orb.addColorStop(1, "rgba(224,138,76,0)");
  g.fillStyle = orb;
  g.fillRect(100, 30, 136, 180);
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 0, 12, 340);
  g.fillStyle = "#fff";
  g.font = "600 40px sans-serif";
  g.fillText("三体", 30, 300);
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = "20px sans-serif";
  g.fillText("刘慈欣", 30, 44);
  return c.toDataURL("image/png");
}
let coverCache: string | null | undefined;
/** Multi-host P1: another host (workstation) has its own services (merged 服务 page). */
const remoteServices = new Map<string, MockService[]>();
function remoteServicesOf(hostId: string): MockService[] {
  let list = remoteServices.get(hostId);
  if (!list) {
    const on = (s: MockService): MockService => ({ ...s, host: "workstation", url: `http://workstation:${s.port}` });
    list = [
      on(mockService("waveline-api", "Waveline API", 24410, "managed", "reachable", "wave", "waveline")),
      on(mockService("tensorboard", "TensorBoard", 24411, "managed", "unreachable", "scratch", null, { process: { pid: null, startedAt: null, restarts: 3, lastExitCode: 1, lastExitAt: null, nextRestartAt: null } })),
      // `?oldservices`: a persistent service of a cutex without purpose / groups / order (r256): 未分类.
      ...(params.has("oldservices") ? [oldHostService(on(mockService("wave-grafana", "Waveline Grafana", 24412, "managed", "reachable", "wave", "waveline", { lifetime: "persistent" })))] : []),
    ];
    remoteServices.set(hostId, list);
  }
  return list;
}
const remoteSettings = new Map<string, ReturnType<typeof settingsStore>>();
/** What a cutex before `services-organize` reports: no owner fields on the record. */
function oldHostService(service: MockService): MockService {
  const { purpose: _purpose, groupName: _group, starred: _starred, sortOrder: _order, note: _note, hidden: _hidden, archived: _archived, ...rest } = service;
  return rest as MockService;
}
const OWNER_FIELDS = ["purpose", "groupName", "starred", "sortOrder", "note", "hidden", "archived"];
function remoteServiceApi(hostId: string, emitHost: (method: string, params: Record<string, unknown>) => void): Partial<import("../../../../shared/ipc").DesktopApi> {
  const list = remoteServicesOf(hostId);
  let hostSettings = remoteSettings.get(hostId);
  if (!hostSettings) {
    hostSettings = settingsStore({ portRangeStart: 24400, portRangeEnd: 24999, agentPersistentApproval: "ask", ephemeralIdleMinutes: 120, ephemeralTtlHours: 24 }, () => false);
    remoteSettings.set(hostId, hostSettings);
  }
  const settings = hostSettings;
  const find = (slug: string) => list.find((s) => s.slug === slug)!;
  return {
    async services() {
      return { hostId: "WORKSTATION", services: structuredClone(list), settings: settings.view() };
    },
    async serviceEligibleOwners(slug) {
      const service = find(slug);
      if (!service) throw new Error("404 service_not_found");
      return { hostId, slug, owners: [
        { id: "wave", name: "Waveline", realName: "wave", projectId: "waveline", isDirector: service.projectId === "waveline", online: true, unnamed: false },
        { id: "remote-hidden-owner", name: "Remote Archive Keeper", realName: "remote-hidden-owner", projectId: service.projectId, isDirector: false, online: false, unnamed: false },
      ] };
    },
    async patchServicesSettings(patch) {
      return settings.patch(patch);
    },
    async patchService(slug, patch) {
      // Such a cutex's PATCH denies unknown fields (serde), like r256 did.
      const unknown = params.has("oldservices") ? Object.keys(patch).find((field) => OWNER_FIELDS.includes(field)) : undefined;
      if (unknown) throw new Error(`invalid_request: unknown field \`${unknown}\`, expected one of \`displayName\`, \`path\`, \`port\`, \`runtime\`, \`lifetime\``);
      const index = list.findIndex((service) => service.slug === slug);
      list[index] = patchedService(list[index]!, patch, settings.view());
      emitHost("cutex/services/changed", { reason: "updated", slug, service: structuredClone(list[index]) });
      return structuredClone(list[index]!);
    },
    async serviceAction(slug, action) {
      const s = find(slug);
      if (action === "archive") { s.archived = true; s.hidden = true; s.health = "stopped"; }
      else if (action === "restore") { s.archived = false; s.hidden = false; }
      else s.health = action === "stop" ? "stopped" : "reachable";
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
  features: { new: [SERVICES_PERSIST_APPROVAL_FEATURE, SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_ORGANIZE_FEATURE, "service-tiles", SERVICES_ELIGIBLE_OWNERS_FEATURE, SERVICES_PROJECT_SCOPE_FEATURE, ...(params.has("oldidle") ? [] : [SERVICES_IDLE_PRESETS_FEATURE])] },
  api: (core) => serviceApi(core, settingsStore({ portRangeStart: 24400, portRangeEnd: 24999, agentPersistentApproval: params.has("persistoff") ? "off" : "ask", ephemeralIdleMinutes: 120, ephemeralTtlHours: 24 }, () => core.legacy)),
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
      // An older cutex reports no ownerScope (every service is its registrant's).
      const services = core.legacy ? mockServices.map(({ ownerScope: _scope, ...rest }) => rest as MockService) : mockServices.map((x) => ({ ...x, ownerScope: x.ownerScope ?? "session" }));
      return { hostId: "HOST-A", services, settings: settings.view() };
    },
    async serviceEligibleOwners(slug) {
      if (core.legacy) throw new Error("404 unsupported");
      const service = mockServices.find((s) => s.slug === slug);
      if (!service) throw new Error("404 service_not_found");
      if (params.get("eligibleOwners") === "error") throw new Error("503 owners_unavailable");
      if (params.get("eligibleOwners") === "loading") await new Promise((resolve) => setTimeout(resolve, 3000));
      const sidebar = core.projectRecords();
      const project = sidebar.projects?.projects.find((p) => p.project_id === service.projectId);
      const owners: EligibleServiceOwner[] = sidebar.active.map((session) => ({
        id: session.cutexSessionId, name: session.displayName, realName: session.formalAgentName ?? null,
        projectId: sidebar.hostRows?.[session.cutexSessionId]?.projectId ?? null,
        isDirector: session.cutexSessionId === project?.director_cutex_session_id,
        online: session.activityStatus !== "offline" && session.runtime?.status !== "offline",
        unnamed: !session.formalAgentName && !session.displayNameOverride?.trim() && session.registrationClass === "local_only",
      }));
      // A valid backend session deliberately absent from the sidebar snapshot.
      owners.push({ id: "local-hidden-owner", name: "Archive Keeper", realName: "local-hidden-owner", projectId: service.projectId, isDirector: false, online: true, unnamed: false });
      return { hostId: "HOST-A", slug, owners };
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
        ...(managed && (request.lifetime ?? "persistent") === "persistent" ? { idleStopPreset: request.idleStopPreset ?? "24h" } : {}),
        purpose: (request.lifetime ?? "persistent") === "persistent" ? (request.purpose ?? null) : null,
        proxyHostHeader: request.proxyHostHeader ?? "preserve",
        ...(request.loginLinkCommand ? { loginLinkCommand: request.loginLinkCommand } : {}),
      });
      mockServices = [...mockServices, s];
      return s;
    },
    async patchService(slug, patch) {
      if ((core.legacy || params.has("oldidle")) && patch.idleStopPreset !== undefined) throw new Error("400 invalid_request: unknown field idleStopPreset");
      if (params.has("serviceFieldsLegacy") && (patch.sortOrder !== undefined || patch.groupName !== undefined)) throw new Error("400 invalid_request: unknown field `sortOrder`");
      mockServices = mockServices.map((s) => (s.slug === slug ? patchedService(s, patch, settings.view()) : s));
      const s = mockServices.find((x) => x.slug === slug)!;
      core.emit("hostEvent", { cutex: { method: "cutex/services/changed", params: { reason: "updated", slug, service: s } } } as never);
      return s;
    },
    async deleteService(slug) {
      mockServices = mockServices.filter((s) => s.slug !== slug);
      core.emit("hostEvent", { cutex: { method: "cutex/services/changed", params: { reason: "removed", slug } } } as never);
    },
    async serviceAction(slug, action) {
      mockServices = mockServices.map((s) => s.slug === slug ? ({ ...s, ...(action === "archive" ? { archived: true, hidden: true, health: "stopped", stopped: true, stoppedIdle: false, stoppedIdleAt: null, idleWakeFailedAt: null } : action === "restore" ? { archived: false, hidden: false } : { health: action === "stop" ? "stopped" : "reachable", stopped: action === "stop", stoppedIdle: false, stoppedIdleAt: null, idleWakeFailedAt: null }) } as typeof s) : s);
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
    // cutex service-tiles (not under ?legacy): the tile answer, and its image through main (a data: URL).
    async serviceTile(slug) {
      if (core.legacy) return null;
      const s = mockServices.find((x) => x.slug === slug);
      if (!s) throw new Error(`service_not_found: no service \`${slug}\``);
      const tile = TILES[slug] ?? null;
      if (s.health === "stopped") return { tile: null, fetchedAt: null, error: { code: "service_stopped", message: "the service is stopped" }, source: null };
      return { tile: tile as never, fetchedAt: new Date().toISOString(), error: null, source: tile ? "service" : null };
    },
    async serviceTileImage(slug) {
      if (core.legacy || slug !== "audiobook") return null;
      if (coverCache === undefined) coverCache = bookCover();
      return coverCache ? { dataUrl: coverCache, etag: "santi-1" } : null;
    },
  };
}
