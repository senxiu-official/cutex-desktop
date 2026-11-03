import type { WorkspaceScope } from "../../../shared/ipc";

export type LargeRenderChoice = "page" | "source";
export const LARGE_RENDER_TTL_MS = 24 * 60 * 60 * 1000;
export const LARGE_RENDER_MAX_CHOICES = 500;

/** Desktop-session memory, independent of Shelf instances. Expiry is measured from the decision,
 * not extended by reads; access order only determines which entry leaves the bounded LRU first. */
export class LargeRenderChoices {
  private entries = new Map<string, { choice: LargeRenderChoice; expires: number }>();
  constructor(private now: () => number = () => Date.now()) {}
  get(key: string): LargeRenderChoice | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.choice;
  }
  set(key: string, choice: LargeRenderChoice): void {
    this.entries.delete(key);
    this.entries.set(key, { choice, expires: this.now() + LARGE_RENDER_TTL_MS });
    while (this.entries.size > LARGE_RENDER_MAX_CHOICES) this.entries.delete(this.entries.keys().next().value!);
  }
  forgetSource(prefix: string): void {
    for (const [key, entry] of this.entries) if (key.startsWith(prefix) && entry.choice === "source") this.entries.delete(key);
  }
  clear(): void { this.entries.clear(); }
}

export const largeRenderChoices = new LargeRenderChoices();

/** An explicit click on Preview lets the owner reconsider a previous source-only decision. */
export function reconsiderFileRender(hostId: string, scope: WorkspaceScope | null, path: string): void {
  const prefix = JSON.stringify(["file", hostId, scope?.kind ?? null, scope?.id ?? null, path]).slice(0, -1) + ",";
  largeRenderChoices.forgetSource(prefix);
}

/** Missing metadata is never treated as proof that a file is still the accepted revision. */
export function fileRenderIdentity(hostId: string, scope: WorkspaceScope | null, path: string, bytes?: number, modifiedAt?: string): string | null {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 && modifiedAt
    ? JSON.stringify(["file", hostId, scope?.kind ?? null, scope?.id ?? null, path, bytes, modifiedAt])
    : null;
}

export function artifactRenderIdentity(hostId: string, artifactId: string, version: number, bytes: number, sha256: string | null): string {
  return JSON.stringify(["artifact", hostId, artifactId, version, bytes, sha256]);
}
