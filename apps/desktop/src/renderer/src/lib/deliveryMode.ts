/** 054: choose per host, never per runtime or per message. */
export const INPUT_LEDGER_FEATURE = "input-ledger-v1";

export function usesOwnerCarries(features: readonly string[] | null | undefined): boolean {
  return usesInputLedger(features) && features?.includes("owner-carries-v1") === true;
}

/** input-disposal-v1: Next Up disposals use the id-only `cutex/input/dispose` (registry 1.9). */
export function usesInputDisposal(features: Iterable<string> | null | undefined): boolean {
  for (const feature of features ?? []) if (feature === "input-disposal-v1" || feature === "inputDisposalV1") return true;
  return false;
}

/** LEGACY(input-ledger-v1): remove the legacy mode when every host has this capability. */
export function usesInputLedger(featureList: readonly string[] | null | undefined): boolean {
  return featureList?.includes(INPUT_LEDGER_FEATURE) === true;
}
