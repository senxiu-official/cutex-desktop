// BLAKE2b-512 (RFC 7693), unkeyed and incremental, in plain TypeScript: Electron's BoringSSL has no
// `blake2b512` digest (node:crypto throws "Digest method not supported"), and minisign's prehashed
// signatures sign the BLAKE2b-512 of the file. 64-bit words are kept as (low, high) uint32 pairs; the
// round function follows the public-domain reference layout (as in blakejs, CC0).

const IV32 = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);

const SIGMA = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
].map((x) => x * 2);

export class Blake2b512 {
  private readonly h = new Uint32Array(16);
  private readonly b = new Uint8Array(128);
  private readonly v = new Uint32Array(32);
  private readonly m = new Uint32Array(32);
  /** Bytes in `b`. */
  private c = 0;
  /** Bytes compressed so far (a JS number: exact up to 2^53). */
  private t = 0;
  private done = false;

  constructor() {
    this.h.set(IV32);
    this.h[0] = (this.h[0]! ^ 0x01010000 ^ 64) >>> 0; // no key, 64-byte digest
  }

  update(data: Uint8Array): this {
    if (this.done) throw new Error("blake2b: digest already taken");
    let i = 0;
    const n = data.length;
    while (i < n) {
      if (this.c === 128) {
        this.t += 128;
        this.compress(false);
        this.c = 0;
      }
      const take = Math.min(128 - this.c, n - i);
      this.b.set(data.subarray(i, i + take), this.c);
      this.c += take;
      i += take;
    }
    return this;
  }

  digest(): Buffer {
    if (this.done) throw new Error("blake2b: digest already taken");
    this.done = true;
    this.t += this.c;
    this.b.fill(0, this.c);
    this.compress(true);
    const out = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) out[i] = this.h[i >> 2]! >>> (8 * (i & 3));
    return out;
  }

  private compress(last: boolean): void {
    const { v, m, h, b } = this;
    for (let i = 0; i < 16; i++) {
      v[i] = h[i]!;
      v[i + 16] = IV32[i]!;
    }
    v[24] = v[24]! ^ this.t;
    v[25] = v[25]! ^ Math.floor(this.t / 0x100000000);
    if (last) {
      v[28] = ~v[28]!;
      v[29] = ~v[29]!;
    }
    for (let i = 0; i < 32; i++) m[i] = b[4 * i]! ^ (b[4 * i + 1]! << 8) ^ (b[4 * i + 2]! << 16) ^ (b[4 * i + 3]! << 24);
    for (let r = 0; r < 12; r++) {
      const s = r * 16;
      this.g(0, 8, 16, 24, SIGMA[s]!, SIGMA[s + 1]!);
      this.g(2, 10, 18, 26, SIGMA[s + 2]!, SIGMA[s + 3]!);
      this.g(4, 12, 20, 28, SIGMA[s + 4]!, SIGMA[s + 5]!);
      this.g(6, 14, 22, 30, SIGMA[s + 6]!, SIGMA[s + 7]!);
      this.g(0, 10, 20, 30, SIGMA[s + 8]!, SIGMA[s + 9]!);
      this.g(2, 12, 22, 24, SIGMA[s + 10]!, SIGMA[s + 11]!);
      this.g(4, 14, 16, 26, SIGMA[s + 12]!, SIGMA[s + 13]!);
      this.g(6, 8, 18, 28, SIGMA[s + 14]!, SIGMA[s + 15]!);
    }
    for (let i = 0; i < 16; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 16]!;
  }

  /** v[a] += v[b] (64-bit). */
  private add(a: number, b: number): void {
    const v = this.v;
    const lo = v[a]! + v[b]!;
    let hi = v[a + 1]! + v[b + 1]!;
    if (lo >= 0x100000000) hi++;
    v[a] = lo;
    v[a + 1] = hi;
  }

  /** v[a] += (lo, hi) (64-bit). */
  private addConst(a: number, b0: number, b1: number): void {
    const v = this.v;
    const lo = v[a]! + b0;
    let hi = v[a + 1]! + b1;
    if (lo >= 0x100000000) hi++;
    v[a] = lo;
    v[a + 1] = hi;
  }

  private g(a: number, b: number, c: number, d: number, ix: number, iy: number): void {
    const { v, m } = this;
    const x0 = m[ix]!, x1 = m[ix + 1]!, y0 = m[iy]!, y1 = m[iy + 1]!;
    this.add(a, b);
    this.addConst(a, x0, x1);
    let xor0 = v[d]! ^ v[a]!;
    let xor1 = v[d + 1]! ^ v[a + 1]!;
    v[d] = xor1; // rotr 32
    v[d + 1] = xor0;
    this.add(c, d);
    xor0 = v[b]! ^ v[c]!;
    xor1 = v[b + 1]! ^ v[c + 1]!;
    v[b] = (xor0 >>> 24) ^ (xor1 << 8); // rotr 24
    v[b + 1] = (xor1 >>> 24) ^ (xor0 << 8);
    this.add(a, b);
    this.addConst(a, y0, y1);
    xor0 = v[d]! ^ v[a]!;
    xor1 = v[d + 1]! ^ v[a + 1]!;
    v[d] = (xor0 >>> 16) ^ (xor1 << 16); // rotr 16
    v[d + 1] = (xor1 >>> 16) ^ (xor0 << 16);
    this.add(c, d);
    xor0 = v[b]! ^ v[c]!;
    xor1 = v[b + 1]! ^ v[c + 1]!;
    v[b] = (xor1 >>> 31) ^ (xor0 << 1); // rotr 63
    v[b + 1] = (xor0 >>> 31) ^ (xor1 << 1);
  }
}

export function blake2b512(data: Uint8Array): Buffer {
  return new Blake2b512().update(data).digest();
}
