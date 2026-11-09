export const LOCALES: string[];
export function checkModuleApiRange(range: string | undefined, current?: string): void;
export function readProject(dir: string): { dir: string; pack: { id: string; version: string; moduleApi: string; author?: string }; entry: string };
export function readMessages(dir: string, id: string): Record<string, Record<string, string>>;
export interface ModuleManifest {
  id: string;
  version: string;
  moduleApi: string;
  author?: string;
  title?: Record<string, string>;
  description?: Record<string, string>;
  entry: string;
  styles: string[];
  host: Record<string, string[]>;
}
export interface BuildOptions {
  logLevel?: "silent" | "error" | "warn" | "info";
}
export function buildModule(dir: string, opts?: BuildOptions): Promise<{ dist: string; manifest: ModuleManifest; files: { path: string; data: Buffer }[] }>;
export function packModule(dir: string, opts?: BuildOptions): Promise<{ archivePath: string; manifest: ModuleManifest; size: number; sha256: string }>;
