// Per-module preview mocks (docs/desktop-modules.md §8 "mock"). A module that needs daemon data in
// the browser preview ships `modules/<id>/mock.ts` exporting `mock: ModuleMock`; dev/mockModules.ts
// collects them with import.meta.glob and dev/mockBridge.ts (the core: hosts, agents, threads,
// timeline, queue, profiles) merges them in. New modules never edit mockBridge.ts.
//
// Only dev/ imports mock.ts files (bridge.ts installs the mock bridge under import.meta.env.DEV), so
// none of this reaches a production bundle. A mock.ts must not import another module's directory or
// dev/mockBridge.ts; it gets everything from the core through `MockCore`.
import type { DaemonEvents, DesktopApi, DesktopEvents } from "../../../shared/ipc";

/** Bridge events as the mock emits them: per-connection ones untagged (dev/mockBridge.ts tags them with the shown host). */
export type MockEvents = Omit<DesktopEvents, keyof DaemonEvents> & DaemonEvents;

/** What the core mock bridge offers a module mock. */
export interface MockCore {
  /** `?legacy`: an older cutex without dev/mockFeatures.ts MOCK_NEW_FEATURES. */
  readonly legacy: boolean;
  /** A raw bridge event to the renderer's listeners (a host connection's event: of the shown host). */
  emit<K extends keyof MockEvents>(event: K, payload: MockEvents[K]): void;
  /** A cutex notification on each session's stream and on the host feed (like cutex's event store). */
  emitCutex(sessionIds: string | readonly string[], method: string, params: Record<string, unknown>): void;
  /** A cutex notification on the host feed only (session "cutex.host"). */
  emitHost(method: string, params: Record<string, unknown>): void;
  /** A native (app-server) notification on a session's stream and the host feed. */
  nativeEvent(sessionId: string, method: string, params: unknown): void;
  /** The session's current cutex `runtimeGeneration` (advanced by each runtime start after a stop). */
  runtimeGeneration(sessionId: string): number;
  /** The session's native `thread/read` (with turns) as the core scripts it (reverts / forks applied). */
  threadRead(sessionId: string): unknown;
  /** The session runs this native turn: sends queue / steer like on a live agent. */
  markBusy(sessionId: string, turnId: string): void;
  /** The session's turn ended (the turn id stays as the last one). */
  markIdle(sessionId: string): void;
  /** Throws like cutex when the session's runtime lacks this agent feature (lib/agentFeatures.ts). */
  unsupportedFor(sessionId: string, feature: string): void;
  /** The mutable `/v2/settings` store (PATCH writes into it). */
  readonly settings: Record<string, unknown>;
  /** GET /v2/settings as the core returns it (module `settings` contributions included). */
  settingsView(): unknown;
  /**
   * cutex `client-token-rename` across the modules' token lists (dev/mockTokenNames.ts): a list
   * registers at install; `rename` sets / clears `ownerName` wherever the token is (throws 400 / 404).
   */
  readonly clientTokenNames: {
    register(list: import("./mockTokenNames").MockTokenList): void;
    rename(tokenId: string, name: string | null): { tokenId: string; ownerName: string | null };
    /** device-scope: set a token's scope in every list (false: unknown token). */
    setScope(tokenId: string, scope: "full" | "chat" | "read"): boolean;
    /** A revoke: every list drops the token (false: no list had it). */
    revoke(tokenId: string): boolean;
  };
}

export interface ModuleMock {
  /** Bridge api methods (DesktopApi) this module serves. Called once at install; a method may not be
   *  defined twice (test/modules.test.ts). Side effects that belong to install may run here. */
  api?(core: MockCore): Partial<DesktopApi>;
  /** Timers / scripted replays, started after the api is built. */
  start?(core: MockCore): void;
  /** thread/read for sessions whose history this module scripts (null = not mine). */
  thread?(sessionId: string): unknown | null;
  /** Extra `cutexState` fields of a session bootstrap. */
  cutexState?(sessionId: string, core: MockCore): Record<string, unknown>;
  /**
   * admission-order: this module's waiting turn-starting items of a session (e.g. delegations queued for
   * it), merged by the core's queue/list with the owner queue in `key` order (smaller = admitted first).
   */
  admission?(sessionId: string, core: MockCore): MockAdmissionEntry[];
  /** admission-order: the session's running turn when this module owns it (e.g. a delegation's); null = not mine. */
  currentTurn?(sessionId: string): import("@cutex-desktop/protocol").AdmissionCurrentTurn | null;
  /**
   * The local host's agent list as this module's daemon side extends it (fields of `GET /v2/sessions`
   * and its session resources, e.g. a Claude agent's `runtime.claudeRuntime`); returns a new snapshot.
   */
  sidebar?(snapshot: import("../../../shared/ipc").SidebarSnapshot, core: MockCore): import("../../../shared/ipc").SidebarSnapshot;
  /** Extra GET /v2/settings fields (not under `?legacy`, which reports the core settings only). */
  settings?(core: MockCore): Record<string, unknown>;
  /** featureList entries this module's daemon side reports: `base` always, `new` not under `?legacy`. */
  features?: { base?: readonly string[]; new?: readonly string[] };
  /** Text of a host file (`GET /v2/fs/file`) this module mocks, e.g. a SKILL.md; null = not mine. */
  hostFile?(path: string): string | null;
  /**
   * File bodies (binary too) this module serves to the core's `fsFile` / `hostFile`: the fs/file body
   * of a workspace-relative or host path, honouring `maxBytes` like cutex (null = not mine).
   */
  files?: {
    read(path: string, maxBytes?: number): import("../../../shared/ipc").FsFile | null;
  };
  /**
   * Methods another (SSH) mock host answers differently from the shared world (`bridge.apiFor`;
   * multi-host P1: workstation has its own services / jobs). `emitHost` = a host-feed event of that host.
   */
  remote?(hostId: string, emitHost: (method: string, params: Record<string, unknown>) => void): Partial<DesktopApi>;
  /**
   * Profile fields this module's daemon side owns (e.g. a Claude profile's `claudeAccount`):
   * `fields` adds them to `GET /v2/profiles` items and details; `patch` applies the keys of a
   * `PATCH /v2/profiles/{p}` body it owns (throwing like cutex to refuse it) and returns those keys,
   * which the core then neither stores nor applies. A `POST /v2/profiles` body's extra keys (e.g.
   * `claudeAccount`) go through `patch` right after the core created the profile (a throw undoes it).
   */
  profile?: {
    fields(profile: MockProfileRef, core: MockCore): Record<string, unknown>;
    patch(profile: MockProfileRef, body: Readonly<Record<string, unknown>>, core: MockCore): readonly string[];
  };
}

/** A non-owner admission item without its position, plus its order key (ms since the epoch). */
export type MockAdmissionEntry = (Extract<import("@cutex-desktop/protocol").AdmissionItem, { kind: "ask" | "delivery" }> extends infer T ? (T extends unknown ? Omit<T, "position"> : never) : never) & { key: number };

/** A profile as module mocks see it. */
export interface MockProfileRef {
  id: string;
  name: string;
  cliKind: "codex" | "claude";
}
