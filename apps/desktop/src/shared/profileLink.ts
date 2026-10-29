/** Renderer-safe link-secret lifecycle facts. The secret and its wire body exist only in main. */
export const PROFILE_ACCOUNT_LINK_FEATURE = "profile-account-link";
export type ProfileLinkSyncCode = "storage_unavailable" | "sync_failed" | "bad_response" | "owner_local_required" | "host_disabled";
export interface ProfileLinkHostSync {
  state: "pending" | "synced" | "unsupported" | "ineligible" | "error";
  secretId: string | null;
  code?: ProfileLinkSyncCode;
}
export interface ProfileLinkState {
  secretId: string | null;
  hosts: Record<string, ProfileLinkHostSync>;
  error?: "storage_unavailable";
}
