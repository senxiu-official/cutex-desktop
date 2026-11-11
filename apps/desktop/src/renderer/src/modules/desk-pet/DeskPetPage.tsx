// Settings → 桌宠: the pet on screen and how it shows, what was counted and what cannot be. Every pet is on the sub-page.
import { useEffect, useState } from "react";
import { DESK_PET_OPACITIES, DESK_PET_SIZES, type DeskPetSettings } from "../../../../shared/deskPet";
import { Button, Section, Select, SettingRow, SubPageRow, Toggle } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { characterName, PetPreview } from "./PetPreview";
import { booksOf, pendingOf, POOL_BOOK_CHOICES, POOL_SPEED_CHOICES } from "./books";
import { openAllPets, petBridge, resetAllCounters, setPoolConfig, useCounters, useDeskPetView, usePool, useTokensToday } from "./controller";
import { totalOf } from "./counters";

export function DeskPetPage() {
  const { t, locale } = useI18n();
  const view = useDeskPetView();
  const counters = useCounters();
  const tokens = useTokensToday();
  const pool = usePool();
  // The amount goes down while the pet works: the page counts it on, once a second, only while it is open.
  const [now, setNow] = useState(() => Date.now());
  const working = !!pool?.state.active && !view?.settings.hidden;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  const [armed, setArmed] = useState(false);
  if (!view) return <p className="text-sm text-subtle">{t("desk-pet.unavailable")}</p>;
  const { settings } = view;
  const set = (patch: Partial<DeskPetSettings>) => void petBridge()?.set(patch);
  const toggleRow = (key: "onlyInFront" | "showCount" | "idleBlink" | "clickThrough" | "followModel" | "mirror" | "currentOnly" | "waitingMark" | "tokenIcons", label: MessageKey, hint?: MessageKey) => (
    <SettingRow agents="none" source="local" label={t(label)} hint={hint ? t(hint) : undefined}>
      <Toggle checked={settings[key]} onChange={(v) => set({ [key]: v })} label={t(label)} />
    </SettingRow>
  );
  const number = (n: number) => <span className="tabular-nums">{n.toLocaleString()}</span>;
  const current = view.characters.find((c) => c.id === view.current);
  return (
    <>
      <Section title={t("desk-pet.section.pet")}>
        <div className="flex items-center gap-3 py-2">
          {current && <PetPreview id={current.id} size={64} pixel={current.pixel} mirror={settings.mirror} />}
          <span className="min-w-0 truncate text-sm">{current ? characterName(current, locale) : view.current}</span>
        </div>
        <SubPageRow title={t("desk-pet.allPets")} summary={t("desk-pet.allPetsSummary", { n: view.characters.length })} onOpen={openAllPets} />
        {toggleRow("followModel", "desk-pet.followModel", "desk-pet.followModelHint")}
        {pool && (
          <>
            <SettingRow agents="none" source="local" label={t("desk-pet.books")} hint={t("desk-pet.booksHint")}>
              <span className="tabular-nums">
                {(() => {
                  const s = pool.state;
                  const spent = working && s.active ? Math.min(s.active.left, ((Math.max(0, now - s.at) / 60_000) * pool.config.tokensPerMinute)) : 0;
                  return t("desk-pet.booksValue", { tokens: Math.round(pendingOf(s) - spent).toLocaleString(), books: booksOf(s, pool.config).toLocaleString(), done: s.done.toLocaleString() });
                })()}
              </span>
            </SettingRow>
            <SettingRow agents="none" source="local" label={t("desk-pet.bookSize")}>
              <Select value={String(pool.config.tokensPerBook)} options={POOL_BOOK_CHOICES.map((n) => ({ value: String(n), label: n.toLocaleString() }))} onChange={(v) => setPoolConfig({ tokensPerBook: Number(v) })} label={t("desk-pet.bookSize")} />
            </SettingRow>
            <SettingRow agents="none" source="local" label={t("desk-pet.workSpeed")}>
              <Select value={String(pool.config.tokensPerMinute)} options={POOL_SPEED_CHOICES.map((n) => ({ value: String(n), label: t("desk-pet.perMinute", { n: n.toLocaleString() }) }))} onChange={(v) => setPoolConfig({ tokensPerMinute: Number(v) })} label={t("desk-pet.workSpeed")} />
            </SettingRow>
          </>
        )}
      </Section>
      <Section title={t("desk-pet.section.display")}>
        <SettingRow agents="none" source="local" label={t("desk-pet.shown")}>
          <Toggle checked={!settings.hidden} onChange={(v) => set({ hidden: !v })} label={t("desk-pet.shown")} />
        </SettingRow>
        {toggleRow("clickThrough", "desk-pet.clickThrough", "desk-pet.clickThroughHint")}
        <SettingRow agents="none" source="local" label={t("desk-pet.size")}>
          <Select value={String(settings.size)} options={DESK_PET_SIZES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))} onChange={(v) => set({ size: Number(v) })} label={t("desk-pet.size")} />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("desk-pet.opacity")}>
          <Select value={String(settings.opacity)} options={DESK_PET_OPACITIES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))} onChange={(v) => set({ opacity: Number(v) })} label={t("desk-pet.opacity")} />
        </SettingRow>
        {toggleRow("mirror", "desk-pet.mirror", "desk-pet.mirrorHint")}
        {toggleRow("onlyInFront", "desk-pet.onlyInFront", "desk-pet.onlyInFrontHint")}
        {toggleRow("idleBlink", "desk-pet.idleBlink")}
        {view.placement === "limited" && <p className="px-1 py-2 text-xs text-subtle">{t("desk-pet.limitedPlacement")}</p>}
        {view.onTop === false && <p className="px-1 py-2 text-xs text-subtle">{t("desk-pet.notOnTop")}</p>}
        {!view.shape && view.placement !== "limited" && <p className="px-1 py-2 text-xs text-subtle">{t("desk-pet.noShape")}</p>}
      </Section>
      <Section title={t("desk-pet.section.energy")} hint={t("desk-pet.energyHint")}>
        {toggleRow("currentOnly", "desk-pet.currentOnly", "desk-pet.currentOnlyHint")}
        {toggleRow("waitingMark", "desk-pet.waitingMark", "desk-pet.waitingMarkHint")}
        {toggleRow("tokenIcons", "desk-pet.tokenIcons", "desk-pet.tokenIconsHint")}
      </Section>
      <Section title={t("desk-pet.section.tokens")} hint={t("desk-pet.tokensHint")}>
        {toggleRow("showCount", "desk-pet.showCount")}
        <SettingRow agents="none" source="local" label={t("desk-pet.count.tokensToday")}>{number(tokens)}</SettingRow>
      </Section>
      <Section title={t("desk-pet.section.counts")} hint={t("desk-pet.countsHint")}>
        <SettingRow agents="none" source="local" label={t("desk-pet.count.messages")}>{number(counters.ownerMessage)}</SettingRow>
        <SettingRow agents="none" source="local" label={t("desk-pet.count.commands")}>{number(counters.command)}</SettingRow>
        <SettingRow agents="none" source="local" label={t("desk-pet.count.tools")}>{number(counters.tool)}</SettingRow>
        <SettingRow agents="none" source="local" label={t("desk-pet.count.total")}>{number(totalOf(counters))}</SettingRow>
        <SettingRow agents="none" source="local" label={t("desk-pet.reset")}>
          {armed ? (
            <span className="flex gap-1.5">
              <Button onClick={() => { resetAllCounters(); setArmed(false); }}>{t("desk-pet.resetConfirm")}</Button>
              <Button onClick={() => setArmed(false)}>{t("desk-pet.cancel")}</Button>
            </span>
          ) : (
            <Button onClick={() => setArmed(true)}>{t("desk-pet.reset")}</Button>
          )}
        </SettingRow>
      </Section>
    </>
  );
}
