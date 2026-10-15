// Draft appearance for a new agent; the creator persists it through session metadata.
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { useRef, useState } from "react";
import { ChevronDown, Upload } from "lucide-react";
import { useI18n } from "../i18n";
import { AVATAR_PALETTE, AVATAR_VALUE_MAX, cleanAvatar, hashColor } from "../lib/avatar";
import { Avatar } from "./Avatar";
import { EmojiGrid } from "./EmojiGrid";
import { avatarSourceProblem, newPictureAvatar } from "../lib/agentPicture";
import { Popover } from "./Menu";
import { ProfilePictureCrop } from "./settings/ProfilePictureCrop";

export function AgentAvatarPicker({ name, color, value, picture, onChange, onOpen }: {
  name: string;
  color: string | null;
  value: SessionAvatar | null;
  picture: string | null;
  onChange(value: SessionAvatar | null, picture?: string): void;
  onOpen(): void;
}) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const customColor = value?.kind === "color" && !AVATAR_PALETTE.includes(value.value);
  const label = `${t("info.avatar")} / ${t("info.avatar.color")}`;
  return (
    <>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" aria-label={t("info.avatar.upload")}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const problem = avatarSourceProblem(file);
        setFileError(problem ? t(problem === "type" ? "info.avatar.badType" : "info.avatar.tooLarge", { name: file.name }) : null);
        if (!problem) setCropFile(file);
      }} />
    {cropFile && <ProfilePictureCrop file={cropFile} onCancel={() => setCropFile(null)}
      onConfirm={(next) => { onChange(newPictureAvatar(), next); setCropFile(null); }} />}
    <Popover align="right" width="w-72" onOpen={onOpen} triggerTitle={label}
      trigger={<><Avatar name={name} color={color} avatar={value} picture={picture} size={22} /><span>{label}</span><ChevronDown size={11} /></>}>
      {(close) => (
        <div className="space-y-3 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-subtle">{label}</span>
            <button type="button" aria-pressed={!value} onClick={() => onChange(null)} className="rounded-md px-2 py-1 text-xs hover:bg-surface-2">{t("info.avatar.default")}</button>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={name} color={color} avatar={value} picture={picture} size={36} />
            <button type="button" onClick={() => { close(); setFileError(null); fileInput.current?.click(); }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-surface-2">
              <Upload size={13} />{t(picture ? "info.avatar.replacePicture" : "info.avatar.upload")}
            </button>
          </div>
          <p className="text-[11px] text-subtle">{t("info.avatar.pictureHint")}</p>
          <EmojiGrid columns={8} className="max-h-48 overflow-y-auto pr-1" value={value?.kind === "emoji" ? value.value : null}
            onPick={(emoji) => onChange({ kind: "emoji", value: emoji })} />
          <input aria-label={t("info.avatar.emoji")} placeholder={t("info.emojiPlaceholder")} maxLength={AVATAR_VALUE_MAX}
            value={value?.kind === "emoji" ? value.value : ""} onChange={(e) => onChange(cleanAvatar({ kind: "emoji", value: e.target.value }))}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
          <div className="flex flex-wrap items-center gap-2">
            {AVATAR_PALETTE.map((c) => <button type="button" key={c} title={c} aria-label={c}
              aria-pressed={value?.kind === "color" && value.value === c} onClick={() => onChange({ kind: "color", value: c })}
              className="h-5 w-5 rounded-full aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface" style={{ background: c }} />)}
            <label title={t("info.customColor")} className={`relative h-5 w-5 shrink-0 cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface ${customColor ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
              style={{ background: "conic-gradient(#ff5555, #ffdb55, #50cd77, #4cbbff, #9864ff, #ff55af, #ff5555)" }}>
              <input type="color" aria-label={t("info.customColor")} value={value?.kind === "color" ? value.value : color ?? hashColor(name)}
                onChange={(e) => onChange({ kind: "color", value: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
          </div>
        </div>
      )}
    </Popover>
    {fileError && <span role="alert" title={fileError} className="max-w-40 truncate text-[11px] text-danger">{fileError}</span>}
    </>
  );
}
