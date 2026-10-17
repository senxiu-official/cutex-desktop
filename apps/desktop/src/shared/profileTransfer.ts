// Copy a profile to another host (cutex `profile-transfer`; docs/research/profile-migration-design-20261016.md).
// The bundle goes main → main only (main/profileTransfer.ts): host A's export, host B's import. The
// renderer sends this request and gets a secret-free result: never the bundle, never a key.

/** cutex capability: `POST /v2/profiles/{p}/export` + `POST /v2/profiles/import`. */
export const PROFILE_TRANSFER_FEATURE = "profile-transfer";

export interface ProfileTransferRequest {
  sourceHostId: string;
  /** Profile id or name on the source host. */
  profile: string;
  targetHostId: string;
  /** New profile name on the target host (never overwrites: a clash is refused). */
  name: string;
  /** Copy an API-key profile's key too (default on in the dialog). Ignored for other kinds. */
  includeApiKey: boolean;
}

export type ProfileCredentialKind = "apiKey" | "chatgpt" | "claude" | "none";

/** What the owner must do or check on the target host (cutex import `warnings`, allow-listed). */
export type ProfileTransferWarning =
  | { code: "needsLogin"; credential: "chatgpt" | "apiKey" }
  | { code: "claudeAccountRebound"; matched: boolean; account: string; accountLabel: string | null; sourceLabel: string | null; loggedIn: boolean | null }
  | { code: "privateAuthReset" }
  | { code: "runtimeDockerImage"; image: string }
  | { code: "proxyCleared" }
  | { code: "proxyCopied" }
  | { code: "secretFieldsCleared"; fields: string[] }
  | { code: "other"; name: string };

export type ProfileTransferStage = "request" | "export" | "import";

export type ProfileTransferResult =
  | {
      ok: true;
      profile: { id: string; name: string };
      credentialKind: ProfileCredentialKind;
      credentialsCopied: boolean;
      warnings: ProfileTransferWarning[];
    }
  | { ok: false; stage: ProfileTransferStage; error: { code: string; message: string; status?: number } };

const MAX_TEXT = 200;
const text = (value: unknown, max = MAX_TEXT): string | null => (typeof value === "string" ? value.slice(0, max) : null);
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** cutex's `warnings` → the known shapes (unknown codes keep only their name; values are capped). */
export function parseTransferWarnings(raw: unknown): ProfileTransferWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileTransferWarning[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const w = item as Record<string, unknown>;
    switch (w.code) {
      case "needsLogin":
        out.push({ code: "needsLogin", credential: w.credential === "chatgpt" ? "chatgpt" : "apiKey" });
        break;
      case "claudeAccountRebound":
        out.push({
          code: "claudeAccountRebound",
          matched: w.matched === true,
          account: text(w.account, 80) ?? "default",
          accountLabel: text(w.accountLabel, 80),
          sourceLabel: text(w.sourceLabel, 80),
          loggedIn: typeof w.loggedIn === "boolean" ? w.loggedIn : null,
        });
        break;
      case "privateAuthReset":
      case "proxyCleared":
      case "proxyCopied":
        out.push({ code: w.code });
        break;
      case "runtimeDockerImage":
        out.push({ code: "runtimeDockerImage", image: text(w.image) ?? "" });
        break;
      case "secretFieldsCleared":
        out.push({ code: "secretFieldsCleared", fields: Array.isArray(w.fields) ? w.fields.slice(0, 10).map((f) => text(f, 120)).filter((f): f is string => !!f) : [] });
        break;
      default:
        if (typeof w.code === "string" && CODE.test(w.code)) out.push({ code: "other", name: w.code });
    }
  }
  return out;
}

/** Each occurrence of a secret replaced (an error text must never carry the key, whoever wrote it). */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join("[redacted]");
  return out;
}

/** Suggested name on the target: the source name, else `name (source host)`, else numbered. */
export function transferName(name: string, sourceLabel: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const base = `${name} (${sourceLabel})`.slice(0, 64);
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 60)} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}
