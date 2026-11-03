import { create } from "zustand";
import { debugError, type DebugEntry, type DebugState } from "../../../shared/debug";
export const useDebug = create<{ state: DebugState; errors: DebugEntry[]; reactReady: boolean }>(() => ({
  state: { enabled: false, since: null, frames: 0, bytes: 0, windows: 0, lastBundle: null, error: null }, errors: [], reactReady: false,
}));
let report: ((entries: DebugEntry[]) => void) | null = null;
export function setDebugReporter(value: typeof report): void { report = value; }
export function receiveDebugError(entry: DebugEntry): void {
  if (!useDebug.getState().state.enabled) return;
  const clean = (text = "") => text.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "");
  const prior = useDebug.getState().errors.find(e => Math.abs(e.time - entry.time) < 1000 && clean(e.message) === clean(entry.message));
  if (prior && (prior.code || !entry.code)) return;
  useDebug.setState(s => ({ errors: [...s.errors.filter(e => e !== prior), entry].slice(-3) }));
}
export function captureDebugError(error: unknown, source: string): void {
  if (!useDebug.getState().state.enabled) return;
  const entry = debugError(error, source);
  receiveDebugError(entry); report?.([entry]);
}

const flushers = new Set<() => Promise<void>>();
export function registerDebugFlush(flush: () => Promise<void>): () => void { flushers.add(flush); return () => { flushers.delete(flush); }; }
export async function flushDebugReports(): Promise<void> { await Promise.all([...flushers].map(f => f())); }
