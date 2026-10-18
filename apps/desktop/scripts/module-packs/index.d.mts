import type { ModuleIndex } from "../../src/shared/modulePacks";
export function makeIndex(opts: { packsDir: string; baseUrl: string; previous?: unknown; now?: number }): Promise<{ index: ModuleIndex; added: string[] }>;
