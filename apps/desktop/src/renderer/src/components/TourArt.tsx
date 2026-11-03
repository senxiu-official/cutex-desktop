// The onboarding's drawings (components/OnboardingFlow): small mock-ups of the real UI in the theme's colours, with the
// app's own icons (lucide, as the Shelf Rail and pane headers use them; owner 2026-10-24: no made-up pictures), moving
// with components/tour.css — infinite CSS loops, so lib/loopPause rests them with 节省资源 while the window is not in
// front, and prefers-reduced-motion shows the end frame, still. Decorative: aria-hidden, the step text says everything.
import type { CSSProperties, ReactNode } from "react";
import { FolderTree, GitCompare, Plus } from "lucide-react";
import { useI18n } from "../i18n";
import { emojiTint } from "../lib/agentEmoji";
import { drawsEmoji } from "../lib/avatarDefault";
import { themedEmoji } from "../lib/avatarThemes";
import { ONBOARDING_FACES } from "../lib/onboardingFaces";
import { useUiPrefs } from "../lib/prefs";
import { EmojiGlyph } from "./Avatar";
import "./tour.css";

const prov = (family: string) => `var(--prov-${family})`;

function Av({ family, letter, children, className = "", style }: { family: string; letter: string; children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={`tour-av ${className}`} style={{ background: prov(family), ...style }}>
      {letter}
      {children}
    </span>
  );
}

/** A conversation: you ask, the agent works in its folder with tools (its ring turns, tool rows tick in). */
export function IntroArt() {
  return (
    <div className="tour-art" aria-hidden data-tour-art="intro">
      <div className="tour-col" style={{ left: 12, right: 12, bottom: 12 }}>
        <div className="tour-bubble tour-anim-ask">
          <div className="tour-ln" style={{ width: 120, margin: 0, background: "color-mix(in srgb, var(--on-accent) 45%, transparent)" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Av family="claude" letter="E">
            <span className="tour-ring" />
          </Av>
          <div style={{ flex: 1 }}>
            <div className="tour-tool tour-anim-tool1">$ ls src</div>
            <div className="tour-tool tour-anim-tool2">✎ main.ts</div>
            <div className="tour-tool tour-anim-tool3">$ npm test ✓</div>
            <div className="tour-ln tour-anim-tool3" style={{ width: "70%" }} />
          </div>
        </div>
        <div className="tour-composer" />
      </div>
    </div>
  );
}

/** Workspaces are groups: A+B go into the tray as one capsule while C comes up, and back. */
export function GroupsArt() {
  return (
    <div className="tour-art" aria-hidden data-tour-art="groups">
      <div className="tour-col tour-anim-out" style={{ left: 10, width: "31%" }}>
        <Av family="claude" letter="A" />
        <div className="tour-ln" />
        <div className="tour-ln" style={{ width: "70%" }} />
      </div>
      <div className="tour-col tour-anim-out" style={{ left: "35%", width: "31%" }}>
        <Av family="openai" letter="B" />
        <div className="tour-ln" />
        <div className="tour-ln" style={{ width: "60%" }} />
      </div>
      <div className="tour-col tour-anim-in" style={{ left: 10, width: "62%" }}>
        <Av family="gemini" letter="C" />
        <div className="tour-ln" />
        <div className="tour-ln" style={{ width: "50%" }} />
      </div>
      <div className="tour-col" style={{ right: 10, width: "24%", borderStyle: "dashed", background: "transparent" }}>
        <Av family="gemini" letter="C" />
      </div>
      <div className="tour-tray">
        <Av family="deepseek" letter="P" className="tour-pin" />
        <span className="tour-sep" />
        <span className="tour-capsule tour-anim-capsule">
          <Av family="claude" letter="A" />
          <Av family="openai" letter="B" />
        </span>
        <Av family="kimi" letter="K" />
      </div>
    </div>
  );
}

/**
 * Shelf pages: the 改动 page dropped on 文件 merges them (two panes), 撤销 shows. The Rail and pane headers carry the
 * app's own icons for those components (modules/workspace: FolderTree 文件, GitCompare 改动; the Rail's ＋ is Plus).
 */
export function PagesArt() {
  const { t } = useI18n();
  const head = (Icon: typeof FolderTree, label: string) => (
    <div className="tour-pane-h">
      <Icon size={12} />
      {label}
    </div>
  );
  return (
    <div className="tour-art" aria-hidden data-tour-art="pages">
      <div className="tour-pane tour-anim-panetop" style={{ top: 12, bottom: 12 }}>
        {head(FolderTree, t("workspace.files"))}
      </div>
      <div className="tour-pane tour-anim-panebottom" style={{ top: "50%", bottom: 12 }}>
        {head(GitCompare, t("workspace.changes"))}
      </div>
      <div className="tour-rail">
        <span className="tour-pb">
          <FolderTree size={14} />
        </span>
        <span className="tour-pb tour-anim-pagedrag">
          <GitCompare size={14} />
        </span>
        <span className="tour-pb" style={{ border: "1px dashed var(--border)", background: "transparent" }}>
          <Plus size={14} />
        </span>
      </div>
      <span className="tour-undo tour-anim-undo">{t("shelf.toast.undo")}</span>
    </div>
  );
}

/** A project: its Director takes the request, creates members one by one, their results come back to it. */
export function ProjectArt() {
  const { t } = useI18n();
  return (
    <div className="tour-art" aria-hidden data-tour-art="project">
      <div className="tour-col" style={{ left: 12, right: 12, bottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Av family="claude" letter="D" />
          <span className="tour-tag">{t("onboarding.art.director")}</span>
          <div className="tour-ln" style={{ flex: 1, margin: 0 }} />
        </div>
        {(["openai", "gemini", "kimi"] as const).map((family, i) => (
          <div key={family} className={`tour-member tour-anim-member${i + 1}`}>
            <span className="tour-branch" />
            <Av family={family} letter={"ABC"[i]!} style={{ width: 22, height: 22, fontSize: 10 }} />
            <div className="tour-ln" style={{ flex: 1, margin: 0 }} />
            <span className="tour-result">✓</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const LOOK_ROWS: readonly { family: string; seed: string; letter: string; mark: "ring" | "badge" | "dot" | "off" }[] = [
  { family: "claude", seed: "eva", letter: "E", mark: "ring" },
  { family: "openai", seed: "sora", letter: "S", mark: "badge" },
  { family: "gemini", seed: "mika", letter: "M", mark: "dot" },
  { family: "kimi", seed: "kai", letter: "K", mark: "off" },
];

/**
 * The new look, in the style chosen earlier in the flow (owner 2026-10-24): with 拟人头像 on, the chosen themes' faces
 * (the fixed onboarding set); 极简风格: emoji or letters as 侧栏 → 默认头像 draws them. Every face has the thin outline in
 * its model colour and 头像底色 = 按模型 puts a picture on a tint of it, exactly like components/Avatar — so the choice on
 * this card shows at once.
 */
export function LookArt() {
  const { portraitPacks, avatarTint, agentAvatarDefault } = useUiPrefs();
  const faces = portraitPacks.map((k) => ONBOARDING_FACES.get(k)).filter((u): u is string => !!u);
  const face = (row: (typeof LOOK_ROWS)[number], i: number): ReactNode => {
    const url = faces.length ? faces[i % faces.length] : null;
    const color = prov(row.family);
    const edge = <span className="tour-face-edge" style={{ boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 70%, transparent)` }} />;
    if (url) {
      const tinted = avatarTint === "provider";
      return (
        <span className="tour-face" data-look-face="picture" data-look-tint={tinted ? row.family : undefined} style={{ background: tinted ? `color-mix(in oklab, ${color} 16%, var(--bg))` : "transparent" }}>
          <img src={url} alt="" draggable={false} />
          {edge}
        </span>
      );
    }
    if (drawsEmoji(agentAvatarDefault))
      return (
        <span className="tour-face" data-look-face="emoji" style={{ background: emojiTint(color) }}>
          <EmojiGlyph glyph={themedEmoji(row.seed).glyph} size={20} />
          {edge}
        </span>
      );
    return (
      <span className="tour-face" data-look-face="letter" style={{ background: color, color: "#fff" }}>
        {row.letter}
        {edge}
      </span>
    );
  };
  return (
    <div className="tour-art" aria-hidden data-tour-art="look">
      <div style={{ position: "absolute", inset: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {LOOK_ROWS.map((row, i) => (
          <div key={row.seed} style={{ display: "flex", alignItems: "center", gap: 10, ...(row.mark === "off" ? { opacity: 0.5, filter: "grayscale(1)" } : {}) }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              {face(row, i)}
              {row.mark === "ring" && <span className="tour-ring" />}
              {row.mark === "badge" && <span className="tour-badge">3</span>}
              {row.mark === "dot" && <span className="tour-dot" />}
            </span>
            <div style={{ flex: 1 }}>
              <div className="tour-ln" style={{ width: "40%", margin: "2px 0" }} />
              <div className="tour-ln" style={{ width: "65%", margin: "4px 0 0" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** And also: the permanent feature directory, including host requirements. */
export function MoreArt() {
  const { t } = useI18n();
  return <div className="tour-art" aria-hidden data-tour-art="more">
    <div className="absolute inset-4 flex flex-col gap-3 overflow-hidden rounded-inner border border-border bg-surface p-3 text-meta text-muted">
      <span className="text-title text-foreground">{t("onboarding.features.title")}</span>
      <span>↕ {t("onboarding.feature.tray.title")}</span>
      <span>▦ {t("onboarding.feature.widgets.title")}</span>
      <span>ⓘ {t("onboarding.features.needs")}</span>
    </div>
  </div>;
}

/** The introduction's 「窗口里的几块」: the five parts, labelled; a soft highlight goes from one to the next. */
export function WindowArt() {
  const { t } = useI18n();
  const box = (style: CSSProperties, label: string, n: number) => (
    <div className={`tour-part tour-anim-part${n}`} style={style}>
      {label}
    </div>
  );
  return (
    <div className="tour-art" aria-hidden data-tour-art="window" style={{ background: "color-mix(in srgb, var(--accent) 8%, var(--bg))" }}>
      {box({ left: 10, top: 10, bottom: 10, width: "22%" }, t("onboarding.window.sidebar"), 1)}
      {box({ left: "calc(22% + 18px)", top: 10, bottom: 52, width: "36%" }, t("onboarding.window.conversation"), 2)}
      {box({ left: "calc(58% + 26px)", top: 10, bottom: 52, right: 10 }, t("onboarding.window.shelf"), 3)}
      {box({ left: "calc(22% + 18px)", bottom: 14, height: 30, right: 10 }, t("onboarding.window.tray"), 4)}
      <span className="tour-part-desktop tour-anim-part5">{t("onboarding.window.desktop")}</span>
    </div>
  );
}
