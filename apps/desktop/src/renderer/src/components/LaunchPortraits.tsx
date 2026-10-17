import { useState } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { PROVIDER_LABEL } from "../lib/provider";
import type { portraitChoices, PortraitProvider } from "../lib/launchPortraits";
import { useLaunchArt } from "../lib/launchArt";

// Art direction for this cast, not official provider character measurements.
const HEIGHT_CM: Record<PortraitProvider, number> = {
  codex: 174, claude: 168, deepseek: 162, glm: 158, kimi: 165, gemini: 166,
};
// Match eye lines, so horns/headpieces do not determine apparent character height.
const EYE_LINE: Record<PortraitProvider, number> = {
  codex: .485, claude: .406, deepseek: .456, glm: .464, kimi: .428, gemini: .292,
};
// A portrait framed wider than the redraw-v4 set: enlarged about its eye line, so the head matches
// the others and the eye line stays where HEIGHT_CM puts it (the extra body runs into the bottom fade).
// 1.6 makes the pupil distance the set's average (measured in the running app: others 65–75 px, mean ≈ 70).
const HEAD_ZOOM: Partial<Record<PortraitProvider, number>> = { gemini: 1.6 };
// Portraits whose crown runs off the top of the image: fade the image's top edge so the cut is not a
// hard line where the others still show hair or headpieces.
const TOP_FADE: Partial<Record<PortraitProvider, string>> = { gemini: "linear-gradient(to bottom, transparent, #000 9%)" };

function PortraitCaption({ provider, profiles, profileId, disabled, onSelect }: {
  provider: PortraitProvider; profiles: ProfileItem[]; profileId?: string; disabled?: boolean; onSelect(id: string): void;
}) {
  const { t } = useI18n();
  return <div className="launch-portrait-caption">
    <div className="launch-portrait-name">{PROVIDER_LABEL[provider]}</div>
    <div className="launch-portrait-profiles" role="group" aria-label={`${PROVIDER_LABEL[provider]} Profiles`}>
      {profiles.map((p) => <button key={p.id} type="button" className="launch-portrait-profile" disabled={disabled}
        title={p.name} aria-pressed={p.id === profileId}
        aria-label={t("launch.portrait.profile", { provider: PROVIDER_LABEL[provider], profile: p.name })}
        onClick={() => onSelect(p.id)}><span>{p.name}</span></button>)}
    </div>
  </div>;
}

export function LaunchPortraits({ choices, selected, profileId, disabled, onSelect }: {
  choices: ReturnType<typeof portraitChoices>;
  selected: PortraitProvider | null;
  profileId?: string;
  disabled?: boolean;
  onSelect(profileId: string): void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState<PortraitProvider | null>(null);
  const [focus, setFocus] = useState<PortraitProvider | null>(null);
  const active = hover ?? focus;
  // The victory pose animates in only when picked here, not when a launcher opens with a pick already
  // made (switching pages would replay it from opacity 0 each time).
  const [shown, setShown] = useState(selected);
  const [entering, setEntering] = useState(false);
  if (selected !== shown) {
    setShown(selected);
    setEntering(selected !== null);
  }
  const selectedProfiles = choices.find((c) => c.provider === selected)?.profiles ?? [];
  const art = useLaunchArt();
  const victory = selected ? art[selected]?.victory : undefined;
  return <div className="launch-portrait-stage">
    {selected && victory ? <div key={selected} className="launch-portrait-selected">
    <div className={`launch-victory${entering ? " is-entering" : ""}`}>
      <img className="launch-victory-soft" src={victory} alt="" aria-hidden="true" />
      <img className="launch-victory-sharp" src={victory} alt={t("launch.portrait.victory", { provider: PROVIDER_LABEL[selected] })} />
    </div>
      <PortraitCaption provider={selected} profiles={selectedProfiles} profileId={profileId} disabled={disabled} onSelect={onSelect} />
    </div> :
      <div className="launch-portrait-strip" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }} role="group" aria-label={t("launch.portrait.choose")}>
        {choices.map(({ provider, profile, profiles }) => <div key={provider}
          className={`launch-portrait-card${active && active !== provider ? " is-muted" : ""}`}
          onPointerEnter={() => setHover(provider)} onPointerLeave={() => setHover(null)}
          onFocus={() => setFocus(provider)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocus(null); }}>
          <button type="button" disabled={disabled} className="launch-portrait-pick"
          aria-label={t("launch.portrait.select", { provider: PROVIDER_LABEL[provider], profile: profile.name })}
          onClick={() => onSelect(profile.id)}>
          <div className="launch-portrait-figure">
            <img src={art[provider]?.portrait} style={{
              width: `${260 * HEIGHT_CM[provider] / 174 * (1 - EYE_LINE.codex) / (1 - EYE_LINE[provider])}%`,
              ...(provider === "codex" ? { transform: "translate(-50%, -10px) scale(0.94)", transformOrigin: "center bottom" } : {}),
              ...(HEAD_ZOOM[provider] ? { transform: `translateX(-50%) scale(${HEAD_ZOOM[provider]})`, transformOrigin: `center ${EYE_LINE[provider] * 100}%` } : {}),
              ...(TOP_FADE[provider] ? { maskImage: TOP_FADE[provider] } : {}),
            }} alt="" draggable={false} />
          </div>
          </button>
          <PortraitCaption provider={provider} profiles={profiles} disabled={disabled} onSelect={onSelect} />
        </div>)}
      </div>}
  </div>;
}
