// New chat draft. Nothing exists in cutex until the first message, so the bar under the input works
// like the composer's (+ · permission · plan … quota · profile / model · effort), limited to what
// works before a session exists: images, $skills, skill switches / MCP status (shared codex config),
// plan mode and a goal (both applied right after the session is created, before the first message;
// see lib/pendingChat). @file and memory need a session and stay out. The first send creates the
// session (~1 s); messages typed meanwhile go out as soon as it exists. Multi-host (P1 step 2c): a
// host picker (RFC ★ Q10 default, lib/useCreateHost) chooses where the chat is created; the profiles,
// models, skills and quota under the input are that host's (TargetHostContext).
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { MessageSquarePlus, Target, X } from "lucide-react";
import type { SkillMetadata, SkillsListResponse } from "@cutex-desktop/protocol/codex/v2";
import type { ProfileItem, ProfileModelsView } from "../../../../shared/ipc";
import type { DraftImage } from "../../../../shared/input";
import { BUILTIN_THREAD_DEFAULTS, readNewThreadDefaults, type LaunchOverrides, type LaunchPermissions } from "../../../../shared/launch";
import { useI18n, type MessageKey } from "../../i18n";
import { en } from "../../i18n/en";
import { zhCN } from "../../i18n/zh-CN";
import { appendToken } from "../../lib/composerTools";
import { useImagePickBlocked } from "../../lib/remoteMode";
import { onHostSwitch } from "../../lib/hostSwitch";
import { imageFileToDataUrl } from "../../lib/images";
import { draftOffersGoal, draftSlashCommands, pendingSettingLocked } from "../../lib/pendingChat";
import { LAUNCH_FOR_MODE, PERMISSION_MODES, permissionModeOfLaunch } from "../../lib/permissionModes";
import { cachedProfile, cachedProfileList, loadProfileList } from "../../lib/profileSnapshot";
import { useOrderedProfiles } from "../../lib/profileOrder";
import { useUiPrefs } from "../../lib/prefs";
import { boundSkills, paletteQuery, parseSlash, rankEntries, type PaletteEntry } from "../../lib/slashCommands";
import { composerKeyAction } from "../../lib/sendKeys";
import { QUICK_CHAT_PROFILE_FEATURE } from "../../lib/profileCreate";
import { featuresOf, hostApi, useApp } from "../../store";
import { TargetHostContext } from "../../lib/targetHost";
import { rememberCreateHost, useCreateHost, type CreateHost } from "../../lib/useCreateHost";
import { HostPicker } from "../../components/HostPicker";
import { ChipDivider, EffortPicker, ProfileQuota } from "../../components/Composer";
import { ComposerTools } from "../../components/ComposerTools";
import { Menu } from "../../components/Menu";
import { ModelPicker } from "../../components/ModelPicker";
import { SlashPalette, type PaletteRow } from "../../components/SlashPalette";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { modelControlTitle, useModelName } from "../../lib/modelDisplay";
import { ScriptText } from "../../components/ScriptText";
import { LaunchAttachments, LaunchComposer, LaunchDock, LaunchIntro, LaunchPage } from "../../components/LaunchPage";
import { profileProvider } from "../../lib/provider";

/** Same box as the bar's popover triggers, for chips that are locked after the first send (the text
 *  goes in a `trim-cap` span, like the triggers' labels, so it shares their centre line). */
const staticChip = "flex min-w-0 rounded-md px-1.5 py-0.5 text-xs text-muted";

/** Model catalogs per host + profile id, so switching back and forth paints from cache. */
const catalogs = new Map<string, ProfileModelsView>();
onHostSwitch(() => catalogs.clear());
/** Last `quickChatDefaultProfile` per host: a revisit picks the same profile (portrait, greeting) in
 *  its first frame instead of the host default until the settings arrive. */
const quickDefaults = new Map<string, string | null>();
/** The picked composer mode survives a profile / host switch (model and effort do not). */
const keptMode = (launch: LaunchOverrides): LaunchOverrides =>
  launch.sandbox ? { sandbox: launch.sandbox, approvalPolicy: launch.approvalPolicy, ...(launch.approvalsReviewer ? { approvalsReviewer: launch.approvalsReviewer } : {}) } : {};
onHostSwitch(() => quickDefaults.clear());
let imageSeq = 0;

type PaletteItem = PaletteEntry & { skill?: SkillMetadata };

function DraftProfileList({ profiles, defaultProfile, current, locked, onPick, className = "border-b border-border pb-2" }: { profiles: ProfileItem[]; defaultProfile: string | null; current: string | null; locked: boolean; onPick(p: ProfileItem): void; className?: string }) {
  const { t } = useI18n();
  const modelName = useModelName();
  return (
    <div className={className}>
      <div className="mb-1 text-xs text-subtle">{t("chat.draft.profileTitle")}</div>
      {profiles.map((p) => (
        <button
          key={p.id}
          disabled={locked}
          onClick={() => onPick(p)}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ProfileAvatar profile={p} size={18} />
          <span className="truncate">{p.name}</span>
          <span className="ml-auto truncate text-xs text-subtle">{p.id === defaultProfile || p.name === defaultProfile ? t("quick-chats.defaultProfile") : modelName(p.model, null, p.id)}</span>
          <span className="w-3 shrink-0 text-xs text-accent">{p.id === current ? "✓" : ""}</span>
        </button>
      ))}
    </div>
  );
}

export function PendingChat() {
  const pending = useApp((s) => s.pendingChat);
  const target = useCreateHost(pending?.hostId ?? null);
  return (
    <TargetHostContext.Provider value={target.hostId}>
      <PendingChatBody target={target} />
    </TargetHostContext.Provider>
  );
}

function PendingChatBody({ target }: { target: CreateHost }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const pending = useApp((s) => s.pendingChat);
  const creating = useApp((s) => s.creatingChat);
  const queue = useApp((s) => s.queuePendingChat);
  const update = useApp((s) => s.setPendingChat);
  // The host the chat is created on; its daemon serves everything this page reads before that.
  const hostId = pending?.sessionId ? (pending.hostId ?? target.hostId) : target.hostId;
  const api = hostApi(hostId);
  const retry = useApp((s) => s.retryPendingChat);
  const { sendKeys } = useUiPrefs();
  const [text, setText] = useState("");
  const [portraitSelected, setPortraitSelected] = useState(!!pending?.profile);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [pickedSkills, setPickedSkills] = useState<{ name: string; path: string }[]>([]);
  const [allSkills, setAllSkills] = useState<SkillMetadata[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState<string | null>(null);
  const [goalEdit, setGoalEdit] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; nonce: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // From the cached list first (no "…" → name flash), refreshed in the background.
  const [profiles, setProfiles] = useState(() => cachedProfileList(hostId));
  /** In the owner's manual order (lib/profileOrder): the profile list and the portraits. */
  const ordered = useOrderedProfiles(profiles?.profiles, hostId);
  const [quick, setQuick] = useState<LaunchPermissions>(BUILTIN_THREAD_DEFAULTS.quickChat);
  const quickProfileFeature = useApp((s) => featuresOf(s, hostId).has(QUICK_CHAT_PROFILE_FEATURE));
  /** `quickChatDefaultProfile` (quick-chat-default-profile): cutex uses it when no profile is passed. */
  const [quickDefault, setQuickDefault] = useState<string | null>(() => quickDefaults.get(hostId) ?? null);
  useEffect(() => {
    setProfiles(cachedProfileList(hostId));
    setQuickDefault(quickDefaults.get(hostId) ?? null);
    setAllSkills(null);
    // A failed load ends "loading" with an empty list, so the intro falls back to the icon one.
    const none = { defaultProfile: null, profiles: [] };
    loadProfileList(hostId).then((r) => setProfiles((p) => r ?? p ?? none), () => setProfiles((p) => p ?? none));
    api.getSettings().then((s) => {
      const d = readNewThreadDefaults(s);
      if (d) setQuick(d.current.quickChat);
      quickDefaults.set(hostId, s.quickChatDefaultProfile ?? null);
      setQuickDefault(s.quickChatDefaultProfile ?? null);
    }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);
  // The picked host goes into the draft (the store creates the session there).
  useEffect(() => {
    if (pending && !pending.sessionId && pending.hostId !== hostId) update({ hostId });
  }, [pending, hostId, update]);
  const launch = pending?.launch ?? {};
  const defaultProfile = (quickProfileFeature ? quickDefault : null) ?? profiles?.defaultProfile ?? null;
  const profileKey = pending?.profile ?? defaultProfile;
  const item = profiles?.profiles.find((p) => p.id === profileKey || p.name === profileKey);
  const cachedCatalog = (p: ProfileItem | undefined) => (p ? (catalogs.get(`${hostId}|${p.id}`) ?? cachedProfile(p.name, hostId)?.models ?? null) : null);
  const [catalog, setCatalog] = useState<ProfileModelsView | null>(() => cachedCatalog(item));
  useEffect(() => {
    setCatalog(cachedCatalog(item));
    if (!item) return;
    let alive = true;
    api.profileModels(item.id).then(
      (c) => {
        catalogs.set(`${hostId}|${item.id}`, c);
        if (alive) setCatalog(c);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, item?.id]);

  // Notices (unavailable command, image errors) float in the box's corner like the composer's.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((n) => (n?.nonce === notice.nonce ? null : n)), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const notify = (value: string) => setNotice({ text: value, nonce: Date.now() });

  const models = catalog?.models ?? [];
  const defaultModel = models.find((m) => m.isDefault)?.id ?? catalog?.selectedModel ?? item?.model ?? null;
  const model = launch.model ?? defaultModel;
  const row = models.find((m) => m.id === model);
  const shownModel = modelName(model, row?.displayName, item?.id);
  const effort = launch.reasoningEffort ?? (launch.model ? row?.defaultReasoningEffort : (item?.modelReasoningEffort ?? row?.defaultReasoningEffort)) ?? null;
  const mode = permissionModeOfLaunch(launch.sandbox ?? quick.sandbox, launch.approvalPolicy ?? quick.approvalPolicy, launch.approvalsReviewer ?? quick.approvalsReviewer);
  // The store creates the session from this (自动's reviewer on an older cutex: lib/permissionModes).
  useEffect(() => {
    if (pending && !pending.sessionId && pending.permissionMode !== mode) update({ permissionMode: mode });
  }, [pending, mode, update]);
  const drafts = pending?.drafts ?? [];
  // Session-shaping choices lock with the first send; plan / goal until they were applied.
  const locked = creating || drafts.length > 0 || !!pending?.sessionId;
  const plan = !!pending?.plan;
  const goal = pending?.goal ?? null;
  const planLocked = !pending || pendingSettingLocked(pending, "plan", creating);
  const goalLocked = !pending || pendingSettingLocked(pending, "goal", creating);
  // Claude profiles hide every 设目标 entry (the runtime has no goals; it would fail after creation).
  const offersGoal = draftOffersGoal(item);
  // A goal set before switching to a Claude profile would only fail after creation: drop it.
  useEffect(() => {
    if (offersGoal || goalLocked) return;
    setGoalEdit(null);
    if (goal) update({ goal: null });
  }, [offersGoal, goalLocked, goal, update]);
  const canImages = row ? row.inputModalities.includes("image") : true; // unknown model: let the native decide
  const imagePickBlocked = useImagePickBlocked();

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  // ---------- skills (shared codex config; no session needed) ----------
  const loadSkills = () => {
    api.codexRequest("skills/list", {}).then(
      (r) => {
        setSkillsError(null);
        setAllSkills((r as SkillsListResponse).data.flatMap((e) => e.skills));
      },
      (e: unknown) => {
        setSkillsError(e instanceof Error ? e.message : String(e));
        setAllSkills((prev) => prev ?? []);
      },
    );
  };
  const query = paletteDismissed === text ? null : paletteQuery(text);
  const paletteOpen = query !== null;
  useEffect(() => {
    if (paletteOpen && !allSkills) loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, allSkills]);
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (query === null) return [];
    const commands: PaletteItem[] = draftSlashCommands(offersGoal).map((id) => {
      const key = `chat.draft.cmd.${id}` as MessageKey;
      return { key: `cmd:${id}`, kind: "command", name: id, description: t(key), keywords: [zhCN[key], en[key]] };
    });
    const skills: PaletteItem[] = (allSkills ?? []).filter((s) => s.enabled).map((s) => ({ key: `skill:${s.path}`, kind: "skill", name: s.name, description: s.interface?.shortDescription ?? s.shortDescription ?? s.description, skill: s }));
    return rankEntries(query, [...commands, ...skills]);
  }, [query, allSkills, t, offersGoal]);
  useEffect(() => setSelected(0), [query]);

  const pickSkill = (skill: SkillMetadata, how: "replace" | "append") => {
    const token = `$${skill.name} `;
    setPickedSkills((prev) => [...prev, { name: skill.name, path: skill.path }]);
    if (how === "replace") setText(token);
    else setText((prev) => appendToken(prev, token));
    focusEnd();
  };

  // ---------- plan / goal ----------
  const setPlan = (on: boolean) => {
    if (planLocked) return notify(t("chat.draft.locked"));
    update({ plan: on });
  };
  const openGoal = () => {
    if (goalLocked) return notify(t("chat.draft.locked"));
    setGoalEdit(goal ?? "");
  };
  const saveGoal = () => {
    if (goalEdit === null) return;
    update({ goal: goalEdit.trim() || null });
    setGoalEdit(null);
    focusEnd();
  };

  const pickPalette = (index: number, viaTab = false) => {
    const entry = paletteItems[index];
    if (!entry) return;
    if (entry.kind === "skill" && entry.skill) return pickSkill(entry.skill, "replace");
    if (entry.name === "goal" || viaTab) return setText(`/${entry.name} `);
    setText("");
    setPlan(!plan);
  };

  // ---------- images ----------
  const addImageFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    if (!canImages) return notify(t("composer.image.unsupported"));
    for (const file of imgs) {
      const url = await imageFileToDataUrl(file);
      if (!url) {
        notify(t("composer.image.tooLarge", { name: file.name || "image" }));
        continue;
      }
      setImages((prev) => [...prev, { id: `draft-img-${++imageSeq}`, name: file.name || "image", preview: url, source: { kind: "data", url } }]);
    }
  };
  const pickImages = async () => {
    try {
      for (const p of await api.pickImages()) {
        if (p.error) notify(t(p.error === "tooLarge" ? "composer.image.tooLarge" : "composer.image.unreadable", { name: p.name }));
        else setImages((prev) => [...prev, { id: `draft-img-${++imageSeq}`, name: p.name, preview: p.preview, source: { kind: "path", path: p.path } }]);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addImageFiles(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    void addImageFiles(files);
  };

  // ---------- send ----------
  const send = () => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    const command = images.length === 0 ? parseSlash(trimmed) : null;
    if (command) {
      if (command.id === "plan") {
        if (planLocked) return notify(t("chat.draft.locked"));
        setText("");
        // Like the composer: `/plan text` sends the text in plan mode.
        if (command.args) {
          update({ plan: true });
          queue({ text: command.args, images: [], skills: boundSkills(command.args, pickedSkills) });
          setPickedSkills([]);
        } else update({ plan: !plan });
        return;
      }
      if (command.id === "goal") {
        // Same notice the live composer's slash dispatcher gives for an agent without goals.
        if (!offersGoal) return notify(t("slash.notice.agentUnsupported", { name: command.id }));
        setText("");
        if (!command.args) return openGoal();
        if (goalLocked) return notify(t("chat.draft.locked"));
        update({ goal: command.args });
        return;
      }
      return notify(t("chat.draft.commandAfterCreate", { name: command.id }));
    }
    rememberCreateHost(hostId);
    queue({ text, images, skills: boundSkills(text, pickedSkills) });
    setText("");
    setImages([]);
    setPickedSkills([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (paletteOpen) {
      const n = paletteItems.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (n > 0) setSelected((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") && n > 0) {
        e.preventDefault();
        pickPalette(selected, e.key === "Tab");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteDismissed(text);
        return;
      }
    }
    const el = e.currentTarget;
    const action = composerKeyAction(
      sendKeys,
      { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey },
      { busy: false, hasContent: !!text.trim() || images.length > 0, pendingSteers: 0, collapsedSelection: el.selectionStart === el.selectionEnd },
    );
    if (action === "send" || action === "steer" || action === "queue" || action === "interruptSend") {
      e.preventDefault();
      send();
    }
  };

  const paletteRows: PaletteRow[] = paletteItems.map((x) => ({ key: x.key, label: `${x.kind === "skill" ? "$" : "/"}${x.name}`, description: x.description, tag: x.kind === "skill" ? t("slash.skillTag") : undefined }));
  const hasContent = !!text.trim() || images.length > 0;
  const efforts = row?.supportedReasoningEfforts ?? [];
  /** The draft's profile choice: in the quota popover and on top of the profile / model chip's menu. */
  const profileList = (close: () => void) => (
    <DraftProfileList
      profiles={ordered ?? []}
      defaultProfile={defaultProfile}
      current={item?.id ?? null}
      locked={locked}
      onPick={(p) => {
        setPortraitSelected(true);
        // Model / effort belong to the profile: reset them, keep the permission choice.
        update({ profile: p.id, launch: keptMode(launch) });
        close();
      }}
    />
  );
  const effortLabel = (e: string) => {
    const key = `composer.effort.${e}`;
    const label = t(key as MessageKey);
    return label === key ? e : label;
  };

  return (
    <LaunchPage intro={drafts.length === 0 ? <LaunchIntro showArtGreeting portraits={{ profileId: item?.id, profiles: ordered, selected: portraitSelected, disabled: locked, onSelect: (id) => { if (locked) return; setPortraitSelected(true); update({ profile: id, launch: keptMode(launch) }); } }} provider={item ? profileProvider(item) : undefined} icon={<MessageSquarePlus size={24} />} title={t("quick-chats.title")} hint={t("chat.draftHint")} /> : null}>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-4 pb-8">
          {drafts.map((d, i) => (
            <div key={i} className="my-3 flex justify-end">
              <div className="max-w-[75%] rounded-2xl border border-dashed border-border px-4 py-2 text-muted">
                {d.images.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2 pb-1.5">
                    {d.images.map((img) => (
                      <div key={img.id} className="h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface-2" title={img.name}>
                        {img.preview ? <img src={img.preview} alt={img.name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[10px] text-subtle">{img.name}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {d.text && <div className="font-chat-context whitespace-pre-wrap"><ScriptText text={d.text} /></div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {(creating || pending?.error) && (
        <p className={`mx-auto w-full max-w-3xl px-6 pb-1 text-xs ${pending?.error ? "text-danger" : "text-accent"}`}>
          {pending?.error ? (
            <>
              {t("chat.createFailed", { error: pending.error })}
              <button onClick={retry} className="ml-2 text-accent hover:underline">
                {t("chat.retry")}
              </button>
            </>
          ) : (
            <span className="animate-pulse">{t("chat.preparingQueued")}</span>
          )}
        </p>
      )}
      {/* Goal row, like the conversation's GoalBar (static: it is set when the session is created). */}
      {(goal || goalEdit !== null) && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1.5 px-6 py-1 text-xs text-muted">
          <Target size={13} className="shrink-0 text-accent" />
          <span className="shrink-0">{t("goal.label")}</span>
          {goalEdit !== null ? (
            <>
              <input
                autoFocus
                value={goalEdit}
                onChange={(e) => setGoalEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveGoal();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setGoalEdit(null);
                    focusEnd();
                  }
                }}
                placeholder={t("chat.draft.goalPlaceholder")}
                className="min-w-0 flex-1 border-b border-border bg-transparent py-0.5 text-foreground outline-none placeholder:text-subtle focus:border-accent"
              />
              <button onClick={() => setGoalEdit(null)} className="rounded-md px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground">
                {t("goal.cancel")}
              </button>
              <button onClick={saveGoal} className="rounded-md bg-accent px-1.5 py-0.5 text-white">
                {t("goal.save")}
              </button>
            </>
          ) : (
            <>
              <button disabled={goalLocked} onClick={openGoal} title={goal ?? undefined} className="min-w-0 truncate text-left text-foreground hover:underline disabled:no-underline">
                {goal}
              </button>
              <span className="shrink-0 text-subtle">· {t(pending?.applied.goal ? "goal.status.active" : "chat.draft.goalPending")}</span>
              {!goalLocked && (
                <button onClick={() => update({ goal: null })} title={t("chat.draft.goalClear")} className="ml-auto shrink-0 rounded p-0.5 hover:bg-surface-2 hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </>
          )}
        </div>
      )}
      <LaunchDock>
        <div className="relative">
          {notice && (
            <div className="pointer-events-none absolute top-2 right-3 z-10 max-w-[60%] truncate rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted shadow-sm">{notice.text}</div>
          )}
          {paletteOpen && <SlashPalette title={t("slash.title")} rows={paletteRows} selected={selected} empty={t("slash.empty")} footer={t("slash.footer")} onHover={setSelected} onPick={(i) => pickPalette(i)} />}
          <LaunchComposer
            dragOver={dragOver}
            dragEvents={{
              onDragOver: (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } },
              onDragLeave: () => setDragOver(false),
              onDrop,
            }}
            attachments={<LaunchAttachments images={images} onRemove={(id) => setImages((previous) => previous.filter((image) => image.id !== id))} />}
            textarea={{ ref: textarea, autoFocus: true, value: text, onChange: (e) => setText(e.target.value), onKeyDown, onPaste, placeholder: t("chat.preparingPlaceholder") }}
            label={t("composer.send")} disabled={!hasContent} onSubmit={send} />
        </div>

        <div className="launch-toolbar">
          {/* Where the chat is created (fixed once it exists). A new host: its own profiles, so the profile / model reset. */}
          <HostPicker
            value={hostId}
            mode={locked && target.mode === "picker" ? "label" : target.mode}
            title={t("hostPicker.createTitle")}
            up
            onChange={(h) => {
              target.setHostId(h);
              update({ hostId: h, profile: null, launch: keptMode(launch) });
            }}
          />
          <ComposerTools
            canImages={canImages}
            imagePickBlocked={imagePickBlocked ? t("remote.noAttachments") : null}
            canFiles={false}
            filesDisabledReason={t("chat.draft.afterCreate")}
            onPickImages={() => void pickImages()}
            onMention={() => {}}
            skills={allSkills}
            skillsError={skillsError}
            onLoadSkills={loadSkills}
            onInsertSkill={(s) => pickSkill(s, "append")}
            plan={{ available: true, on: plan, disabledReason: planLocked ? t("chat.draft.locked") : null, set: setPlan }}
            goal={offersGoal ? { label: goal ?? t("composer.tools.goal.unset"), disabledReason: goalLocked ? t("chat.draft.locked") : null, onClick: openGoal } : undefined}
            onManage={(tab) => useApp.getState().openSettings(tab)}
          />
          {locked ? (
            <span className={`${staticChip} whitespace-nowrap ${mode === "full" ? "text-warn" : ""}`}>
              <span className="trim-cap">{t(`composer.mode.${mode}` as MessageKey)}</span>
            </span>
          ) : (
            <Menu
              title={t("composer.permissionTitle")}
              trigger={<span className={`trim-cap whitespace-nowrap ${mode === "full" ? "text-warn" : ""}`}>{t(`composer.mode.${mode}` as MessageKey)}</span>}
              items={PERMISSION_MODES.map((m) => ({ value: m, label: t(`composer.mode.${m}` as MessageKey), description: t(`composer.modeHint.${m}` as MessageKey) }))}
              selected={mode}
              onSelect={(m) => m !== "custom" && update({ launch: { ...launch, ...LAUNCH_FOR_MODE[m] } })}
            />
          )}
          {plan && (
            <button
              disabled={planLocked}
              onClick={() => setPlan(false)}
              title={t("composer.tools.planOff")}
              className="ml-0.5 flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs text-accent hover:bg-accent/25 disabled:pointer-events-none"
            >
              {t("composer.collab.plan")}
              {!planLocked && <X size={11} />}
            </button>
          )}
          {/* Same right group as the conversation's composer (no context ring before a session exists). */}
          <div className="launch-profile-bar ml-auto flex min-w-0 items-center [&>div>button]:px-1 [&>span:not([aria-hidden])]:px-1">
            <ProfileQuota profile={item?.name ?? null} rateLimits={null} rateLimitsAt={null} sessionId={null} busy={false} switcher={(close) => profileList(close)} />
            <ChipDivider />
            {locked ? (
              <span className={staticChip} title={modelControlTitle(t("chat.draft.locked"), model, shownModel)}>
                <span className="trim-cap max-w-40 truncate">{shownModel || "—"}</span>
              </span>
            ) : (
              <ModelPicker
                profile={item?.name ?? null}
                models={models.map((m) => ({ model: m.id, displayName: m.displayName ?? m.id, description: m.id === defaultModel ? t("quick-chats.defaultProfile") : "" }))}
                current={model}
                label={shownModel || "—"}
                trigger={<span className="trim-cap max-w-40 truncate">{shownModel || "—"}</span>}
                triggerTitle={modelControlTitle(t("composer.modelTitle"), model, shownModel)}
                onOpen={() => {}}
                onSelect={(id) => update({ launch: { ...launch, model: id, reasoningEffort: undefined } })}
              />
            )}
            {effort &&
              (locked || efforts.length === 0 ? (
                <span className={staticChip}>
                  <span className="trim-cap">{effortLabel(effort)}</span>
                </span>
              ) : (
                <EffortPicker effort={effort} efforts={efforts} onChange={(x) => update({ launch: { ...launch, reasoningEffort: x } })} />
              ))}
          </div>
        </div>
      </LaunchDock>
    </LaunchPage>
  );
}
