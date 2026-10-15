import { ProtocolError } from '@cutex-desktop/browser-protocol';

/** Bounded header parsing only. No Node/Electron dependency and no full image decode. */
export function imageDimensions(data: string, format: 'png' | 'jpeg'): { width: number; height: number } {
  const fail = () => { throw new ProtocolError('transport_error', 'Malformed screenshot header'); };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) return fail();
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(data.slice(0, 131072)), value => value.charCodeAt(0)); } catch { return fail(); }
  const u16 = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  const u32 = (i: number) => u16(i) * 65536 + u16(i + 2);
  let width = 0, height = 0;
  if (format === 'png') {
    if (bytes.length < 33 || [137,80,78,71,13,10,26,10].some((byte, i) => bytes[i] !== byte)
      || u32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return fail();
    width = u32(16); height = u32(20);
  } else {
    if (u16(0) !== 0xffd8) return fail();
    for (let i = 2; i + 4 < bytes.length;) {
      if (bytes[i++] !== 0xff) return fail();
      while (bytes[i] === 0xff) i++;
      const marker = bytes[i++]!;
      if (marker === 0xda || marker === 0xd9) return fail();
      const length = u16(i);
      if (length < 2 || i + length > bytes.length) return fail();
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) return fail(); height = u16(i + 3); width = u16(i + 5); break;
      }
      i += length;
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32768 || height > 32768) return fail();
  return { width, height };
}
