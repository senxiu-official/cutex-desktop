import type { UpgradeTreeParty } from "./upgradeTypes";
export const partyName = (party: UpgradeTreeParty | null) => party && "name" in party ? party.name : "";
