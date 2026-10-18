import type { ModuleIndexPack } from "../../src/shared/modulePacks";
export const APP_DIR: string;
export interface HostTable { bare: Set<string>; files: Map<string, string> }
export function readHostTable(file?: string): HostTable;
export type BuiltPackEntry = Omit<ModuleIndexPack, "archive"> & { archive: Omit<ModuleIndexPack["archive"], "url"> };
export interface BuiltPack { entry: BuiltPackEntry; archivePath: string; files: { path: string; data: Buffer }[] }
export function buildPack(id: string, outDir: string, opts?: { styles?: boolean; moduleDir?: string; logLevel?: "info" | "warn" | "error" | "silent" }): Promise<BuiltPack>;
export function packableModules(): string[];
