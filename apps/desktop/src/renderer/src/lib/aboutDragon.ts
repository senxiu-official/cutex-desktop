// Size of the Settings → 关于 dragon (AboutDragon): kept while Settings is open (switching pages keeps
// it), back to the small icon once Settings is left (SettingsNav unmounts).
export const DRAGON_BASE = 96;

let size = DRAGON_BASE;

export function dragonSize(): number {
  return size;
}

export function setDragonSize(next: number): void {
  size = next;
}

export function resetDragonSize(): void {
  size = DRAGON_BASE;
}
