// Identity digests (person-key fingerprints, NCI key fingerprint, peer instance ids) are masked by
// default in the UI (owner 2026-10-15: 「身份指纹这种平时打个码」); components/MaskedText.tsx reveals one
// row on click (local state: resets when the page closes) and its copy button copies the full value.

/** Visible characters before the mask. */
export const MASK_KEEP = 4;
/** The mask shown after the kept prefix. */
export const MASK_DOTS = "••••••";

/** An algorithm label kept in front of the mask (`SHA256:` of an ssh fingerprint). */
const ALGORITHM = /^(?:SHA\d+|MD5):/i;

/**
 * `abcd••••••`: the first `keep` non-space characters of `value` (after an algorithm label such as
 * `SHA256:`, which stays), then the mask (empty → empty).
 */
export function maskDigest(value: string | null | undefined, keep = MASK_KEEP): string {
  const compact = (value ?? "").replace(/\s+/g, "");
  if (!compact) return "";
  const label = ALGORITHM.exec(compact)?.[0] ?? "";
  return `${label}${compact.slice(label.length, label.length + Math.max(0, keep))}${MASK_DOTS}`;
}
