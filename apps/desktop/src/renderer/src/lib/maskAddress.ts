// Network addresses of devices (Settings → 用户 / 远程访问) are masked until clicked: a screenshot or a
// screen share of the settings page should not hand out where each device connects from.

const DOT = "•";

/** "100.64.0.97" → "100.•.•.•"; "fd7a:115c::1" → "fd7a:…"; a host name → its first letter + "•••". */
export function maskAddress(address: string): string {
  const text = address.trim();
  if (!text) return text;
  // An optional ":port" after an IPv4 address goes too.
  const v4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?$/.exec(text);
  if (v4) return `${v4[1]}.${DOT}.${DOT}.${DOT}`;
  const bare = text.replace(/^\[|\](?::\d+)?$/g, "");
  if (bare.includes(":")) return `${bare.split(":")[0] || ""}:…`;
  return `${text[0]}${DOT.repeat(3)}`;
}
