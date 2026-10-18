// 升级运行时 for a Claude agent (cutex `claude-runtime-repin`, owner Q26): move the agent to the host's
// selected Claude runtime, the desktop form of `cutex human claude repin <id>`. Wire shapes of
// `GET /v2/sessions/{id}/claude-runtime` and `POST /v2/sessions/{id}/claude-runtime/repin` (cutex schema
// export `claude-runtime`). An offline agent moves at once; a running one is never restarted by cutex:
// the change waits for its next fresh runtime start (`restartRequired`).

import type { HostClaudeRuntime, SessionClaudeRuntime } from "@cutex-desktop/protocol";
import type { CutexRefusal } from "./ipc";

export const CLAUDE_REPIN_FEATURE = "claude-runtime-repin";
/**
 * cutex `session-claude-runtime`: Claude session resources carry `runtime.claudeRuntime` and
 * `GET /v2/sessions` the host's `claudeRuntime.selectedRelease`, so the menu decides without a request.
 */
export const SESSION_CLAUDE_RUNTIME_FEATURE = "session-claude-runtime";

export type ClaudeRepinOutcomeKind = "applied" | "deferred" | "unchanged" | "skipped";

export interface ClaudeRepinOutcome {
  outcome: ClaudeRepinOutcomeKind;
  /** Why it was skipped (a refusal), or `online: applies at the next start`. */
  reason: string | null;
  /** deferred: the running runtime keeps the old pin until it is restarted. */
  restartRequired: boolean;
}

export interface ClaudeRuntimeView {
  cutexSessionId: string;
  name: string;
  /** Release labels such as `claude-r19`, never paths. */
  current: { release: string; missing: boolean };
  pending: { release: string; requestedAt: string } | null;
  selected: { release: string } | null;
  selectedError: string | null;
  direction: "upgrade" | "downgrade" | "change" | "none";
  upgradeAvailable: boolean;
  dryRun: ClaudeRepinOutcome | null;
}

export interface ClaudeRepinDone {
  result: ClaudeRepinOutcome & { previous: string; target: string };
  runtime: ClaudeRuntimeView;
}

export type ClaudeRepinResult = { ok: true; done: ClaudeRepinDone } | { ok: false; error: CutexRefusal };

/** What 升级运行时 offers for this view: from → to, and whether cutex would refuse (null = nothing to offer). */
export interface ClaudeRepinOffer {
  from: string;
  to: string;
  /** The agent runs: the change applies at its next runtime start. */
  restartRequired: boolean;
  /** cutex would refuse (dry run `skipped`): the reason, shown instead of a confirmation. */
  refusal: string | null;
}

export function repinOffer(view: ClaudeRuntimeView | null | undefined): ClaudeRepinOffer | null {
  if (!view || !view.upgradeAvailable || !view.selected || !view.dryRun) return null;
  const { outcome, reason, restartRequired } = view.dryRun;
  if (outcome === "unchanged") return null;
  return {
    from: view.current.release,
    to: view.selected.release,
    restartRequired: outcome === "deferred" || restartRequired,
    refusal: outcome === "skipped" ? (reason ?? "") : null,
  };
}

/** The number of a release label (`claude-r19` → 19); null for another label. */
export function releaseNumber(release: string): number | null {
  const m = /^claude-r(\d+)/.exec(release);
  return m ? Number(m[1]) : null;
}

/**
 * What the agent menu offers from the agent list alone (cutex `session-claude-runtime`): an upgrade when
 * the host's selected release is a higher number than the agent's pin and not already pending. undefined:
 * the list does not say (older cutex) — the caller falls back to the per-agent view.
 */
export function sessionRepinOffer(
  pin: SessionClaudeRuntime | null | undefined,
  host: HostClaudeRuntime | null | undefined,
): { from: string; to: string } | null | undefined {
  if (!pin || !host) return undefined;
  const to = host.selectedRelease;
  if (to === null || pin.pendingRelease === to) return null;
  const selected = releaseNumber(to);
  const current = releaseNumber(pin.release);
  if (selected === null || current === null || selected <= current) return null;
  return { from: pin.release, to };
}
