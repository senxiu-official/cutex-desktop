// Optional components (cutex `components`, owner only; components spec v2 §4–§5). Wire types and
// readers come from @cutex-desktop/cutex-client (components.ts); main forwards the calls and returns
// refusals as values (`ComponentResult`), so the component card can explain each one.
export type {
  ComponentInstallFrom,
  ComponentOperationState,
  ComponentRefusalCode,
  ComponentState,
  ComponentVersion,
} from "@cutex-desktop/cutex-client";
// r269 contract (frozen, cutex cefe571a): gate names, wire types and readers live in ./componentIndex.ts.
export { COMPONENT_INDEX_CHECK_PATH, COMPONENT_INDEX_FEATURE, COMPONENT_SOURCE_ONLY, DESKTOP_REFUSAL_CODES, EXTERNAL_PATH_KEYS, sourceOnlyOffer, COMPONENTS_INDEX_UPDATED_EVENT, EXTERNAL_RUNTIME_ROOT_FEATURE, EXTERNAL_ISSUE_CODES, componentClearCli, componentConfigureBody, componentConfigureCli, componentIndexEventOf, externalReadiness, externalRuntimeOf, readComponentExternal, readComponentIndex, readOperationResult } from "./componentIndex";
export type { ComponentConfigureRequest, ComponentExternal, ComponentExternalIssue, ComponentIndexEvent, ComponentIndexRelease, ComponentIndexSource, ComponentIndexState, ComponentOperationResult, ExternalIssueCode, ExternalPathKey, ExternalPaths, ExternalReadiness } from "./componentIndex";
export { COMPONENT_NAME, COMPONENT_REFUSAL_CODES, COMPONENT_STATES, isComponentRefusalCode, isOperationRunning, COMPONENTS_FEATURE, COMPONENTS_UPDATED_EVENT } from "@cutex-desktop/cutex-client";
import {
  componentEventOf as readClientComponentEvent,
  readComponentOperation as readClientOperation,
  readComponentsList as readClientComponentsList,
  type ComponentEvent as ClientComponentEvent,
  type ComponentOperation as ClientComponentOperation,
  type ComponentsList as ClientComponentsList,
  type ComponentStatus as ClientComponentStatus,
  type UpgradeRefusal,
} from "@cutex-desktop/cutex-client";
import { readOperationResult, readR269Fields, type ComponentExternal, type ComponentIndexState, type ComponentOperationResult } from "./componentIndex";

/** A component operation; r269 adds actions `indexCheck` / `check` / `configure` and a terminal `result`. */
export interface ComponentOperation extends ClientComponentOperation {
  /** Terminal install / check / configure outcome (absent on old daemons and on index refreshes). */
  result?: ComponentOperationResult;
}

/** A component of `GET /v2/components`, plus the r269 fields (./componentIndex.ts). */
export interface ComponentStatus extends ClientComponentStatus {
  /** External-install readiness of the selected or a candidate adapter (hosts with EXTERNAL_RUNTIME_ROOT_FEATURE). */
  external?: ComponentExternal;
  /** The component's effective offers: signed index, manifest fallback or private kit (hosts with COMPONENT_INDEX_FEATURE). */
  index?: ComponentIndexState;
  /** r270 (ae9cced9): the full Node range of the legacy `dsh.node` / `kimi.node` detail (e.g. `>=24.9.0 <25`). */
  nodeRange?: string;
}

export interface ComponentsList extends Omit<ClientComponentsList, "components" | "operation"> {
  components: ComponentStatus[];
  operation: ComponentOperation | null;
  /** The index refresh (r269; top level, separate from `operation` so a refresh never hides install progress). Absent on old daemons. */
  indexOperation?: ComponentOperation | null;
}

export interface ComponentEvent extends Omit<ClientComponentEvent, "operation"> {
  operation: ComponentOperation | null;
}

/** The client reader, plus the r269 terminal `result` when present. */
export function readComponentOperation(value: unknown): ComponentOperation | null {
  const op = readClientOperation(value);
  const result = op && value && typeof value === "object" ? readOperationResult((value as { result?: unknown }).result) : undefined;
  return op && result ? { ...op, result } : op;
}

/** `cutex/components/updated` (the client reader, keeping the operation's `result`). */
export function componentEventOf(envelope: { cutex?: { method?: string; params?: unknown } } | null | undefined): ComponentEvent | null {
  const event = readClientComponentEvent(envelope);
  if (!event) return null;
  const params = envelope?.cutex?.params;
  return { ...event, operation: readComponentOperation(params && typeof params === "object" ? (params as { operation?: unknown }).operation : null) };
}

/** A `GET /v2/components` reply: the client reader, plus `external` / `index` per component, `indexOperation` and results. */
export function readComponentsList(value: unknown): ComponentsList {
  const list = readClientComponentsList(value);
  const top = value && typeof value === "object" ? (value as { components?: unknown; operation?: unknown; indexOperation?: unknown }) : {};
  const raw = Array.isArray(top.components) ? top.components : [];
  const byName = new Map(raw.flatMap((c) => (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string" ? [[(c as { name: string }).name, c] as const] : [])));
  return {
    ...list,
    components: list.components.map((c) => ({ ...c, ...readR269Fields(byName.get(c.name)) })),
    operation: readComponentOperation(top.operation),
    ...("indexOperation" in top ? { indexOperation: readComponentOperation(top.indexOperation) } : {}),
  };
}

/** A refusal of a component route; r270 `component_source_only` may name the verified version to request explicitly (sourceOnlyOffer). */
export interface ComponentRefusal extends UpgradeRefusal {
  offeredVersion?: string;
}

/** An install / remove / check / configure / index check answer: the operation cutex started (null if it named none) or its refusal. */
export type ComponentResult = { ok: true; value: ComponentOperation | null } | { ok: false; error: ComponentRefusal };
/** `check`: re-run the external-install probe (r269; only on hosts with EXTERNAL_RUNTIME_ROOT_FEATURE). */
export type ComponentAction = "install" | "remove" | "check";
