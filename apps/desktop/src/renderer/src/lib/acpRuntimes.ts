// The ACP runtimes cutex runs behind its Codex-subset adapter: DSH (r265) and Kimi Code (r266, docs/design/049).
// Both behave the same in the desktop — explicit feature support for structural actions, no same-turn steer unless
// declared, no Codex sandbox / approval presets, an optional host component, a capability that says the host can
// start them — so the desktop branches on "ACP runtime" and reads the per-runtime facts from this one table.
// Pure (no React, no store) so it is unit-tested.
import type { MessageKey } from "../i18n";
import { DSH_NOT_RECOMMENDED } from "./dshNotice";
import { KIMI_NOT_RECOMMENDED } from "./kimiNotice";

export const ACP_RUNTIMES = ["dsh", "kimi"] as const;
export type AcpRuntime = (typeof ACP_RUNTIMES)[number];

export interface AcpRuntimeInfo {
  /** `native.schema.protocol` of its sessions. */
  protocol: string;
  /** `runtime.backend` of its sessions. */
  backend: string;
  /** cutex capability: the host can start it (its optional component is installed). */
  capability: string;
  /** A capability that says the host knows the runtime even before its component is installed (so the runtime
   *  page can offer the install); null: the group shows only once `capability` is there (DSH, r265). */
  known: string | null;
  /** Optional host component (components spec v2). */
  component: string;
  /** Display name: the conversation tag, variant rows, runtime card. */
  label: string;
  /** The 「暂不建议使用」 label (lib/dshNotice, lib/kimiNotice): one switch per runtime. */
  notRecommended: boolean;
  /** The sentence behind the label (its title / the runtime card line). */
  notRecommendedText: MessageKey;
}

export const ACP_RUNTIME_INFO: Record<AcpRuntime, AcpRuntimeInfo> = {
  dsh: { protocol: "dsh-acp-subset", backend: "dsh", capability: "dsh-runtime", known: null, component: "dsh-runtime", label: "DSH", notRecommended: DSH_NOT_RECOMMENDED, notRecommendedText: "dsh.notRecommended" },
  kimi: { protocol: "kimi-acp-subset", backend: "kimi", capability: "kimi-runtime", known: "kimi-runtime-profiles", component: "kimi-runtime", label: "Kimi", notRecommended: KIMI_NOT_RECOMMENDED, notRecommendedText: "kimi.notRecommended" },
};

export function isAcpRuntime(runtime: unknown): runtime is AcpRuntime {
  return typeof runtime === "string" && (ACP_RUNTIMES as readonly string[]).includes(runtime);
}

/** The ACP runtime of a session's protocol / backend / bound runtime, or null. */
export function acpRuntimeOf(s: { protocol?: unknown; backend?: unknown; bound?: unknown }): AcpRuntime | null {
  for (const r of ACP_RUNTIMES) {
    const info = ACP_RUNTIME_INFO[r];
    if (s.protocol === info.protocol || s.backend === info.backend || s.bound === r) return r;
  }
  return null;
}

/** The host can start new agents on this runtime (its capability is there). Never filters stored data. */
export function acpRuntimeAvailable(runtime: AcpRuntime, features: ReadonlySet<string>): boolean {
  return features.has(ACP_RUNTIME_INFO[runtime].capability);
}

/** Settings → 运行时 shows the runtime's group: installed, or known to the host and installable there. */
export function acpRuntimeShown(runtime: AcpRuntime, features: ReadonlySet<string>): boolean {
  const info = ACP_RUNTIME_INFO[runtime];
  return features.has(info.capability) || (info.known !== null && features.has(info.known) && features.has("components"));
}

/** Whether the runtime still carries 「暂不建议使用」 (the per-runtime switch). */
export function acpNotRecommended(runtime: string): boolean {
  return isAcpRuntime(runtime) && ACP_RUNTIME_INFO[runtime].notRecommended;
}
