// The desktop's localStorage is full (storage audit 2026-10-23: layouts and unsent steers failed to save without a
// word). Writers report it here; the owner is told once per run, in plain words (the notifier is set by the store).
let told = false;
let notifier: (() => void) | null = null;

/** Who tells the owner (lib/sideLayoutStore). */
export function setStorageFullNotifier(fn: (() => void) | null): void {
  notifier = fn;
}

/** A write failed because storage is full: say so once per run. */
export function reportStorageFull(): void {
  if (told || !notifier) return;
  told = true;
  const tell = notifier;
  setTimeout(() => tell(), 0);
}

/** Tests: forget that the owner was told. */
export function resetStorageFullNotice(): void {
  told = false;
}
