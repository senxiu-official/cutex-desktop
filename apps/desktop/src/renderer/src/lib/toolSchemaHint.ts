// 工具参数严格模式 hint (owner 2026-10-25): a turn that failed because the provider refused a tool's parameter
// schema (Google's function declarations: no mixed / typeless / nullable enums, a closed set of schema keys) gets,
// inside its error row, 「打开「工具参数严格模式」后重试」 — whatever the Profile, as long as it has not turned strict
// mode (cutex `profile-tool-schema-compat`) on. It stays with the error (no timeout); 「不再提示」 is remembered per
// host + Profile on this device.
import { useSyncExternalStore } from "react";

/**
 * The provider refused a tool's parameter schema. Google's wording (cutex src/profiles/gemini.rs: 「Google does
 * not support this JSON Schema enum」) and the Gemini API's INVALID_ARGUMENT field paths into a function
 * declaration's parameters (`tools[0].function_declarations[3].parameters…`, OpenAI-compatible relays pass them
 * through), e.g. 「Unknown name "additionalProperties" at 'tools[0].function_declarations[0].parameters'」,
 * 「….parameters.properties[mode].enum: only allowed for STRING type」 or 「….items: missing field」.
 */
export function isToolSchemaRejection(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /does not support this JSON Schema/i.test(text) ||
    /function_?declarations\[\d+\]\.parameters/i.test(text) ||
    /\benum\b[^\n]{0,40}only allowed for STRING type/i.test(text)
  );
}

/** cutex r261's code for it on the turn error (`turn.error.cutexCode`); the text match covers older cutex. */
export const TOOL_SCHEMA_REJECTED = "tool_schema_rejected";

export function turnRefusedToolSchema(turn: { error?: string | null; errorCode?: string | null }): boolean {
  return turn.errorCode === TOOL_SCHEMA_REJECTED || isToolSchemaRejection(turn.error);
}

/** cutex: the per-Profile `toolSchemaCompat` switch (off | strict). */
export const PROFILE_TOOL_SCHEMA_COMPAT_FEATURE = "profile-tool-schema-compat";

const KEY = "cutex-desktop.toolSchemaHint.dismissed.v1";
const listeners = new Set<() => void>();
let dismissed: ReadonlySet<string> = read();

function read(): ReadonlySet<string> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

const keyOf = (hostId: string, profile: string) => `${hostId}\n${profile}`;

/** 「不再提示」 for this host's Profile (this device; later errors show only their own text). */
export function dismissToolSchemaHint(hostId: string, profile: string): void {
  const next = new Set(dismissed);
  next.add(keyOf(hostId, profile));
  dismissed = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // Storage full / unavailable: dismissed for this run only.
  }
  for (const listener of listeners) listener();
}

export function useToolSchemaHintDismissed(hostId: string, profile: string | null): boolean {
  const set = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dismissed,
  );
  return !!profile && set.has(keyOf(hostId, profile));
}
