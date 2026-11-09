// Pairing v2 (QR invites) in main: allowing a device. Main re-reads the host's owner list itself, checks the
// request is still the one the owner looked at, asks in a native dialog with the 6-digit code when the device
// would get full control (owner's risk rule: high risk → dialog), and approves with the code the host listed —
// the renderer never supplies a code. Chat / read devices were confirmed in place in the renderer.
import { shownUserName, type CutexClient, type PairingInvite } from "@cutex-desktop/cutex-client";
import type { PairingApproveResult, PairingApproveTexts } from "../shared/ipc";
import type { UsersResult } from "../shared/users";

export interface PairingConfirmOptions {
  title: string;
  message: string;
  detail: string;
  buttons: [allow: string, cancel: string];
}

/** The native dialog: true only when the owner chose the first button. */
export type PairingConfirm = (options: PairingConfirmOptions) => Promise<boolean>;

type Call = <T>(run: () => Promise<T>) => Promise<UsersResult<T>>;

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** `123456` → `123 456` (easier to read against the phone). */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function pairingConfirmOptions(invite: PairingInvite, host: string, userName: string, texts: Partial<PairingApproveTexts> | null | undefined): PairingConfirmOptions {
  const request = invite.request!;
  const platforms = texts?.platforms && typeof texts.platforms === "object" ? texts.platforms : {};
  const platform = clip(platforms[request.platform], 40) || request.platform;
  const code = spacedCode(request.shortCode);
  const fill = (template: unknown, max: number) =>
    clip(template, max)
      .replaceAll("{host}", host)
      .replaceAll("{device}", request.deviceName || platform)
      .replaceAll("{platform}", platform)
      .replaceAll("{user}", userName)
      .replaceAll("{code}", code);
  const message = fill(texts?.message, 300) || `${request.deviceName} → ${host}`;
  const detail = fill(texts?.detail, 800);
  // The code is the point of the dialog: never let a template drop it.
  const withCode = message.includes(code) || detail.includes(code) ? detail : `${detail}${detail ? "\n\n" : ""}${code}`;
  return { title: fill(texts?.title, 120) || host, message, detail: withCode, buttons: [clip(texts?.allow, 40) || "Allow", clip(texts?.cancel, 40) || "Cancel"] };
}

export async function approvePairing(
  client: Pick<CutexClient, "pairingInvites" | "approvePairingRequest" | "users">,
  call: Call,
  confirm: PairingConfirm | null,
  host: string,
  inviteId: string,
  requestId: string,
  texts: Partial<PairingApproveTexts> | null | undefined,
): Promise<PairingApproveResult> {
  if (typeof inviteId !== "string" || typeof requestId !== "string") throw new Error("bad pairing request");
  const listed = await call(() => client.pairingInvites());
  if (!listed.ok) return listed;
  const invite = listed.value.find((row) => row.inviteId === inviteId);
  if (!invite?.request || invite.request.requestId !== requestId || (invite.status !== "pending" && invite.status !== "approving")) return { ok: false, changed: true };
  if (invite.scope === "full" && invite.status === "pending") {
    if (!confirm) return { ok: false, canceled: true };
    const users = await client.users().catch(() => null);
    const user = users?.users.find((u) => u.id === invite.userId);
    const userName = (user ? shownUserName(user) : invite.userId).slice(0, 60);
    if (!(await confirm(pairingConfirmOptions(invite, host, userName, texts)))) return { ok: false, canceled: true };
  }
  const approved = await call(() => client.approvePairingRequest(inviteId, requestId, invite.request!.shortCode));
  return approved.ok ? { ok: true, invite: approved.value } : approved;
}
