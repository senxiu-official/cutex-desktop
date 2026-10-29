/** Search uses distinct ids; old account/quota deep links remain accepted. */
const PROFILE_DETAIL_ANCHORS = new Set(["account", "models", "tools", "images", "quota", "proxy", "appearance", "browser", "advanced"]);

export function profileSearchAnchor(anchor: string | undefined | null): string | null {
  if (!anchor) return null;
  const short = anchor.startsWith("profile-") ? anchor.slice(8) : anchor;
  return PROFILE_DETAIL_ANCHORS.has(short) ? short : null;
}
