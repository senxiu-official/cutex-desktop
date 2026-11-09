// @cutex-desktop/module-api/experimental: no promises. These names and shapes may change in any app update, and a module
// that imports this entry is marked "may stop working after an app update" in Settings → Modules. Each change gets a line
// in docs/module-authoring.md. The item shapes are loose on purpose; docs/desktop-modules.md describes each slot.
import type { ItemId, Json, SlotItemBase } from "./types";
import type { ModuleContext, ModuleDefinition } from "./services";

/** Slots that have no stable shape yet. */
export type ExperimentalSlotId =
  | "side.component"
  | "pane.kind"
  | "pane.desktop"
  | "timeline.received"
  | "timeline.tool"
  | "timeline.turnAttachment"
  | "timeline.intro"
  | "conversation.gutter"
  | "customize.region"
  | "window.search";

export type ExperimentalItem = SlotItemBase & { readonly [field: string]: unknown };

/** The whole daemon API of one connected host. Untyped here. A call after your module stopped is refused. */
export type ExperimentalDaemonApi = { readonly [method: string]: (...args: never[]) => Promise<unknown> };

/** `defineModule` with experimental slots as well. */
export declare function defineExperimentalModule(definition: ModuleDefinition & { experimental?: { readonly [S in ExperimentalSlotId]?: readonly ExperimentalItem[] } }): ModuleDefinition;

/** Adds an item to an experimental slot while the module runs. */
export declare function contributeExperimental(context: ModuleContext, slot: ExperimentalSlotId, item: ExperimentalItem): () => void;

/** Daemon calls bound to one connected host's current connection. */
export declare function daemonFor(context: ModuleContext, hostId: string): ExperimentalDaemonApi;

/** The right side and the tool area. */
export declare const side: {
  open(kind: ItemId, params?: Json, options?: Record<string, unknown>): { status: string };
  close(instanceId: string): void;
  list(kind: ItemId): readonly { id: string; kind: ItemId; state: Json; pinned: boolean }[];
};

/** Jump to a turn in the timeline. */
export declare function focusTurn(hostId: string, sessionId: string, turnId: string): Promise<{ status: string }>;
