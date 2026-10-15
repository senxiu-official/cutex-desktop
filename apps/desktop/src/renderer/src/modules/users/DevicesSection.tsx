// Settings → 用户 → 设备 (docs/research/identity-settings-review-20261015.md §4.2): every client / device
// token of the host in one flat list (it replaces the 待分配 section, each user's device sublist and
// 接入's second token list). Unassigned devices first (待分配 chip: 分配给…, 新建用户并分配, 以后认出这个人,
// 移除), then this desktop (这台电脑: hosts.json tokenId), then by last use. Each row: the name
// (cutex `client-token-rename` pencil, components/settings/TokenName), platform · last used · masked
// address, the user it belongs to (a select; 待分配 sends it back), 移除. A device that now uses another
// person's identity says so (知道了 with `person-identity-ack`). A user filter (also set from a user's
// counts), 配对设备 (Settings → 接入), and the 新设备先待分配 switch at the bottom.
import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { PERSON_IDENTITY_ACK_FEATURE, shownUserName, type UsersList, type UsersResult, type UserTokenRecord } from "../../../../shared/users";
import { groupFingerprint } from "../../../../shared/personIdentity";
import { MaskedText } from "../../components/MaskedText";
import { ArmedRemove, Button, Checkbox, EmptyState, ErrorNote, ListRow, Section, Select, SettingRow, TextInput, Toggle } from "../../components/settings/Form";
import { RenameTokenButton, ThisComputerBadge, TokenDetail, TokenIcon, TokenTitle } from "../../components/settings/TokenName";
import { useI18n } from "../../i18n";
import { useFingerprint } from "../../lib/personIdentity";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { createUserAndAssign, deviceRows, isUnassigned, newUserDefaultName, personKeyOwners, rememberKeyFor, tokenPerson, USER_NAME_MAX, withPersonKey, type DeviceFilter } from "./model";
import { DEVICES_ANCHOR, nameIn, openPairing, PENDING, useOwnTokenId, useRename, useRevoke, userOptions, useT, type Write } from "./shared";
import { changePersonKeys } from "./personKeyWrites";
import { UserDot } from "./UserDot";

/** A key's fingerprint (the host's, else computed here): masked by default (eye reveals, grouped by 4). */
export function KeyPrint({ publicKey, known }: { publicKey: string; known?: string | null }) {
  const fp = useFingerprint(publicKey, known);
  if (!fp) return <span className="font-mono text-xs">…</span>;
  return <MaskedText value={fp} shown={groupFingerprint(fp)} title={publicKey} copy testId="key-print" />;
}

export function DevicesSection({ list, write, filter, onFilter }: { list: UsersList; write: Write; filter: DeviceFilter; onFilter(f: DeviceFilter): void }) {
  const { t } = useI18n();
  const tt = useT();
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const revoke = useRevoke(write);
  const rename = useRename(write);
  const own = useOwnTokenId();
  const [error, setError] = useState<string | null>(null);
  const [forget, setForget] = useState<ReadonlySet<string>>(new Set());
  // 新建用户并分配: the token whose inline form is open, and its name draft.
  const [creating, setCreating] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = deviceRows(list.tokens, filter, own);
  const users = userOptions(list.users);
  const owners = personKeyOwners(list.users);
  // Assign; with 「以后认出这个人」 (default on) an unknown presented key is added to that user too.
  const assign = async (token: UserTokenRecord, userId: string) => {
    const person = tokenPerson(list, token, owners);
    const bound = await write(() => api.bindUserToken(token.tokenId, userId), setError);
    const user = list.users.find((u) => u.id === userId);
    if (!bound || !user || person.kind !== "unknown" || forget.has(token.tokenId)) return;
    const publicKey = person.publicKey!;
    await write(() => changePersonKeys(api, hostId, userId, user, (latest) => withPersonKey(latest, { publicKey })), setError, undefined, nameIn(list));
  };
  const openCreate = (token: UserTokenRecord) => {
    setError(null);
    setNewName(newUserDefaultName(list, token, tt));
    setCreating((open) => (open === token.tokenId ? null : token.tokenId));
  };
  const createAndAssign = async (token: UserTokenRecord) => {
    if (busy || !newName.trim()) return;
    setBusy(true);
    setError(null);
    const step = <V,>(run: () => Promise<UsersResult<V>>) => write(run, setError, undefined, nameIn(list));
    const done = await createUserAndAssign(api, step, { name: newName, tokenId: token.tokenId, rememberKey: rememberKeyFor(list, token, !forget.has(token.tokenId)) });
    setBusy(false);
    if (done.bound) setCreating(null);
  };
  const filterValue = filter.kind === "all" ? "" : filter.kind === "pending" ? PENDING : filter.userId;
  const filterOptions = [{ value: "", label: t("users.devices.filterAll") }, ...users, { value: PENDING, label: t("users.pendingOption") }];
  return (
    <Section
      id={settingsAnchorId(DEVICES_ANCHOR)}
      title={t("users.devices")}
      hint={t("users.devices.hint")}
      actions={
        <>
          <Select<string> width="w-36" label={t("users.devices.filter")} value={filterValue} options={filterOptions} onChange={(v) => onFilter(v === "" ? { kind: "all" } : v === PENDING ? { kind: "pending" } : { kind: "user", userId: v })} />
          <Button onClick={openPairing}>{t("users.devices.pair")}</Button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {rows.length === 0 && <EmptyState action={filter.kind === "all" ? <Button onClick={openPairing}>{t("users.devices.pair")}</Button> : undefined}>{t(filter.kind === "all" ? "users.noDevices" : "users.devices.noneFiltered")}</EmptyState>}
      {rows.map((token) => {
        const unassigned = isUnassigned(token);
        const mine = token.tokenId === own;
        const removeTitle = mine ? t("remote.token.revokeOwn") : t("users.revokeHint");
        return (
          <ListRow
            key={token.tokenId}
            frame={unassigned ? "bg-warn/5" : undefined}
            leading={<TokenIcon token={token} />}
            title={
              <TokenTitle
                token={token}
                editing={rename.editing === token.tokenId}
                onSave={(name) => rename.save(token.tokenId, name, setError)}
                onCancel={() => rename.setEditing(null)}
                extra={
                  <>
                    {unassigned && <span className="shrink-0 rounded bg-warn/15 px-1.5 text-[11px] text-warn">{t("users.devices.pendingChip")}</span>}
                    {mine && <ThisComputerBadge />}
                  </>
                }
              />
            }
            detail={<TokenDetail token={token} />}
            below={
              unassigned ? (
                <>
                  <PendingPerson list={list} token={token} remember={!forget.has(token.tokenId)} onRemember={(on) => setForget((f) => { const next = new Set(f); if (on) next.delete(token.tokenId); else next.add(token.tokenId); return next; })} />
                  {creating === token.tokenId && (
                    <div className="mt-2 ml-7 flex flex-wrap items-center gap-2" data-testid="pending-new-user">
                      <TextInput value={newName} onChange={setNewName} label={t("users.pending.newUserName")} placeholder={t("users.addNamePlaceholder")} maxLength={USER_NAME_MAX} autoFocus onKeyDown={(e) => { if (e.key === "Enter") void createAndAssign(token); else if (e.key === "Escape") setCreating(null); }} />
                      <Button primary disabled={busy || !newName.trim()} onClick={() => void createAndAssign(token)}>{t("users.pending.newUserSubmit")}</Button>
                      <Button onClick={() => setCreating(null)}>{t("users.pending.newUserCancel")}</Button>
                      <span className="basis-full text-xs text-subtle">{t("users.pending.newUserHint")}</span>
                    </div>
                  )}
                </>
              ) : (
                <TokenPersonNote list={list} token={token} write={write} onError={setError} />
              )
            }
            actions={
              <>
                {rename.can && rename.editing !== token.tokenId && <RenameTokenButton onClick={() => rename.setEditing(token.tokenId)} />}
                {unassigned ? (
                  <>
                    <Select<string> value="" width="w-36" options={[{ value: "", label: t("users.pending.assign"), disabled: true }, ...users]} label={t("users.pending.assign")} onChange={(userId) => void assign(token, userId)} />
                    <Button title={t("users.pending.newUserHint")} onClick={() => openCreate(token)}>{t("users.pending.newUser")}</Button>
                  </>
                ) : (
                  <Select<string> value={token.userId!} options={[...users, { value: PENDING, label: t("users.pendingOption") }]} label={t("users.rebind")} width="w-36" onChange={(to) => void write(() => api.bindUserToken(token.tokenId, to === PENDING ? null : to), setError)} />
                )}
                <ArmedRemove title={`${t("users.revoke")} — ${removeTitle}`} armedLabel={t("users.revokeArmed")} onRemove={() => void revoke(token.tokenId, setError)} />
              </>
            }
          />
        );
      })}
      <ApprovalSetting list={list} write={write} />
    </Section>
  );
}

/** 新设备先待分配 (`ownerRequiresApproval`), the list's footer row. */
function ApprovalSetting({ list, write }: { list: UsersList; write: Write }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="-mx-4 border-t border-border px-4">
      {error && <ErrorNote>{error}</ErrorNote>}
      <SettingRow label={t("users.ownerRequiresApproval")} hint={t("users.ownerRequiresApprovalHint")}>
        <Toggle
          checked={list.settings.ownerRequiresApproval}
          disabled={busy}
          label={t("users.ownerRequiresApproval")}
          onChange={(next) => {
            setBusy(true);
            void write(() => api.patchUsersSettings({ ownerRequiresApproval: next }), setError).finally(() => setBusy(false));
          }}
        />
      </SettingRow>
    </div>
  );
}

/** The identity an unassigned device brought: who it is when a user already has the key, else its fingerprint + 「以后认出这个人」. */
function PendingPerson({ list, token, remember, onRemember }: { list: UsersList; token: UserTokenRecord; remember: boolean; onRemember(on: boolean): void }) {
  const { t } = useI18n();
  const person = tokenPerson(list, token);
  if (person.kind === "none") return null;
  const known = person.ownerId ? list.users.find((u) => u.id === person.ownerId) : undefined;
  return (
    <div className="mt-1 ml-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle" data-testid="pending-person">
      <span className="flex items-center gap-1.5">
        <Fingerprint size={13} className="shrink-0" />
        {known && <UserDot user={known} />}
        <span>{known ? t("users.person.claimedAs", { name: shownUserName(known) }) : person.displayName ? t("users.person.claimedName", { name: person.displayName }) : t("users.person.claimed")}</span>
        <KeyPrint publicKey={person.publicKey!} known={person.fingerprint} />
      </span>
      {person.kind === "unknown" && (
        <label className="flex cursor-pointer items-center gap-1.5" title={t("users.person.rememberHint")}>
          <Checkbox checked={remember} onChange={onRemember} />
          <span>{t("users.person.remember")}</span>
        </label>
      )}
    </div>
  );
}

/** Under an assigned device, only when it now uses another person's identity (its user stays); 知道了 clears a change. */
function TokenPersonNote({ list, token, write, onError }: { list: UsersList; token: UserTokenRecord; write: Write; onError(text: string): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const canAck = useTargetFeatures().has(PERSON_IDENTITY_ACK_FEATURE);
  const [acking, setAcking] = useState(false);
  const person = tokenPerson(list, token);
  if (person.kind === "none" || (!person.changed && person.kind !== "other")) return null;
  const other = person.kind === "other" ? list.users.find((u) => u.id === person.ownerId) : undefined;
  const text = person.changed ? (other ? t("users.person.changed", { name: shownUserName(other) }) : t("users.person.changedUnknown")) : t("users.person.presentedOther", { name: other ? shownUserName(other) : "?" });
  return (
    <div className="mt-0.5 ml-7 flex flex-wrap items-center gap-1.5 text-xs text-warn" data-testid="token-person">
      <Fingerprint size={12} className="shrink-0" />
      <span>{text}</span>
      <KeyPrint publicKey={person.publicKey!} known={person.fingerprint} />
      {person.changed && canAck && (
        <Button
          title={t("users.person.ackHint")}
          disabled={acking}
          onClick={() => {
            setAcking(true);
            void write(() => api.ackTokenPersonChange(token.tokenId), onError).finally(() => setAcking(false));
          }}
        >
          {t("users.person.ack")}
        </Button>
      )}
    </div>
  );
}
