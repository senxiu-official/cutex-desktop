// 点击与手势 (Settings → 键盘快捷键; owner 2026-10-24: the 5-column matrix was "very ugly"): one block per kind of target —
// its icon, name and where it appears — then only the gestures that do something, one per line: keycap chips on the
// left (the same <kbd> look as the shortcut list below), the result on the right. Identical gestures share a line
// (「Ctrl/⌘ + 左键点击 或 中键点击」). Above: the rule as three legend chips (并排 / 后台新开 / 关闭), whose colour
// marks the lines that follow it. Two columns of blocks when the card is wide (lib/sizeFlags: no CSS size container),
// one when narrow. Mouse gestures are icon chips (owner 2026-10-24, components/GestureIcons), the word in their tooltip
// and aria-label; keys stay text keycaps. A one-line key of the icons sits under the meaning chips.
// A rebindable command's key (桌面: paneDesktop) is the owner's effective binding, one keycap per combo like the list
// below, and follows a rebind live; a command with no key drops out of its line.
// Data: lib/gestures (GESTURES), words: i18n/gestureCatalog.
import { Fragment } from "react";
import { AppWindow, ChevronsLeftRight, Monitor, PanelTop, SquareMousePointer, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { GESTURE_INPUTS, GESTURE_KINDS, GESTURES, gestureParts, type Gesture, type GestureInput, type GestureKind, type GestureTarget } from "../../lib/gestures";
import { GestureInputIcon } from "../GestureIcons";
import { dataFlags, useSizeFlags, widthAtLeast } from "../../lib/sizeFlags";
import { bindingLabel } from "../../lib/keybindings";
import { useKeybindingsVersion } from "../../lib/useKeybindings";

const ICONS: Record<GestureTarget, LucideIcon> = {
  agent: UserRound,
  group: UsersRound,
  page: SquareMousePointer,
  launcher: AppWindow,
  tab: PanelTop,
  strip: ChevronsLeftRight,
  desktop: Monitor,
};

/** The legend's colours (the foretell tones: beside green, opening blue; close red). */
const TONE: Record<GestureKind, { chip: string; dot: string }> = {
  beside: { chip: "bg-ok/10 text-ok ring-ok/30", dot: "bg-ok" },
  background: { chip: "bg-accent/10 text-accent ring-accent/30", dot: "bg-accent" },
  close: { chip: "bg-danger/10 text-danger ring-danger/25", dot: "bg-danger" },
};

const KEYCAP = "inline-flex h-6 items-center rounded font-sans border border-border bg-surface-2 px-1.5 text-caption/[inherit] whitespace-nowrap text-foreground shadow-xs";

function GestureChip({ g }: { g: Gesture }) {
  const { t } = useI18n();
  const label = (kind: string) => (kind === "mod" ? t("gestures.mod") : t("gestures.shift"));
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-gesture="">
      {gestureParts(g).map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-caption/[inherit] text-subtle">+</span>}
          {p.kind === "input" ? (
            <InputCap input={p.value as GestureInput} />
          ) : (
            <kbd className={KEYCAP}>{label(p.kind)}</kbd>
          )}
        </Fragment>
      ))}
      {g.on === "close" && <span className="text-caption/[inherit] text-muted">{t("gestures.on.close")}</span>}
    </span>
  );
}

/** A mouse gesture as an icon keycap; its word (左键点击 …) is the tooltip and the accessible name. */
function InputCap({ input }: { input: GestureInput }) {
  const { t } = useI18n();
  const word = t(`gestures.input.${input}` as MessageKey);
  return (
    <kbd role="img" aria-label={word} title={word} data-gesture-input={input} className={`${KEYCAP} px-1`}>
      <GestureInputIcon input={input} />
    </kbd>
  );
}

const SEP = "\n";

/** A row's gestures joined by 「或」: a command gesture becomes its current combos (none: left out). */
function GestureLine({ gestures }: { gestures: readonly Gesture[] }) {
  const { t } = useI18n();
  useKeybindingsVersion();
  const chips = gestures.flatMap((g) =>
    g.command
      ? bindingLabel(g.command, SEP).split(SEP).filter(Boolean).map((combo) => (
          <kbd key={combo} className={`${KEYCAP} !font-mono`} data-gesture="" data-gesture-command={g.command}>
            {combo}
          </kbd>
        ))
      : [<GestureChip key={gestureParts(g).map((p) => p.value).join("+") + (g.on ?? "")} g={g} />],
  );
  return chips.map((chip, j) => (
    <Fragment key={j}>
      {j > 0 && <span className="text-caption/[inherit] text-subtle">{t("gestures.or")}</span>}
      {chip}
    </Fragment>
  ));
}

export function GestureLegend() {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted" data-gesture-legend="">
      <span>{t("gestures.hint")}</span>
      {GESTURE_KINDS.map((k) => (
        <span key={k} data-gesture-kind={k} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ring-1 ring-inset ${TONE[k].chip}`}>
          <span className="font-medium">{t(`gestures.legend.${k}` as MessageKey)}</span>
          <span className="opacity-80">{t(`gestures.legend.${k}.for` as MessageKey)}</span>
        </span>
      ))}
      {/* The icons' key: icon + word, one line. */}
      <span className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-caption/[inherit] text-subtle" data-gesture-icons="">
        {GESTURE_INPUTS.map((i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="text-muted">
              <GestureInputIcon input={i} size={13} />
            </span>
            {t(`gestures.input.${i}` as MessageKey)}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Two columns of blocks from this width of the guide. */
const SIZES = { wide: widthAtLeast(40) };

export function GestureGuide() {
  const { t } = useI18n();
  const [ref, flags] = useSizeFlags(SIZES);
  return (
    <div ref={ref} {...dataFlags(flags)} className="group/gestures flex flex-col gap-3" data-testid="gesture-guide">
      <GestureLegend />
      <div className="grid gap-2.5 group-data-[wide]/gestures:grid-cols-2">
        {GESTURES.map((block) => {
          const Icon = ICONS[block.id];
          return (
            <section key={block.id} data-gesture-block={block.id} aria-labelledby={`gesture-${block.id}`} className="rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5">
              <header className="mb-2 flex items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                  <Icon size={15} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span id={`gesture-${block.id}`} className="block text-sm font-medium text-foreground">
                    {t(`gestures.${block.id}.title` as MessageKey)}
                  </span>
                  <span className="block text-xs text-subtle">{t(`gestures.${block.id}.where` as MessageKey)}</span>
                </span>
              </header>
              <dl className="grid grid-cols-[fit-content(55%)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                {block.rows.map((row, i) => (
                  <Fragment key={i}>
                    <dt className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <GestureLine gestures={row.gestures} />
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5 text-xs/5 text-muted" data-gesture-result="">
                      {row.kind && <span className={`size-1.5 shrink-0 rounded-full ${TONE[row.kind].dot}`} title={t(`gestures.legend.${row.kind}` as MessageKey)} aria-hidden />}
                      <span>{t(row.result)}</span>
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </div>
  );
}
