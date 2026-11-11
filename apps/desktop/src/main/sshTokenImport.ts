import { CutexApiError, CutexClient } from "@cutex-desktop/cutex-client";
import type { ImportedSshAccess, SshErrorView } from "../shared/hosts";
import { hostUserAccessOf } from "../shared/users";
import { daemonFetch } from "./daemonFetch";

export class ImportedTokenFailure extends Error {
  constructor(readonly view: SshErrorView) { super(view.detail); }
}

/** Read only public identity/rights; a reflected bearer in an error must never cross IPC. */
export async function probeImportedToken(port: number, token: string, expected?: string | null): Promise<ImportedSshAccess> {
  const client = new CutexClient({ baseUrl: `http://127.0.0.1:${port}`, token, configPath: "ssh-token-import" }, { fetch: daemonFetch });
  const signal = AbortSignal.timeout(15_000);
  try {
    const [host, caps] = await Promise.all([client.host({ signal }), client.capabilities<{ hostId: string; user?: unknown; featureList: string[] }>({ signal })]);
    if (!host.hostId || (caps && caps.hostId !== host.hostId) || (expected && expected !== host.hostId))
      throw new ImportedTokenFailure({ code: "hostMismatch", detail: "This tunnel reaches a different cutex host. Use the address and token supplied for this host." });
    if (!caps?.user || typeof caps.user !== "object")
      throw new ImportedTokenFailure({ code: "remoteDaemon", detail: "This cutex version does not report the token's user and grants." });
    const user = hostUserAccessOf(caps);
    if (!user.token?.id)
      throw new ImportedTokenFailure({ code: "tokenRejected", detail: "Import a client token supplied by the host owner, rather than the root credential." });
    return { hostId: host.hostId, user, featureList: (caps.featureList ?? []).filter((f): f is string => typeof f === "string") };
  } catch (error) {
    if (error instanceof ImportedTokenFailure) throw error;
    if (error instanceof CutexApiError && (error.status === 401 || error.status === 403))
      throw new ImportedTokenFailure({ code: "tokenRejected", detail: "cutex rejected this token. Ask the host owner for a valid token for this host." });
    throw new ImportedTokenFailure({ code: "remoteDaemon", detail: "The SSH tunnel could not reach cutex. Check the Management port and whether this SSH account permits forwarding." });
  }
}
