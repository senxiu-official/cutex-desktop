import type { OwnerJoinDelegation } from "@cutex-desktop/protocol";

/** Main validates the narrow IPC shape; daemon validates the live attempt and lease. */
export function ownerJoinIntent(value: unknown): OwnerJoinDelegation | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad owner join intent");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 4 || typeof v.askId !== "string" || !v.askId || v.askId.length > 200 ||
      typeof v.expectedTurnId !== "string" || !v.expectedTurnId || v.expectedTurnId.length > 200 ||
      !Number.isSafeInteger(v.attempt) || (v.attempt as number) < 1 || (v.attempt as number) > 0xffffffff ||
      !Number.isSafeInteger(v.runtimeGeneration) || (v.runtimeGeneration as number) < 1) throw new Error("bad owner join intent");
  return { askId: v.askId, attempt: v.attempt as number, expectedTurnId: v.expectedTurnId, runtimeGeneration: v.runtimeGeneration as number };
}
