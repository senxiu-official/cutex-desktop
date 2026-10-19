// Settings → 访问管理, the users module's parts (人 · 设备 · 别的主机 → 对端主机; formerly 用户) (cutex `users`, docs/research/user-isolation-p1-20261014.md §9;
// layout per docs/research/identity-settings-review-20261015.md §4.2), host-scoped, owner only (the page
// shows the non-owner view instead on a host where this device is not the owner): an attention strip
// while devices wait to be assigned, the user list (owner first; each row shows the name and picture that
// user set on their own desktop — cutex `users-self-profile` — with the owner's label as 备注; its
// counts filter the 设备 list; a row expands into 自己设的名字 / 备注名 / colour, the grant editor, 认得的身份
// and delete — the owner's own row only colour and identities), then the flat 设备 list (DevicesSection:
// every token with its user, 待分配 first, the 新设备先待分配 switch). cutex `person-identity` (P2,
// docs/research/person-identity-p2-20261014.md §5): each user lists the person keys it is known by
// (fingerprint, remove) and the unknown keys its devices brought (「认作此用户」).
import { useEffect, useMemo, useRef, useState } from "react";
import { create as createStore } from "zustand";
import { ChevronDown, ChevronRight, Fingerprint } from "lucide-react";
import { PEERS_FEATURE } from "../../../../shared/peers";
import { shownUserName, USERS_P2_ACCESS_FEATURE, type PersonKeyRecord, type UserGrant, type UserRecord, type UsersList } from "../../../../shared/users";
import { ProjectColorPicker } from "../../components/ProjectColorPicker";
import { AddButton, ArmedRemove, Button, Checkbox, ErrorNote, IconButton, ListRow, Loading, Notice, RefreshButton, Section, SettingRow, TextField, TextInput, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId, useTargetSidebar } from "../../lib/targetHost";
import { usePersonIdentity } from "../../lib/personIdentity";
import { DevicesSection, KeyPrint } from "./DevicesSection";
import { ThisComputerBadge } from "../../components/settings/TokenName";
import { useUsers, useUsersWrite } from "./hooks";
import { bindingsOf, deviceName, EMPTY_GRANT, grantChoices, grantSummary, isUnassigned, personKeyOwners, rebaseGrantDraft, sameGrant, toggleAllProjects, selfKeyUnknown, sortedUsers, toggleId, unknownKeysOf, withoutPersonKey, withPersonKey, type DeviceFilter, type GrantChoice } from "./model";
import { DEVICES_ANCHOR, nameIn, openPairing, PEERS_ANCHOR, USERS_ANCHOR, useT, type Write } from "./shared";
import { changePersonKeys } from "./personKeyWrites";
import { PeersSection } from "./PeersSection";
import { UserDot } from "./UserDot";

/**
 * Settings → 访问管理 places the users module's cards in three of its parts (人 / 设备 / 别的主机), each a
 * `settings.section` of its own. They share one `/v2/users` read: the 人 part reads it (useUsers) and
 * mirrors it here; the 设备 and 对端主机 parts render from it, and their writes reload it. Also the
 * cross-card state: the 设备 filter and the 对端主机 user. Settings remounts the page per host.
 */
interface SharedUsers {
  list: UsersList | null;
  load: (() => Promise<void>) | null;
  filter: DeviceFilter;
  /** A user's 「1 个对端主机」 narrows 对端主机 to that user (null: every linked host). */
  peerUser: string | null;
}
const FRESH: SharedUsers = { list: null, load: null, filter: { kind: "all" }, peerUser: null };
const useShared = createStore<SharedUsers>(() => FRESH);
const noLoad = async () => {};

/** 人: the attention strip and the user list; reads the listing the other parts share. */
export function UsersPeoplePart() {
  const { t } = useI18n();
  const { list, unsupported, error, load } = useUsers();
  const write = useUsersWrite(load);
  const withPeers = useTargetFeatures().has(PEERS_FEATURE);
  useEffect(() => useShared.setState({ list, load }), [list, load]);
  useEffect(() => () => useShared.setState(FRESH, true), []);
  if (error && !list) return <Section><ErrorNote>{error}</ErrorNote></Section>;
  if (unsupported) return <Section><Notice>{t("users.unsupported")}</Notice></Section>;
  if (!list) return <Section><Loading rows={3} /></Section>;
  // A user's 「2 台设备」 shows that user's devices in 设备.
  const showDevices = (next: DeviceFilter) => {
    useShared.setState({ filter: next });
    requestAnimationFrame(() => document.getElementById(settingsAnchorId(DEVICES_ANCHOR))?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const showPeers = (userId: string) => {
    useShared.setState({ peerUser: userId });
    requestAnimationFrame(() => document.getElementById(settingsAnchorId(PEERS_ANCHOR))?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const waiting = list.tokens.filter(isUnassigned).length;
  return (
    <>
      {waiting > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2 text-sm" role="status" data-testid="users-attention">
          <span className="min-w-0 flex-1">{t("users.attention", { n: waiting })}</span>
          <Button onClick={() => showDevices({ kind: "pending" })}>{t("users.attentionView")}</Button>
        </div>
      )}
      <UsersSection list={list} write={write} reload={load} onShowDevices={showDevices} onShowPeers={withPeers ? showPeers : undefined} />
    </>
  );
}

/** 设备: every device with its user (the 人 part's listing). */
export function UsersDevicesPart() {
  const { list, load, filter } = useShared();
  const write = useUsersWrite(load ?? noLoad);
  if (!list) return null;
  return <DevicesSection list={list} write={write} filter={filter} onFilter={(next) => useShared.setState({ filter: next })} />;
}

/** 别的主机 → 对端主机: each linked host with the user it belongs to (the 人 part's listing). */
export function UsersPeersPart() {
  const { list, load, peerUser } = useShared();
  const write = useUsersWrite(load ?? noLoad);
  if (!list) return null;
  return <PeersSection list={list} write={write} userId={peerUser} onAll={() => useShared.setState({ peerUser: null })} />;
}

function UsersSection({ list, write, reload, onShowDevices, onShowPeers }: { list: UsersList; write: Write; reload: () => Promise<void>; onShowDevices(filter: DeviceFilter): void; onShowPeers?(userId: string): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bindings = useMemo(() => bindingsOf(list), [list]);
  // Enter and the button share one guard (a ref: a second Enter can come before the re-render).
  const creating = useRef(false);
  const create = async () => {
    if (creating.current || !name.trim()) return;
    creating.current = true;
    setBusy(true);
    setError(null);
    const r = await write(() => api.createUser({ name: name.trim(), grant: EMPTY_GRANT }), setError);
    creating.current = false;
    setBusy(false);
    if (!r) return;
    setAdding(false);
    setName("");
    setOpen(r.user.id);
  };
  const onlyOwner = list.users.every((u) => u.isOwner);
  return (
    <Section
      id={settingsAnchorId(USERS_ANCHOR)}
      title={t("users.list")}
      hint={t("users.pageHint")}
      source="host"
      actions={
        <>
          <RefreshButton label={t("users.refresh")} onClick={() => void reload()} />
          <AddButton primary onClick={() => setAdding((v) => !v)}>{t("users.add")}</AddButton>
        </>
      }
    >
      {adding && (
        <div className="-mx-4 border-b border-border bg-surface-2/40 px-4 py-3" data-testid="users-add">
          <p className="mb-2 text-xs text-subtle">{t("users.addHint")}</p>
          <div className="flex items-center gap-2">
            <TextInput value={name} onChange={setName} placeholder={t("users.addNamePlaceholder")} label={t("users.addName")} maxLength={64} autoFocus onKeyDown={(e) => e.key === "Enter" && void create()} />
            <Button primary disabled={busy || !name.trim()} onClick={() => void create()}>{t("users.addSubmit")}</Button>
          </div>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {sortedUsers(list.users).map((user) => {
        const tokens = bindings.tokens.get(user.id) ?? [];
        const peers = bindings.peers.get(user.id) ?? [];
        const expanded = open === user.id;
        const showAlias = !user.isOwner && !!user.displayName && user.displayName !== user.name;
        return (
          <ListRow
            key={user.id}
            leading={<UserDot user={user} />}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{shownUserName(user)}</span>
                {showAlias && <span className="shrink-0 text-xs text-subtle" title={t("users.aliasHint")}>{t("users.aliasInline", { name: user.name })}</span>}
                {user.isOwner && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[11px] text-accent">{t("users.ownerBadge")}</span>}
              </span>
            }
            detail={
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{user.isOwner ? t("users.ownerHint") : grantSummary(user.grant, (k, v) => t(k as never, v))}</span>
                {tokens.length > 0 && <CountLink onClick={() => onShowDevices({ kind: "user", userId: user.id })}>{t("users.summary.devices", { n: tokens.length })}</CountLink>}
                {peers.length > 0 && onShowPeers && <CountLink onClick={() => onShowPeers(user.id)}>{t("users.summary.peers", { n: peers.length })}</CountLink>}
              </span>
            }
            actions={
              <IconButton label={expanded ? t("users.collapse") : t("users.expand")} onClick={() => setOpen(expanded ? null : user.id)}>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </IconButton>
            }
            below={expanded ? <UserEditor key={user.id} user={user} list={list} write={write} onDeleted={() => setOpen(null)} /> : undefined}
          />
        );
      })}
      {onlyOwner && !adding && (
        <div className="-mx-4 flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-subtle" data-testid="users-only-owner">
          <span className="min-w-0 flex-1">{t("users.onlyOwner")}</span>
          <Button onClick={() => setAdding(true)}>{t("users.add")}</Button>
          <Button onClick={openPairing}>{t("users.devices.pair")}</Button>
        </div>
      )}
    </Section>
  );
}

/** 「· 2 台设备」: a count that filters the list it counts. */
function CountLink({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden>·</span>
      <button type="button" className="shrink-0 rounded hover:text-accent hover:underline" onClick={onClick}>
        {children}
      </button>
    </>
  );
}

function UserEditor({ user, list, write, onDeleted }: { user: UserRecord; list: UsersList; write: Write; onDeleted(): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const [error, setError] = useState<string | null>(null);
  const patch = (body: Parameters<typeof api.patchUser>[1]) => write(() => api.patchUser(user.id, body), setError);
  const profiles = user.displayName !== undefined;
  return (
    <div className="mt-2 mb-1 ml-8 space-y-3 border-l border-border pl-4" data-testid="user-editor">
      {error && <ErrorNote>{error}</ErrorNote>}
      {profiles && !user.isOwner && (
        <SettingRow label={t("users.selfName")} hint={t("users.selfNameHint")}>
          <span className="text-sm text-muted" data-testid="user-self-name">{user.displayName ?? t("users.selfNameUnset")}</span>
        </SettingRow>
      )}
      {/* Your own name comes from Settings → 你; an alias for yourself means nothing. */}
      {!(user.isOwner && profiles) && (
        <SettingRow label={t(profiles ? "users.alias" : "users.name")} hint={profiles ? t("users.aliasHint") : undefined}>
          <TextField value={user.name} maxLength={64} label={t(profiles ? "users.alias" : "users.name")} onCommit={(v) => (v.trim() && v.trim() !== user.name ? patch({ name: v.trim() }) : undefined)} />
        </SettingRow>
      )}
      <SettingRow label={t("users.color")}>
        <ProjectColorPicker value={user.color ?? ""} onChange={(c) => void patch({ color: c })} />
      </SettingRow>
      {!user.isOwner && <GrantEditor user={user} onSave={(grant) => patch({ grant })} />}
      <PersonKeys user={user} list={list} write={write} />
      {!user.isOwner && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="text-xs text-subtle">{t("users.delete")}</span>
          <ArmedRemove
            title={t("users.delete")}
            armedLabel={t("users.deleteArmed")}
            onRemove={() =>
              void write(() => api.deleteUser(user.id), setError, shownUserName(user)).then((r) => {
                if (r) onDeleted();
              })
            }
          />
        </div>
      )}
    </div>
  );
}

/** A user's person identities: known keys (remove), and unknown ones its devices (or this desktop, on the owner) presented (「记到此用户」). */
function PersonKeys({ user, list, write }: { user: UserRecord; list: UsersList; write: Write }) {
  const { t, locale } = useI18n();
  const tt = useT();
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const mine = usePersonIdentity();
  const [error, setError] = useState<string | null>(null);
  if (user.personKeys === undefined && list.tokenPersons === undefined) return null; // an older host
  const keys = user.personKeys ?? [];
  const owners = personKeyOwners(list.users);
  const unknown = unknownKeysOf(list, user.id);
  // The owner's row: this desktop's own key when no user has it yet (a claim normally puts it there —
  // the root credential's and the first device's go on owner — so this shows only when that did not happen).
  const self = user.isOwner && selfKeyUnknown(list.users, mine.publicKey) && !unknown.some((k) => k.publicKey === mine.publicKey) ? mine.publicKey : null;
  const tokenName = (id: string) => {
    const token = list.tokens.find((x) => x.tokenId === id);
    return token ? deviceName(token, tt) : id;
  };
  const add = (publicKey: string) => void write(() => changePersonKeys(api, hostId, user.id, user, (latest) => withPersonKey(latest, { publicKey })), setError, undefined, nameIn(list));
  const remove = (key: PersonKeyRecord) => void write(() => changePersonKeys(api, hostId, user.id, user, (latest) => withoutPersonKey(latest, key.publicKey)), setError, undefined, nameIn(list));
  const rows = keys.length + unknown.length + (self ? 1 : 0);
  return (
    <SubList title={t("users.person.title")} empty={t("users.person.none")} count={rows}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {keys.map((key) => (
        <ListRow
          key={key.publicKey}
          leading={<Fingerprint size={15} className="shrink-0 text-subtle" />}
          title={
            <span className="flex items-center gap-2">
              <KeyPrint publicKey={key.publicKey} known={key.fingerprint} />
              {key.label && <span className="truncate">{key.label}</span>}
              {key.publicKey === mine.publicKey && <ThisComputerBadge />}
            </span>
          }
          detail={Number.isFinite(Date.parse(key.addedAt)) ? t("users.person.addedAt", { t: new Date(key.addedAt).toLocaleDateString(locale) }) : undefined}
          actions={<ArmedRemove title={t("users.person.remove")} armedLabel={t("users.person.removeArmed")} onRemove={() => remove(key)} />}
        />
      ))}
      {unknown.map((k) => (
        <ListRow
          key={k.publicKey}
          frame="bg-warn/5"
          leading={<Fingerprint size={15} className="shrink-0 text-subtle" />}
          title={<KeyPrint publicKey={k.publicKey} />}
          detail={t("users.person.fromDevices", { devices: k.tokenIds.map(tokenName).join(locale.startsWith("zh") ? "、" : ", ") })}
          actions={<Button onClick={() => add(k.publicKey)}>{t("users.person.add")}</Button>}
        />
      ))}
      {self && (
        <ListRow
          frame="bg-warn/5"
          leading={<Fingerprint size={15} className="shrink-0 text-subtle" />}
          title={<KeyPrint publicKey={self} known={mine.fingerprint} />}
          detail={t("users.person.selfUnknown")}
          actions={<Button onClick={() => add(self)}>{t("users.person.add")}</Button>}
        />
      )}
    </SubList>
  );
}

function SubList({ title, empty, count, children }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      {count ? <div className="px-4">{children}</div> : <p className="text-xs text-subtle">{empty}</p>}
    </div>
  );
}

function Checklist({ choices, chosen, disabled, onToggle, label }: { choices: GrantChoice[]; chosen: readonly string[]; disabled?: boolean; onToggle(id: string, on: boolean): void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-3 gap-y-1 overflow-y-auto pr-1">
      {choices.map((c) => (
        <label key={c.id} className={`flex min-w-0 items-center gap-1.5 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`} title={c.id}>
          <Checkbox disabled={disabled} checked={chosen.includes(c.id)} onChange={(on) => onToggle(c.id, on)} />
          <span className="truncate">{c.name}</span>
        </label>
      ))}
    </div>
  );
}

function GrantEditor({ user, onSave }: { user: UserRecord; onSave(grant: UserGrant): Promise<unknown> }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  // users-p2-access: the grant also opens read-only files, images and delegation commands.
  const p2 = useTargetFeatures().has(USERS_P2_ACCESS_FEATURE);
  const choices = useMemo(() => grantChoices(sidebar), [sidebar]);
  const saved = user.grant ?? EMPTY_GRANT;
  const [draft, setDraft] = useState<UserGrant>(saved);
  // The saved grant the draft started from: a newer one (this or another device wrote it) replaces an
  // untouched draft; an edited draft is kept (its 未保存 says so).
  const [base, setBase] = useState<UserGrant>(saved);
  if (!sameGrant(base, saved)) {
    setBase(saved);
    setDraft(rebaseGrantDraft(draft, base, saved));
  }
  // The project list 全部项目 replaced, restored when it is turned off again (ids not shown here —
  // archived or unknown projects — included).
  const [keptProjects, setKeptProjects] = useState<string[]>(saved.projects === "all" ? [] : [...saved.projects]);
  const [busy, setBusy] = useState(false);
  const dirty = !sameGrant(draft, saved);
  const all = draft.projects === "all";
  const projects = all ? [] : (draft.projects as string[]);
  const save = async () => {
    setBusy(true);
    await onSave(draft);
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-border px-3 py-2.5" data-testid="grant-editor">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t("users.grant")}</div>
          <div className="text-xs text-subtle">{t(p2 ? "users.grantHintP2" : "users.grantHint")}</div>
        </div>
      </div>
      <SettingRow label={t("users.grant.allProjects")} hint={t("users.grant.allProjectsHint")}>
        <Toggle checked={all} label={t("users.grant.allProjects")} onChange={(on) => {
            const next = toggleAllProjects(draft, on, keptProjects);
            setKeptProjects(next.kept);
            setDraft(next.draft);
          }} />
      </SettingRow>
      {!all && (
        <div className="py-2">
          <div className="mb-1 text-xs text-muted">{t("users.grant.projects")}</div>
          {choices.projects.length ? <Checklist label={t("users.grant.projects")} choices={choices.projects} chosen={projects} onToggle={(id, on) => setDraft((d) => ({ ...d, projects: toggleId(d.projects === "all" ? [] : d.projects, id, on) }))} /> : <p className="text-xs text-subtle">{t("users.grant.noProjects")}</p>}
        </div>
      )}
      <div className="py-2">
        <div className="mb-1 text-xs text-muted">{t("users.grant.standalone")}</div>
        {choices.standalone.length ? <Checklist label={t("users.grant.standalone")} choices={choices.standalone} chosen={draft.standaloneAgents} onToggle={(id, on) => setDraft((d) => ({ ...d, standaloneAgents: toggleId(d.standaloneAgents, id, on) }))} /> : <p className="text-xs text-subtle">{t("users.grant.noStandalone")}</p>}
      </div>
      <SettingRow label={t("users.grant.send")} hint={t(p2 ? "users.grant.sendHintP2" : "users.grant.sendHint")}>
        <Toggle checked={draft.send} label={t("users.grant.send")} onChange={(on) => setDraft((d) => ({ ...d, send: on }))} />
      </SettingRow>
      <div className="flex items-center justify-end gap-2 pt-2">
        <span className="text-xs text-subtle">{dirty ? t("users.grant.unsaved") : t("users.grant.saved")}</span>
        <Button primary disabled={!dirty || busy} onClick={() => void save()}>{t("users.grant.save")}</Button>
      </div>
    </div>
  );
}
