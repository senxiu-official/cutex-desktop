// users-p2-access on one host (shared/users.ts canUseP2): what this connection may do of the P2
// additions there — read-only workspace files, image attachments, delegation commands. Owner (or an
// unknown / older host): everything. Store bindings only; the decision itself is pure (shared/users).
import { canUseP2, type P2Access } from "../../../shared/users";
import { featuresOf, useApp } from "../store";
import { hostAccessNow, useHostAccess } from "./hostAccess";

/** Non-React: the host's P2 access now. */
export function p2AccessNow(hostId: string): P2Access {
  return canUseP2(featuresOf(useApp.getState(), hostId), hostAccessNow(hostId));
}

/** The host's P2 access (re-renders when its access or features change). */
export function useP2Access(hostId: string | null | undefined): P2Access {
  const access = useHostAccess(hostId);
  const features = useApp((s) => featuresOf(s, hostId));
  return canUseP2(features, access);
}
