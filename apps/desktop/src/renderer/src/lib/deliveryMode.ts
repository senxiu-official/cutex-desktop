/** 054: choose per host, never per runtime or per message. */
export const INPUT_LEDGER_FEATURE = "input-ledger-v1";

/** LEGACY(input-ledger-v1): remove the legacy mode when every host has this capability. */
export function usesInputLedger(featureList: readonly string[] | null | undefined): boolean {
  return featureList?.includes(INPUT_LEDGER_FEATURE) === true;
}
