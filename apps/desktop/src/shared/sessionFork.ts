/** Additive cutex session-fork-profile contract. */
export const FORK_PROFILE_FEATURE = "session-fork-profile";
export interface SessionForkRequest { afterTurnId?: string | null; name?: string; profile?: string }
export interface SessionForkWarning {
  code: string;
  message: string;
  runtimeState?: string;
  restartError?: string | null;
}
export interface SessionForkResult {
  cutexSessionId: string;
  historyBytes?: number | null;
  coldCache?: boolean;
  profile?: string | null;
  sourceProfile?: string | null;
  forkBoundaryNote?: string;
  warnings?: SessionForkWarning[];
}

/** Optional presentation fields must never invalidate a committed fork. */
export function readForkWarnings(value: unknown): SessionForkWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((warning: unknown): SessionForkWarning[] => {
    if (typeof warning === "string") return [{ code: "legacy", message: warning }];
    if (!warning || typeof warning !== "object" || Array.isArray(warning)) return [];
    const w = warning as Record<string, unknown>;
    if (typeof w.code !== "string" || !w.code) return [];
    return [{ code: w.code, message: typeof w.message === "string" ? w.message : "",
      ...(typeof w.runtimeState === "string" ? { runtimeState: w.runtimeState } : {}),
      ...(typeof w.restartError === "string" || w.restartError === null ? { restartError: w.restartError } : {}),
    }];
  });
}

export const FORK_PREVIEW_FEATURE = "session-fork-preview";
export interface SessionForkPreviewRequest { afterTurnId?: string | null; profile?: string }
export interface ForkRefusal { code: string; message: string }
export interface SessionForkTarget {
  id: string; name: string; cliKind: string; providerFamily: string;
  eligible: boolean; reason: ForkRefusal | null;
}
export interface SessionForkPreview {
  contractVersion: 2;
  cutexSessionId: string;
  afterTurnId: string | null;
  profile: string | null;
  sourceProfile: string | null;
  sourceCliKind: "codex" | "claude";
  sourceProviderFamily: string | null;
  targets: SessionForkTarget[];
  eligible: boolean;
  reason: ForkRefusal | null;
  historyBytes: number | null;
  historyBytesEstimate: "upperBound" | "unavailable";
  historyBytesMeaning: string;
  coldCache: boolean | null;
  boundaryNote: string;
}
