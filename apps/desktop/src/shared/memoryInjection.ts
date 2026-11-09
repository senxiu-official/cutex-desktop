// Per-agent project-memory injection (cutex `agent-memory-injection`, owner 2026-11-06): off = the agent gets
// no project memory instructions, index or idle reminders (for independent review). Set at creation
// (`POST /v2/human/agents` `memoryInjection`), changed later with `cutex/session/defaults/update`
// `{patch: {memoryInjection}}`; it applies at the agent's next launch. Default (absent) = on.

export const MEMORY_INJECTION_FEATURE = "agent-memory-injection";

/** The agent's switch as cutex projects it (top level, else runtimeDefaults); absent = on. */
export function memoryInjectionOf(session: { memoryInjection?: unknown; runtimeDefaults?: unknown } | null | undefined): boolean {
  if (typeof session?.memoryInjection === "boolean") return session.memoryInjection;
  const defaults = session?.runtimeDefaults as { memoryInjection?: unknown } | null | undefined;
  return typeof defaults?.memoryInjection === "boolean" ? defaults.memoryInjection : true;
}
