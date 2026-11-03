import type { BackgroundTerminal } from "../../../shared/ipc";
import { RequestCoalescer } from "./terminalsFetch";

export const EMPTY_TERMINALS: BackgroundTerminal[] = [];
type Entry = { rows: BackgroundTerminal[]; signature: string | null; requests: RequestCoalescer<BackgroundTerminal[]>; listeners: Set<() => void> };

/** One read snapshot per host/agent/thread/generation, shared by the chip, capsule and Shelf. */
export class TerminalRowsStore {
  private entries = new Map<string, Entry>();
  private entry(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { rows: EMPTY_TERMINALS, signature: null, requests: new RequestCoalescer(2_000), listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }
  get(key: string): BackgroundTerminal[] { return this.entry(key).rows; }
  subscribe(key: string, listener: () => void): () => void {
    const entry = this.entry(key);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); if (!entry.listeners.size && this.entries.get(key) === entry) this.entries.delete(key); };
  }
  invalidate(key: string): void { this.entry(key).requests = new RequestCoalescer(2_000); }
  async read(key: string, signature: string, fetch: () => Promise<BackgroundTerminal[]>): Promise<BackgroundTerminal[] | null> {
    const entry = this.entry(key);
    if (entry.signature !== signature) {
      entry.signature = signature;
      entry.requests = new RequestCoalescer(2_000);
    }
    const request = entry.requests;
    const rows = await request.get("list", fetch).catch(() => EMPTY_TERMINALS);
    if (this.entries.get(key) !== entry || entry.requests !== request) return null;
    if (rows !== entry.rows) {
      entry.rows = rows;
      for (const listener of entry.listeners) listener();
    }
    return rows;
  }
}

export const terminalRows = new TerminalRowsStore();
