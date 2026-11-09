// What Project 视图 sees on the host feeds while the module runs (memory only, never persisted): plan
// updates of every agent (native `turn/plan/updated`; the 进度 rows — cutex keeps no history of them) and
// artifact publishes (the 发布 rows between two reads of the project's artifact list). Started by the
// module's activate; ends with it.
import { create } from "zustand";
import { ARTIFACT_PUBLISHED_EVENT } from "../../../../shared/artifactStore";
import { PROJECT_EVENTS_APPENDED } from "../../../../shared/projectEvents";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { bridge } from "../../bridge";
import { receivedAtOf } from "../../lib/liveEvents";
import { planSnapshotOf } from "../../lib/timeline";
import { sidebarOf, useApp } from "../../store";
import type { ModuleContext } from "../slots";
import { planSummary, type ArtifactEvent, type PlanEvent } from "./model";

/** Kept per host (newest last). */
export const LIVE_MAX = 300;

export interface HostLive {
  plans: PlanEvent[];
  artifacts: (ArtifactEvent & { projectId: string | null })[];
  /** Bumped by every artifact event (the project's list is read again). */
  artifactEpoch: number;
}

export const useProjectLive = create<{ byHost: Record<string, HostLive> }>(() => ({ byHost: {} }));

/** cutex `project-events`: the host-feed hint `cutex/projectEvents/appended`, a counter per `host\nproject` (正在进行 re-reads on it). */
export const useProjectAppended = create<{ epochs: Record<string, number> }>(() => ({ epochs: {} }));

const EMPTY: HostLive = { plans: [], artifacts: [], artifactEpoch: 0 };
export const hostLive = (byHost: Record<string, HostLive>, hostId: string): HostLive => byHost[hostId] ?? EMPTY;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Last plan signature per host + agent: an unchanged re-send is not a new row. */
const lastPlan = new Map<string, string>();

export function recordEnvelope(hostId: string, envelope: EventEnvelope, now = Date.now()): void {
  const at = receivedAtOf(envelope) ?? now;
  const plan = planSnapshotOf(envelope);
  if (plan) {
    const id = envelope.cutexSessionId;
    // A sub-agent's plan (another thread than the agent's own) is not the agent's progress.
    const bound = sidebarOf(useApp.getState(), hostId)?.active.find((s) => s.cutexSessionId === id)?.native.threadId ?? null;
    if (plan.threadId && bound && plan.threadId !== bound) return;
    const summary = planSummary(plan);
    if (!summary) return;
    const key = `${hostId}\n${id}`;
    const sig = plan.steps.map((s) => `${s.status}:${s.step}`).join("\n");
    if (lastPlan.get(key) === sig) return;
    lastPlan.set(key, sig);
    push(hostId, (h) => ({ ...h, plans: [...h.plans, { sessionId: id, at, ...summary }].slice(-LIVE_MAX) }));
    return;
  }
  const cutex = (envelope as { cutex?: { method?: unknown; params?: unknown } }).cutex;
  if (cutex?.method === PROJECT_EVENTS_APPENDED && isRecord(cutex.params) && typeof cutex.params.projectId === "string") {
    const key = `${hostId}\n${cutex.params.projectId}`;
    useProjectAppended.setState((s) => ({ epochs: { ...s.epochs, [key]: (s.epochs[key] ?? 0) + 1 } }));
    return;
  }
  if (!cutex || typeof cutex.method !== "string" || !cutex.method.startsWith("cutex/artifact/")) return;
  const p = cutex.params;
  if (cutex.method === ARTIFACT_PUBLISHED_EVENT && isRecord(p) && typeof p.artifactId === "string" && typeof p.version === "number" && typeof p.name === "string") {
    const producer = isRecord(p.producer) ? p.producer : {};
    const scope = isRecord(p.scope) ? p.scope : {};
    const event = {
      artifactId: p.artifactId,
      version: p.version,
      name: p.name.slice(0, 200),
      at,
      sessionId: producer.kind === "agent" && typeof producer.sessionId === "string" ? producer.sessionId : null,
      producerName: typeof producer.displayName === "string" ? producer.displayName : null,
      projectId: scope.kind === "project" && typeof scope.id === "string" ? scope.id : null,
    };
    push(hostId, (h) => ({ ...h, artifacts: [...h.artifacts, event].slice(-LIVE_MAX), artifactEpoch: h.artifactEpoch + 1 }));
    return;
  }
  push(hostId, (h) => ({ ...h, artifactEpoch: h.artifactEpoch + 1 }));
}

function push(hostId: string, f: (h: HostLive) => HostLive): void {
  useProjectLive.setState((s) => ({ byHost: { ...s.byHost, [hostId]: f(hostLive(s.byHost, hostId)) } }));
}

export function startLive(ctx: ModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => recordEnvelope(hostId, envelope));
  ctx.signal.addEventListener(
    "abort",
    () => {
      off?.();
      lastPlan.clear();
      useProjectLive.setState({ byHost: {} });
      useProjectAppended.setState({ epochs: {} });
    },
    { once: true },
  );
}
