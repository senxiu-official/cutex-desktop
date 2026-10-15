// Settings → Profiles, overview → detail:
//   overview: one card per profile with [+ 添加 profile]: the owner's manual order (lib/profileOrder:
//             drag a card, or 上移 / 下移 / 移到最前 in its menu, Alt+↑ / Alt+↓ / Alt+Home on a focused
//             card; 恢复默认顺序), else default first, then cutex's order;
//   detail:   the profile's editor full width (breadcrumb 设置 › Profiles › <name> in the title bar);
//   添加:      the in-page create form as its own page.
// The sub-page lives in the store (`view.profilePage`), so `openSettings("profiles", {profile})`
// from anywhere lands on that profile's detail. Lifecycle (cutex profile-create / -duplicate /
// -delete) is gated per capability. Below the overview's list: the `settings.section` items of
// page `profiles` (claude-accounts: Claude 账户); `openSettings("profiles", {anchor: <item id>})`
// scrolls to one.
import type { DeleteProfileOptions } from "../../lib/profileRefs";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import type { CutexRefusal, ProfileItem, ProfilePatch } from "../../../../shared/ipc";
import { bridge } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { useArmed } from "../../lib/armedConfirm";
import { openMenuAt, openMenuFrom, promptDialog, type MenuEntry } from "../../lib/contextMenu";
import { isDefaultProfile, orderProfiles } from "../../lib/profileCards";
import { applyProfileOrder, canMoveProfile, dropProfile, moveProfile, setProfileOrder, useProfileOrder, type ProfileMove } from "../../lib/profileOrder";
import { copyName } from "../../lib/profileCreate";
import { defaultModelEditable, PROFILE_FEATURES } from "../../lib/profileKind";
import { defaultModelMenu } from "../../lib/profileDefaultModel";
import { useModelName } from "../../lib/modelDisplay";
import { cachedProfile, cachedProfileList, prefetchProfiles, rememberProfileList, updateCachedProfile } from "../../lib/profileSnapshot";
import { QUOTA_UPDATED_EVENT, quotaEventPlanChanged } from "../../lib/quota";
import { requestSettingsReveal } from "../../lib/settingsSearchView";
import { SettingsSections } from "../../modules/Outlet";
import { profilePageOf, SETTINGS_PAGE, useApp } from "../../store";
import { Button, Loading } from "./Form";
import { NewProfileForm } from "./NewProfileForm";
import { noteNewAgentProfile, useKeptNewAgentDraft } from "../../lib/newAgentReturn";
import { ProfileCard } from "./ProfileCard";
import { ProfileEditor } from "./ProfileEditor";
import { useTargetApi, useTargetFeatures, useTargetHostId, useTargetLoadQuota } from "../../lib/targetHost";

type ProfileList = { defaultProfile: string | null; profiles: ProfileItem[] };

/** One overview card + its armed-delete state (each card arms on its own). */
function Card({ item, isDefault, menu, onOpen, onDelete, onModelMenu }: {
  item: ProfileItem;
  isDefault: boolean;
  menu(item: ProfileItem, arm: () => void): MenuEntry[];
  onModelMenu?(el: HTMLElement): void;
  onOpen(): void;
  onDelete(): Promise<void>;
}) {
  const [armed, setArmed] = useArmed(item.name);
  const [deleting, setDeleting] = useState(false);
  return (
    <ProfileCard
      item={item}
      isDefault={isDefault}
      armed={armed}
      deleting={deleting}
      onOpen={() => !armed && onOpen()}
      onModelMenu={armed ? undefined : onModelMenu}
      onMenu={(at) => {
        const entries = menu(item, () => setArmed(true));
        if ("el" in at) openMenuFrom(at.el, entries);
        else openMenuAt(at.x, at.y, entries);
      }}
      onConfirmDelete={() => {
        setDeleting(true);
        void onDelete().finally(() => (setDeleting(false), setArmed(false)));
      }}
    />
  );
}


/** Sections of the profile editor that `openSettings("profiles", { profile, anchor })` scrolls to (`#profile-<anchor>`). */
const PROFILE_ANCHORS: readonly string[] = ["account", "quota"];
/** Settings → Profiles, with 「返回新建」 on top while a new-agent draft waits for this host. */
export function ProfilesPage() {
  return (
    <>
      <NewAgentReturnBar />
      <ProfilesBody />
    </>
  );
}

/**
 * New agent → 「添加 Profile…」 / 「管理 Profile」 kept its draft (lib/newAgentReturn): the way back to it,
 * on the draft's host only (the new profile shows in the form's Profile menu there).
 */
function NewAgentReturnBar() {
  const { t } = useI18n();
  const kept = useKeptNewAgentDraft();
  const targetHost = useTargetHostId();
  if (!kept || kept.hostId !== targetHost) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-sm" role="status" data-testid="new-agent-return">
      <span className="min-w-0 flex-1">{t("agent-config.newAgent.returnHint")}</span>
      <Button primary onClick={() => useApp.getState().openPage("agent-config.newAgent", kept.params)}>{t("agent-config.newAgent.returnButton")}</Button>
    </div>
  );
}

function ProfilesBody() {
  const api = useTargetApi();
  const targetHost = useTargetHostId();
  const { t } = useI18n();
  const features = useTargetFeatures();
  const loadQuota = useTargetLoadQuota();
  const modelName = useModelName();
  const openSettings = useApp((s) => s.openSettings);
  const settingsParams = useApp((s) => (s.view.kind === "page" && s.view.page === SETTINGS_PAGE ? s.view.params : null));
  const page = settingsParams ? profilePageOf(settingsParams) : undefined;
  const focus = useApp((s) => s.settingsFocus);
  const [list, setList] = useState<ProfileList | null | undefined>(() => cachedProfileList(targetHost) ?? undefined);
  /** Last lifecycle result, in the overview's toolbar row (fixed spot: never shifts the cards). */
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  /** Why cutex refused deleting a profile; shown in that profile's detail overview card. */
  const [refusal, setRefusal] = useState<{ profile: string; refusal: CutexRefusal } | null>(null);
  // Any other anchor is a card of the overview: a module section (`settings.section` item id, e.g. the
  // profile editor's 管理账户 → Claude 账户) — scroll to it and flash it once it renders.
  useEffect(() => {
    if (!focus?.anchor || PROFILE_ANCHORS.includes(focus.anchor)) return;
    requestSettingsReveal(focus.anchor);
    useApp.setState({ settingsFocus: null });
  }, [focus]);
  // `/logout` lands on this agent's profile with its account section in view; the identity menu's
  // 用量 ▸ rows on its 额度 section.
  useEffect(() => {
    const anchor = focus?.anchor;
    if (!anchor || !PROFILE_ANCHORS.includes(anchor)) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(`profile-${anchor}`);
      if (!el && ++tries <= 20) return;
      clearInterval(timer);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      // Consumed only now: clearing it earlier re-runs this effect and its cleanup stops the timer.
      useApp.setState({ settingsFocus: null });
    }, 100);
    return () => clearInterval(timer);
  }, [focus]);
  const refresh = () =>
    api.listProfiles().then(
      (r) => {
        rememberProfileList(r, targetHost);
        if (r) prefetchProfiles(r.profiles, targetHost);
        setList(r);
      },
      () => setList(null),
    );
  useEffect(() => {
    void refresh();
  }, []);
  // cutex observed a different account plan (quota event `planChanged`): the cards' plan labels follow.
  useEffect(
    () =>
      bridge.on("hostEvent", ({ hostId, envelope }) => {
        if (envelope.cutex?.method !== QUOTA_UPDATED_EVENT || hostId !== targetHost) return;
        if (quotaEventPlanChanged(envelope.cutex.params).length) void refresh();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    for (const p of list?.profiles ?? []) void loadQuota(p.name);
  }, [list, loadQuota]);

  const savedOrder = useProfileOrder(targetHost);
  const profiles = list ? applyProfileOrder(orderProfiles(list), savedOrder) : null;
  /** Drag-to-reorder: the card being dragged and where it would land (line above / below a card). */
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const shownIds = profiles ? profiles.map((p) => p.id) : [];
  /** Save a new order of every listed profile (deleted ones drop out); focus follows the moved card. */
  const saveOrder = (ids: string[], focusId?: string) => {
    setProfileOrder(targetHost, ids);
    if (focusId) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-profile-card="${CSS.escape(focusId)}"] [role="button"]`)?.focus());
  };
  const move = (p: ProfileItem, how: ProfileMove, focus = false) => saveOrder(moveProfile(shownIds, p.id, how), focus ? p.id : undefined);
  const resetOrder = () => setProfileOrder(targetHost, []);
  const onCardKey = (p: ProfileItem) => (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const how: ProfileMove | null = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "Home" ? "top" : null;
    if (!how) return;
    e.preventDefault();
    if (canMoveProfile(shownIds.indexOf(p.id), shownIds.length, how)) move(p, how, true);
  };
  const endDrag = () => (setDragged(null), setDropAt(null));
  const isDefault = (p: ProfileItem) => isDefaultProfile(p, list?.defaultProfile);
  const names = profiles ? profiles.map((p) => p.name) : [];
  const needsCutex = t("agent-config.profile.needsCutex");
  const canCreate = features.has(PROFILE_FEATURES.create);
  const canDuplicate = features.has(PROFILE_FEATURES.duplicate);
  const canDelete = features.has(PROFILE_FEATURES.delete);
  const fail = (e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), error: true });
  const open = (name: string) => openSettings("profiles", { profile: name });
  const toOverview = () => openSettings("profiles");

  const duplicate = async (p: ProfileItem) => {
    const name = await promptDialog(t("agent-config.profile.duplicateName"), copyName(p.name, names));
    if (!name?.trim()) return;
    try {
      const copy = await api.duplicateProfile(p.name, name.trim());
      await refresh();
      setNotice({ text: t("agent-config.profile.duplicated", { name: copy.name }), error: false });
      open(copy.name);
    } catch (e) {
      fail(e);
    }
  };
  /** Delete; a refusal opens the profile's detail, whose overview card explains it (clickable agents). */
  const remove = async (name: string, options?: DeleteProfileOptions) => {
    try {
      const r = await api.deleteProfile(name, options);
      if (!r.ok) {
        setRefusal({ profile: name, refusal: r.error });
        open(name);
        return;
      }
      setRefusal(null);
      // A deleted profile drops out of the saved order.
      const gone = profiles?.find((p) => p.name === name)?.id;
      if (savedOrder.length && gone) setProfileOrder(targetHost, shownIds.filter((id) => id !== gone));
      await refresh();
      setNotice({ text: t("agent-config.profile.deleted", { name }), error: false });
      toOverview();
    } catch (e) {
      fail(e);
    }
  };
  /** The card's 模型 value: pick the default model / effort (saved at once, lib/profileDefaultModel). */
  const modelMenu = async (p: ProfileItem, el: HTMLElement) => {
    let view = cachedProfile(p.name, targetHost)?.models ?? null;
    try {
      view ??= await api.profileModels(p.name);
    } catch (e) {
      return fail(e);
    }
    if (!view) return;
    const effortName = (e: string) => {
      const key = `composer.effort.${e}` as MessageKey;
      return t(key) === key ? e : t(key);
    };
    openMenuFrom(el, defaultModelMenu({
      view,
      profileId: p.id,
      claude: p.cliKind === "claude",
      model: p.model,
      effort: p.modelReasoningEffort,
      modelName,
      labels: { current: "✓", effort: t("composer.effortTitle"), effortDefault: t("settings.profile.card.effortDefault"), effortName },
      onPick: (patch) => void savePick(p, patch),
    }));
  };
  const savePick = async (p: ProfileItem, patch: ProfilePatch) => {
    try {
      const detail = await api.patchProfile(p.name, patch);
      updateCachedProfile(p.name, { detail }, targetHost);
      api.profileModels(p.name).then((models) => updateCachedProfile(p.name, { models }, targetHost), () => {});
      await refresh();
      const shown = detail.model ? modelName(detail.model, null, detail.id) : "—";
      setNotice({ text: t("settings.profile.card.modelSaved", { name: p.name, model: [shown, detail.modelReasoningEffort].filter(Boolean).join(" · ") }), error: false });
    } catch (e) {
      fail(e);
    }
  };
  const cardMenu = (p: ProfileItem, arm: () => void): MenuEntry[] => {
    const at = shownIds.indexOf(p.id);
    const moveEntry = (how: ProfileMove, label: string, hint: string): MenuEntry => ({ label, hint, disabled: !canMoveProfile(at, shownIds.length, how), onSelect: () => move(p, how, true) });
    return [
    { label: t("agent-config.profile.makeDefault"), disabled: isDefault(p), onSelect: () => void api.patchSettings({ defaultProfile: p.name }).then(refresh, fail) },
    { label: t("agent-config.profile.duplicate"), disabled: !canDuplicate, hint: canDuplicate ? undefined : needsCutex, onSelect: () => void duplicate(p) },
    {
      label: t("agent-config.profile.delete"),
      danger: true,
      disabled: !canDelete || isDefault(p),
      hint: canDelete ? (isDefault(p) ? t("agent-config.profile.deleteDefault") : undefined) : needsCutex,
      onSelect: arm,
    },
    "separator",
    moveEntry("up", t("profiles.order.up"), "Alt+↑"),
    moveEntry("down", t("profiles.order.down"), "Alt+↓"),
    moveEntry("top", t("profiles.order.top"), "Alt+Home"),
    { label: t("profiles.order.reset"), disabled: savedOrder.length === 0, onSelect: resetOrder },
  ];
  };

  if (page?.kind === "new")
    return (
      <NewProfileForm
        existing={names}
        onCancel={toOverview}
        onCreated={(detail) => {
          setNotice({ text: t("agent-config.profiles.new.created", { name: detail.name }), error: false });
          noteNewAgentProfile(targetHost, detail.id);
          void refresh().then(() => open(detail.name));
        }}
      />
    );

  if (page?.kind === "profile") {
    const name = page.name;
    const item = profiles?.find((p) => p.name === name || p.id === name) ?? null;
    if (item)
      return (
        <ProfileEditor
          key={item.name}
          profile={item.name}
          item={item}
          isDefault={isDefault(item)}
          refusal={refusal?.profile === item.name ? refusal.refusal : null}
          onChanged={(renamed) => {
            if (renamed) open(renamed);
            void refresh();
          }}
          onDuplicate={() => void duplicate(item)}
          onDelete={(options) => remove(item.name, options)}
        />
      );
    if (list === undefined) return <Loading rows={3} />;
    return (
      <div className="flex items-center gap-3 text-sm text-subtle">
        {t("agent-config.profiles.notFound", { name })}
        <Button onClick={toOverview}>{t("agent-config.profiles.backToList")}</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex min-h-7 items-center gap-3">
        <p className={`min-w-0 flex-1 truncate text-xs ${notice?.error ? "text-danger" : "text-subtle"}`} title={notice?.text}>
          {notice?.text ?? (list === null ? t("agent-config.profiles.loadFailed") : "")}
        </p>
        {savedOrder.length > 0 && profiles && profiles.length > 1 && (
          <Button title={t("profiles.order.resetHint")} onClick={resetOrder}>
            {t("profiles.order.reset")}
          </Button>
        )}
        {list !== null && (
          <Button disabled={!canCreate} title={canCreate ? undefined : needsCutex} onClick={() => (setNotice(null), openSettings("profiles", { create: true }))}>
            <span className="flex items-center gap-1">
              <Plus size={13} />
              {t("agent-config.profiles.add")}
            </span>
          </Button>
        )}
      </div>
      {profiles?.length ? (
        <div className="flex flex-col gap-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              data-profile-card={p.id}
              className={`relative ${dragged === p.id ? "opacity-40" : ""}`}
              draggable={profiles.length > 1}
              title={profiles.length > 1 ? t("profiles.order.dragHint") : undefined}
              onKeyDown={onCardKey(p)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragged(p.id);
              }}
              onDragOver={(e) => {
                if (!dragged) return;
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > box.top + box.height / 2;
                if (dropAt?.id !== p.id || dropAt.after !== after) setDropAt({ id: p.id, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged && dropAt) saveOrder(dropProfile(shownIds, dragged, dropAt.id, dropAt.after));
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              {dropAt?.id === p.id && dragged !== p.id && (
                <div className={`pointer-events-none absolute right-1 left-1 h-0.5 rounded bg-accent ${dropAt.after ? "-bottom-2" : "-top-2"}`} />
              )}
              <Card
                item={p}
                isDefault={isDefault(p)}
                menu={cardMenu}
                onOpen={() => open(p.name)}
                onDelete={() => remove(p.name)}
                onModelMenu={defaultModelEditable(p, features) ? (el) => void modelMenu(p, el) : undefined}
              />
            </div>
          ))}
        </div>
      ) : profiles ? (
        <p className="text-sm text-subtle">{t("agent-config.profiles.none")}</p>
      ) : null}
      {/* Module sections after the list, by `order` (claude-accounts: Claude 账户). Not folded. */}
      <div className="mt-6">
        <SettingsSections page="profiles" />
      </div>
    </div>
  );
}
