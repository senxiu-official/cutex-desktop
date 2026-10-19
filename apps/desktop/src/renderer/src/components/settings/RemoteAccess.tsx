// Settings → 接入: 监听地址 + 配对设备 + CORS (cutex `listen-settings` / `device-pairing`,
// docs/research/cutex-mobile-api.md §1, §2): which addresses the connected cutex's Management API
// listens on, the browser CORS allow-list and one-time pairing codes (QR). Paired devices are managed in
// 用户 → 设备 on a host with cutex `users` (one link row here, docs/research/identity-settings-review-
// 20261015.md §4.3); an older host keeps its list here (named by lib/deviceNames; cutex
// `client-token-rename`: a pencil renames one, TokenName.tsx).
// Everything is host-side state read / written over the daemon API; no token is ever shown here
// except the one-time pairing code.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Lock, ShieldAlert, Smartphone } from "lucide-react";
import type { ClientTokenView, GlobalSettings, ListenEntry, PairingCodeView } from "../../../../shared/ipc";
import { MaskedAddress } from "../MaskedAddress";
import { RenameTokenButton, TokenTitle } from "./TokenName";
import { CLIENT_TOKEN_RENAME_FEATURE } from "../../lib/deviceNames";
import { useI18n, type MessageKey } from "../../i18n";
import { qrPath } from "../../lib/qr";
import {
  checkCorsOrigin,
  checkListenEntry,
  entryAddress,
  entryStatus,
  formatCountdown,
  LISTEN_FEATURE,
  needsPairingBanner,
  needsRestart,
  newTokens,
  readListenSettings,
  secondsLeft,
  sortTokens,
  tokenName,
  unixSeconds,
} from "../../lib/remoteAccess";
import { formatWhen, useClock, useNow } from "../../lib/time";
import { useApp } from "../../store";
import { AddButton, ArmedRemove, Button, EmptyState, ErrorNote, ListRow, Loading, Notice, RefreshButton, ResetButton, Section, Select, TextInput, TextLink } from "./Form";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { OWNER_USER_ID, shownUserName, USERS_FEATURE, type UserRecord, accessRefusalOf, DEVICE_SCOPE_FEATURE, OWNER_DEVICE_NOTICE_FEATURE, type DeviceScope } from "../../../../shared/users";
import { accessRefusalText, scopeOptions, useOwnerLocalLock } from "./OwnerDevices";
import { useHostScope } from "../../lib/useHostScope";
import { useHostData } from "../../lib/useHostScope";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Daemons (baseUrl · hostId) whose listen list changed since they started: "重启后生效" survives leaving the page. */
const restartPending = new Set<string>();
const POLL_MS = 3000;
const PLATFORMS: ReadonlySet<string> = new Set(["android", "ios", "web", "other"]);
/** Pairing / revoking changes `remoteAccess` counts in `/v2/settings`: the 远程访问 banner re-reads. */
const tokenListeners = new Set<() => void>();
const tokensChanged = () => tokenListeners.forEach((fn) => fn());

/** The target host's connection (Settings → 远程访问 of the picked host). */
function useDaemonKey(): string | null {
  const daemon = useHostData(useTargetHostId())?.daemon ?? { kind: "unreachable" as const };
  return daemon.kind === "connected" ? `${daemon.baseUrl}·${daemon.hostId}` : null;
}

/** `/v2/settings` for these sections: load, reload, patch (keeps `restartRequired`). */
function useListenSettings(key: string | null) {
  const api = useTargetApi();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restart, setRestart] = useState(false);
  const load = useCallback(() => {
    setError(null);
    api.getSettings().then(setSettings, (e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    setSettings(null);
    setRestart(key !== null && restartPending.has(key));
    if (!key) return;
    load();
    tokenListeners.add(load);
    return () => void tokenListeners.delete(load);
  }, [key, load]);
  const patch = async (p: Partial<GlobalSettings>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.patchSettings(p);
      setSettings(next);
      if (needsRestart(next.restartRequired) && key) {
        restartPending.add(key);
        setRestart(true);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { settings, error, busy, restart, load, patch };
}

const KIND_KEYS: Record<string, MessageKey> = {
  loopback: "remote.kind.loopback",
  tailscale: "remote.kind.tailscale",
  address: "remote.kind.address",
  wildcard: "remote.kind.wildcard",
};

function ListenRow({ row, active, canRemove, busy, onRemove }: { row: ListenEntry; active: readonly string[]; canRemove: boolean; busy: boolean; onRemove(): void }) {
  const { t } = useI18n();
  const status = entryStatus(row, active);
  const dot = status === "active" ? "bg-ok" : status === "inactive" ? "bg-subtle/40" : "bg-accent/60";
  const warning = row.kind === "wildcard" ? t("remote.warn.wildcard") : row.warning;
  return (
    <ListRow
      leading={<span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
      title={<span className="font-mono text-xs">{entryAddress(row)}</span>}
      detail={
        <>
          {KIND_KEYS[row.kind] ? t(KIND_KEYS[row.kind]!) : row.kind}
          {status && ` · ${t(status === "active" ? "remote.status.active" : "remote.status.inactive")}`}
        </>
      }
      below={warning ? <p className="pb-0.5 pl-[18px] text-xs text-warn">{warning}</p> : undefined}
      actions={canRemove ? <ArmedRemove title={t("remote.remove")} disabled={busy} onRemove={onRemove} /> : <span className="text-[11px] text-subtle" title={t("remote.keepLoopbackHint")}>{t("remote.required")}</span>}
    />
  );
}

export function RemoteAccessSection() {
  const { t } = useI18n();
  const key = useDaemonKey();
  const { settings, error, busy, restart, load, patch } = useListenSettings(key);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (!key) return null;
  const view = readListenSettings(settings);
  const list = view?.list ?? [];
  const anchors = view?.rows.filter((r) => r.kind === "loopback" || r.kind === "wildcard") ?? [];
  const hasTailscale = view?.rows.some((r) => r.kind === "tailscale") ?? false;
  const add = (input: string) => {
    const r = checkListenEntry(input, list);
    if (!r.ok) return setProblem(t(`remote.problem.${r.problem}` as MessageKey));
    setProblem(null);
    void patch({ managementListen: [...list, r.entry] }).then(() => {
      setDraft("");
      setAdding(false);
    });
  };
  const remove = (row: ListenEntry) => void patch({ managementListen: list.filter((e) => e.trim() !== row.entry) });
  return (
    <Section
      title={t("remote.title")}
      hint={t("remote.hint")}
      actions={
        <>
          <RefreshButton onClick={load} disabled={busy} />
          <AddButton disabled={busy || !view || hasTailscale} title={hasTailscale ? t("remote.tailscaleExists") : undefined} onClick={() => add("tailscale")}>
            {t("remote.addTailscale")}
          </AddButton>
          <AddButton disabled={busy || !view || adding} onClick={() => setAdding(true)}>
            {t("remote.addAddress")}
          </AddButton>
        </>
      }
    >
      {!settings && !error && <Loading rows={2} />}
      {settings && !view && <Notice tone="info">{t("remote.needsUpgrade", { feature: LISTEN_FEATURE })}</Notice>}
      {restart && <Notice>{t("remote.restartRequired")}</Notice>}
      {view && needsPairingBanner(view) && <Notice>{t("remote.noTokens")}</Notice>}
      {view?.error && (
        <div className="flex items-center gap-2">
          <ErrorNote>{t("remote.invalidStored", { error: view.error })}</ErrorNote>
          <ResetButton title={t("remote.resetDefault")} onClick={() => void patch({ managementListen: null })} />
        </div>
      )}
      {view?.rows.map((row) => (
        <ListenRow key={row.entry} row={row} active={view.activeRemote} busy={busy} canRemove={!(anchors.length === 1 && anchors[0] === row)} onRemove={() => remove(row)} />
      ))}
      {adding && (
        <div className="-mx-4 border-b border-border bg-surface-2/40 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              mono
              width="w-72"
              label={t("remote.addAddress")}
              value={draft}
              placeholder="100.64.0.7 · 192.0.2.20:24270 · [fd7a::1]"
              onChange={(v) => (setDraft(v), setProblem(null))}
              onKeyDown={(e) => {
                if (e.key === "Enter") add(draft);
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <Button primary disabled={busy || !draft.trim()} onClick={() => add(draft)}>
              {t("remote.add")}
            </Button>
            <Button onClick={() => (setAdding(false), setProblem(null), setDraft(""))}>{t("dialog.cancel")}</Button>
          </div>
          <p className={`mt-1 text-xs ${problem ? "text-danger" : "text-subtle"}`}>{problem ?? t("remote.addHint")}</p>
        </div>
      )}
      {view && (
        <div className="flex items-center gap-2 border-t border-border py-2 text-xs text-subtle first:border-t-0">
          <span>{t("remote.listeningNow")}</span>
          <span className="min-w-0 flex-1 truncate font-mono">{view.activeRemote.length ? view.activeRemote.join(" · ") : t("remote.loopbackOnly")}</span>
          {!view.isDefault && (
            <button className="rounded text-accent hover:underline disabled:opacity-40" disabled={busy} onClick={() => void patch({ managementListen: null })}>
              {t("remote.resetDefault")}
            </button>
          )}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}

/** Browser / Capacitor Origin allow-list (applies at once). */
export function CorsSection() {
  const { t } = useI18n();
  const key = useDaemonKey();
  const { settings, error, busy, patch } = useListenSettings(key);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const view = readListenSettings(settings);
  if (!key || (settings && !view)) return null;
  const add = () => {
    if (!view) return;
    const r = checkCorsOrigin(draft, view.cors);
    if (!r.ok) return setProblem(t(`remote.cors.problem.${r.problem}` as MessageKey));
    setProblem(null);
    void patch({ managementCorsOrigins: [...view.cors, r.origin] }).then(() => setDraft(""));
  };
  return (
    <Section
      title={t("remote.cors.title")}
      hint={t("remote.cors.hint")}
      actions={view && !view.corsIsDefault ? <ResetButton title={t("remote.resetDefault")} disabled={busy} onClick={() => void patch({ managementCorsOrigins: null })} /> : undefined}
    >
      {!settings && !error && <Loading rows={1} />}
      {view?.cors.length === 0 && <EmptyState>{t("remote.cors.empty")}</EmptyState>}
      {view?.cors.map((origin) => (
        <ListRow
          key={origin}
          title={<span className="font-mono text-xs">{origin}</span>}
          detail={view.corsIsDefault ? t("remote.cors.default") : undefined}
          actions={<ArmedRemove title={t("remote.remove")} disabled={busy} onRemove={() => void patch({ managementCorsOrigins: view.cors.filter((o) => o !== origin) })} />}
        />
      ))}
      {view && (
        <div className="flex flex-wrap items-center gap-2 py-2.5">
          <TextInput
            mono
            width="w-72"
            label={t("remote.cors.add")}
            value={draft}
            placeholder="https://app.example.com"
            onChange={(v) => (setDraft(v), setProblem(null))}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <Button disabled={busy || !draft.trim()} onClick={add}>
            {t("remote.cors.add")}
          </Button>
          {problem && <span className="text-xs text-danger">{problem}</span>}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}

/** The pairing payload as a QR code: dark on white in both themes (phones need the contrast). */
/** 设备权限 at pairing: one radio per scope with what it means (the owner's default: 完全控制). */
function PairScope({ value, ownerDevice, onChange }: { value: DeviceScope; ownerDevice: boolean; onChange(scope: DeviceScope): void }) {
  const { t } = useI18n();
  return (
    <div className="-mx-4 border-b border-border px-4 py-2.5" role="radiogroup" aria-label={t("ownerDev.scope")}>
      <div className="mb-1 text-sm">{t("ownerDev.scope")}</div>
      {scopeOptions(t, ownerDevice, true).map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input type="radio" name="pair-scope" checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-[var(--color-accent)]" />
          <span>
            {o.label}
            {o.value === "full" && ownerDevice && <span className="ml-1 text-xs text-subtle">{t("ownerDev.scope.ownerDefault")}</span>}
            <span className="block text-xs text-subtle">{o.value === "full" && !ownerDevice ? t("ownerDev.scope.byUser.hint") : o.title}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Before generating an owner code with full control: what it gives (owner 2026-10-19, three points). */
function OwnerCodeWarning({ host }: { host: string }) {
  const { t } = useI18n();
  return (
    <div className="-mx-4 border-b border-border bg-warn/10 px-4 py-3 text-xs text-warn-text" data-testid="owner-code-warning">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <ShieldAlert size={14} className="shrink-0" />
        {t("ownerDev.code.title", { host })}
      </div>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>{t("ownerDev.code.commands")}</li>
        <li>{t("ownerDev.code.once")}</li>
        <li>{t("ownerDev.code.notice", { host })}</li>
      </ul>
    </div>
  );
}

function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  const quiet = 4;
  return (
    <svg role="img" aria-label={label} viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`} shapeRendering="crispEdges" className="h-48 w-48 shrink-0 rounded-lg bg-white ring-1 ring-border">
      <path d={d} fill="#000" />
    </svg>
  );
}

function PairingCard({ code, onClose, onRenew, busy }: { code: PairingCodeView; onClose(): void; onRenew(): void; busy: boolean }) {
  const { t } = useI18n();
  const now = useNow(true);
  const left = secondsLeft(code.expiresAt, now);
  const expired = left === 0;
  return (
    <div className="-mx-4 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-start gap-5">
        <div className={expired ? "opacity-30" : ""}>
          <QrCode text={code.qr} label={t("remote.pair.qr")} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-subtle">{t("remote.pair.scanHint")}</p>
          <div className={`font-mono text-3xl font-semibold tracking-[0.2em] select-all ${expired ? "text-subtle line-through" : ""}`}>{code.code}</div>
          <p className={`text-xs tabular-nums ${expired ? "text-danger" : left < 60 ? "text-warn" : "text-subtle"}`}>
            {expired ? t("remote.pair.expired") : t("remote.pair.expiresIn", { time: formatCountdown(left) })}
            {code.ownerDevice ? ` · ${t("ownerDev.code.onceShort")}` : ""}
            {code.label ? ` · ${code.label}` : ""}
          </p>
          {code.urls.length > 0 ? (
            <div>
              <div className="text-xs text-subtle">{t("remote.pair.urls")}</div>
              {code.urls.map((u) => (
                <div key={u} className="truncate font-mono text-xs text-muted">
                  {u}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-warn">{t("remote.pair.noUrls")}</p>
          )}
          {!expired && (
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {t("remote.pair.waiting")}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button primary={expired} disabled={busy} onClick={onRenew}>
              {t("remote.pair.renew")}
            </Button>
            <Button onClick={onClose}>{t("remote.pair.close")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenRow({ token, own, busy, onRevoke, rename }: { token: ClientTokenView; own: boolean; busy: boolean; onRevoke(): void; rename: { can: boolean; editing: boolean; start(): void; cancel(): void; save(name: string | null): Promise<boolean> } }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const device = token.kind === "device";
  const used = unixSeconds(token.lastUsedAt);
  const created = unixSeconds(token.createdAt);
  const parts = [
    device ? (token.platform && PLATFORMS.has(token.platform) ? t(`remote.platform.${token.platform}` as MessageKey) : t("remote.token.device")) : t("remote.token.client"),
    used !== null ? t("remote.token.lastUsed", { when: formatWhen(used, now, locale) }) : t("remote.token.neverUsed"),
    token.lastAddress ? <MaskedAddress address={token.lastAddress} /> : null,
    created !== null ? t("remote.token.created", { when: formatWhen(created, now, locale) }) : null,
  ].filter(Boolean);
  const Icon = device ? Smartphone : KeyRound;
  return (
    <ListRow
      leading={<Icon size={15} className={device ? "text-accent" : "text-subtle"} />}
      title={<TokenTitle token={token} editing={rename.editing} onSave={rename.save} onCancel={rename.cancel} extra={own && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("remote.token.own")}</span>} />}
      detail={parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {part}
        </Fragment>
      ))}
      actions={
        <>
          {rename.can && !rename.editing && <RenameTokenButton disabled={busy} onClick={rename.start} />}
          <ArmedRemove title={own ? t("remote.token.revokeOwn") : t("remote.token.revoke")} armedLabel={t("remote.token.revokeArmed")} disabled={busy} onRemove={onRevoke} />
        </>
      }
    />
  );
}

export function PairingSection() {
  const api = useTargetApi();
  const { t } = useI18n();
  const key = useDaemonKey();
  const targetHost = useTargetHostId();
  const notify = useApp((s) => s.notify);
  const ownTokenId = useApp((s) => s.hosts?.hosts.find((h) => h.id === targetHost)?.tokenId) ?? null;
  const [tokens, setTokens] = useState<ClientTokenView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<PairingCodeView | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState<ClientTokenView | null>(null);
  const known = useRef<Set<string>>(new Set());
  // users: whose the paired device will be (default the owner: a code made here is the owner's approval).
  const features = useTargetFeatures();
  const withUsers = features.has(USERS_FEATURE);
  // client-token-rename (owner only: a non-owner connection has the capability stripped).
  const canRename = features.has(CLIENT_TOKEN_RENAME_FEATURE);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [forUser, setForUser] = useState<string>(OWNER_USER_ID);
  // device-scope: what the paired device may do (never above its user's grant).
  const withScope = features.has(DEVICE_SCOPE_FEATURE);
  const [scope, setScope] = useState<DeviceScope>("full");
  const lock = useOwnerLocalLock(targetHost);
  const hostLabel = useHostScope().host(targetHost)?.view.label ?? targetHost;
  useEffect(() => {
    setUsers(null);
    setForUser(OWNER_USER_ID);
    if (key && withUsers) void api.users().then((r) => setUsers(r?.users ?? null), () => setUsers(null));
  }, [key, withUsers]); // eslint-disable-line react-hooks/exhaustive-deps -- api follows the target host (key)

  const load = useCallback(async () => {
    try {
      const list = await api.clientTokens();
      setTokens(list);
      return list;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  }, []);
  useEffect(() => {
    setTokens(null);
    setCode(null);
    setPaired(null);
    setError(null);
    setRenaming(null);
    if (key) void load();
  }, [key, load]);

  // While a code is live: poll the token list; a new token = the phone paired.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      if (secondsLeft(code.expiresAt, Date.now()) === 0) return;
      void load().then((list) => {
        const fresh = list ? newTokens(list, known.current) : [];
        if (fresh.length === 0) return;
        setPaired(fresh[0]!);
        setCode(null);
        tokensChanged();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [code, load]);

  if (!key) return null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    setPaired(null);
    try {
      const list = (await load()) ?? tokens ?? [];
      known.current = new Set(list.map((x) => x.tokenId));
      setCode(await api.createPairingCode(label.trim() || undefined, users && forUser !== OWNER_USER_ID ? forUser : undefined, withScope ? scope : undefined));
    } catch (e) {
      const text = errorText(e);
      setError(accessRefusalText(t, accessRefusalOf(e, { action: "pairingCode" }), hostLabel) ?? (text.includes("too_many_pairing_codes") ? t("remote.pair.tooMany") : text));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (token: ClientTokenView) => {
    setBusy(true);
    try {
      await api.revokeClientToken(token.tokenId);
      notify(t("remote.token.revoked", { name: tokenName(token, t) }));
      await load();
      tokensChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const rename = async (token: ClientTokenView, name: string | null) => {
    setError(null);
    try {
      await api.renameClientToken(token.tokenId, name);
      await load();
      return true;
    } catch (e) {
      setError(t("device.renameFailed", { message: errorText(e) }));
      return false;
    }
  };
  const sorted = tokens ? sortTokens(tokens) : null;
  return (
    <Section title={t("remote.pair.title")} hint={t("remote.pair.hint")} actions={<RefreshButton disabled={busy} onClick={() => void load()} />}>
      {code ? (
        <PairingCard code={code} busy={busy} onRenew={() => void generate()} onClose={() => setCode(null)} />
      ) : (
        <div className="-mx-4 flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <TextInput width="w-48" label={t("remote.pair.label")} value={label} maxLength={60} placeholder={t("remote.pair.labelPlaceholder")} onChange={setLabel} />
          {users && users.length > 1 && <Select<string> width="w-36" label={t("users.pairFor")} value={forUser} options={users.map((u) => ({ value: u.id, label: u.isOwner ? `${shownUserName(u)} · ${t("host.info.owner")}` : shownUserName(u) }))} onChange={setForUser} />}
          <Button primary disabled={busy || lock.locked} title={lock.hint ?? undefined} onClick={() => void generate()}>
            {busy ? t("remote.pair.generating") : t("remote.pair.generate")}
          </Button>
          {paired && <span className="text-xs text-ok-text">{t("remote.pair.paired", { name: tokenName(paired, t) })}</span>}
          {lock.hint && <span className="flex basis-full items-center gap-1 text-xs text-subtle"><Lock size={12} />{lock.hint}</span>}
        </div>
      )}
      {!code && withScope && !lock.locked && <PairScope value={scope} ownerDevice={forUser === OWNER_USER_ID} onChange={setScope} />}
      {!code && !lock.locked && forUser === OWNER_USER_ID && (!withScope || scope === "full") && features.has(OWNER_DEVICE_NOTICE_FEATURE) && <OwnerCodeWarning host={hostLabel} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {/* With users, every device is managed in 用户 → 设备 (with its user); an older host keeps the list here. */}
      {withUsers ? (
        <div className="flex items-center gap-2 py-2.5 text-xs text-subtle" data-testid="pairing-devices-link">
          <span className="min-w-0 flex-1">{t("remote.pair.devicesInUsers")}</span>
          <TextLink onClick={() => useApp.getState().openSettings("users", { anchor: "users-devices" })}>{t("remote.pair.openDevices")}</TextLink>
        </div>
      ) : (
        <>
          <div className="pt-2 text-xs font-medium text-subtle">{t("remote.pair.devices")}</div>
          {sorted === null && !error && <Loading rows={2} />}
          {sorted?.length === 0 && <EmptyState>{t("remote.pair.noDevices")}</EmptyState>}
        </>
      )}
      {!withUsers && sorted?.map((token) => (
        <TokenRow
          key={token.tokenId}
          token={token}
          own={token.tokenId === ownTokenId}
          busy={busy}
          onRevoke={() => void revoke(token)}
          rename={{ can: canRename, editing: renaming === token.tokenId, start: () => setRenaming(token.tokenId), cancel: () => setRenaming(null), save: (name) => rename(token, name) }}
        />
      ))}
    </Section>
  );
}
