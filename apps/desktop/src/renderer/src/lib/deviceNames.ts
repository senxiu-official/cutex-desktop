// How a client / device token is named in Settings → 用户 and 接入 (cutex `client-token-rename`): the
// owner-given name, else the name the device reported at pairing, else a friendly reading of the
// desktop's own label (「mhs-087278 上的 Cutex」), else the raw label. The label itself never changes
// (the desktop finds its own token by it) and stays visible as a tooltip. Pure: no React / store.
import { DEFAULT_USER_DATA_FOLDER, parseDeviceLabel } from "../../../shared/hosts";

export { CLIENT_TOKEN_NAME_MAX, CLIENT_TOKEN_RENAME_FEATURE } from "@cutex-desktop/cutex-client";

export interface NamedToken {
  tokenId: string;
  label: string;
  deviceName?: string | null;
  ownerName?: string | null;
}

type T = (key: "device.appOnHost", vars: { app: string; host: string }) => string;

/** A `desktop-…` label in words: just the host for the installed app's default folder, else 「host 上的 folder」. */
export function friendlyDeviceLabel(label: string, t: T): string | null {
  const parsed = parseDeviceLabel(label);
  if (!parsed) return null;
  if (!parsed.folder || parsed.folder === DEFAULT_USER_DATA_FOLDER) return parsed.host;
  return t("device.appOnHost", { app: parsed.folder, host: parsed.host });
}

/** The name a token is shown under (see the file comment for the order). */
export function clientTokenName(token: NamedToken, t: T): string {
  return token.ownerName?.trim() || token.deviceName?.trim() || friendlyDeviceLabel(token.label ?? "", t) || token.label?.trim() || token.tokenId;
}
