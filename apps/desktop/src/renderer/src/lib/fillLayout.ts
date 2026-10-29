// Always-filled work row: column positions own their proportions, not the selected agents.
// Minimums constrain the view only; resizing a window never overwrites the owner's ratios.
export interface FillRatios {
  columns: number[];
  remembered: number[];
  shelves: { left: number; right: number }[];
}
export const emptyFillRatios = (): FillRatios => ({ columns: [1], remembered: [], shelves: [] });
const fraction = (n: unknown, fallback: number): number => typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
export function parseFillRatios(raw: unknown): FillRatios {
  const v = raw && typeof raw === "object" ? raw as Partial<FillRatios> : {};
  const columns = Array.isArray(v.columns) ? v.columns.slice(0, 3).map(n => fraction(n, 1)) : [1];
  const sum = columns.reduce((a, b) => a + b, 0);
  return {
    columns: sum ? columns.map(n => n / sum) : [1],
    remembered: Array.isArray(v.remembered) ? v.remembered.slice(0, 3).map(n => fraction(n, 0)) : [],
    shelves: Array.isArray(v.shelves) ? v.shelves.slice(0, 3).map(s => ({ left: fraction(s?.left, .3), right: fraction(s?.right, .4) })) : [],
  };
}
export function fillColumnCount(value: FillRatios, count: number): FillRatios {
  count = Math.max(1, Math.min(3, count));
  if (value.columns.length === count) return value;
  const remembered = [...value.remembered];
  let columns = [...value.columns];
  while (columns.length > count) {
    const removed = columns.pop()!;
    remembered[columns.length] = removed;
    const remaining = columns.reduce((a, b) => a + b, 0);
    columns = columns.map(w => remaining ? w / remaining : 1 / columns.length);
  }
  while (columns.length < count) {
    const share = fraction(remembered[columns.length], 1 / (columns.length + 1));
    columns = [...columns.map(w => w * (1 - share)), share];
  }
  return { ...value, columns, remembered };
}
/** Water-fill with minimums, conserving every pixel; impossibly small rows scale their floors. */
export function fillWidths(room: number, weights: readonly number[], mins: readonly number[]): number[] {
  room = Math.max(0, room);
  const floor = mins.reduce((a, b) => a + b, 0);
  if (floor >= room) return mins.map(w => floor ? room * w / floor : 0);
  const out = weights.map(() => 0);
  let pending = weights.map((_, i) => i);
  let available = room;
  while (pending.length) {
    const sum = pending.reduce((s, i) => s + weights[i]!, 0);
    const held = pending.filter(i => available * weights[i]! / sum < mins[i]!);
    if (!held.length) {
      for (const i of pending) out[i] = available * weights[i]! / sum;
      break;
    }
    for (const i of held) { out[i] = mins[i]!; available -= out[i]!; }
    pending = pending.filter(i => !held.includes(i));
  }
  return out;
}
