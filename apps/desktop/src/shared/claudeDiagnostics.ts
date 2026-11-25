// claude-runtime-diagnostics-v1 (cutex r295, docs/management/claude-launch-diagnostics.md): a connected Claude
// runtime's startup warnings and the hooks running now. The session resource carries
// `runtime.claudeDiagnostics`; the host status channel replaces it whole with
// `cutex/session/claudeDiagnostics/changed` (non-durable, tagged with the runtime generation). It rides the
// background-work projection (shared/backgroundWork.ts), so it never invalidates sidebar reads.
import type { SessionClaudeDiagnostics } from "@cutex-desktop/protocol";

export const CLAUDE_DIAGNOSTICS_METHOD = "cutex/session/claudeDiagnostics/changed";
export const CLAUDE_DIAGNOSTICS_FEATURE = "claude-runtime-diagnostics-v1";
export type ClaudeDiagnostics = SessionClaudeDiagnostics;

/** Startup warnings the desktop words; anything else is ignored (the host allowlists the same set). */
export const CLAUDE_WARNINGS = ["configurationNotApplied", "managedHooksNotLoaded", "mcpConnectionFailed", "mcpAuthenticationRequired"] as const;
export type ClaudeWarning = (typeof CLAUDE_WARNINGS)[number];

/** Hook event names cutex passes on (others arrive as "other" and read as a plain 钩子). */
export const CLAUDE_HOOK_EVENTS = new Set([
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Notification", "Setup", "TaskCompleted", "TeammateIdle", "ConfigChange", "InstructionsLoaded",
]);

/** A hook is worth a line only once it has run this long (spec: at least 30 s). */
export const SLOW_HOOK_MS = 30_000;

export interface ClaudeDiagnosticsChange {
  cutexSessionId: string;
  runtimeGeneration: number;
  claudeDiagnostics: ClaudeDiagnostics | null;
}

const uint = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** A snapshot as the desktop keeps it: known warnings once each, well-formed hooks; null when not a snapshot. */
export function claudeDiagnosticsOf(value: unknown): ClaudeDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.warnings) || !Array.isArray(v.activeHooks)) return null;
  const warnings = CLAUDE_WARNINGS.filter((w) => (v.warnings as unknown[]).includes(w));
  const activeHooks = (v.activeHooks as unknown[]).slice(0, 64).flatMap((h) => {
    const hook = h as { event?: unknown; startedAtMs?: unknown } | null;
    return hook && typeof hook.event === "string" && uint(hook.startedAtMs) && hook.startedAtMs > 0 ? [{ event: hook.event, startedAtMs: hook.startedAtMs }] : [];
  });
  return { warnings, activeHooks };
}

export function claudeDiagnosticsChange(value: unknown): ClaudeDiagnosticsChange | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.cutexSessionId !== "string" || !p.cutexSessionId || !uint(p.runtimeGeneration)) return null;
  if (p.claudeDiagnostics === null) return { cutexSessionId: p.cutexSessionId, runtimeGeneration: p.runtimeGeneration, claudeDiagnostics: null };
  const claudeDiagnostics = claudeDiagnosticsOf(p.claudeDiagnostics);
  return claudeDiagnostics ? { cutexSessionId: p.cutexSessionId, runtimeGeneration: p.runtimeGeneration, claudeDiagnostics } : null;
}

export function sameClaudeDiagnostics(a: ClaudeDiagnostics | null | undefined, b: ClaudeDiagnostics | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.warnings.length === b.warnings.length && a.warnings.every((w, i) => w === b.warnings[i]) &&
    a.activeHooks.length === b.activeHooks.length && a.activeHooks.every((h, i) => h.event === b.activeHooks[i]!.event && h.startedAtMs === b.activeHooks[i]!.startedAtMs);
}

export interface SlowHook {
  /** The known hook event name, else null (shown as 钩子 / Hook). */
  event: string | null;
  /** How long it has run (clock skew capped to zero). */
  elapsedMs: number;
}

/** The longest-running hook that has run at least SLOW_HOOK_MS, else null. */
export function slowestHook(d: ClaudeDiagnostics | null | undefined, nowMs: number): SlowHook | null {
  if (!d?.activeHooks.length) return null;
  const oldest = d.activeHooks.reduce((a, b) => (b.startedAtMs < a.startedAtMs ? b : a));
  const elapsedMs = Math.max(0, nowMs - oldest.startedAtMs);
  if (elapsedMs < SLOW_HOOK_MS) return null;
  return { event: CLAUDE_HOOK_EVENTS.has(oldest.event) ? oldest.event : null, elapsedMs };
}

/** When the next hook crosses SLOW_HOOK_MS (ms from now), for a one-shot timer; null when none will. */
export function nextSlowHookIn(d: ClaudeDiagnostics | null | undefined, nowMs: number): number | null {
  const waits = (d?.activeHooks ?? []).map((h) => h.startedAtMs + SLOW_HOOK_MS - nowMs).filter((ms) => ms > 0);
  return waits.length ? Math.min(...waits) : null;
}

interface DiagRow { runtime?: { claudeDiagnostics?: ClaudeDiagnostics | null } | null }

/** The snapshot without any Claude diagnostics (a lost connection; the kept sidebar list): same object when none. */
export function withoutClaudeDiagnostics<T extends { active: DiagRow[]; retired: DiagRow[] }>(snapshot: T): T {
  const strip = <R extends DiagRow>(rows: R[]): R[] => {
    if (!rows.some((r) => r.runtime && "claudeDiagnostics" in r.runtime)) return rows;
    return rows.map((r) => {
      if (!r.runtime || !("claudeDiagnostics" in r.runtime)) return r;
      const { claudeDiagnostics: _gone, ...runtime } = r.runtime;
      return { ...r, runtime };
    });
  };
  const active = strip(snapshot.active), retired = strip(snapshot.retired);
  return active === snapshot.active && retired === snapshot.retired ? snapshot : { ...snapshot, active, retired };
}
