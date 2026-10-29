// Image-heavy history guidance (docs/design/027 §later): cutex reports how many media payloads it
// replaced; the desktop never scans the conversation itself.

export const IMAGE_HISTORY_HINT_THRESHOLD = 20;

export function imageHeavyHistory(mediaRefs: number | null | undefined): boolean {
  return typeof mediaRefs === "number" && mediaRefs > IMAGE_HISTORY_HINT_THRESHOLD;
}

export function migrateImageHistoryHintDone(value: unknown): string[] {
  return [...new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [])].slice(0, 1000);
}

export function dismissImageHistoryHint(done: readonly string[], sessionId: string): string[] {
  return done.includes(sessionId) ? [...done] : [...done, sessionId].slice(-1000);
}
