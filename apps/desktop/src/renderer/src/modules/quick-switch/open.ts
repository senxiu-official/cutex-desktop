// Runs an OpenPlan (model.ts planOpen) against the module services. The calls are injected so the
// dispatch is unit-tested without the shell (test/quickSwitch.test.ts).
import type { Json } from "../types";
import type { WorkspaceOpenMode, WorkspaceRef } from "../../lib/workspaces";
import type { CutexRef, PaneOpenOptions, PaneOpenResult, RefOpenResult } from "../slots";
import type { OpenPlan } from "./model";

export interface OpenDeps {
  panesOpen(kind: string, params: Json, opts: PaneOpenOptions): PaneOpenResult;
  refsOpen(ref: CutexRef): Promise<RefOpenResult>;
  openServiceExternal(slug: string, hostId: string): Promise<void>;
  /** False: the page is gone. */
  openShelfPage(pageId: string): boolean;
  /** lib/workspaces openRef (beside for services / artifacts / pages); false = nothing opened. */
  openRef(ref: WorkspaceRef, mode: WorkspaceOpenMode, opts: { pageParams?: Record<string, string> }): Promise<boolean>;
}

/** Done, or why it could not open (a `side.reason.*` / ref reason id, "not-opened", or an error message). */
export type OpenOutcome = { ok: true } | { ok: false; reason: string };

export async function runOpen(plan: OpenPlan, deps: OpenDeps): Promise<OpenOutcome> {
  try {
    switch (plan.via) {
      case "panes": {
        const result = deps.panesOpen(plan.kind, plan.params, plan.beside ? { beside: true, focus: true } : { focus: true });
        if (result.status === "opened") return { ok: true };
        if (plan.fallback) return runOpen(plan.fallback, deps);
        return { ok: false, reason: result.status === "stale" ? "stale" : result.reason };
      }
      case "serviceExternal":
        await deps.openServiceExternal(plan.slug, plan.hostId);
        return { ok: true };
      case "ref": {
        const result = await deps.refsOpen(plan.ref);
        return result.status === "opened" ? { ok: true } : { ok: false, reason: result.status === "unavailable" ? result.reason : result.status };
      }
      case "run":
        await plan.run();
        return { ok: true };
      case "shelfPage":
        return deps.openShelfPage(plan.pageId) ? { ok: true } : { ok: false, reason: "gone" };
      case "workspace":
        return (await deps.openRef(plan.ref, plan.mode, plan.pageParams ? { pageParams: plan.pageParams } : {})) ? { ok: true } : { ok: false, reason: "not-opened" };
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
