import type { CSSProperties } from "react";
import { projectColor } from "./sidebar";

/**
 * How the sidebar sets one project's section (header + agents + 运行中 / 空闲 / 离线 rows) apart
 * (Settings → 侧栏 → 项目分隔):
 * - 标题行 (header): the header as a full-width band in the project colour, the rows below
 *   untinted with a thin rail in the project colour down their left side;
 * - 图标引线 (iconLine): the same full-width header row without any tint, the icon set in from the
 *   edge, and the line in the project colour hanging straight down from under the icon (centred on
 *   it) beside the rows, which are indented past it;
 * - 背景色 (tint): a rounded block tinted with the project colour;
 * - 左侧色条 (rail): a 2px rail in that colour on the block's left edge;
 * - 无 (none, default since the quiet pass 2026-10-14): a neutral header; the project colour stays
 *   only in the header's initial badge (components/ProjectIcon).
 * The strengths are theme variables (`--project-band`, `--project-band-rail`, `--project-tint`,
 * `--project-tint-header` in styles.css), mixed with `color-mix(in oklab, …)`.
 * 独立智能体 / 工作 get the same treatment in a neutral colour (NEUTRAL_GROUP); 项目标题着色 off drops
 * the header tint only (图标引线 has none).
 */
export type ProjectSeparation = "header" | "iconLine" | "tint" | "rail" | "none";
export const PROJECT_SEPARATIONS: readonly ProjectSeparation[] = ["header", "iconLine", "tint", "rail", "none"];
export const DEFAULT_PROJECT_SEPARATION: ProjectSeparation = "none";
/**
 * The default was "header" (a band in the project colour) before the quiet pass (owner 2026-10-14:
 * one accent, neutral surfaces). A stored "header" from then switches once to the new default
 * (projectSeparationRev, like runningAgentsRev); any other or later explicit choice is kept.
 */
export const PROJECT_SEPARATION_REV = 1;

export function migrateProjectSeparation(value: unknown, rev?: unknown): ProjectSeparation {
  if (!(PROJECT_SEPARATIONS as readonly unknown[]).includes(value)) return DEFAULT_PROJECT_SEPARATION;
  if (value === "header" && (typeof rev !== "number" || rev < PROJECT_SEPARATION_REV)) return DEFAULT_PROJECT_SEPARATION;
  return value as ProjectSeparation;
}

export interface ProjectBlockLook {
  /** Extra classes for the project's `<section>`. */
  className: string;
  /** Extra classes for the header row. */
  headerClassName: string;
  /** Extra classes for the lines under the header (本机备注 / directory). */
  metaClassName: string;
  /** Classes for the agent rows' container (the 8px extra indent, plus the mode's own). */
  bodyClassName: string;
  /** Classes for a one-row (collapsed) project's wrapper. */
  rowClassName: string;
  /** Gap below the section. */
  gapClassName: string;
  /**
   * Gap below a folded section: the same as a one-row (collapsed) project's own margin, so a folded
   * group — e.g. a starred project, which never auto-collapses — and a collapsed row share one pitch.
   */
  foldedGapClassName: string;
  /** `--project-color` for the CSS rules; undefined without any separation. */
  style: CSSProperties | undefined;
}

const NO_BLOCK: ProjectBlockLook = { className: "", headerClassName: "", metaClassName: "", bodyClassName: "pl-4", rowClassName: "", gapClassName: "mb-1.5", foldedGapClassName: "", style: undefined };

/**
 * 独立智能体 / 工作 (not projects): the same header treatment in a neutral theme colour, so they read
 * as section headers without looking like a project.
 */
export const NEUTRAL_GROUP = "neutral";

/** `--project-color` for a group: a project's raw colour (name or #hex) or NEUTRAL_GROUP. */
export function groupColor(color: string): string {
  return color === NEUTRAL_GROUP ? "var(--fg-muted)" : projectColor(color);
}

/**
 * The look of a group: `color` is a project's raw colour, NEUTRAL_GROUP, or null (no separation).
 * `headerTint` (项目标题着色) off: header bands keep their layout, icon and rail, without the tint.
 */
export function projectBlockLook(separation: ProjectSeparation, color: string | null, headerTint = true): ProjectBlockLook {
  if (color === null || separation === "none") return NO_BLOCK;
  const style = { "--project-color": groupColor(color) } as CSSProperties;
  const plain = headerTint ? "" : " project-plain";
  switch (separation) {
    case "header":
      return {
        className: "",
        headerClassName: `project-band${plain}`,
        metaClassName: "project-band-body project-band-meta",
        bodyClassName: "project-band-body project-band-rows",
        rowClassName: `project-band project-band-row${plain}`,
        gapClassName: "mb-1",
        foldedGapClassName: "",
        style,
      };
    case "iconLine":
      return {
        className: "",
        headerClassName: "project-lead",
        metaClassName: "project-lead-body project-lead-meta",
        bodyClassName: "project-lead-body project-lead-rows",
        rowClassName: "project-lead project-lead-row",
        gapClassName: "mb-1.5",
        foldedGapClassName: "",
        style,
      };
    case "tint":
      return {
        className: "project-block project-block-tint",
        headerClassName: `project-block-header${plain}`,
        metaClassName: "",
        bodyClassName: "pr-0.5 pl-4",
        rowClassName: `mb-0.5 project-block project-block-tint project-block-row${plain}`,
        gapClassName: "mb-2",
        foldedGapClassName: "mb-0.5",
        style,
      };
    case "rail":
      return {
        className: "project-block project-block-rail",
        headerClassName: "",
        metaClassName: "",
        bodyClassName: "pl-4",
        rowClassName: "mb-0.5 project-block project-block-rail project-block-row",
        gapClassName: "mb-2",
        foldedGapClassName: "mb-0.5",
        style,
      };
  }
}
