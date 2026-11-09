// Settings → 桌宠 → 全部宠物: every pet with its preview, name and source; one click picks it. Previews load when a card
// scrolls into view, so dozens of pets cost nothing up front. Nothing here copies art or deletes a user's files.
import { Check, FolderOpen, RefreshCw } from "lucide-react";
import { Button, Section } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { characterName, PetPreview } from "./PetPreview";
import { petBridge, useDeskPetView } from "./controller";

export function AllPets() {
  const { t, locale } = useI18n();
  const view = useDeskPetView();
  if (!view) return <p className="text-sm text-subtle">{t("desk-pet.unavailable")}</p>;
  return (
    <>
      <Section
        title={t("desk-pet.allPets")}
        actions={
          <span className="flex gap-1.5">
            <Button onClick={() => void petBridge()?.openFolder()}><span className="inline-flex items-center gap-1"><FolderOpen size={13} aria-hidden />{t("desk-pet.openFolder")}</span></Button>
            <Button onClick={() => void petBridge()?.reloadArt()}><span className="inline-flex items-center gap-1"><RefreshCw size={13} aria-hidden />{t("desk-pet.reloadArt")}</span></Button>
          </span>
        }
      >
        <div data-desk-pet-grid="" className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 py-2">
          {view.characters.map((c) => {
            const on = c.id === view.current;
            return (
              <button
                key={c.id}
                type="button"
                data-desk-pet-pick={c.id}
                aria-pressed={on}
                onClick={() => void petBridge()?.set({ character: c.id })}
                className={`relative flex min-w-0 flex-col items-center gap-1 rounded-lg p-2 text-center outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50 ${on ? "bg-surface-2 ring-1 ring-accent/50" : ""}`}
              >
                {on && <Check size={13} aria-hidden className="absolute top-1.5 right-1.5 text-accent" />}
                <PetPreview id={c.id} size={72} lazy pixel={c.pixel} mirror={view.settings.mirror} />
                <span className="w-full truncate text-xs">{characterName(c, locale)}</span>
                <span className="w-full truncate text-caption text-subtle">{t(`desk-pet.source.${c.source}` as MessageKey)}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title={t("desk-pet.section.art")} hint={t("desk-pet.artHint")}>
        <p className="py-1 text-xs break-all text-subtle">{view.artDir}</p>
        {view.problems.length > 0 && (
          <>
            <p className="pt-2 text-xs font-medium">{t("desk-pet.refused", { n: view.problems.length })}</p>
            <ul data-desk-pet-problems="" className="py-1 text-xs text-danger">
              {view.problems.map((p, i) => <li key={i}>{`${p.character}${p.file ? ` / ${p.file}` : ""}: ${t(`desk-pet.problem.${p.code}` as MessageKey)}`}</li>)}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}
