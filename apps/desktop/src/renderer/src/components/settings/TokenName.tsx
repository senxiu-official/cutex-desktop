// A client / device token in a settings row (Settings → 用户 → 设备 / 你的设备, 接入 on older hosts): its icon,
// detail line (platform · last used · masked address) and 这台电脑 badge, and its name:
// the shown name (lib/deviceNames) with the raw label as its tooltip, and — on the owner's connection to
// a host with cutex `client-token-rename` — inline rename (pencil → field, Enter saves, Esc cancels, an
// empty field clears the owner-given name).
import { useState, type ReactNode } from "react";
import { Check, Laptop, Pencil, Smartphone, X } from "lucide-react";
import type { UserTokenRecord } from "../../../../shared/users";
import { useI18n, type MessageKey } from "../../i18n";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { MaskedAddress } from "../MaskedAddress";
import { CLIENT_TOKEN_NAME_MAX, clientTokenName, type NamedToken } from "../../lib/deviceNames";
import { IconButton, TextInput } from "./Form";

/** The row title: the name (tooltip: the label) and `extra` badges, or the rename field while editing. */
export function TokenTitle({ token, editing, onSave, onCancel, extra }: { token: NamedToken; editing: boolean; onSave(name: string | null): Promise<boolean>; onCancel(): void; extra?: ReactNode }) {
  const { t } = useI18n();
  const name = clientTokenName(token, t);
  if (editing) return <TokenNameField token={token} onSave={onSave} onCancel={onCancel} />;
  const tooltip = [token.label?.trim() ? t("device.labelTooltip", { label: token.label.trim() }) : null, token.tokenId].filter(Boolean).join("\n");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate" title={tooltip} data-testid="token-name">
        {name}
      </span>
      {extra}
    </span>
  );
}

function TokenNameField({ token, onSave, onCancel }: { token: NamedToken; onSave(name: string | null): Promise<boolean>; onCancel(): void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(token.ownerName ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const done = await onSave(draft.trim() || null);
    setBusy(false);
    if (done) onCancel();
  };
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid="token-rename">
      <TextInput
        value={draft}
        onChange={setDraft}
        width="w-56"
        maxLength={CLIENT_TOKEN_NAME_MAX}
        label={t("device.renameLabel")}
        placeholder={t("device.renamePlaceholder")}
        disabled={busy}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <IconButton label={t("device.renameSave")} disabled={busy} onClick={() => void save()}>
        <Check size={14} />
      </IconButton>
      <IconButton label={t("device.renameCancel")} disabled={busy} onClick={onCancel}>
        <X size={14} />
      </IconButton>
    </span>
  );
}

/** The pencil in a row's actions. */
export function RenameTokenButton({ onClick, disabled }: { onClick(): void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <IconButton label={t("device.rename")} disabled={disabled} onClick={onClick}>
      <Pencil size={13} />
    </IconButton>
  );
}

const PLATFORMS: ReadonlySet<string> = new Set(["android", "ios", "web", "other"]);

/** "Android · 12 分钟前用过 · 100.•.•.•" (kind when the device did not say its platform). */
export function TokenDetail({ token }: { token: Pick<UserTokenRecord, "kind" | "platform" | "lastUsedAt" | "lastAddress"> }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const used = token.lastUsedAt ? Date.parse(token.lastUsedAt) / 1000 : NaN;
  const kind = token.platform && PLATFORMS.has(token.platform) ? t(`remote.platform.${token.platform}` as MessageKey) : token.platform || t(token.kind === "device" ? "remote.token.device" : "remote.token.client");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">{kind} ·</span>
      <span className="truncate" title={Number.isFinite(used) ? formatAbsolute(used) : undefined}>
        {Number.isFinite(used) ? t("users.lastUsed", { t: formatWhen(used, now, locale) }) : t("users.neverUsed")}
        {token.lastAddress && (
          <>
            {" · "}
            <MaskedAddress address={token.lastAddress} />
          </>
        )}
      </span>
    </span>
  );
}

export function TokenIcon({ token }: { token: Pick<UserTokenRecord, "kind"> }) {
  const Icon = token.kind === "device" ? Smartphone : Laptop;
  return <Icon size={15} className="shrink-0 text-subtle" />;
}

/** The 这台电脑 badge. */
export function ThisComputerBadge() {
  const { t } = useI18n();
  return <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[11px] text-accent">{t("users.person.thisDesktop")}</span>;
}
