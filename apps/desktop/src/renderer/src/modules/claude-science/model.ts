// Pure helpers of the Claude Science module (docs/research/claude-science-accounts-20261014.md):
// an account = one cutex managed, persistent service. Everything the module knows about an account is
// in its service record: slug `claude-science-<id>`, env key CLAUDE_SCIENCE_ACCOUNT (the marker; env
// values are never shown by cutex), and the command line built here (home, binary, ~/.ssh share are
// read back from it). Nothing runs on this machine: cutex runs the command on the host.
import type { ServiceView } from "../../../../shared/ipc";

export const SLUG_PREFIX = "claude-science-";
/** The env key that marks a service as a Claude Science account of this module. */
export const ACCOUNT_ENV = "CLAUDE_SCIENCE_ACCOUNT";
export const DEFAULT_BINARY = "~/.local/bin/claude-science";
export const DEFAULT_BASE = "~/.cs-accounts";
/**
 * Claude Science puts a unix socket at `<home>/.claude-science/sbx-bind-src/sock-<pid>-<8 hex>/socks.sock`
 * and refuses to start when that path reaches 104 bytes: with a 7-digit pid the home may have at most
 * 41 characters (checked by the command on the host, where `~` is known).
 */
export const MAX_HOME_CHARS = 41;
const ID = /^[a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?$/;

export interface AccountSpec {
  /** 1–12 of a-z 0-9 -, not starting / ending with -; the slug is `claude-science-<id>`. */
  id: string;
  name: string;
  /** `~`, `~/…` (the host user's home) or an absolute POSIX path. */
  home: string;
  binary: string;
  shareSsh: boolean;
  /** Omitted: cutex allocates a free port. */
  port?: number;
}

export interface Account {
  service: ServiceView;
  id: string;
  name: string;
  home: string | null;
  binary: string | null;
  shareSsh: boolean;
}

export type SpecProblem = "id" | "idTaken" | "name" | "home" | "binary" | "port";

export function validId(id: string): boolean {
  return ID.test(id);
}

/** A host path the command accepts: `~`, `~/…` or absolute; no NUL / newline; no `..` segments. */
export function validPath(path: string): boolean {
  if (!path || path.length > 1024 || /[\0\r\n]/.test(path)) return false;
  if (!(path === "~" || path.startsWith("~/") || path.startsWith("/"))) return false;
  return !path.split("/").some((part) => part === "..");
}

export function specProblems(spec: AccountSpec, taken: ReadonlySet<string>): SpecProblem[] {
  const problems: SpecProblem[] = [];
  if (!validId(spec.id)) problems.push("id");
  else if (taken.has(spec.id)) problems.push("idTaken");
  if (spec.name.trim().length === 0 || spec.name.length > 80) problems.push("name");
  if (!validPath(spec.home) || (spec.home.startsWith("/") && spec.home.length > MAX_HOME_CHARS)) problems.push("home");
  if (!validPath(spec.binary) || spec.binary === "~") problems.push("binary");
  if (spec.port !== undefined && !(Number.isInteger(spec.port) && spec.port >= 1024 && spec.port <= 65535)) problems.push("port");
  return problems;
}

export const slugOf = (id: string) => `${SLUG_PREFIX}${id}`;

/** POSIX single quotes. */
export function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A path for the command: `~` → the host user's home (`$r`, saved before HOME is replaced). */
export function shellPath(path: string): string {
  if (path === "~") return `"$r"`;
  if (path.startsWith("~/")) return `"$r"/${quote(path.slice(2))}`;
  return quote(path);
}

/**
 * The service command (sh -c on the host; cutex substitutes `{port}`). It creates the account home,
 * optionally links the host user's ~/.ssh into it, runs `serve` in the foreground with HOME = the
 * account home, and — because Claude Science restarts itself into a detached successor (e.g. after
 * the first sign-in) — keeps following whatever daemon owns that home until it is gone. cutex's stop
 * (SIGTERM to the group) runs `claude-science stop` for that daemon.
 */
export function serviceCommand(spec: Pick<AccountSpec, "home" | "binary" | "shareSsh">): string {
  const parts = [
    `r=$HOME; cs=${shellPath(spec.binary)}; h=${shellPath(spec.home)}`,
    `[ \${#h} -le ${MAX_HOME_CHARS} ] || { echo "account home $h is longer than ${MAX_HOME_CHARS} characters (Claude Science socket path limit)" >&2; exit 2; }`,
    `mkdir -p "$h" || exit 1`,
    ...(spec.shareSsh ? [`[ -e "$h/.ssh" ] || [ -L "$h/.ssh" ] || ln -s "$r/.ssh" "$h/.ssh"`] : []),
    `export HOME="$h"`,
    `cd "$h" || exit 1`,
    `trap '"$cs" stop >/dev/null 2>&1; exit 143' TERM INT HUP`,
    `"$cs" serve --port {port} --sandbox-port 0 --no-browser --no-auto-update & wait $!; c=$?`,
    `while p=$("$cs" status 2>/dev/null | grep -o '"pid": *[0-9]*' | head -n 1 | tr -dc 0-9); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; do while kill -0 "$p" 2>/dev/null; do sleep 5 & wait $!; done; done`,
    `exit $c`,
  ];
  return parts.join("; ");
}

/** cutex `loginLinkCommand`: prints a one-time login URL of the running daemon (`claude-science url`). */
export function loginLinkCommand(spec: Pick<AccountSpec, "home" | "binary">): string {
  return `r=$HOME; HOME=${shellPath(spec.home)} exec ${shellPath(spec.binary)} url`;
}

/** `POST /v2/services` body of an account. */
export function registerRequest(spec: AccountSpec) {
  return {
    slug: slugOf(spec.id),
    displayName: spec.name.trim(),
    runtime: "managed" as const,
    lifetime: "persistent" as const,
    proxyHostHeader: "upstream" as const,
    command: serviceCommand(spec),
    loginLinkCommand: loginLinkCommand(spec),
    env: { [ACCOUNT_ENV]: spec.id },
    ...(spec.port !== undefined ? { port: spec.port } : {}),
  };
}

/** Undo `quote` / `shellPath` for one word of our own command (null: not a word we write). */
export function unshellPath(word: string): string | null {
  let rest = word;
  let prefix = "";
  if (rest === `"$r"`) return "~";
  if (rest.startsWith(`"$r"/`)) {
    prefix = "~/";
    rest = rest.slice(5);
  }
  let out = "";
  while (rest.length > 0) {
    if (rest.startsWith(`\\'`)) {
      out += "'";
      rest = rest.slice(2);
      continue;
    }
    if (!rest.startsWith("'")) return null;
    const end = rest.indexOf("'", 1);
    if (end < 0) return null;
    out += rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  return prefix + out;
}

/** This module's account, or null for any other service. */
export function accountOf(service: ServiceView): Account | null {
  if (!service.slug.startsWith(SLUG_PREFIX) || !(service.envKeys ?? []).includes(ACCOUNT_ENV)) return null;
  const command = typeof service.command === "string" ? service.command : "";
  const head = /^r=\$HOME; cs=(.+?); h=(.+?); /.exec(command);
  return {
    service,
    id: service.slug.slice(SLUG_PREFIX.length),
    name: service.displayName || service.slug,
    binary: head ? unshellPath(head[1]!) : null,
    home: head ? unshellPath(head[2]!) : null,
    shareSsh: command.includes(`ln -s "$r/.ssh" "$h/.ssh"`),
  };
}

export function accountsOf(services: readonly ServiceView[] | null | undefined): Account[] {
  return (services ?? [])
    .map(accountOf)
    .filter((a): a is Account => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A suggested id from a name ("Work 2" → "work-2"); empty when nothing usable is left. */
export function idFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12)
    .replace(/-+$/g, "");
}

/** Home of a new account under the module's base directory. */
export function homeFor(base: string, id: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/${id}`;
}
