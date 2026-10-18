export interface TarFile { path: string; data: Uint8Array | string }
export function writeTar(files: readonly TarFile[]): Buffer;
export function gzipFixed(data: Uint8Array): Buffer;
export function writeTarGz(files: readonly TarFile[]): Buffer;
