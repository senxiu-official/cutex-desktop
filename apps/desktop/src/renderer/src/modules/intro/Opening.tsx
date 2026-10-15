// The intro.opening item's view: portrait (custom → provider artwork → none) above the greeting
// (custom → provider pool), centred like the launcher's entrance. No store writes, no daemon
// mutations — the only daemon read is the profile list (provider + stable id of the profile).
// Nothing renders until that lookup settles (or fails): a half-known session would flash the
// generic greeting before its own shows up.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { resolveIntroGreeting, resolveIntroPortrait, useIntroAppearanceOf } from "../../lib/introAppearance";
import { profileProvider, PROVIDER_SVG, type Provider } from "../../lib/provider";
import { resolveTerms, useTermOverrides } from "../../lib/terms";
import { daemonApiOf, useFocusHostId } from "../../lib/targetHost";
import type { TimelineIntroProps } from "../slots";

/** The session's host may not be the focus host; daemon calls go to the session's own host. */
interface ProfileEntry {
  id: string;
  provider: Provider | null;
}
interface ProfileIndex {
  /** false while the list is on its way — the opening waits rather than guessing. */
  ready: boolean;
  index: Map<string, ProfileEntry> | null;
}

/** Resolves the profile reference (a name) once per mount — profiles can be added or renamed
 *  while the app runs, so this is deliberately not cached across mounts (one cheap IPC). */
function useProfileEntry(hostId: string, profileName: string | null): ProfileIndex {
  const focus = useFocusHostId();
  const [state, setState] = useState<ProfileIndex>({ ready: false, index: null });
  useEffect(() => {
    let live = true;
    daemonApiOf(hostId, focus)
      .listProfiles()
      .then((r) => {
        if (live) setState({ ready: true, index: new Map((r?.profiles ?? []).map((p) => [p.name, { id: p.id, provider: profileProvider(p) }])) });
      }, () => {
        if (live) setState({ ready: true, index: null });
      });
    return () => {
      live = false;
    };
  }, [hostId, focus]);
  return state;
}

/** The host's provider hint (a string from the contract props) as far as this build knows it. */
function asProvider(v: string | null): Provider | null {
  return v && v in PROVIDER_SVG ? (v as Provider) : null;
}

export function Opening({ sessionId, hostId, profileName, providerKind, agentName }: TimelineIntroProps) {
  const { locale } = useI18n();
  const { ready, index } = useProfileEntry(hostId, profileName);
  const entry = profileName ? index?.get(profileName) ?? null : null;
  const stored = useIntroAppearanceOf(hostId, entry?.id || null);
  const owner = resolveTerms(useTermOverrides(), locale).owner.one;
  // The sample and the time-of-day window are decided once per mount (the outlet keys the item by
  // session): streaming re-renders never reroll the pool, and a sentence doesn't change mid-session.
  const [sample] = useState(() => Math.random());
  const [minute] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  const [broken, setBroken] = useState(false);
  if (profileName && !ready) return null;
  const provider = asProvider(providerKind) ?? entry?.provider ?? null;
  const custom = entry?.id ? stored : null;
  const portrait = broken ? null : resolveIntroPortrait(custom?.portrait ?? null, provider);
  const greeting = resolveIntroGreeting({
    custom: custom?.greeting ?? null,
    provider,
    locale,
    minute,
    owner,
    agentName,
    sample,
  });
  if (!portrait && !greeting) return null;
  return (
    <div className="timeline-intro-block" data-intro-session={sessionId}>
      {portrait && (
        <div className={`timeline-intro-figure${custom?.portrait ? "" : " is-provider"}`}>
          <img src={portrait} alt="" draggable={false} onError={() => setBroken(true)} />
        </div>
      )}
      {greeting && <p className="timeline-intro-greeting">{greeting}</p>}
    </div>
  );
}
