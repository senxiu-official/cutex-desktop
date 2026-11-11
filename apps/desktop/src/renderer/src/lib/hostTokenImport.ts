// Connecting with a token someone issued (owner-approved 2026-11-10): the desktop opens only the SSH
// tunnel to the host's management port and presents the token; it runs no command over SSH. Pure helpers
// for components/settings/HostTokenImport.tsx (test/hostTokenImport.test.ts).
import type { HostView, SshErrorView } from "../../../shared/hosts";
import type { HostUserAccess } from "../../../shared/users";

/** A host added from a token: no pairing over SSH, no 连接身份 switch; 重新导入令牌 / 忘记 instead. */
export function isTokenImportHost(host: Pick<HostView, "kind" | "pairingMode"> | null | undefined): boolean {
  return host?.kind === "ssh" && host.pairingMode === "tokenImport";
}

/** Errors with their own words when importing a token; any other code keeps the general `host.problem.<code>`. */
const TOKEN_PROBLEMS: Readonly<Record<string, string>> = {
  refused: "host.token.problem.unreachable",
  timeout: "host.token.problem.unreachable",
  resolve: "host.token.problem.resolve",
  forwardDenied: "host.token.problem.forwardDenied",
  tokenRejected: "host.token.problem.tokenRejected",
  hostMismatch: "host.token.problem.hostMismatch",
  remoteDaemon: "host.token.problem.remoteDaemon",
  badInput: "host.token.problem.badInput",
};

/** The message key of an import error: the import's own words, else the general one. */
export function tokenProblemKey(error: Pick<SshErrorView, "code">): string {
  return TOKEN_PROBLEMS[error.code] ?? `host.problem.${error.code}`;
}

/** A pasted token: surrounding blanks and line breaks dropped (a copied terminal line often carries them). */
export function cleanToken(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/** The owner-side command that issues a token for one user (no HTTP route yet: CLI on the host only). */
export function issueTokenCommand(userId: string): string {
  return `cutex management client-token issue --user ${userId} --scope full`;
}

/** Who the imported token is on the host, for the words after a successful import. */
export function importedWho(user: HostUserAccess): string | null {
  return user.displayName?.trim() || user.name?.trim() || null;
}
