// cutex `approval-decided-by`: the facts this desktop sends with an owner decision (`client`), which
// cutex stores as the record's `decidedBy.client` and logs. Main adds app / version / device to the
// renderer's origin (where and how the button was activated); anything malformed sends nothing.
import type { ApprovalDecisionOrigin } from "./ipc";

const SURFACES: readonly string[] = ["inline", "page"] satisfies ApprovalDecisionOrigin["surface"][];
const INPUTS: readonly string[] = ["pointer", "touch", "keyboard", "unknown"] satisfies ApprovalDecisionOrigin["input"][];

/** `client` of a decision made on this desktop; undefined = send none (no / bad origin). */
export function approvalClientFacts(origin: unknown, version: string, device: string): Record<string, string> | undefined {
  if (!origin || typeof origin !== "object") return undefined;
  const { surface, input } = origin as { surface?: unknown; input?: unknown };
  if (typeof surface !== "string" || !SURFACES.includes(surface) || typeof input !== "string" || !INPUTS.includes(input)) return undefined;
  return { app: "cutex-desktop", version, device, surface, input };
}
