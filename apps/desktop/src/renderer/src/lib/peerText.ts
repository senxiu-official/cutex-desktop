// Text that came from another host (cutex peers-v2: peer labels, remote names, diagnostics) as one
// safe display line. cutex already sanitizes these; this is the desktop's own belt: control and
// bidi-format characters go, whitespace folds, anything that looks like a cutex credential is
// redacted, and the line is capped. Pure, unit-tested (test/peers.test.ts).

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI = /[‪-‮⁦-⁩‎‏؜]/g;
/** cutex credentials: peer (`cxp1.`), client / device (`cxm1.`) tokens, and bearer headers. */
const TOKEN = /\b(cxp1|cxm1)\.[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

export const SINGLE_LINE_MAX = 300;

export function singleLine(text: string | null | undefined, max = SINGLE_LINE_MAX): string {
  if (!text) return "";
  const line = text.replace(BIDI, "").replace(/\s+/g, " ").replace(CONTROL, "").replace(TOKEN, "[redacted]").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
