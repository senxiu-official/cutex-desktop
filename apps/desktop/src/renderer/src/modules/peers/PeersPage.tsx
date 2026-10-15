// Settings → 互联 (cutex peers-v2), its own host page: the global `peers` settings, 「邀请对方」 (a one-time
// code + this host's addresses to copy, and 「复制邀请」 = one line `<url> <code>`, model.ts inviteText)
// and 「加入对方」 (address + code + name; pasting that line fills both, the target host:port is shown
// back before pairing), the peer list (state,
// last seen, in-flight / outbox counts, the user it belongs to — linked to 用户 → 对端主机 —, enable)
// and, for one peer, PeerDetail. Writes are
// loopback-only in cutex: a `loopback_only` refusal turns the page read-only for that connection.
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PEER_LABEL, PEERS_SETTINGS_RANGE, type PeerInvite, type PeersSettings, type PeerView } from "../../../../shared/peers";
import { MaskedText } from "../../components/MaskedText";
import { Button, EmptyState, ErrorNote, ListRow, Loading, Notice, NumberField, Section, SettingRow, TextInput, Toggle } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { formatSpan } from "../../lib/delegations";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { shownUserName, USERS_FEATURE } from "../../../../shared/users";
import { useApp } from "../../store";
import { formatAbsolute, formatWhen, useClock, useNow } from "../../lib/time";
import { usePeers, usePeersSettings, usePeerWrite, usePeerWrites } from "./hooks";
import { inviteText, isFullInvite, outboxAgeSecs, outboxTone, parseInvite, PEER_TONE_TEXT as TONE_TEXT, peerErrorText, urlTarget } from "./model";
import { PeerDetail } from "./PeerDetail";
import { CopyButton, CopyInviteButton, ReadOnlyNotice, StateBadge } from "./PeerParts";

function GlobalSection() {
  const { t } = useI18n();
  const api = useTargetApi();
  const write = usePeerWrite();
  const { readOnly } = usePeerWrites();
  const { value, setValue, error, setError } = usePeersSettings();
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<PeersSettings>) => {
    setSaving(true);
    setError(null);
    const s = await write(() => api.patchPeersSettings(patch), setError);
    if (s?.peers) setValue(s.peers);
    setSaving(false);
  };
  const number = (key: keyof typeof PEERS_SETTINGS_RANGE, unit: "hours" | "secs" | null, hint?: MessageKey) => (
    <SettingRow key={key} label={t(`peers.${key}` as MessageKey)} hint={hint ? t(hint) : undefined}>
      <NumberField value={value?.[key] ?? null} range={PEERS_SETTINGS_RANGE[key]} unit={unit ? t(`peers.unit.${unit}`) : undefined} disabled={readOnly || saving} label={t(`peers.${key}` as MessageKey)} onCommit={(v) => v !== null && void save({ [key]: v })} />
    </SettingRow>
  );
  return (
    <Section id={settingsAnchorId("peers-settings")} title={t("peers.settings")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {value === undefined && !error && <Loading rows={2} />}
      {value === null && <Notice>{t("peers.unsupported")}</Notice>}
      {value && (
        <>
          <SettingRow label={t("peers.enabled")} hint={t("peers.enabledHint")}>
            <Toggle checked={value.enabled} disabled={readOnly || saving} label={t("peers.enabled")} onChange={(on) => void save({ enabled: on })} />
          </SettingRow>
          {number("outboxMaxAgeHours", "hours", "peers.outboxMaxAgeHoursHint")}
          {number("maxHops", null, "peers.maxHopsHint")}
          {number("refreshAgentsSecs", "secs")}
          {number("connectTimeoutSecs", "secs")}
          {number("readTimeoutSecs", "secs")}
        </>
      )}
    </Section>
  );
}

function InviteRow() {
  const { t } = useI18n();
  const api = useTargetApi();
  const write = usePeerWrite();
  const { readOnly } = usePeerWrites();
  const [label, setLabel] = useState("");
  const [invite, setInvite] = useState<PeerInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(!!invite);
  const badLabel = !!label && !PEER_LABEL.test(label);
  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await write(() => api.createPeerInvite(label ? { label } : {}), setError);
    if (r) setInvite(r);
    setBusy(false);
  };
  const left = invite ? Math.max(0, Math.floor((Date.parse(invite.expiresAt) - now) / 1000)) : 0;
  return (
    <div className="border-b border-border py-2.5" data-testid="peers-invite">
      <SettingRow label={t("peers.invite")} hint={t("peers.inviteHint")}>
        <TextInput value={label} onChange={setLabel} placeholder={t("peers.inviteLabelPlaceholder")} width="w-40" label={t("peers.inviteLabel")} disabled={readOnly || busy} />
        <Button primary onClick={() => void create()} disabled={readOnly || busy || badLabel}>
          {t("peers.inviteCreate")}
        </Button>
      </SettingRow>
      {badLabel && <ErrorNote>{t("peers.badLabel")}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {invite && (
        <div className="mb-1 rounded-lg bg-surface-2/60 px-3 py-2 text-xs">
          <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
            <span className="w-16 shrink-0 text-subtle">{t("peers.inviteLine")}</span>
            <span className="min-w-0 flex-1 font-mono text-[11px] break-all select-all" data-testid="peers-invite-line">
              {inviteText(invite)}
            </span>
            <CopyInviteButton text={inviteText(invite)} disabled={left <= 0} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-subtle">{t("peers.inviteCode")}</span>
            <span className="font-mono text-base font-semibold tracking-wider">{invite.code}</span>
            <CopyButton text={invite.code} />
            <span className={`ml-auto ${left > 0 ? "text-subtle" : "text-danger"}`}>{left > 0 ? t("peers.inviteExpires", { t: formatSpan(left) }) : t("peers.inviteExpired")}</span>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-subtle">{t("peers.inviteUrls")}</span>
            <div className="min-w-0 flex-1">
              {invite.urls.length === 0 && <p className="py-1 text-warn">{t("peers.inviteNoUrls")}</p>}
              {invite.urls.map((u) => (
                <div key={u} className="flex items-center gap-1">
                  <span className="min-w-0 font-mono text-[11px] break-all">{u}</span>
                  <CopyButton text={u} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-subtle">
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-[11px]">
              {invite.hostId} · <MaskedText value={invite.instanceId} keep={7} className="font-mono text-[11px]" testId="peers-invite-instance" />
            </span>
            <Button onClick={() => setInvite(null)}>{t("peers.inviteDone")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function JoinRow({ onJoined }: { onJoined(peer: PeerView): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const write = usePeerWrite();
  const { readOnly } = usePeerWrites();
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const badLabel = !!label.trim() && !PEER_LABEL.test(label.trim());
  const target = url.trim() ? urlTarget(url) : null;
  // Pasting the one-line invite (`<url> <code>`) into either field fills both.
  const take = (v: string, set: (v: string) => void) => {
    if (!isFullInvite(v)) return set(v);
    const p = parseInvite(v);
    setUrl(p.url ?? "");
    setCode(p.code ?? "");
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const peer = await write(() => api.addPeer({ url: url.trim(), code: code.trim(), ...(label.trim() ? { label: label.trim() } : {}) }), setError);
    setBusy(false);
    if (!peer) return;
    setUrl("");
    setCode("");
    setLabel("");
    onJoined(peer);
  };
  return (
    <div className="py-2.5" data-testid="peers-join">
      <div className="text-sm">{t("peers.join")}</div>
      <div className="text-xs text-subtle">{t("peers.joinHint")}</div>
      <div className="mt-2 flex">
        <TextInput value={url} onChange={(v) => take(v, setUrl)} placeholder={t("peers.joinUrlPlaceholder")} mono width="w-full min-w-0" label={t("peers.joinUrl")} disabled={readOnly || busy} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TextInput value={code} onChange={(v) => take(v, setCode)} placeholder={t("peers.joinCode")} mono width="w-40" label={t("peers.joinCode")} disabled={readOnly || busy} />
        <TextInput value={label} onChange={setLabel} placeholder={t("peers.joinLabelPlaceholder")} width="w-52" label={t("peers.joinLabel")} disabled={readOnly || busy} />
        <Button primary onClick={() => void submit()} disabled={readOnly || busy || !target || !code.trim() || badLabel}>
          {t("peers.joinSubmit")}
        </Button>
      </div>
      {url.trim() && (
        <div className="mt-1.5 space-y-0.5 text-xs" data-testid="peers-join-target">
          {!target && <p className="text-warn">{t("peers.joinBadUrl")}</p>}
          {target && (
            <p className="text-subtle">
              {t("peers.joinTarget", { host: target.host, port: target.port })}
              {code.trim() && <span className="font-mono"> · {t("peers.joinCodeShape", { code: code.trim() })}</span>}
            </p>
          )}
          {target && !target.explicitPort && <p className="text-warn">{t("peers.joinNoPort", { port: target.port })}</p>}
          {target?.path && <p className="text-warn">{t("peers.joinUrlPath")}</p>}
        </div>
      )}
      {badLabel && <ErrorNote>{t("peers.badLabel")}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** One peer: state · last seen · in flight · outbox; the enable toggle; click = details. */
/**
 * Who each peer belongs to on this host (cutex `users`, owner connections: `GET /v2/users` peers → the
 * user's shown name); empty without users. Re-read when the peer list changes.
 */
function usePeerOwners(peerIds: string): ReadonlyMap<string, string> {
  const api = useTargetApi();
  const withUsers = useTargetFeatures().has(USERS_FEATURE);
  const [owners, setOwners] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    setOwners(new Map());
    if (!withUsers) return;
    let live = true;
    api.users().then(
      (list) => {
        if (!live || !list) return;
        const names = new Map(list.users.map((u) => [u.id, shownUserName(u)]));
        setOwners(new Map(list.peers.map((p) => [p.peerId, names.get(p.userId) ?? p.userId])));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, withUsers, peerIds]);
  return owners;
}

/** 用户 → 对端主机 (where a peer's user is changed). */
const openPeerUsers = () => useApp.getState().openSettings("users", { anchor: "users-peers" });

function PeerRow({ peer, owner, maxAgeHours, onOpen, onToggle, readOnly }: { peer: PeerView; owner: string | undefined; maxAgeHours: number | null; onOpen(): void; onToggle(on: boolean): void; readOnly: boolean }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const seen = peer.lastSeenAt ? Date.parse(peer.lastSeenAt) / 1000 : NaN;
  const age = outboxAgeSecs(peer.outboxOldestAt, now);
  const pending = peer.outboxPending ?? 0;
  const err = peerErrorText(peer.lastError, (key, vars) => t(key as MessageKey, vars));
  const probe = peer.state === "unreachable" && peer.nextProbeAt ? Date.parse(peer.nextProbeAt) : NaN;
  const detail = (
    <span className="flex min-w-0 items-center gap-2">
      <StateBadge peer={peer} />
      <span className="shrink-0" title={Number.isFinite(seen) ? formatAbsolute(seen) : undefined}>
        {Number.isFinite(seen) ? t("peers.lastSeen", { t: formatWhen(seen, now, locale) }) : t("peers.neverSeen")}
      </span>
      {Number.isFinite(probe) && probe > now && <span className="shrink-0">· {t("peers.nextProbe", { t: formatSpan(Math.ceil((probe - now) / 1000)) })}</span>}
      {peer.inflight && (peer.inflight.inbound > 0 || peer.inflight.outbound > 0) && (
        <span className="shrink-0" title={t("peers.inflightTitle", { out: peer.inflight.outbound, in: peer.inflight.inbound })}>
          · {t("peers.inflight", { out: peer.inflight.outbound, in: peer.inflight.inbound })}
        </span>
      )}
      {pending > 0 && (
        <span className={`shrink-0 ${TONE_TEXT[outboxTone(age, maxAgeHours)]}`} title={t("peers.outboxTitle")}>
          · {age !== null ? t("peers.outboxAge", { n: pending, t: formatSpan(age) }) : t("peers.outbox", { n: pending })}
        </span>
      )}
      {(peer.deadLetterCount ?? 0) > 0 && <span className="shrink-0 text-danger">· {t("peers.deadLetters", { n: peer.deadLetterCount ?? 0 })}</span>}
      {owner && (
        <button type="button" className="shrink-0 rounded hover:text-accent hover:underline" title={t("users.peers.belongsToHint")} onClick={openPeerUsers} data-testid="peer-owner">
          · {t("users.peers.belongsTo", { user: owner })}
        </button>
      )}
    </span>
  );
  return (
    <ListRow
      title={
        <button onClick={onOpen} className="flex min-w-0 items-baseline gap-2 text-left hover:underline" data-testid="peer-row">
          <span className="font-medium">{peer.label}</span>
          <span className="truncate text-xs text-subtle">
            {peer.hostId}
            {peer.platform ? ` · ${peer.platform}` : ""}
          </span>
        </button>
      }
      detail={detail}
      actions={
        <>
          <Toggle checked={peer.enabled} disabled={readOnly || peer.state === "removedByPeer"} label={t("peers.enable")} onChange={onToggle} />
          <button onClick={onOpen} aria-label={t("peers.open")} title={t("peers.open")} className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-foreground">
            <ChevronRight size={14} />
          </button>
        </>
      }
      below={err ? <p className="truncate pb-0.5 pl-0 text-[11px] text-subtle" title={err.title}>{err.text}</p> : undefined}
    />
  );
}

export function PeersPage() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const api = useTargetApi();
  const write = usePeerWrite();
  const { readOnly } = usePeerWrites();
  const peers = usePeers();
  const owners = usePeerOwners((peers.list ?? []).map((p) => p.id).join(","));
  const settings = usePeersSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => setOpen(null), [hostId]);
  const openPeer = open ? (peers.list?.find((p) => p.id === open) ?? null) : null;
  if (open && openPeer)
    return (
      <>
        <ReadOnlyNotice />
        <PeerDetail
          peer={openPeer}
          onBack={() => setOpen(null)}
          onChanged={peers.put}
          onDeleted={(p) => {
            peers.drop(p.id);
            setOpen(null);
            setNotice({ text: t("peers.deleted", { label: p.label }), error: false });
          }}
        />
      </>
    );
  const toggle = async (peer: PeerView, on: boolean) => {
    setNotice(null);
    const next = await write(() => api.patchPeer(peer.id, { enabled: on }), (text) => setNotice({ text, error: true }));
    if (next) peers.put(next);
  };
  return (
    <>
      <ReadOnlyNotice />
      <GlobalSection />
      <Section id={settingsAnchorId("peers-pair")} title={t("peers.pair")}>
        <InviteRow />
        <JoinRow
          onJoined={(peer) => {
            peers.put(peer);
            void peers.load();
            setNotice({ text: t("peers.joined", { label: peer.label }), error: false });
          }}
        />
      </Section>
      <Section id={settingsAnchorId("peers-list")} title={t("peers.list")}>
        {notice && (notice.error ? <ErrorNote>{notice.text}</ErrorNote> : <Notice tone="info">{notice.text}</Notice>)}
        {peers.error && <ErrorNote>{peers.error}</ErrorNote>}
        {peers.unsupported && <Notice>{t("peers.unsupported")}</Notice>}
        {!peers.list && !peers.unsupported && !peers.error && <Loading rows={2} />}
        {peers.list && peers.list.length === 0 && <EmptyState>{t("peers.none")}</EmptyState>}
        {peers.list?.map((p) => (
          <PeerRow key={p.id} peer={p} owner={owners.get(p.id)} maxAgeHours={settings.value?.outboxMaxAgeHours ?? null} readOnly={readOnly} onOpen={() => setOpen(p.id)} onToggle={(on) => void toggle(p, on)} />
        ))}
      </Section>
    </>
  );
}
