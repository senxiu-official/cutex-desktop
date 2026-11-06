import { useEffect, useSyncExternalStore } from "react";
import type { AvatarStyle } from "@cutex-desktop/protocol";
import type { ProfileItem, ProfilePatch } from "../../../shared/ipc";
import { apiFor } from "../bridge";
import { useApp } from "../store";
import { hostData } from "./hostScope";
import { accountLinkHostAllowed, accountLinkIdentity, accountProfilesSnapshot, captureAccountLinkAction, refreshAccountProfiles, subscribeAccountProfiles, type LinkedProfileRef } from "./profileAccountLinks";
import { patchProfileLook } from "./profileLooks";
import { updateCachedProfile } from "./profileSnapshot";

export const LOOK_FIELDS = ["color", "avatarThemes", "introGreeting", "avatar", "introPortrait", "avatarStyle"] as const;
export type LookField = typeof LOOK_FIELDS[number];
export type LookValue = string | string[] | AvatarStyle | null;
export type AppearanceChanges = Partial<Record<LookField, LookValue>>;
/** design 047: the full style syncs only between hosts that both advertise this. */
export const PROFILE_AVATAR_STYLE_FEATURE = "profile-avatar-style";
type Mark = { value: string; token: string; time: string | null };
type Marks = Record<LookField, Mark>;
// avatarStyle of a host without the capability, or of a baseline persisted before this field: never
// compared, never a source or target; adopted from the first capable observation.
const UNKNOWN_STYLE: Mark = { value: "?", token: "?", time: null };
const knownStyle = (mark: Mark) => mark.token !== UNKNOWN_STYLE.token;
type Member = { hostId: string; profileId: string; hostName: string; marks: Marks };
type Group = { members: Record<string, Member>; conflict: boolean; paused?: boolean };
type Target = { key: string; expected: Partial<Record<LookField, string>>; before?: AppearanceChanges };
type Job = { id: string; group: string; values: AppearanceChanges; targets: Target[]; undo?: boolean };
type Saved = { version: 1; groups: Record<string, Group>; jobs: Job[] };
type Undo = { member: Member; values: AppearanceChanges; expected: Partial<Record<LookField, string>> };
export type AppearanceNotice = { id: number; kind: "pending" | "synced" | "error" | "storageError" | "newerChange"; hosts: string[]; undo: boolean };
export class ProfileAppearanceSyncError extends Error {
  constructor(readonly kind: "error" | "newerChange") { super(kind); }
}
export interface AppearanceTransport {
  refs(): readonly LinkedProfileRef[];
  allowed(hostId: string): boolean;
  /** The host advertises profile-avatar-style (absent: no host does). */
  styled?(hostId: string): boolean;
  fresh(ref: LinkedProfileRef): Promise<ProfileItem>;
  image(ref: LinkedProfileRef, field: "avatar" | "introPortrait"): Promise<{ dataUrl: string; etag: string | null } | null>;
  write(ref: LinkedProfileRef, field: LookField, value: LookValue, isCurrent?: () => boolean): Promise<ProfileItem>;
  refresh(): Promise<void>;
}
export const PROFILE_LINK_APPEARANCE_STORAGE = "cutex-desktop.profileLinkAppearance.v1";
const memberKey = (ref: Pick<LinkedProfileRef, "hostId"> & { profile: Pick<ProfileItem, "id"> }) => JSON.stringify([ref.hostId, ref.profile.id]);
const validIdentity = (s: string) => /^[0-9a-f]{8}:[A-Za-z0-9_-]{22}$/.test(s);
const own = (value: object, field: string) => Object.prototype.hasOwnProperty.call(value, field);

/** A fixed write allowlist is used for UI drafts AND untrusted persisted pending work. */
export function cleanAppearanceChanges(value: unknown): AppearanceChanges {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: AppearanceChanges = {};
  for (const field of LOOK_FIELDS) {
    if (!own(raw, field)) continue;
    const v = raw[field];
    if (v === null) out[field] = null;
    else if (field === "color" && typeof v === "string" && /^#[\da-f]{6}$/i.test(v)) out[field] = v.toUpperCase();
    else if (field === "avatarThemes" && Array.isArray(v) && v.length && v.length <= 64 && v.every((x) => typeof x === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(x)) && new Set(v).size === v.length) out[field] = [...v].sort();
    else if (field === "introGreeting" && typeof v === "string" && [...v.trim()].length <= 300 && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v.replaceAll("\r\n", "\n"))) out[field] = v.trim().replaceAll("\r\n", "\n") || null;
    else if ((field === "avatar" || field === "introPortrait") && typeof v === "string" && v.length <= (field === "avatar" ? 70_000 : 2_800_000) && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)) out[field] = v;
    else if (field === "avatarStyle") { const style = cleanAvatarStyle(v); if (style) out[field] = style; }
  }
  return out;
}
const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const uniqueList = (v: unknown, max: number, ok: (s: string) => boolean): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((x) => typeof x === "string" && ok(x)) && new Set(v).size === v.length;
/** Design 047's style shape, exact keys only; portrait order is the owner's, emoji order is canonical (sorted here). */
function cleanAvatarStyle(v: unknown): AvatarStyle | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const raw = v as Record<string, unknown>;
  let style: AvatarStyle | undefined;
  if (raw.kind === "letter" && exactKeys(raw, ["kind"])) style = { kind: "letter" };
  else if (raw.kind === "emoji" && exactKeys(raw, ["kind", "emojiThemes"]) && (raw.emojiThemes === null || uniqueList(raw.emojiThemes, 64, (x) => /^[a-z][a-z0-9_-]{0,31}$/.test(x)))) style = { kind: "emoji", emojiThemes: raw.emojiThemes === null ? null : [...raw.emojiThemes as string[]].sort() };
  else if (raw.kind === "portrait" && exactKeys(raw, ["kind", "portraitThemes"]) && uniqueList(raw.portraitThemes, 128, (x) => /^[a-z0-9][a-z0-9-]{0,19}\/[a-z0-9][a-z0-9-]{0,19}$/.test(x))) style = { kind: "portrait", portraitThemes: [...raw.portraitThemes] };
  return style && new TextEncoder().encode(JSON.stringify(style)).length <= 8192 ? style : undefined;
}

export function appearanceMarks(profile: ProfileItem): Marks {
  return Object.fromEntries(LOOK_FIELDS.map((field) => {
    const raw = field === "avatar" ? profile.avatarEtag ?? null : field === "introPortrait" ? profile.introPortraitEtag ?? null : profile.appearance[field] ?? null;
    const value = field === "color" && typeof raw === "string" ? raw.toUpperCase() : field === "avatarThemes" && Array.isArray(raw) ? [...raw].sort() : field === "avatarStyle" && raw ? cleanAvatarStyle(raw) ?? raw : raw;
    const revision = profile.appearanceRevisions?.[field];
    return [field, { value: JSON.stringify(value), token: JSON.stringify([revision?.etag ?? null, revision?.updatedAt ?? null, value]), time: revision?.updatedAt ?? null }];
  })) as Marks;
}
const sameLooks = (a: Marks, b: Marks) => LOOK_FIELDS.every((field) => field === "avatarStyle" && (!knownStyle(a[field]) || !knownStyle(b[field])) || a[field].value === b[field].value);

/** One serialized worker; durable pending values contain only the five appearance fields. */
export class ProfileLinkAppearanceSync {
  private state: Saved = { version: 1, groups: {}, jobs: [] };
  private listeners = new Set<() => void>();
  private notices = new Map<string, AppearanceNotice>();
  private undoRecords = new Map<string, Undo[]>();
  private editing = new Map<string, number>();
  private generations = new Map<string, number>();
  private running = false;
  private flight: Promise<void> | null = null;
  private again = false;
  private brokenStorage = false;
  private unreadableStorage = false;
  private version = 0;
  constructor(private transport: AppearanceTransport, private storage: Pick<Storage, "getItem" | "setItem">) {
    try {
      const raw = storage.getItem(PROFILE_LINK_APPEARANCE_STORAGE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Saved;
      if (parsed.version !== 1 || !parsed.groups || typeof parsed.groups !== "object" || !Array.isArray(parsed.jobs) || parsed.jobs.length > 64 || Object.keys(parsed.groups).length > 128) throw Error("invalid appearance pending store");
      for (const [identity, group] of Object.entries(parsed.groups)) {
        if (!validIdentity(identity) || !group || typeof group.conflict !== "boolean" || !group.members || Object.keys(group.members).length > 64) throw Error("invalid appearance baseline");
        for (const [key, member] of Object.entries(group.members)) {
          // Baselines saved before avatarStyle joined have no mark for it: unknown, not corrupt.
          if (member?.marks && typeof member.marks === "object" && !own(member.marks, "avatarStyle")) member.marks.avatarStyle = { ...UNKNOWN_STYLE };
          if (typeof member.hostId !== "string" || typeof member.profileId !== "string" || typeof member.hostName !== "string" || key !== JSON.stringify([member.hostId, member.profileId]) || !LOOK_FIELDS.every((f) => typeof member.marks?.[f]?.value === "string" && typeof member.marks[f].token === "string" && (member.marks[f].time === null || typeof member.marks[f].time === "string"))) throw Error("invalid appearance member");
        }
      }
      parsed.jobs = parsed.jobs.map((job) => {
        if (!validIdentity(job.group) || !parsed.groups[job.group] || typeof job.id !== "string" || !Array.isArray(job.targets) || job.targets.length > 64) throw Error("invalid appearance pending item");
        return { id: job.id, group: job.group, undo: job.undo === true, values: cleanAppearanceChanges(job.values), targets: job.targets.map((target) => {
          if (!parsed.groups[job.group]!.members[target.key] || !target.expected || typeof target.expected !== "object") throw Error("invalid appearance target");
          return { key: target.key, before: cleanAppearanceChanges(target.before), expected: Object.fromEntries(LOOK_FIELDS.filter((f) => typeof target.expected[f] === "string").map((f) => [f, target.expected[f]])) };
        }) };
      });
      this.state = parsed;
    } catch { this.brokenStorage = true; this.unreadableStorage = true; }
  }
  private styled(hostId: string) { try { return this.transport.styled?.(hostId) === true; } catch { return false; } }
  /** Whether a field may be read from / written to this host (avatarStyle: only with the capability). */
  private carries(field: LookField, hostId: string) { return field !== "avatarStyle" || this.styled(hostId); }
  private marksOf(ref: LinkedProfileRef): Marks {
    const marks = appearanceMarks(ref.profile);
    return this.styled(ref.hostId) ? marks : { ...marks, avatarStyle: { ...UNKNOWN_STYLE } };
  }
  private memberOf(ref: LinkedProfileRef): Member { return { hostId: ref.hostId, profileId: ref.profile.id, hostName: ref.hostName, marks: this.marksOf(ref) }; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private generation(identity: string) { return this.generations.get(identity) ?? 0; }
  private invalidate(identity: string) { const next = this.generation(identity) + 1; this.generations.set(identity, next); return next; }
  private jobCurrent(job: Job, generation: number, target?: Target, field?: LookField) {
    const group = this.state.groups[job.group];
    return this.generation(job.group) === generation && this.state.jobs.includes(job) && !!group && !this.editing.has(job.group)
      && (job.undo || !group.conflict && !group.paused)
      && (!target || job.targets.includes(target) && !!group.members[target.key])
      && (!field || !!target && own(target.expected, field) && own(job.values, field));
  }
  private changed() {
    try {
      if (this.unreadableStorage) throw Error("pending storage unreadable");
      const text = JSON.stringify(this.state);
      if (text.length > 4_000_000) throw Error("appearance pending storage full");
      this.storage.setItem(PROFILE_LINK_APPEARANCE_STORAGE, text);
      this.brokenStorage = false;
    } catch { this.brokenStorage = true; }
    this.version++;
    for (const listener of this.listeners) listener();
  }
  private notice(group: string, kind: AppearanceNotice["kind"], hosts: string[] = []) {
    this.notices.set(group, { id: ++this.version, kind, hosts: [...new Set(hosts)], undo: (this.undoRecords.get(group)?.length ?? 0) > 0 || this.state.jobs.some((j) => j.group === group && !j.undo) });
    this.changed();
  }
  view(identity: string | null) {
    const group = identity ? this.state.groups[identity] : undefined;
    const refs = identity ? this.transport.refs().filter((r) => accountLinkIdentity(r.profile) === identity) : [];
    const members = group ? Object.values(group.members) : refs.map((r) => this.memberOf(r));
    const storedNotice = identity ? this.notices.get(identity) : undefined;
    const canUndo = !!identity && ((this.undoRecords.get(identity)?.length ?? 0) > 0 || this.state.jobs.some((j) => j.group === identity && !j.undo));
    const notice = storedNotice ? { ...storedNotice, undo: canUndo } : undefined;
    const pendingHosts = identity ? this.state.jobs.filter((j) => j.group === identity).flatMap((j) => j.targets.filter((t) => Object.keys(t.expected).length).map((t) => group?.members[t.key]?.hostName ?? "")) : [];
    return { members, choices: refs.filter((r) => r.connected && this.transport.allowed(r.hostId)), busy: !!identity && this.editing.has(identity), conflict: group?.conflict ?? (refs.length > 1 && refs.some((r) => !sameLooks(this.marksOf(r), this.marksOf(refs[0]!)))), notice: this.brokenStorage && identity ? { id: this.version, kind: "storageError" as const, hosts: [], undo: !!notice?.undo } : pendingHosts.length && notice?.kind !== "newerChange" && notice?.kind !== "error" ? { id: this.version, kind: "pending" as const, hosts: [...new Set(pendingHosts)], undo: canUndo } : notice };
  }
  private ensureGroup(identity: string, refs: readonly LinkedProfileRef[]): Group {
    let group = this.state.groups[identity];
    if (!group) {
      if (Object.keys(this.state.groups).length >= 128) throw Error("appearance baseline full");
      group = { members: {}, conflict: false };
      this.state.groups[identity] = group;
    }
    for (const ref of refs) {
      const key = memberKey(ref);
      if (!group.members[key]) {
        if (Object.keys(group.members).length >= 64) throw Error("appearance group full");
        if (Object.values(group.members).some((m) => !sameLooks(m.marks, this.marksOf(ref)))) group.conflict = true;
        group.members[key] = this.memberOf(ref);
      }
    }
    return group;
  }
  beginEdit(ref: LinkedProfileRef): () => void {
    const identity = accountLinkIdentity(ref.profile);
    if (!identity) return () => {};
    try { this.ensureGroup(identity, this.transport.refs().filter((r) => accountLinkIdentity(r.profile) === identity)); }
    catch { this.notice(identity, "error"); return () => {}; }
    const generation = this.invalidate(identity);
    this.editing.set(identity, generation);
    this.changed();
    return () => { if (this.editing.get(identity) === generation) this.editing.delete(identity); this.changed(); this.kick(); };
  }
  private current(group: string, member: Member): LinkedProfileRef | undefined {
    return this.transport.refs().find((r) => r.hostId === member.hostId && r.profile.id === member.profileId && accountLinkIdentity(r.profile) === group && r.connected && this.transport.allowed(r.hostId));
  }
  private async read(ref: LinkedProfileRef, field: LookField): Promise<LookValue> {
    if (!this.transport.allowed(ref.hostId)) throw Error("host access changed");
    if (!this.carries(field, ref.hostId)) throw Error("host does not carry this appearance field");
    if (field === "avatarStyle") {
      // A style this desktop cannot validate (a newer kind) is never copied as null.
      const raw = ref.profile.appearance.avatarStyle ?? null;
      const style = cleanAppearanceChanges({ avatarStyle: raw }).avatarStyle;
      if (raw !== null && !style) throw Error("unsupported avatar style");
      return style ?? null;
    }
    if (field !== "avatar" && field !== "introPortrait") return cleanAppearanceChanges({ [field]: ref.profile.appearance[field] ?? null })[field] ?? null;
    const expected = field === "avatar" ? ref.profile.avatarEtag : ref.profile.introPortraitEtag;
    if (!expected) return null;
    const image = await this.transport.image(ref, field);
    if (!image || image.etag !== expected || !own(cleanAppearanceChanges({ [field]: image.dataUrl }), field)) throw Error("source image changed or unavailable");
    return image.dataUrl;
  }
  private enqueue(identity: string, values: AppearanceChanges, exclude?: string, origins?: Partial<Record<LookField, string>>) {
    const group = this.state.groups[identity]!;
    const fields = LOOK_FIELDS.filter((f) => own(values, f));
    if (!fields.length) return;
    this.invalidate(identity);
    // A newer owner edit replaces pending values for these fields, never unrelated pending fields.
    for (const job of this.state.jobs.filter((j) => j.group === identity)) for (const field of fields) { delete job.values[field]; for (const target of job.targets) delete target.expected[field]; }
    this.state.jobs = this.state.jobs.filter((j) => Object.keys(j.values).length);
    if (this.state.jobs.length >= 64) throw Error("appearance pending queue full");
    const excludedHost = exclude ? group.members[exclude]?.hostId : undefined;
    const targets = Object.entries(group.members).filter(([key, member]) => key !== exclude && member.hostId !== excludedHost).map(([key, m]) => ({ key, expected: Object.fromEntries(fields.filter((f) => origins?.[f] !== m.hostId && this.carries(f, m.hostId) && (f !== "avatarStyle" || knownStyle(m.marks[f]))).map((f) => [f, m.marks[f].token])) })).filter((target) => Object.keys(target.expected).length);
    if (targets.length) this.state.jobs.push({ id: crypto.randomUUID(), group: identity, values: cleanAppearanceChanges(values), targets });
    this.undoRecords.set(identity, []);
    // Nothing to send (e.g. only avatarStyle, and no other capable host): not "pending".
    if (targets.length) this.notice(identity, "pending", targets.map((t) => group.members[t.key]!.hostName));
    else this.changed();
  }
  async saved(ref: LinkedProfileRef, changes: AppearanceChanges, also: boolean) {
    const identity = accountLinkIdentity(ref.profile);
    changes = cleanAppearanceChanges(changes);
    if (!this.carries("avatarStyle", ref.hostId)) delete changes.avatarStyle;
    if (!identity || !this.transport.allowed(ref.hostId) || !Object.keys(changes).length) return;
    const refs = this.transport.refs().filter((r) => accountLinkIdentity(r.profile) === identity);
    const group = this.ensureGroup(identity, refs);
    const generation = this.generation(identity);
    const isCurrent = () => this.generation(identity) === generation;
    let fresh = { ...ref, profile: await this.transport.fresh(ref) };
    if (!isCurrent()) return;
    if (accountLinkIdentity(fresh.profile) !== identity) throw Error("profile account changed");
    // Existing local image/theme caches write asynchronously. Confirm the host saved the same
    // owner draft before accepting its baseline; duplicate writes are idempotent on new hosts.
    for (const field of LOOK_FIELDS.filter((f) => own(changes, f))) {
      const current = await this.read(fresh, field);
      if (!isCurrent()) return;
      if (JSON.stringify(cleanAppearanceChanges({ [field]: current })[field]) !== JSON.stringify(changes[field])) {
        if (appearanceMarks(fresh.profile)[field].token !== group.members[memberKey(ref)]?.marks[field].token) {
          group.conflict = true; this.notice(identity, "newerChange", [ref.hostName]);
          throw new ProfileAppearanceSyncError("newerChange");
        }
        fresh = { ...fresh, profile: await this.transport.write(fresh, field, changes[field]!, isCurrent) };
        if (!isCurrent()) return;
      }
    }
    const mark = this.memberOf(fresh);
    group.members[memberKey(ref)] ??= mark;
    for (const field of LOOK_FIELDS.filter((f) => own(changes, f))) group.members[memberKey(ref)]!.marks[field] = mark.marks[field];
    if (also && !group.conflict) { group.paused = false; this.enqueue(identity, changes, memberKey(ref)); }
    else {
      for (const job of this.state.jobs.filter((j) => j.group === identity)) for (const target of job.targets.filter((t) => t.key === memberKey(ref))) {
        for (const field of LOOK_FIELDS.filter((f) => own(changes, f))) delete target.expected[field];
      }
      this.changed();
    }
    await this.transport.refresh().catch(() => {});
    this.kick();
  }
  async choose(identity: string, source: LinkedProfileRef) {
    if (this.editing.has(identity) || !this.transport.allowed(source.hostId) || accountLinkIdentity(source.profile) !== identity) return;
    const generation = this.invalidate(identity);
    const isCurrent = () => this.generation(identity) === generation && this.editing.get(identity) === generation;
    this.editing.set(identity, generation);
    let selectingGroup: Group | undefined;
    try {
      selectingGroup = this.ensureGroup(identity, this.transport.refs().filter((r) => accountLinkIdentity(r.profile) === identity));
      selectingGroup.paused = true;
      this.changed();
      const refs = this.transport.refs().filter((r) => accountLinkIdentity(r.profile) === identity && r.connected && this.transport.allowed(r.hostId));
      const freshRefs = await Promise.all(refs.map(async (ref) => ({ ...ref, profile: await this.transport.fresh(ref) })));
      if (!isCurrent()) return;
      if (freshRefs.some((ref) => accountLinkIdentity(ref.profile) !== identity)) throw new ProfileAppearanceSyncError("newerChange");
      const fresh = freshRefs.find((ref) => memberKey(ref) === memberKey(source));
      if (!fresh) throw Error("source unavailable");
      if (accountLinkIdentity(fresh.profile) !== identity) throw Error("profile account changed");
      const group = this.ensureGroup(identity, this.transport.refs().filter((r) => accountLinkIdentity(r.profile) === identity));
      const values: AppearanceChanges = {};
      await Promise.all(LOOK_FIELDS.filter((field) => this.carries(field, fresh.hostId)).map(async (field) => { values[field] = await this.read(fresh, field); }));
      if (!isCurrent()) return;
      // Explicit source choice authorizes overwriting the currently observed target versions,
      // not the stale versions that originally produced this conflict. Offline targets stay fenced.
      for (const ref of freshRefs) group.members[memberKey(ref)] = this.memberOf(ref);
      group.conflict = false; group.paused = false;
      this.state.jobs = this.state.jobs.filter((j) => j.group !== identity);
      this.enqueue(identity, values, memberKey(source));
    } catch (error) { if (isCurrent()) { if (selectingGroup) selectingGroup.conflict = true; this.notice(identity, error instanceof ProfileAppearanceSyncError ? error.kind : "error"); } }
    finally { if (this.editing.get(identity) === generation) this.editing.delete(identity); this.changed(); this.kick(); }
  }
  keepSeparate(identity: string) {
    const group = this.state.groups[identity];
    if (group) { this.invalidate(identity); this.editing.delete(identity); group.paused = true; group.conflict = false; this.state.jobs = this.state.jobs.filter((j) => j.group !== identity); this.notices.delete(identity); this.changed(); }
  }
  async undo(identity: string) {
    const group = this.state.groups[identity];
    if (!group) return;
    const generation = this.invalidate(identity);
    this.editing.set(identity, generation);
    group.paused = true; group.conflict = true;
    // A request may have committed while its reply was lost. Retain the pre-write snapshot and
    // undo only while the observed value still equals that uncertain request's desired value.
    const uncertain = this.state.jobs.filter((j) => j.group === identity && !j.undo).flatMap((job) => job.targets.flatMap((target) =>
      LOOK_FIELDS.filter((field) => own(job.values, field) && own(target.expected, field) && !!target.before && own(target.before, field)).map((field): Job => ({
        id: crypto.randomUUID(), group: identity, undo: true, values: { [field]: target.before![field]! },
        targets: [{ key: target.key, expected: { [field]: `undo-unconfirmed:${JSON.stringify(job.values[field])}` } }],
      }))));
    this.state.jobs = this.state.jobs.filter((j) => j.group !== identity);
    const records = this.undoRecords.get(identity) ?? [];
    if (!records.length && !uncertain.length) {
      this.undoRecords.delete(identity); this.notices.delete(identity); this.editing.delete(identity); this.changed(); return;
    }
    if (this.state.jobs.length + records.length + uncertain.length > 64) { this.editing.delete(identity); this.notice(identity, "error"); return; }
    this.state.jobs.push(...uncertain);
    for (const record of records.toReversed()) {
      this.state.jobs.push({ id: crypto.randomUUID(), group: identity, values: record.values, targets: [{ key: JSON.stringify([record.member.hostId, record.member.profileId]), expected: record.expected }], undo: true });
    }
    this.undoRecords.delete(identity);
    this.editing.delete(identity);
    this.notice(identity, "pending", records.map((r) => r.member.hostName));
    this.kick();
  }
  /**
   * A conflict is a stored flag; once every member is observed now and all look the same (e.g. the
   * other host caught up after first association), there is nothing left to choose: clear it and take
   * the observed values as the baseline. Never writes and leaves `paused` as it is. Any member not
   * observed now (offline, not allowed) keeps the conflict, since it could still differ.
   */
  private settleConflict(identity: string, group: Group, current: readonly LinkedProfileRef[], observed: Map<string, Marks>) {
    const live = new Set(current.filter((r) => r.connected && this.transport.allowed(r.hostId)).map((r) => memberKey(r)));
    const keys = Object.keys(group.members);
    if (keys.length < 2 || !keys.every((key) => live.has(key) && observed.has(key))) return;
    const marks = keys.map((key) => observed.get(key)!);
    if (!marks.every((a) => marks.every((b) => sameLooks(a, b)))) return;
    for (const key of keys) for (const field of LOOK_FIELDS) {
      const mark = observed.get(key)![field];
      if (field !== "avatarStyle" || knownStyle(mark)) group.members[key]!.marks[field] = mark;
    }
    group.conflict = false;
    if (this.notices.get(identity)?.kind === "newerChange") this.notices.delete(identity);
    this.changed();
  }
  kick = () => { this.again = true; if (!this.running) this.flight = this.run(); };
  async flush(): Promise<void> { this.kick(); await this.flight; }
  private cancelledReceipt(job: Job, target: Target, member: Member, field: LookField, previous: LookValue, next: ProfileItem) {
    const after = appearanceMarks(next)[field];
    const compensation = this.state.jobs.filter((j) => j.group === job.group && j.undo).flatMap((j) => j.targets)
      .find((t) => t.key === target.key && t.expected[field]?.startsWith("undo-unconfirmed:"));
    if (compensation) compensation.expected[field] = after.token;
    else {
      const undo = this.undoRecords.get(job.group) ?? [];
      undo.push({ member: { ...member }, values: { [field]: previous }, expected: { [field]: after.token } });
      this.undoRecords.set(job.group, undo);
      if (!this.notices.has(job.group)) this.notice(job.group, "synced", [member.hostName]);
    }
    this.changed();
  }
  private cancelledUncertainReceipt(job: Job, target: Target, member: Member, field: LookField, previous: LookValue, desired: LookValue) {
    if (this.state.jobs.some((j) => j.group === job.group && j.undo && j.targets.some((t) => t.key === target.key && own(t.expected, field)))) return;
    const undo = this.undoRecords.get(job.group) ?? [];
    undo.push({ member: { ...member }, values: { [field]: previous }, expected: { [field]: `undo-unconfirmed:${JSON.stringify(desired)}` } });
    this.undoRecords.set(job.group, undo);
    this.notice(job.group, "error", [member.hostName]);
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    let activeIdentity: string | null = null;
    try {
      do {
        this.again = false;
        const refs = this.transport.refs();
        for (const [identity, group] of Object.entries(this.state.groups)) {
          for (const [key, member] of Object.entries(group.members)) {
            const changedAccount = refs.find((r) => r.hostId === member.hostId && r.profile.id === member.profileId && r.connected && this.transport.allowed(r.hostId) && accountLinkIdentity(r.profile) !== identity);
            if (!changedAccount) continue;
            delete group.members[key];
            for (const job of this.state.jobs.filter((j) => j.group === identity)) job.targets = job.targets.filter((t) => t.key !== key);
            const newIdentity = accountLinkIdentity(changedAccount.profile);
            if (newIdentity) this.notice(newIdentity, "newerChange", [member.hostName]);
          }
        }
        const identities = new Set(refs.map((r) => accountLinkIdentity(r.profile)).filter((s): s is string => !!s));
        groups: for (const identity of identities) {
          activeIdentity = identity;
          if (this.editing.has(identity)) continue;
          const current = refs.filter((r) => accountLinkIdentity(r.profile) === identity);
          const observed = new Map(current.map((ref) => [memberKey(ref), this.marksOf(ref)]));
          const group = this.ensureGroup(identity, current);
          if (group.conflict && !this.state.jobs.some((j) => j.group === identity)) this.settleConflict(identity, group, current, observed);
          if (group.conflict || group.paused || this.state.jobs.some((j) => j.group === identity)) continue;
          // A style baseline unknown (older host, or saved before this field) is adopted from the first
          // capable observation; members that then disagree need the owner's choice, as on first association.
          const adopt = current.filter((r) => r.connected && this.transport.allowed(r.hostId) && !knownStyle(group.members[memberKey(r)]!.marks.avatarStyle) && knownStyle(observed.get(memberKey(r))!.avatarStyle));
          if (adopt.length) {
            for (const r of adopt) group.members[memberKey(r)]!.marks.avatarStyle = observed.get(memberKey(r))!.avatarStyle;
            if (new Set(Object.values(group.members).filter((m) => knownStyle(m.marks.avatarStyle)).map((m) => m.marks.avatarStyle.value)).size > 1) { group.conflict = true; this.changed(); continue; }
            this.changed();
          }
          const generation = this.generation(identity);
          const isCurrent = () => this.generation(identity) === generation && !this.editing.has(identity) && !group.paused && !group.conflict;
          const values: AppearanceChanges = {};
          const origins: Partial<Record<LookField, string>> = {};
          const winnerMarks: Partial<Record<LookField, { key: string; mark: Marks[LookField] }>> = {};
          for (const field of LOOK_FIELDS) {
            const changed = current.filter((r) => r.connected && this.transport.allowed(r.hostId) && this.carries(field, r.hostId) && (field !== "avatarStyle" || knownStyle(observed.get(memberKey(r))![field]) && knownStyle(group.members[memberKey(r)]!.marks[field])) && observed.get(memberKey(r))![field].value !== group.members[memberKey(r)]!.marks[field].value);
            if (!changed.length) continue;
            // Replication itself gives the receiver a newer local clock. Only new changes since
            // the established baseline compete; an unchanged receiver must not undo a later edit.
            const clocks = changed.map((r) => ({ key: memberKey(r), mark: observed.get(memberKey(r))![field] }));
            if (clocks.some((r) => !Number.isFinite(Date.parse(r.mark.time ?? "")))) { group.conflict = true; break; }
            clocks.sort((a, b) => (Date.parse(b.mark.time ?? "") || 0) - (Date.parse(a.mark.time ?? "") || 0));
            const top = clocks[0]!;
            if (clocks.some((c) => c.key !== top.key && c.mark.time === top.mark.time && c.mark.value !== top.mark.value)) { group.conflict = true; break; }
            const winner = current.find((r) => memberKey(r) === top.key && r.connected && this.transport.allowed(r.hostId));
            if (!winner) continue;
            const fresh = { ...winner, profile: await this.transport.fresh(winner) };
            if (!isCurrent()) continue groups;
            if (accountLinkIdentity(fresh.profile) !== identity) continue;
            values[field] = await this.read(fresh, field);
            if (!isCurrent()) continue groups;
            origins[field] = winner.hostId;
            winnerMarks[field] = { key: memberKey(winner), mark: appearanceMarks(fresh.profile)[field] };
          }
          if (isCurrent() && Object.keys(values).length) {
            for (const field of LOOK_FIELDS.filter((f) => own(values, f))) {
              for (const [key, marks] of observed) if (group.members[key] && (field !== "avatarStyle" || knownStyle(marks[field]))) group.members[key]!.marks[field] = marks[field];
              const winner = winnerMarks[field];
              if (winner) group.members[winner.key]!.marks[field] = winner.mark;
            }
            this.enqueue(identity, values, undefined, origins);
          }
        }
        for (const job of [...this.state.jobs]) {
          activeIdentity = job.group;
          const group = this.state.groups[job.group];
          const generation = this.generation(job.group);
          if (!this.jobCurrent(job, generation) || !group) continue;
          for (const target of job.targets) {
            if (!this.jobCurrent(job, generation, target)) break;
            const member = group.members[target.key];
            if (!member) continue;
            const ref = this.current(job.group, member);
            if (!ref) continue;
            let attempted: { field: LookField; previous: LookValue; value: LookValue } | undefined;
            try {
              let fresh = { ...ref, profile: await this.transport.fresh(ref) };
              if (!this.jobCurrent(job, generation, target)) break;
              if (accountLinkIdentity(fresh.profile) !== job.group) { group.conflict = true; continue; }
              for (const field of LOOK_FIELDS.filter((f) => own(target.expected, f) && own(job.values, f) && this.carries(f, member.hostId))) {
                const isCurrent = () => this.jobCurrent(job, generation, target, field) && !!this.current(job.group, member);
                if (!isCurrent()) break;
                const before = appearanceMarks(fresh.profile)[field];
                const value = job.values[field]!;
                const previous = await this.read(fresh, field);
                if (!isCurrent()) break;
                if (JSON.stringify(cleanAppearanceChanges({ [field]: previous })[field]) === JSON.stringify(value)) {
                  if (!job.undo && target.before && own(target.before, field)) {
                    const undo = this.undoRecords.get(job.group) ?? [];
                    undo.push({ member: { ...member }, values: { [field]: target.before[field]! }, expected: { [field]: before.token } });
                    this.undoRecords.set(job.group, undo);
                    delete target.before[field];
                  }
                  member.marks[field] = before; delete target.expected[field]; continue;
                }
                const uncertainUndo = job.undo && target.expected[field]?.startsWith("undo-unconfirmed:") && JSON.stringify(cleanAppearanceChanges({ [field]: previous })[field]) === target.expected[field]!.slice("undo-unconfirmed:".length);
                if (before.token !== target.expected[field] && !uncertainUndo) { group.conflict = true; this.notice(job.group, "newerChange", [member.hostName]); break; }
                if (!isCurrent()) break;
                if (!job.undo) {
                  target.before ??= {};
                  if (!own(target.before, field)) { target.before[field] = previous; this.changed(); }
                }
                if (!isCurrent()) break;
                attempted = { field, previous, value };
                const next = await this.transport.write(fresh, field, value, isCurrent);
                if (accountLinkIdentity(next) !== job.group) throw Error("account changed during appearance write");
                if (!isCurrent()) { this.cancelledReceipt(job, target, member, field, previous, next); break; }
                const after = appearanceMarks(next)[field];
                if (!job.undo) {
                  const undo = this.undoRecords.get(job.group) ?? [];
                  undo.push({ member: { ...member }, values: { [field]: target.before![field]! }, expected: { [field]: after.token } });
                  this.undoRecords.set(job.group, undo);
                }
                fresh = { ...fresh, profile: next };
                member.marks[field] = after; delete target.expected[field]; if (target.before) delete target.before[field];
                attempted = undefined;
                this.changed();
              }
            } catch (error) {
              if (this.jobCurrent(job, generation, target)) {
                if (error instanceof ProfileAppearanceSyncError && error.kind === "newerChange") group.conflict = true;
                this.notice(job.group, error instanceof ProfileAppearanceSyncError ? error.kind : "error", [member.hostName]);
              } else if (attempted) this.cancelledUncertainReceipt(job, target, member, attempted.field, attempted.previous, attempted.value);
            }
          }
          if (this.jobCurrent(job, generation) && job.targets.every((t) => !Object.keys(t.expected).some((f) => own(job.values, f)))) {
            this.state.jobs = this.state.jobs.filter((j) => j.id !== job.id);
            this.notice(job.group, "synced", job.targets.map((t) => group.members[t.key]!.hostName));
          }
        }
        this.changed();
      } while (this.again);
    } catch { if (activeIdentity) this.notice(activeIdentity, "error"); }
    finally { this.running = false; }
  }
}

let singleton: ProfileLinkAppearanceSync | null = null;
let started = false;
const connectionFences = new WeakMap<ProfileItem, () => boolean>();
const checkedConnection = (ref: LinkedProfileRef) => connectionFences.get(ref.profile) ?? captureAccountLinkAction(ref.hostId);
export const profileAppearanceTransport: AppearanceTransport = {
  refs: accountProfilesSnapshot, allowed: accountLinkHostAllowed,
  styled(hostId) {
    const data = hostData(useApp.getState(), hostId);
    return !!data?.featuresKnown && data.features.has(PROFILE_AVATAR_STYLE_FEATURE);
  },
  async fresh(ref) {
    const isCurrent = captureAccountLinkAction(ref.hostId);
    const id = ref.profile.id;
    const identity = accountLinkIdentity(ref.profile);
    if (!isCurrent()) throw Error("host access changed");
    const next = await apiFor(ref.hostId).getProfile(id);
    if (!isCurrent() || next.id !== id || accountLinkIdentity(next) !== identity) throw Error("profile connection or account changed");
    connectionFences.set(next, isCurrent);
    return next;
  },
  async image(ref, field) {
    const isCurrent = checkedConnection(ref);
    if (!isCurrent()) throw Error("host connection changed");
    const image = await apiFor(ref.hostId).profileImage(ref.profile.id, field === "avatar" ? "avatar" : "intro-portrait");
    if (!isCurrent()) throw Error("host connection changed");
    return image;
  },
  async write(ref, field, value, operationCurrent = () => true) {
    const isCurrent = checkedConnection(ref);
    const canSend = () => isCurrent() && operationCurrent();
    const id = ref.profile.id;
    const identity = accountLinkIdentity(ref.profile);
    const expected = appearanceMarks(ref.profile)[field].token;
    if (!canSend()) throw Error("host access or operation changed");
    const api = apiFor(ref.hostId);
    const current = await api.getProfile(id);
    if (!canSend()) throw Error("host connection or operation changed");
    if (current.id !== id || accountLinkIdentity(current) !== identity || appearanceMarks(current)[field].token !== expected) throw new ProfileAppearanceSyncError("newerChange");
    // The check is intentionally immediately before mutation. There is no backend If-Match yet;
    // once sent, a request may commit and must return a receipt even if the owner cancels it.
    if (!canSend()) throw Error("host connection or operation changed");
    let receipt: ProfileItem;
    let imageEtag: string | null | undefined;
    if (field === "avatar" || field === "introPortrait") {
      const result = await api.putProfileImage(id, field === "avatar" ? "avatar" : "intro-portrait", value as string | null);
      if (!isCurrent()) throw Error("appearance outcome needs refresh");
      imageEtag = result.etag;
      patchProfileLook(ref.hostId, id, field === "avatar" ? { avatarEtag: result.etag } : { introPortraitEtag: result.etag });
    } else {
      // Only the mutation response identifies our own revision. A later read may
      // already contain another owner edit and must never become our undo fence.
      receipt = await api.patchProfile(id, { [field]: value } as ProfilePatch);
      if (receipt.id !== id || accountLinkIdentity(receipt) !== identity) throw Error("appearance outcome needs refresh");
    }
    if (!isCurrent()) throw Error("appearance outcome needs refresh");
    const next = await api.getProfile(id);
    if (!isCurrent() || next.id !== id || accountLinkIdentity(next) !== identity) throw Error("appearance outcome needs refresh");
    if (field === "avatar" || field === "introPortrait") {
      // Image writes return only an etag; accept a revision only while the
      // subsequent profile still describes that exact image (including deletion).
      const observedEtag = field === "avatar" ? next.avatarEtag : next.introPortraitEtag;
      if ((observedEtag ?? null) !== imageEtag) throw new ProfileAppearanceSyncError("newerChange");
      receipt = next;
    }
    connectionFences.set(receipt!, isCurrent);
    updateCachedProfile(next.name, { detail: next }, ref.hostId);
    // Sessions that follow the Profile style redraw from the looks cache.
    if (field === "avatarStyle") patchProfileLook(ref.hostId, id, { appearance: { avatarStyle: next.appearance.avatarStyle ?? null } });
    await refreshAccountProfiles(ref.hostId);
    if (!isCurrent()) throw Error("appearance outcome needs refresh");
    return receipt!;
  },
  refresh: () => refreshAccountProfiles(),
};
function appearanceSync(): ProfileLinkAppearanceSync {
  if (singleton) return singleton;
  let storage: Pick<Storage, "getItem" | "setItem">;
  try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw Error("storage unavailable"); } }; }
  singleton = new ProfileLinkAppearanceSync(profileAppearanceTransport, storage);
  return singleton;
}
export function startProfileLinkAppearanceSync(): ProfileLinkAppearanceSync {
  const sync = appearanceSync();
  if (started) return sync;
  started = true;
  subscribeAccountProfiles(sync.kick);
  let connection = "";
  if (typeof useApp.subscribe === "function") useApp.subscribe(() => {
    const next = (useApp.getState().hosts?.hosts ?? []).map((h) => `${h.id}:${h.conn?.epoch ?? ""}:${accountLinkHostAllowed(h.id)}`).join("|");
    if (next !== connection) { connection = next; void refreshAccountProfiles().then(() => singleton?.kick(), () => {}); }
  });
  sync.kick();
  return sync;
}
export function useProfileLinkAppearance(hostId: string, profile: ProfileItem) {
  const sync = appearanceSync();
  useSyncExternalStore(sync.subscribe, sync.snapshot, sync.snapshot);
  const current = accountProfilesSnapshot().find((ref) => ref.hostId === hostId && ref.profile.id === profile.id)?.profile ?? profile;
  const candidateIdentity = accountLinkIdentity(current);
  const identity = candidateIdentity && accountLinkHostAllowed(hostId) ? candidateIdentity : null;
  useEffect(() => { startProfileLinkAppearanceSync(); sync.kick(); }, [sync, identity]);
  const view = sync.view(identity);
  const self: LinkedProfileRef = { hostId, hostName: view.members.find((m) => m.hostId === hostId)?.hostName ?? hostId, profile: current, connected: !!identity };
  return { ...view, linked: !!identity && view.members.some((m) => m.hostId !== hostId), retry: sync.kick, beginEdit: () => sync.beginEdit(self), saved: (values: AppearanceChanges, also: boolean) => sync.saved(self, values, also).catch((error: unknown) => { throw error instanceof ProfileAppearanceSyncError ? error : new ProfileAppearanceSyncError("error"); }), choose: (source: LinkedProfileRef) => identity ? sync.choose(identity, source) : Promise.resolve(), keepSeparate: () => { if (identity) sync.keepSeparate(identity); }, undo: () => identity ? sync.undo(identity) : Promise.resolve() };
}
export type LinkedAppearanceControls = ReturnType<typeof useProfileLinkAppearance>;

/**
 * 已同步到 X · 撤销同步 is a moment, not a row (owner 2026-10-25): shown this long after the sync happened, then gone;
 * the undo stays in the card's ⋯ (linkedAppearanceUndoNow) and the synced state in the 同一账号 badge's tooltip.
 */
export const SYNCED_NOTICE_MS = 8000;
const firstSeen = new Map<number, number>();
/** Whether a notice is still shown: a 已同步 one only for SYNCED_NOTICE_MS after this window first saw it; others stay. */
export function noticeShown(notice: AppearanceNotice | undefined | null, now = Date.now()): boolean {
  if (!notice) return false;
  if (notice.kind !== "synced") return true;
  const seen = firstSeen.get(notice.id) ?? (firstSeen.set(notice.id, now), now);
  return now - seen < SYNCED_NOTICE_MS;
}

/** Outside React (the card's ⋯): 取消同步到 X while this Profile's last appearance sync can still be undone. */
export function linkedAppearanceUndoNow(hostId: string, profile: ProfileItem): { hosts: string[]; run(): Promise<void> } | null {
  const sync = appearanceSync();
  const current = accountProfilesSnapshot().find((ref) => ref.hostId === hostId && ref.profile.id === profile.id)?.profile ?? profile;
  const candidate = accountLinkIdentity(current);
  const identity = candidate && accountLinkHostAllowed(hostId) ? candidate : null;
  if (!identity) return null;
  const view = sync.view(identity);
  if (!view.notice?.undo || view.busy) return null;
  const hosts = view.notice.hosts.length ? view.notice.hosts : view.members.filter((m) => m.hostId !== hostId).map((m) => m.hostName);
  return { hosts: [...new Set(hosts)], run: () => sync.undo(identity) };
}
