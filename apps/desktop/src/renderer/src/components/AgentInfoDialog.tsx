import { badgeColor, badgeDraft, validBadgeText } from "../lib/sessionBadge";
import { BadgeTintPicker } from "./BadgeTintPicker";
// 编辑信息: 显示名, avatar and note in one dialog; all are cutex session metadata
// (`cutex/session/metadata/update`), saved by the caller. 显示名 = cutex `displayNameOverride`, display
// only (lib/agentAlias): the real name stays what the agent is addressed by. Avatar tabs: 默认 = null
// (Settings → 外观 → 默认头像 decides: emoji from the id or the letter), 表情 = `emoji`, 图片 = `icon`
// pointing at a device-local picture (lib/agentPicture, saved here before the caller writes cutex),
// 颜色 = the circle colour. With `agent-avatar-color` the colour combines with the face (`color` on an
// emoji / icon avatar, a `color` avatar for the default face); without it 颜色 is a face of its own
// (`color` avatar: the glyph stays the default one) and a picked emoji uses the profile colour.
// 「拟人 / {{director}}头像」 = `icon` pointing at a 拟人头像包 picture (lib/portraitPacks) or a portrait of
// lib/directorAvatars (both resolved on this device); a Director sees that tab first and, with no avatar of its
// own yet, opens on it (nothing changes until a pick).
import { useRef, useState } from "react";
import type { AvatarMode, SessionAvatar } from "@cutex-desktop/protocol";
import { Upload } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { AVATAR_PALETTE, AVATAR_VALUE_MAX, cleanAvatar, hashColor, isHexColor, type AgentInfo, type AgentInfoOptions } from "../lib/avatar";
import { DISPLAY_NAME_MAX } from "../lib/agentAlias";
import { agentPictureOf, avatarSourceProblem, newPictureAvatar, saveAgentPicture } from "../lib/agentPicture";
import { bundledEmoji } from "../lib/agentEmoji";
import { shownStyleAvatar } from "../lib/avatarStyleAssign";
import { themedEmoji } from "../lib/avatarThemes";
import { useAgentLook } from "../lib/agentLook";
import { closeDialog } from "../lib/contextMenu";
import { useUiPrefs } from "../lib/prefs";
import { Avatar } from "./Avatar";
import { ProjectBadge } from "./ProjectBadge";
import { isImeComposing } from "../lib/ime";
import { BadgeTextInput } from "./BadgeTextInput";
import type { SessionBadge } from "@cutex-desktop/protocol";
import { EmojiGrid } from "./EmojiGrid";
import { DirectorAvatarGrid } from "./DirectorAvatarGrid";
import { PortraitPackGrid } from "./PortraitPackGrid";
import { avatarTabs, initialAvatarTab, isGalleryAvatar, type AvatarTab } from "../lib/directorAvatars";
import { InfoTip, Segmented } from "./settings/Form";
import { ProfilePictureCrop } from "./settings/ProfilePictureCrop";
import { btn } from "./Button";
import { useOwnerDocument } from "../lib/ownerContext";
import { AgentOwnName } from "./AgentOwnName";

type Kind = AvatarTab | "inherit";
/** What sits inside the circle (combined mode; 颜色 is not a face there). */
type Face = "default" | "emoji" | "picture" | "portrait";

const FIELD = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function AgentInfoDialog({ name, color, seed, initial, options, resolve }: { name: string; color: string | null; seed: string; initial: AgentInfo; options: AgentInfoOptions; resolve(v: AgentInfo | null): void }) {
  const doc = useOwnerDocument();
  const { t } = useI18n();
  const { portraitPacks } = useUiPrefs();
  // 仅重要智能体 draws the emoji too (the dot is a list-row thing, never this preview).
  const look = useAgentLook(seed);
  const emojiMode = look?.style?.kind !== "letter";
  const [resetStyle, setResetStyle] = useState(false);
  const theme = look?.themes;
  const isDirector = !!look?.isDirector;
  const { combineColor, editName, rename } = options;
  // 自己的名字 renamed in this dialog: the 显示名称 hint and placeholder follow (displayNameOverride stays).
  const [ownName, setOwnName] = useState(options.ownName ?? null);
  const realName = ownName && ownName !== options.ownName && options.realName === options.ownName ? ownName : options.realName;
  const start = options.editAvatarMode && initial.avatarMode === "inherit" ? null : initial.avatar;
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(initial.avatarMode ?? null);
  const fixed = () => { if (options.editAvatarMode) setAvatarMode("fixed"); };
  const [kind, setKind] = useState<Kind>(() => options.editAvatarMode && initial.avatarMode === "inherit" ? "inherit" : initialAvatarTab(start, isDirector));
  const [face, setFace] = useState<Face>(() => { const k = initialAvatarTab(start, isDirector); return k === "color" ? "default" : k; });
  // 「{{director}}头像」: the picked portrait (an icon avatar; null = none picked yet).
  const [portrait, setPortrait] = useState<SessionAvatar | null>(isGalleryAvatar(start) && start ? { kind: "icon", value: start.value } : null);
  // Combined mode: the avatar's own circle colour (null = the profile colour).
  const [tint, setTint] = useState<string | null>(start?.kind === "color" ? start.value : isHexColor(start?.color) ? start.color : null);
  const [badgeText, setBadgeText] = useState(initial.badge?.text ?? "");
  const [badgeComposing, setBadgeComposing] = useState(false);
  const [badgeTint, setBadgeTint] = useState<NonNullable<SessionBadge["tint"]>>(initial.badge?.tint ?? "blue");
  const badge = badgeDraft(badgeText, badgeTint, initial.badge);
  const [alias, setAlias] = useState(initial.displayName ?? "");
  const [emoji, setEmoji] = useState(start?.kind === "emoji" ? start.value : "");
  // A typed emoji outside the bundled set opens 「其他…」 right away.
  const [otherOpen, setOtherOpen] = useState(start?.kind === "emoji" && !bundledEmoji(start.value));
  const [swatch, setSwatch] = useState(start?.kind === "color" ? start.value : (color ?? hashColor(name)));
  // 图片: the stored icon avatar (kept as is unless replaced) or a freshly cropped one.
  const [icon, setIcon] = useState<SessionAvatar | null>(start?.kind === "icon" && !isGalleryAvatar(start) ? start : null);
  const [picture, setPicture] = useState<string | null>(() => (start?.kind === "icon" && !isGalleryAvatar(start) ? agentPictureOf(start) : null));
  const [fresh, setFresh] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState(initial.note ?? "");
  const avatar: SessionAvatar | null = kind === "inherit" ? null : combineColor ? combinedAvatar(face, emoji, face === "portrait" ? portrait : icon, tint) :
    kind === "emoji" ? cleanAvatar({ kind: "emoji", value: emoji }) : kind === "color" ? { kind: "color", value: swatch } : kind === "picture" && icon ? { kind: "icon", value: icon.value } :
    kind === "portrait" && portrait ? { kind: "icon", value: portrait.value } : null;
  const shown: Kind = kind === "inherit" ? "inherit" : combineColor ? face : kind;
  const shownPicture = shown === "picture" ? picture : null;
  const pick = (c: string) => { fixed(); if (combineColor) setTint(c); else setSwatch(c); };
  const picked = combineColor ? tint : swatch;
  const done = (v: AgentInfo | null) => {
    closeDialog();
    resolve(v);
  };
  const save = () => {
    if (badgeComposing || isImeComposing({ target: doc.activeElement })) return;
    if (options.editBadge && !validBadgeText(badgeText)) { setError(t("info.badgeHint")); return; }
    if (kind === "picture" && fresh && icon && picture) {
      try {
        saveAgentPicture(icon, picture);
      } catch {
        setError(t("info.avatar.pictureSaveFailed"));
        return;
      }
    }
    const baseAvatar = shown === "default" && resetStyle && look?.hostId ? shownStyleAvatar(seed, look.hostId) : avatar;
    const savedAvatar = baseAvatar && shown === "default" && resetStyle && combineColor && isHexColor(tint) ? { ...baseAvatar, color: tint.toLowerCase() } : baseAvatar;
    done({ avatar: avatarMode === "inherit" && options.editAvatarMode ? null : savedAvatar, ...(options.editAvatarMode ? { avatarMode } : {}), note, ...(options.editBadge ? { badge } : {}), ...(editName ? { displayName: alias } : {}) });
  };
  const shownName = (editName ? alias.trim() : "") || (editName ? realName : name);
  const resetPreview = shown === "default" && resetStyle && look?.hostId ? shownStyleAvatar(seed, look.hostId) : avatar;
  const previewAvatar = resetPreview && shown === "default" && resetStyle && combineColor && isHexColor(tint) ? { ...resetPreview, color: tint.toLowerCase() } : resetPreview;
  const preview = { name: shownName, color, seed, avatar: previewAvatar, ...(options.editAvatarMode ? { avatarMode } : {}), picture: shown === "picture" ? shownPicture : null };
  const customEmoji = kind === "emoji" && !!emoji.trim() && !bundledEmoji(emoji);
  return (
    <div
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
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
            fixed();
            setIcon(newPictureAvatar());
            setPicture(next);
            setFresh(true);
            setCropFile(null);
          }} />
      )}
      <div className="mb-3 text-sm font-medium">{t("menu.editInfo").replace(/…$/, "")}</div>
      {editName ? (
        <div className="mb-3">
          {/* 显示名称 (owner 2026-11-05: folded in from the menu; first field, focused): what it changes sits behind the ⓘ. */}
          <div className="mb-1.5 flex items-center gap-1">
            <label className="text-xs text-muted" htmlFor="agent-info-alias">{t("info.displayName")}</label>
            <InfoTip id="agent-info-alias-hint">{ownName ? t("menu.displayNameHint", { name: ownName }) : t("menu.displayNameHintNoFormal")}</InfoTip>
          </div>
          <input id="agent-info-alias" autoFocus value={alias} maxLength={DISPLAY_NAME_MAX} placeholder={realName} onChange={(e) => setAlias(e.target.value)} className={FIELD} />
        </div>
      ) : (
        <p className="mb-3 text-caption/[inherit] text-subtle">{t("info.displayNameUnsupported")}</p>
      )}
      {rename && (ownName || rename.archived) && <AgentOwnName host={rename.host} sessionId={rename.sessionId} revision={rename.revision} archived={rename.archived} ownName={ownName ?? ""} onRenamed={setOwnName} />}
      {options.editBadge && <div className="mb-3 space-y-1.5">
        <label htmlFor="agent-info-badge" className="block text-xs text-muted">{t("info.badge")}</label>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
          <BadgeTextInput id="agent-info-badge" value={badgeText} onChange={setBadgeText} onCompositionChange={setBadgeComposing} className={FIELD} placeholder={t("info.badgePlaceholder")} />
          <BadgeTintPicker value={badgeTint} onChange={setBadgeTint} />
          {badge && <ProjectBadge badge={badge.text} color={badgeColor(badgeTint)} />}
        </div>
        <p className="text-caption/[inherit] text-subtle">{t("info.badgeHint")}</p>
      </div>}
      <div className="mb-1.5 text-xs text-muted">{t("info.avatar")}</div>
      <div className="flex items-center gap-4 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5">
        <Avatar {...preview} size={40} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-surface-2/70 px-1.5 py-1" title={t("info.avatar.sidebarSize")}>
            <Avatar {...preview} size={20} />
            <span className="truncate text-sm">{shownName}</span>
          </div>
          <div className="truncate px-0.5 text-caption/[inherit] text-subtle">{previewCaption(shown, emojiMode, emoji, shown === "portrait" ? !!portrait : !!shownPicture, t, portraitPacks.length > 0 && !!look && look.family !== "other")}{combineColor && tint ? ` · ${t("info.avatar.ownColor")}` : ""}</div>
        </div>
      </div>
      <div className="mt-2.5">
        <Segmented<Kind>
          label={t("info.avatar")}
          value={kind}
          options={[...(options.editAvatarMode ? [{ value: "inherit" as const, label: t("avatarStyle.followProfile" as MessageKey) }] : []), ...avatarTabs(isDirector).map((k) => ({ value: k, label: t(k === "default" ? "avatarStyle.reset" as MessageKey : k === "portrait" ? "info.avatar.gallery" : (`info.avatar.${k}` as MessageKey)) }))]}
          onChange={(k) => {
            setKind(k);
            if (k === "inherit") setAvatarMode("inherit"); else fixed();
            if (k === "default") setResetStyle(true);
            if (k !== "color" && k !== "inherit") setFace(k);
            // Start 表情 from the emoji the agent shows now, so 「确定」 right away keeps the look.
            if (k === "emoji" && !emoji.trim() && emojiMode) setEmoji(themedEmoji(seed, theme).glyph);
            setError(null);
          }}
        />
      </div>
      <div className="mt-2 min-h-[4.5rem]">
        {kind === "inherit" && <p className="text-xs text-subtle">{t("avatarStyle.followProfileHint" as MessageKey)}</p>}
        {kind === "default" && (
          <p className="text-xs text-subtle">{t("avatarStyle.resetHint" as MessageKey)}</p>
        )}
        {kind === "emoji" && (
          <div className="space-y-2">
            <EmojiGrid value={emoji} onPick={(g) => { fixed(); setEmoji(g); }} className="max-h-52 overflow-y-auto pr-1" />
            {otherOpen ? (
              <div className="space-y-1">
                <input
                  autoFocus
                  value={customEmoji || !bundledEmoji(emoji) ? emoji : ""}
                  maxLength={AVATAR_VALUE_MAX}
                  placeholder={t("info.emojiPlaceholder")}
                  aria-label={t("info.avatar.other")}
                  onChange={(e) => { fixed(); setEmoji(e.target.value); }}
                  className={FIELD}
                />
                <p className="text-caption/[inherit] text-subtle">{t("info.avatar.otherHint")}</p>
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
                <button type="button" onClick={() => { fixed(); setTint(null); }} title={t("info.avatar.profileColor")} aria-label={t("info.avatar.profileColor")} aria-pressed={tint === null}
                  className="h-6 rounded-full border border-dashed border-border px-2 text-caption/[inherit] text-muted aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface">
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
            {!combineColor && <p className="text-caption/[inherit] text-subtle/80">{t("info.avatar.colorComboUnsupported")}</p>}
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
        {kind === "portrait" && (
          <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
            <div className="space-y-1">
              <div className="text-caption/[inherit] text-subtle">{t("info.avatar.packs")}</div>
              <PortraitPackGrid value={portrait} family={look?.family} onPick={(next) => { fixed(); setPortrait(next); }} size={32} />
            </div>
            <div className="space-y-1">
              <div className="text-caption/[inherit] text-subtle">{t("info.avatar.portrait")}</div>
              <DirectorAvatarGrid value={portrait} onPick={(next) => { fixed(); setPortrait(next); }} columns={8} size={32} />
            </div>
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
        <button type="button" onClick={save} disabled={shown === "picture" && !icon} className={btn({ variant: "primary" })}>
          {t("dialog.ok")}
        </button>
      </div>
    </div>
  );
}

/** `portraits`: 拟人头像 themes are on (and fit the agent's family), so the default is a character avatar. */
function previewCaption(kind: Kind, emojiMode: boolean, emoji: string, hasPicture: boolean, t: (key: MessageKey) => string, portraits = false): string {
  if (kind === "inherit") return t("avatarStyle.followProfile" as MessageKey);
  if (kind === "default" || kind === "color" || (kind === "emoji" && !emoji.trim()) || ((kind === "picture" || kind === "portrait") && !hasPicture)) return t(portraits ? "info.avatar.followsPortrait" : emojiMode ? "info.avatar.followsEmoji" : "info.avatar.followsLetter");
  if (kind === "emoji") return t(bundledEmoji(emoji) ? "info.avatar.bundledEmoji" : "info.avatar.systemEmoji");
  if (kind === "portrait") return t("info.avatar.portraitLocal");
  return t("info.avatar.pictureLocal");
}

/** Combined mode: the face plus the avatar's own colour. An empty emoji / missing picture = the default face. */
function combinedAvatar(face: Face, emoji: string, icon: SessionAvatar | null, tint: string | null): SessionAvatar | null {
  const color = tint ? { color: tint } : {};
  if (face === "emoji" && emoji.trim()) return cleanAvatar({ kind: "emoji", value: emoji, ...color });
  if ((face === "picture" || face === "portrait") && icon) return cleanAvatar({ kind: "icon", value: icon.value, ...color });
  return tint ? { kind: "color", value: tint } : null;
}
