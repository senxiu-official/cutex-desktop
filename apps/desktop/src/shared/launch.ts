// Thread launch options (cutex `launch` object on POST /v2/human/{agents,sessions}) and new-thread
// defaults (`/v2/settings` newThreadDefaults). Shared by main (validation before forwarding) and the
// renderer (forms). Pure, unit-tested. See docs/launch-options.md.

export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

/** cutex accepts only these two (`untrusted` cannot be launched; granular is not plumbed). */
export const APPROVAL_POLICIES = ["on-request", "never"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export type ThreadKind = "agent" | "quickChat";
export const THREAD_KINDS: readonly ThreadKind[] = ["agent", "quickChat"];

/** Effective permissions of one thread kind (`newThreadDefaults.<kind>`). */
export interface LaunchPermissions {
  sandbox: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
  writableRoots: string[];
}

export type LaunchField = keyof LaunchPermissions;
export const LAUNCH_FIELDS: readonly LaunchField[] = ["sandbox", "approvalPolicy", "networkAccess", "writableRoots"];

export interface NewThreadDefaults {
  agent: LaunchPermissions;
  quickChat: LaunchPermissions;
}

/**
 * cutex built-ins of hosts that do not report newThreadDefaults (older cutex: agents full access). A
 * current cutex reports its own (`newThreadDefaultsBuiltin`; since 2026-10-15 fresh installs give
 * agents workspace-write + on-request + network, existing homes keep full access stored explicitly).
 */
export const BUILTIN_THREAD_DEFAULTS: NewThreadDefaults = {
  agent: { sandbox: "danger-full-access", approvalPolicy: "never", networkAccess: false, writableRoots: [] },
  quickChat: { sandbox: "workspace-write", approvalPolicy: "on-request", networkAccess: false, writableRoots: [] },
};

/** Per-create overrides; absent fields keep the kind default (model / effort: the profile default). */
export interface LaunchOverrides {
  sandbox?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  networkAccess?: boolean;
  writableRoots?: string[];
  model?: string;
  reasoningEffort?: string;
}

/** PATCH /v2/settings `newThreadDefaults`: absent = unchanged, field null = built-in, kind null = reset kind. */
export type NewThreadDefaultsPatch = Partial<Record<ThreadKind, { [K in LaunchField]?: LaunchPermissions[K] | null } | null>>;

/** Absolute path on Windows (drive / UNC) or POSIX. */
export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path) || path.startsWith("/");
}

const visible = (value: string) => value.length > 0 && value.trim() === value && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);

/**
 * Keep only well-formed launch fields (main validates whatever the renderer sends before it reaches
 * cutex). Returns null when nothing valid is left, so callers can omit `launch` entirely.
 */
export function sanitizeLaunch(raw: unknown): LaunchOverrides | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: LaunchOverrides = {};
  if (typeof x.sandbox === "string" && (SANDBOX_MODES as readonly string[]).includes(x.sandbox)) out.sandbox = x.sandbox as SandboxMode;
  if (typeof x.approvalPolicy === "string" && (APPROVAL_POLICIES as readonly string[]).includes(x.approvalPolicy)) out.approvalPolicy = x.approvalPolicy as ApprovalPolicy;
  if (typeof x.networkAccess === "boolean") out.networkAccess = x.networkAccess;
  if (Array.isArray(x.writableRoots)) {
    out.writableRoots = [...new Set(x.writableRoots.filter((p): p is string => typeof p === "string" && visible(p) && isAbsolutePath(p)))].slice(0, 32);
  }
  if (typeof x.model === "string" && visible(x.model)) out.model = x.model;
  if (typeof x.reasoningEffort === "string" && visible(x.reasoningEffort) && /^[A-Za-z0-9_-]+$/.test(x.reasoningEffort)) out.reasoningEffort = x.reasoningEffort;
  return Object.keys(out).length ? out : null;
}

/** Same value (writable roots compared as ordered lists). */
export function sameLaunchValue<K extends LaunchField>(a: LaunchPermissions[K], b: LaunchPermissions[K]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/** Fields of `current` that differ from the built-in defaults (Settings shows a reset for these). */
export function changedFields(current: LaunchPermissions, builtin: LaunchPermissions): LaunchField[] {
  return LAUNCH_FIELDS.filter((f) => !sameLaunchValue(current[f], builtin[f]));
}

/** New Agent "Advanced" form state. `model` / `reasoningEffort` empty = profile default. */
export interface LaunchForm extends LaunchPermissions {
  model: string;
  reasoningEffort: string;
}

/**
 * `launch` for a create request: omitted while the Advanced section is untouched (cutex applies the
 * kind defaults); once touched, the full permission set plus model / effort when chosen.
 */
export function launchFromForm(form: LaunchForm, touched: boolean): LaunchOverrides | undefined {
  if (!touched) return undefined;
  const launch: LaunchOverrides = {
    sandbox: form.sandbox,
    approvalPolicy: form.approvalPolicy,
    networkAccess: form.networkAccess,
    writableRoots: [...form.writableRoots],
  };
  if (form.model.trim()) launch.model = form.model.trim();
  if (form.reasoningEffort) launch.reasoningEffort = form.reasoningEffort;
  return launch;
}

/** Append a writable root (absolute, deduplicated); returns the same array when nothing changes. */
export function addWritableRoot(roots: readonly string[], path: string): string[] {
  const p = path.trim();
  if (!p || !isAbsolutePath(p) || roots.includes(p)) return roots as string[];
  return [...roots, p];
}

/** Read `newThreadDefaults` / `newThreadDefaultsBuiltin` off a settings response; null on older cutex. */
export function readNewThreadDefaults(settings: { newThreadDefaults?: unknown; newThreadDefaultsBuiltin?: unknown } | null | undefined): { current: NewThreadDefaults; builtin: NewThreadDefaults } | null {
  const current = settings?.newThreadDefaults as NewThreadDefaults | undefined;
  const builtin = settings?.newThreadDefaultsBuiltin as NewThreadDefaults | undefined;
  if (!current?.agent || !current.quickChat || !builtin?.agent || !builtin.quickChat) return null;
  return { current, builtin };
}
