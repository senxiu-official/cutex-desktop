// QR code → one SVG path (generated locally with qrcode-generator, no network). Used for the
// `cutex-pair:v1?…` pairing payload; rendered dark-on-white in both themes so phones can scan it.
import qrcode from "qrcode-generator";

/** `size` = module count; `d` draws every dark module as a 1×1 square (unit = one module). */
export function qrPath(text: string, level: "L" | "M" | "Q" | "H" = "M"): { size: number; d: string } {
  const qr = qrcode(0, level);
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!qr.isDark(r, c)) continue;
      // Merge horizontal runs into one rect.
      let end = c;
      while (end + 1 < size && qr.isDark(r, end + 1)) end++;
      d += `M${c} ${r}h${end - c + 1}v1h-${end - c + 1}z`;
      c = end;
    }
  }
  return { size, d };
}
