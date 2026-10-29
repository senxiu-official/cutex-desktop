// Pieces the desktop and the 个人页 share: the background (cover, else the launch art over the sky scene,
// variant C; the desktop's own, remembered across starts and cross-faded: DesktopBackdrop, modules/home/backdrop),
// the profile avatar, the heatmap and the stat tiles.
import { useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import { useLaunchArtView } from "../../lib/launchArt";
import type { PortraitProvider } from "../../lib/launchPortraits";
import { identityInitials } from "../../lib/identity";
import type { Identity } from "../../lib/identityView";
import { Avatar } from "../../components/Avatar";
import { heatWeeks, type HeatCell } from "./stats";
import { ART_PREFERENCE, backdropId, type DeskBackdrop } from "./backdrop";
const PROVIDER_NAME: Record<PortraitProvider, string> = { glm: "GLM", kimi: "Kimi", gemini: "Gemini", codex: "Codex", claude: "Claude", deepseek: "DeepSeek" };

/** The background: the home cover (full bleed), else the launch art's portrait over the sky scene. */
export function Backdrop({ cover, credit = false, className = "" }: { cover: string | null; credit?: boolean; className?: string }) {
  const { t } = useI18n();
  const { art } = useLaunchArtView();
  const provider = ART_PREFERENCE.find((p) => art[p]);
  const portrait = provider ? art[provider]!.portrait : null;
  return (
    <div className={`home-scene absolute inset-0 overflow-hidden ${className}`} data-home-backdrop={cover ? "cover" : portrait ? "art" : "scene"} aria-hidden>
      {cover ? (
        <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        portrait && <img src={portrait} alt="" className="absolute right-[4%] bottom-0 h-[92%] max-w-[55%] object-contain object-bottom" draggable={false} />
      )}
      <div className="absolute inset-0" style={{ background: "var(--home-veil)" }} />
      {credit && !cover && provider && <div className="absolute bottom-3 left-5 text-caption/[inherit] text-white/75 [text-shadow:0_1px_6px_rgba(0,0,0,0.4)]">{`${t("home.artCredit")} · ${PROVIDER_NAME[provider]}`}</div>}
    </div>
  );
}

/** One drawn desktop background: the cover full bleed, or the art's portrait, over the sky scene. */
function BackdropImage({ backdrop }: { backdrop: DeskBackdrop }) {
  const { art } = useLaunchArtView();
  if (backdrop.kind === "cover") return backdrop.dataUrl ? <img src={backdrop.dataUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} /> : null;
  const portrait = backdrop.kind === "art" ? art[backdrop.provider]?.portrait : undefined;
  return portrait ? <img src={portrait} alt="" className="absolute right-[4%] bottom-0 h-[92%] max-w-[55%] object-contain object-bottom" draggable={false} /> : null;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The desktop's background (owner 2026-10-21, modules/home/backdrop): drawn at once from what is known or
 * remembered (never an unrelated portrait first); when it changes, the new one cross-fades in over the old
 * (instant with reduced motion).
 */
export function DesktopBackdrop({ backdrop }: { backdrop: DeskBackdrop }) {
  const id = backdropId(backdrop);
  const [cur, setCur] = useState({ id, backdrop });
  // The background being faded out (under the new one) while the new one fades in.
  const [prev, setPrev] = useState<{ id: string; backdrop: DeskBackdrop } | null>(null);
  if (cur.id !== id) {
    // Derived during render: React redraws before committing, so no frame shows the old one alone.
    setPrev(reducedMotion() ? null : cur);
    setCur({ id, backdrop });
  }
  return (
    <div className="home-scene absolute inset-0 overflow-hidden" data-home-backdrop={backdrop.kind === "cover" ? (backdrop.dataUrl ? "cover" : "scene") : backdrop.kind} aria-hidden>
      {prev && prev.id !== id && (
        <div key={prev.id} data-home-backdrop-layer="out" className="home-scene absolute inset-0">
          <BackdropImage backdrop={prev.backdrop} />
        </div>
      )}
      <div key={id} data-home-backdrop-layer="in" className={`home-scene absolute inset-0 ${prev && prev.id !== id ? "home-backdrop-in" : ""}`} onAnimationEnd={() => setPrev(null)}>
        <BackdropImage backdrop={backdrop} />
      </div>
      <div className="absolute inset-0" style={{ background: "var(--home-veil)" }} />
    </div>
  );
}

/** The launch art's credit line (bottom left) when the background is the art: drawn with the desktop's content. */
export function ArtCredit({ backdrop }: { backdrop: DeskBackdrop }) {
  const { t } = useI18n();
  const { art } = useLaunchArtView();
  const provider = backdrop.kind === "art" && art[backdrop.provider] ? backdrop.provider : null;
  if (!provider) return null;
  return <div className="pointer-events-none absolute bottom-3 left-5 text-caption/[inherit] text-white/75 [text-shadow:0_1px_6px_rgba(0,0,0,0.4)]" data-home-credit="">{`${t("home.artCredit")} · ${PROVIDER_NAME[provider]}`}</div>;
}

export function MeAvatar({ identity, size, ring = false }: { identity: Identity; size: number; ring?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full ${ring ? "border-2 border-white/75" : ""}`}>
      <Avatar name={identity.name} initial={identityInitials(identity.name)} color={identity.color} picture={identity.picture} size={size} />
    </span>
  );
}

export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="min-w-0 flex-1 px-3.5 py-2.5" title={hint}>
      <b className="block truncate text-lg font-semibold tabular-nums">{value}</b>
      <span className="block truncate text-meta/[inherit] text-subtle">{label}</span>
    </div>
  );
}

/**
 * The one-year heatmap (53 weeks × 7 days, Monday on top): one sequential hue (the usage page's token
 * blue) in quartile steps, a tooltip per day, scaled to the width it gets (SVG).
 */
export function Heatmap({ days, today, locale }: { days: ReadonlyMap<string, number>; today: string; locale: string }) {
  const { t } = useI18n();
  const weeks = heatWeeks(days, today);
  const cell = 11;
  const gap = 3;
  const w = weeks.length * (cell + gap) - gap;
  const h = 7 * (cell + gap) - gap;
  const fmt = new Intl.NumberFormat(locale);
  const title = (c: HeatCell) => (c.tokens > 0 ? t("home.heat.cell", { date: c.day, tokens: fmt.format(c.tokens) }) : t("home.heat.none", { date: c.day }));
  return (
    <div data-home-heatmap="">
      <svg viewBox={`0 0 ${w} ${h}`} className="home-heat block h-auto w-full" role="img" aria-label={t("home.heat.label")}>
        {weeks.map((week, x) =>
          week.map((c, y) =>
            c.future ? null : (
              <rect key={c.day} x={x * (cell + gap)} y={y * (cell + gap)} width={cell} height={cell} rx={2.5} data-level={c.level}>
                <title>{title(c)}</title>
              </rect>
            ),
          ),
        )}
      </svg>
      <div className="mt-1.5 flex items-center justify-between text-caption/[inherit] text-subtle">
        <span>{t("home.heat.caption")}</span>
        <span className="flex items-center gap-[3px]">
          {t("home.heat.less")}
          <svg viewBox="0 0 68 10" className="home-heat h-2.5 w-[68px]" aria-hidden>
            {[0, 1, 2, 3, 4].map((l) => (
              <rect key={l} x={l * 14} y={0} width={10} height={10} rx={2} data-level={l} />
            ))}
          </svg>
          {t("home.heat.more")}
        </span>
      </div>
    </div>
  );
}
