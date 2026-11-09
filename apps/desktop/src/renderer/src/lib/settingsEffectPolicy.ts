/** The sole named placement exception. Declarations stay mandatory on every row. */
export const SETTINGS_EFFECT_EXEMPTIONS: Readonly<Record<string, { reason: string; scope: "baseline" }>> = {
  profiles: {
    reason: "Profiles name the common target host once and mark only differing scopes; timing follows the normal page, card and row placement.",
    scope: "baseline",
  },
  access: {
    reason: "One host's page names that host once in its header and marks only what differs (this desktop's connection).",
    scope: "baseline",
  },
};
