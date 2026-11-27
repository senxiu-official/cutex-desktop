// cutex runtime skills (`/v2/runtime-skills`, contract .claude/reports/runtime-config-contract-20261128.md): one
// owner-only inventory per runtime of the daemon host, and the explicit one-way 「复制到…」 between Codex and Claude on
// that host (preview, then apply with the preview token, an action id and the confirm phrase). The daemon owns every
// path; the desktop never sends a path back.
import type { CutexRefusal } from "./ipc";

export const RUNTIME_SKILLS_FEATURE = "runtime-skills";
export const RUNTIME_SKILL_COPY_FEATURE = "runtime-skill-copy";
export const RUNTIME_SKILLS_DSH_FEATURE = "runtime-skills-dsh";
export const RUNTIME_SKILLS_KIMI_FEATURE = "runtime-skills-kimi";

export const SKILL_RUNTIMES = ["codex", "claude", "dsh", "kimi"] as const;
export type SkillRuntime = (typeof SKILL_RUNTIMES)[number];
export const COPY_RUNTIMES = ["codex", "claude"] as const;
export type CopyRuntime = (typeof COPY_RUNTIMES)[number];

export type SkillState = "enabled" | "disabled" | "default" | "unknown";
export type SkillOriginKind = "personal" | "plugin" | "builtin" | "admin" | "other";

export interface RuntimeSkill {
  /** Opaque; valid on the same host and runtime only. */
  id: string;
  name: string;
  description: string;
  /** Canonical SKILL.md path, for display only. */
  path: string;
  origin: SkillOriginKind;
  /** Root label, or the plugin id when known. */
  source: string;
  state: SkillState;
  /** Only a supported personal root. */
  copyable: boolean;
  compatibility: { status: "portable" | "review" | "unknown"; fields: string[] };
}

export interface RuntimeSkillList {
  runtime: SkillRuntime;
  skills: RuntimeSkill[];
  coverage: "partial" | "complete";
  limits: string[];
  truncated: boolean;
}

export interface SkillCopySelection {
  sourceRuntime: CopyRuntime;
  targetRuntime: CopyRuntime;
  skillId: string;
  overwrite?: boolean;
}

export interface SkillCopyPreview {
  name: string;
  destination: string;
  destinationExists: boolean;
  disposition: "copy" | "skip" | "overwrite" | "blocked";
  files: { path: string; bytes: number; script: boolean }[];
  frontmatter: { key: string; change: "preserve" | "remove" | "review" }[];
  warnings: string[];
  sourceDigest: string;
  previewToken: string | null;
  confirmPhrase: string | null;
}

export interface SkillCopyRequest extends SkillCopySelection {
  actionId: string;
  previewToken: string;
  confirmation?: string;
}

export interface SkillCopyResult {
  actionId: string;
  outcome: "copied" | "overwritten" | "skipped";
  name: string;
  destination: string;
  replayed: boolean;
}

export type RuntimeSkillsAnswer = { ok: true; list: RuntimeSkillList } | { ok: false; error: CutexRefusal };
export type SkillCopyPreviewAnswer = { ok: true; preview: SkillCopyPreview } | { ok: false; error: CutexRefusal };
export type SkillCopyAnswer = { ok: true; result: SkillCopyResult } | { ok: false; error: CutexRefusal };

/** The capability that lists `runtime` (Codex and Claude come with the base flag). */
export function runtimeSkillsFeature(runtime: SkillRuntime): string {
  return runtime === "dsh" ? RUNTIME_SKILLS_DSH_FEATURE : runtime === "kimi" ? RUNTIME_SKILLS_KIMI_FEATURE : RUNTIME_SKILLS_FEATURE;
}

export const isSkillRuntime = (v: unknown): v is SkillRuntime => typeof v === "string" && (SKILL_RUNTIMES as readonly string[]).includes(v);
export const isCopyRuntime = (v: unknown): v is CopyRuntime => typeof v === "string" && (COPY_RUNTIMES as readonly string[]).includes(v);

/** Bounded opaque strings main forwards (skill ids, preview tokens, action ids, the typed phrase). */
export const boundedText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);

/** Main's check of a selection before it leaves the app (the daemon checks again). */
export function validCopySelection(s: unknown): s is SkillCopySelection {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return isCopyRuntime(x.sourceRuntime) && isCopyRuntime(x.targetRuntime) && x.sourceRuntime !== x.targetRuntime && boundedText(x.skillId, 1024) && (x.overwrite === undefined || typeof x.overwrite === "boolean");
}

export function validCopyRequest(s: unknown): s is SkillCopyRequest {
  if (!validCopySelection(s)) return false;
  const x = s as unknown as Record<string, unknown>;
  return boundedText(x.actionId, 200) && boundedText(x.previewToken, 4096) && (x.confirmation === undefined || boundedText(x.confirmation, 400));
}

/** Only the fields the contract defines go out (no extra keys from the renderer). */
export function copySelectionBody(s: SkillCopySelection): SkillCopySelection {
  return { sourceRuntime: s.sourceRuntime, targetRuntime: s.targetRuntime, skillId: s.skillId, ...(s.overwrite ? { overwrite: true } : {}) };
}

export function copyRequestBody(s: SkillCopyRequest): SkillCopyRequest {
  return { ...copySelectionBody(s), actionId: s.actionId, previewToken: s.previewToken, ...(s.confirmation !== undefined ? { confirmation: s.confirmation } : {}) };
}
