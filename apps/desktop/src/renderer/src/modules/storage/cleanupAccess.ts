import { STORAGE_CLEANUP_FEATURE } from "../../../../shared/storageCleanup";
import { ownerLocalActionsAllowed, type HostUserAccess } from "../../../../shared/users";
/** Fail closed until this host reports owner, provenance and full-scope admission. */
export function canCleanup(access: HostUserAccess & { known?: boolean }, features: ReadonlySet<string>, connected: boolean): boolean {
  return connected && access.known !== false && features.has(STORAGE_CLEANUP_FEATURE) && access.isOwner
    && (access.token === null || access.token?.issuedVia === "hostCli")
    && ownerLocalActionsAllowed(access, features) === "yes";
}
