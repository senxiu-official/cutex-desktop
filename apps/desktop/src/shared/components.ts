// Optional components (cutex `components`, owner only; components spec v2 §4–§5). Wire types and
// readers come from @cutex-desktop/cutex-client (components.ts); main forwards the calls and returns
// refusals as values (`ComponentResult`), so the component card can explain each one.
export type {
  ComponentEvent,
  ComponentInstallFrom,
  ComponentOperation,
  ComponentOperationState,
  ComponentRefusalCode,
  ComponentsList,
  ComponentState,
  ComponentStatus,
  ComponentVersion,
} from "@cutex-desktop/cutex-client";
export { COMPONENT_NAME, COMPONENT_REFUSAL_CODES, COMPONENT_STATES, isComponentRefusalCode, isOperationRunning, COMPONENTS_FEATURE, COMPONENTS_UPDATED_EVENT, componentEventOf, readComponentOperation, readComponentsList } from "@cutex-desktop/cutex-client";
import type { ComponentOperation, UpgradeResult } from "@cutex-desktop/cutex-client";

/** An install / remove answer: the operation cutex started (null if it named none) or its refusal. */
export type ComponentResult = UpgradeResult<ComponentOperation | null>;
export type ComponentAction = "install" | "remove";
