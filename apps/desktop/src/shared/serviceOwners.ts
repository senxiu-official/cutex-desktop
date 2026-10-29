/** Read-only candidate list from cutex; eligibility is decided again on reassignment. */
export const SERVICES_ELIGIBLE_OWNERS_FEATURE = "services-eligible-owners";

export interface EligibleServiceOwner {
  id: string;
  name: string;
  realName: string | null;
  projectId: string | null;
  isDirector: boolean;
  /** Process liveness hint only, not proof of a connected native control channel. */
  online: boolean;
  unnamed: boolean;
}

export interface EligibleServiceOwners {
  hostId: string;
  slug: string;
  owners: EligibleServiceOwner[];
}
