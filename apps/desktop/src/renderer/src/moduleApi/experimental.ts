// The app's side of `@cutex-desktop/module-api/experimental` (docs/desktop-modules.md §30). The package's item types are
// loose and carry no promises, so nothing here is checked against the app's slots beyond the host's own validation.
import type { ItemId, Json, ModuleContext, ModuleDefinition } from "@cutex-desktop/module-api";
import type { ExperimentalDaemonApi, ExperimentalItem, ExperimentalSlotId } from "@cutex-desktop/module-api/experimental";
import type { ModuleContext as AppModuleContext } from "../modules/slots";
import { services as appServices } from "../modules/app";

export function defineExperimentalModule(definition: ModuleDefinition & { experimental?: { readonly [S in ExperimentalSlotId]?: readonly ExperimentalItem[] } }): ModuleDefinition {
  const { experimental, ...rest } = definition;
  return { ...rest, contributes: { ...rest.contributes, ...experimental } as ModuleDefinition["contributes"] };
}

export function contributeExperimental(context: ModuleContext, slot: ExperimentalSlotId, item: ExperimentalItem): () => void {
  return (context as unknown as { contribute(slot: string, item: unknown): () => void }).contribute(slot, item);
}

export function daemonFor(context: ModuleContext, hostId: string): ExperimentalDaemonApi {
  return (context as unknown as AppModuleContext).services.daemonFor(hostId) as unknown as ExperimentalDaemonApi;
}

export const side = {
  open: (kind: ItemId, params?: Json, options?: Record<string, unknown>) => appServices.side.open(kind, params, options) as { status: string },
  close: (instanceId: string) => appServices.side.close(instanceId),
  list: (kind: ItemId) => appServices.side.list(kind).map((i) => ({ id: i.id, kind: i.kind, state: i.state, pinned: i.pinned })),
};

export function focusTurn(hostId: string, sessionId: string, turnId: string): Promise<{ status: string }> {
  return appServices.timeline.focusTurn(hostId, sessionId, turnId);
}
