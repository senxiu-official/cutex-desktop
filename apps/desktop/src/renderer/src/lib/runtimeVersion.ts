/** Native release names are not proof of a registered version; only the daemon resolves it. */
export function nativeVersionText(version: string | null | undefined, sha256Prefix: string | null | undefined, unknown: string): string {
  return version || (sha256Prefix ? `${unknown} · ${sha256Prefix}` : unknown);
}
