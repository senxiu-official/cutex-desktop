// Interactive SSH prompts (passphrase / password / keyboard-interactive / unknown host key). The
// system OpenSSH client asks through SSH_ASKPASS (main/sshAskpass.ts); main forwards each question
// to the renderer's prompt dialog and returns the answer to that one ssh process only. Answers are
// never logged, never stored on disk and never sent back to the renderer.

/**
 * - passphrase: an encrypted private key ("Enter passphrase for key '…':")
 * - password: password authentication ("user@host's password:")
 * - hostKey: unknown host key, needs yes / no ("Are you sure you want to continue connecting")
 * - confirm: a yes / no question (SSH_ASKPASS_PROMPT=confirm, e.g. an agent key confirmation)
 * - notice: information only, no answer (SSH_ASKPASS_PROMPT=none, e.g. "touch your security key")
 * - text: any other server question (keyboard-interactive: one-time codes, …); answered hidden
 */
export type SshPromptKind = "passphrase" | "password" | "hostKey" | "confirm" | "notice" | "text";

/** One open question (main → renderer). Holds no secret. */
export interface SshPromptView {
  id: string;
  kind: SshPromptKind;
  /** The host as the user entered it (`alias` or `user@host[:port]`). */
  target: string;
  /** ssh's own prompt text (may come from the server: show as plain text). */
  message: string;
  /** hostKey: `SHA256:…` from the prompt, when ssh printed one. */
  fingerprint?: string;
  /** hostKey: key type (`ED25519`, `RSA`, …). */
  keyType?: string;
  /** The answer is a secret (input hidden). */
  secret: boolean;
  createdAt: number;
}

/** The renderer's reply: the typed text / `yes` | `no`, or null = cancel. */
export type SshPromptAnswer = string | null;

/** At most this long per question; then it is cancelled (ssh then fails with an auth error). */
export const SSH_PROMPT_TIMEOUT_MS = 5 * 60_000;

const MAX_MESSAGE = 2000;

/** What a prompt asks for; `hint` = SSH_ASKPASS_PROMPT as ssh set it for the askpass program. */
export function classifySshPrompt(message: string, hint?: string | null): Omit<SshPromptView, "id" | "target" | "createdAt"> {
  const text = message.replace(/\r/g, "").slice(0, MAX_MESSAGE);
  if (hint === "none") return { kind: "notice", message: text, secret: false };
  if (/continue connecting \(yes\/no|authenticity of host .* can't be established/i.test(text)) {
    const fp = /\b(SHA256:[A-Za-z0-9+/]{20,}={0,2}|MD5(?::[0-9a-f]{2}){16})/.exec(text)?.[1];
    const type = /\b([A-Z0-9-]{2,20}) key fingerprint is/.exec(text)?.[1];
    return { kind: "hostKey", message: text, secret: false, ...(fp ? { fingerprint: fp } : {}), ...(type ? { keyType: type } : {}) };
  }
  if (hint === "confirm") return { kind: "confirm", message: text, secret: false };
  if (/passphrase/i.test(text)) return { kind: "passphrase", message: text, secret: true };
  if (/password/i.test(text)) return { kind: "password", message: text, secret: true };
  return { kind: "text", message: text, secret: true };
}

