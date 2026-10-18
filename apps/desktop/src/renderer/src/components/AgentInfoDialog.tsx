// 编辑信息: 显示名, avatar and note in one dialog; all are cutex session metadata
// (`cutex/session/metadata/update`), saved by the caller. 显示名 = cutex `displayNameOverride`, display
// only (lib/agentAlias): the real name stays what the agent is addressed by. Avatar tabs: 默认 = null
// (Settings → 外观 → 默认头像 decides: emoji from the id or the letter), 表情 = `emoji`, 图片 = `icon`
// pointing at a device-local picture (lib/agentPicture, saved here before the caller writes cutex),
// 颜色 = the circle colour. With `agent-avatar-color` the colour combines with the face (`color` on an
// emoji / icon avatar, a `color` avatar for the default face); without it 颜色 is a face of its own
// (`color` avatar: the glyph stays the default one) and a picked emoji uses the profile colour.
import { useRef, useState } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { Upload } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { AVATAR_PALETTE, AVATAR_VALUE_MAX, cleanAvatar, hashColor, isHexColor, type AgentInfo, type AgentInfoOptions } from "../lib/avatar";
import { DISPLAY_NAME_MAX } from "../lib/agentAlias";
import { agentPictureOf, avatarSourceProblem, newPictureAvatar, saveAgentPicture } from "../lib/agentPicture";
import { bundledEmoji } from "../lib/agentEmoji";
import { drawsEmoji } from "../lib/avatarDefault";
import { themedEmoji } from "../lib/avatarThemes";
import { useAgentLook } from "../lib/agentLook";
import { closeDialog } from "../lib/contextMenu";
import { useUiPrefs } from "../lib/prefs";
import { Avatar } from "./Avatar";
import { EmojiGrid } from "./EmojiGrid";
import { Segmented } from "./settings/Form";
import { ProfilePictureCrop } from "./settings/ProfilePictureCrop";

type Kind = "default" | "emoji" | "color" | "picture";
/** What sits inside the circle (combined mode; 颜色 is not a face there). */
type Face = "default" | "emoji" | "picture";

const FIELD = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function AgentInfoDialog({ name, color, seed, initial, options, resolve }: { name: string; color: string | null; seed: string; initial: AgentInfo; options: AgentInfoOptions; resolve(v: AgentInfo | null): void }) {
  const { t } = useI18n();
  const { agentAvatarDefault } = useUiPrefs();
  // 仅重要智能体 draws the emoji too (the dot is a list-row thing, never this preview).
  const emojiMode = drawsEmoji(agentAvatarDefault);
  const theme = useAgentLook(seed)?.themes;
  const { combineColor, editName, realName } = options;
  const start = initial.avatar;
  const [kind, setKind] = useState<Kind>(!start ? "default" : start.kind === "icon" ? "picture" : start.kind);
  const [face, setFace] = useState<Face>(start?.kind === "emoji" ? "emoji" : start?.kind === "icon" ? "picture" : "default");
  // Combined mode: the avatar's own circle colour (null = the profile colour).
  const [tint, setTint] = useState<string | null>(start?.kind === "color" ? start.value : isHexColor(start?.color) ? start.color : null);
  const [alias, setAlias] = useState(initial.displayName ?? "");
  const [emoji, setEmoji] = useState(start?.kind === "emoji" ? start.value : "");
  // A typed emoji outside the bundled set opens 「其他…」 right away.
  const [otherOpen, setOtherOpen] = useState(start?.kind === "emoji" && !bundledEmoji(start.value));
  const [swatch, setSwatch] = useState(start?.kind === "color" ? start.value : (color ?? hashColor(name)));
  // 图片: the stored icon avatar (kept as is unless replaced) or a freshly cropped one.
  const [icon, setIcon] = useState<SessionAvatar | null>(start?.kind === "icon" ? start : null);
  const [picture, setPicture] = useState<string | null>(() => (start?.kind === "icon" ? agentPictureOf(start) : null));
  const [fresh, setFresh] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState(initial.note ?? "");
  const avatar: SessionAvatar | null = combineColor ? combinedAvatar(face, emoji, icon, tint) :
    kind === "emoji" ? cleanAvatar({ kind: "emoji", value: emoji }) : kind === "color" ? { kind: "color", value: swatch } : kind === "picture" && icon ? { kind: "icon", value: icon.value } : null;
  const shown: Kind = combineColor ? face : kind;
  const shownPicture = shown === "picture" ? picture : null;
  const pick = (c: string) => (combineColor ? setTint(c) : setSwatch(c));
  const picked = combineColor ? tint : swatch;
  const done = (v: AgentInfo | null) => {
    closeDialog();
    resolve(v);
  };
  const save = () => {
    if (kind === "picture" && fresh && icon && picture) {
      try {
        saveAgentPicture(icon, picture);
      } catch {
        setError(t("info.avatar.pictureSaveFailed"));
        return;
      }
    }
    done({ avatar, note, ...(editName ? { displayName: alias } : {}) });
  };
  const shownName = (editName ? alias.trim() : "") || (editName ? realName : name);
  const preview = { name: shownName, color, seed, avatar, picture: shown === "picture" ? shownPicture : null };
  const customEmoji = kind === "emoji" && !!emoji.trim() && !bundledEmoji(emoji);
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") done(null);
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      }}
    >
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" aria-label={t("info.avatar.upload")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const problem = avatarSourceProblem(file);
          setError(problem ? t(problem === "type" ? "info.avatar.badType" : "info.avatar.tooLarge", { name: file.name }) : null);
          if (!problem) setCropFile(file);
        }} />
      {cropFile && (
        <ProfilePictureCrop file={cropFile} onCancel={() => setCropFile(null)}
          onConfirm={(next) => {
            setIcon(newPictureAvatar());
            setPicture(next);
            setFresh(true);
            setCropFile(null);
          }} />
      )}
      <div className="mb-3 text-sm font-medium">{t("menu.editInfo")}</div>
      {editName ? (
        <div className="mb-3">
          <label className="mb-1.5 block text-xs text-muted" htmlFor="agent-info-alias">{t("info.displayName")}</label>
          <input id="agent-info-alias" autoFocus value={alias} maxLength={DISPLAY_NAME_MAX} placeholder={realName} onChange={(e) => setAlias(e.target.value)} className={FIELD} />
          <p className="mt-1 break-words text-[11px] text-subtle">{t("info.displayNameHint", { name: realName })}</p>
        </div>
      ) : (
        <p className="mb-3 text-[11px] text-subtle">{t("info.displayNameUnsupported")}</p>
      )}
      <div className="mb-1.5 text-xs text-muted">{t("info.avatar")}</div>
      <div className="flex items-center gap-4 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5">
        <Avatar {...preview} size={48} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-surface-2/70 px-1.5 py-1" title={t("info.avatar.sidebarSize")}>
            <Avatar {...preview} size={20} />
            <span className="truncate text-sm">{shownName}</span>
          </div>
          <div className="truncate px-0.5 text-[11px] text-subtle">{previewCaption(shown, emojiMode, emoji, !!shownPicture, t)}{combineColor && tint ? ` · ${t("info.avatar.ownColor")}` : ""}</div>
        </div>
      </div>
      <div className="mt-2.5">
        <Segmented<Kind>
          label={t("info.avatar")}
          value={kind}
          options={(["default", "emoji", "color", "picture"] as const).map((k) => ({ value: k, label: t(`info.avatar.${k}` as MessageKey) }))}
          onChange={(k) => {
            setKind(k);
            if (k !== "color") setFace(k);
            // Start 表情 from the emoji the agent shows now, so 「确定」 right away keeps the look.
            if (k === "emoji" && !emoji.trim() && emojiMode) setEmoji(themedEmoji(seed, theme).glyph);
            setError(null);
          }}
        />
      </div>
      <div className="mt-2 min-h-[4.5rem]">
        {kind === "default" && (
          <p className="text-xs text-subtle">{t(agentAvatarDefault === "important" ? "info.avatar.defaultHintImportant" : emojiMode ? "info.avatar.defaultHintEmoji" : "info.avatar.defaultHintLetter")}</p>
        )}
        {kind === "emoji" && (
          <div className="space-y-2">
            <EmojiGrid value={emoji} onPick={(g) => setEmoji(g)} className="max-h-52 overflow-y-auto pr-1" />
            {otherOpen ? (
              <div className="space-y-1">
                <input
                  autoFocus
                  value={customEmoji || !bundledEmoji(emoji) ? emoji : ""}
                  maxLength={AVATAR_VALUE_MAX}
                  placeholder={t("info.emojiPlaceholder")}
                  aria-label={t("info.avatar.other")}
                  onChange={(e) => setEmoji(e.target.value)}
                  className={FIELD}
                />
                <p className="text-[11px] text-subtle">{t("info.avatar.otherHint")}</p>
              </div>
            ) : (
              <button type="button" onClick={() => setOtherOpen(true)} className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground">
                {t("info.avatar.other")}
              </button>
            )}
          </div>
        )}
        {kind === "color" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {combineColor && (
                <button type="button" onClick={() => setTint(null)} title={t("info.avatar.profileColor")} aria-label={t("info.avatar.profileColor")} aria-pressed={tint === null}
                  className="h-6 rounded-full border border-dashed border-border px-2 text-[11px] text-muted aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface">
                  {t("info.avatar.profileColor")}
                </button>
              )}
              {AVATAR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pick(c)}
                  title={c}
                  aria-label={c}
                  aria-pressed={picked?.toLowerCase() === c}
                  className="h-6 w-6 rounded-full aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface"
                  style={{ background: c }}
                />
              ))}
              <label className="ml-1 flex cursor-pointer items-center gap-1 text-xs text-muted" title={t("info.customColor")}>
                <input type="color" value={isHexColor(picked) ? picked : (color && isHexColor(color) ? color : "#4c8dff")} onChange={(e) => pick(e.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
                {t("info.customColor")}
              </label>
            </div>
            <p className="text-xs text-subtle">{t(combineColor ? "info.avatar.colorHintCombined" : "info.avatar.colorHint")}</p>
            {!combineColor && <p className="text-[11px] text-subtle/80">{t("info.avatar.colorComboUnsupported")}</p>}
          </div>
        )}
        {kind === "picture" && (
          <div className="space-y-2">
            <button type="button" onClick={() => { setError(null); fileInput.current?.click(); }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-surface-2">
              <Upload size={13} />{t(picture ? "info.avatar.replacePicture" : "info.avatar.upload")}
            </button>
            <p className="text-xs text-subtle">{t(icon && !picture ? "info.avatar.pictureElsewhere" : "info.avatar.pictureHint")}</p>
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <div className="mt-3 mb-1 text-xs text-muted">{t("info.note")}</div>
      <textarea
        rows={3}
        value={note}
        placeholder={t("info.notePlaceholder")}
        onChange={(e) => setNote(e.target.value)}
        className={FIELD}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => done(null)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2">
          {t("dialog.cancel")}
        </button>
        <button type="button" onClick={save} disabled={shown === "picture" && !icon} className="rounded-md bg-accent px-3 py-1 text-sm text-white disabled:opacity-50">
          {t("dialog.ok")}
        </button>
      </div>
    </div>
  );
}

function previewCaption(kind: Kind, emojiMode: boolean, emoji: string, hasPicture: boolean, t: (key: MessageKey) => string): string {
  if (kind === "default" || kind === "color" || (kind === "emoji" && !emoji.trim()) || (kind === "picture" && !hasPicture)) return t(emojiMode ? "info.avatar.followsEmoji" : "info.avatar.followsLetter");
  if (kind === "emoji") return t(bundledEmoji(emoji) ? "info.avatar.bundledEmoji" : "info.avatar.systemEmoji");
  return t("info.avatar.pictureLocal");
}

/** Combined mode: the face plus the avatar's own colour. An empty emoji / missing picture = the default face. */
function combinedAvatar(face: Face, emoji: string, icon: SessionAvatar | null, tint: string | null): SessionAvatar | null {
  const color = tint ? { color: tint } : {};
  if (face === "emoji" && emoji.trim()) return cleanAvatar({ kind: "emoji", value: emoji, ...color });
  if (face === "picture" && icon) return cleanAvatar({ kind: "icon", value: icon.value, ...color });
  return tint ? { kind: "color", value: tint } : null;
}
