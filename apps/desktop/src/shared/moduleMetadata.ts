/** App-owned first-party metadata, independent of the signed pack index and module API. */
export interface ModuleMetadata {
  readonly optional: true;
}

const FIRST_PARTY_MODULE_METADATA: Readonly<Partial<Record<string, ModuleMetadata>>> = {
  "baidu-pan": { optional: true },
  "claude-science": { optional: true },
  nci: { optional: true },
  whatsapp: { optional: true },
};

export function moduleMetadata(id: string): ModuleMetadata | undefined {
  return Object.hasOwn(FIRST_PARTY_MODULE_METADATA, id) ? FIRST_PARTY_MODULE_METADATA[id] : undefined;
}
