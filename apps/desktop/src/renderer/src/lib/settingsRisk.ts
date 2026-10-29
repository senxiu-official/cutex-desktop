/** An approval belongs to one continuous target/input/state lifetime, including A→B→A. */
export class SettingsRiskGate {
  private signature = "";
  private generation = 0;
  update(signature: string): void {
    if (signature !== this.signature) { this.signature = signature; this.invalidate(); }
  }
  invalidate(): void { this.generation += 1; }
  capture(): () => boolean {
    const generation = this.generation;
    return () => generation === this.generation;
  }
}

export function settingsRiskFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

/** Typed confirmations deliberately require exact equality, including spaces. */
export async function confirmSettingsRisk(
  target: string,
  prompt: () => Promise<string | null>,
  valid: () => boolean,
): Promise<"confirmed" | "cancelled" | "changed" | "mismatch"> {
  if (!valid()) return "changed";
  const answer = await prompt();
  if (!valid()) return "changed";
  if (answer === null) return "cancelled";
  return target.length > 0 && answer === target ? "confirmed" : "mismatch";
}

/** Newly allowed set members are a widening; removal and equivalent reordering are not. */
export function addedSettingsTargets(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before.map(value => value.trim().toLowerCase()));
  return after.filter(value => !known.has(value.trim().toLowerCase()));
}

function listenScope(entry: string, defaultPort: string): { host: string; port: string } {
  const text = entry.trim().toLowerCase();
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  if (bracket) return { host: bracket[1]!, port: bracket[2] ?? defaultPort };
  const socket = /^([^:]+):(\d+)$/.exec(text);
  return socket ? { host: socket[1]!, port: socket[2]! } : { host: text, port: defaultPort };
}

/** Existing wildcards cover narrower additions on the same port. Loopback-only
 * additions do not widen network access. Unknown addresses are treated cautiously. */
export function widenedListenTargets(before: readonly string[], after: readonly string[], defaultPort?: number): string[] {
  const port = defaultPort === undefined ? "default" : String(defaultPort);
  const previous = before.map(entry => listenScope(entry, port));
  return after.filter(entry => {
    const next = listenScope(entry, port);
    if (next.host === "::1" || next.host === "localhost" || /^127\./.test(next.host)) return false;
    return !previous.some(old => old.port === next.port && (old.host === next.host
      || (old.host === "0.0.0.0" && /^\d+\./.test(next.host))
      || (old.host === "::" && next.host.includes(":"))));
  });
}
