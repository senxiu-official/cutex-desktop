// cutex lists archived sessions (`GET /v2/sessions?lifecycle=retired`) as a reduced, archive-only
// projection: no effectiveNextLaunch / configuredProfile / launchedProfile, no native.schema, no
// note / avatar / formal name, and a runtime with only backend / status / generation / agent id.
// Views treat every SessionResource alike (a just-archived agent stays selected), so the missing
// fields are filled with their "nothing known" values once, where the snapshot comes in.
import type { SessionResource } from "@cutex-desktop/protocol";

export function withRetiredDefaults(s: SessionResource): SessionResource {
  const r = s as Partial<SessionResource> & SessionResource;
  const runtime = (r.runtime ?? {}) as Partial<SessionResource["runtime"]>;
  return {
    ...r,
    formalAgentName: r.formalAgentName ?? null,
    displayNameOverride: r.displayNameOverride ?? null,
    note: r.note ?? null,
    avatar: r.avatar ?? null,
    configuredProfile: r.configuredProfile ?? r.profile ?? null,
    launchedProfile: r.launchedProfile ?? null,
    effectiveNextLaunch: r.effectiveNextLaunch ?? { profile: r.profile ?? null, source: "retired" },
    groups: r.groups ?? [],
    visible: r.visible ?? true,
    native: { threadId: r.native?.threadId ?? null, schema: r.native?.schema ?? null },
    runtime: {
      ...runtime,
      backend: runtime.backend ?? "",
      status: runtime.status ?? "offline",
      appServerConnected: runtime.appServerConnected ?? false,
      runtimeGeneration: runtime.runtimeGeneration ?? 0,
      runtimeAgentId: runtime.runtimeAgentId ?? null,
      activeTurnId: runtime.activeTurnId ?? null,
      activeTurnObservedAt: runtime.activeTurnObservedAt ?? null,
      threadStatus: runtime.threadStatus ?? null,
      threadSettings: runtime.threadSettings ?? null,
      requiresVisibleTerminal: runtime.requiresVisibleTerminal ?? false,
      tuiAttached: runtime.tuiAttached ?? false,
      lastEventAt: runtime.lastEventAt ?? null,
      lastError: runtime.lastError ?? null,
    } as SessionResource["runtime"],
    runtimeDefaults: r.runtimeDefaults ?? null,
    activity: r.activity ?? null,
    focus: r.focus ?? null,
    management: r.management ?? null,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}
